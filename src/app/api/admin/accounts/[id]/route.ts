import type PocketBase from "pocketbase";

import {
  recordAuditLog,
} from "@/lib/audit/log";

import {
  buildAccountPayload,
  enforceAccountGuards,
  getPocketBaseError,
  isSafeRecordId,
  parseAccountInput,
  serializeAccount,
  validateAccountUniqueness,
  validateDepartment,
  type AccountRecord,
} from "@/lib/accounts/admin";

import {
  accountApiError,
  accountApiResponse,
} from "@/lib/accounts/response";

import {
  consumeAdminRateLimit,
} from "@/lib/admin/rate-limit";

import {
  revokeAllAppSessionsForUser,
} from "@/lib/auth/app-session";

import {
  getAdminSession,
} from "@/lib/pocketbase/admin";

import {
  getPocketBaseServiceClient,
} from "@/lib/pocketbase/service";

/*
 * ============================================
 * Types
 * ============================================
 */

type Context = {
  params: Promise<{
    id: string;
  }>;
};

type AuditResult =
  | "success"
  | "failure"
  | "blocked";

type SessionRevocationInfo = {
  reason:
    string;

  total:
    number;

  revoked:
    number;

  complete:
    boolean;
};

/*
 * ============================================
 * Limits
 * ============================================
 */

const MAX_REQUEST_BODY_BYTES =
  16 * 1024;

const CONVERSATION_LIMIT =
  10;

const MESSAGE_COUNT_CONCURRENCY =
  4;

/*
 * PATCH این Route فقط اطلاعات پروفایل و
 * سطح دسترسی Account را تغییر می‌دهد.
 *
 * Password عمداً در Route جداگانه مدیریت
 * می‌شود.
 */
const ALLOWED_PATCH_FIELDS =
  new Set([
    "name",
    "email",
    "employee_code",
    "department",
    "job_title",
    "role",
    "active",
  ]);

/*
 * ============================================
 * GET
 *
 * Read-only.
 * Admin mutation rate-limit روی GET اعمال
 * نمی‌شود.
 * ============================================
 */

export async function GET(
  _request: Request,
  {
    params,
  }: Context
) {
  const requestId =
    crypto.randomUUID();

  /*
   * ==========================================
   * Admin Authorization
   * ==========================================
   */

  const admin =
    await getAdminSession();

  if (
    !admin.ok
  ) {
    return accountApiError(
      requestId,
      admin.status,
      admin.code,
      admin.message
    );
  }

  /*
   * ==========================================
   * Account ID
   * ==========================================
   */

  const {
    id,
  } = await params;

  if (
    !isSafeRecordId(
      id
    )
  ) {
    return invalidAccountId(
      requestId
    );
  }

  /*
   * ==========================================
   * Service Client
   * ==========================================
   */

  let pb:
    PocketBase;

  try {
    pb =
      await getPocketBaseServiceClient();
  } catch (error) {
    console.error(
      "Account details service unavailable",
      {
        requestId,

        adminId:
          admin.account.id,

        accountId:
          id,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return serviceUnavailable(
      requestId
    );
  }

  /*
   * ==========================================
   * Account / Activity
   * ==========================================
   */

  try {
    const [
      record,
      conversations,
      questions,
      lastQuestion,
    ] =
      await Promise.all([
        pb
          .collection(
            "accounts"
          )
          .getOne<AccountRecord>(
            id,
            {
              expand:
                "department",
            }
          ),

        pb
          .collection(
            "conversations"
          )
          .getList(
            1,
            CONVERSATION_LIMIT,
            {
              filter:
                pb.filter(
                  "user = {:user}",
                  {
                    user:
                      id,
                  }
                ),

              sort:
                "-last_message_at,-updated",

              fields:
                "id,title,status,created,updated,last_message_at",
            }
          ),

        pb
          .collection(
            "messages"
          )
          .getList(
            1,
            1,
            {
              filter:
                pb.filter(
                  "user = {:user} && role = 'user'",
                  {
                    user:
                      id,
                  }
                ),

              fields:
                "id",
            }
          ),

        pb
          .collection(
            "messages"
          )
          .getList(
            1,
            1,
            {
              filter:
                pb.filter(
                  "user = {:user} && role = 'user'",
                  {
                    user:
                      id,
                  }
                ),

              sort:
                "-created",

              fields:
                "id,created",
            }
          ),
      ]);

    /*
     * ========================================
     * Conversation Message Counts
     * ========================================
     */

    const messageCounts =
      await getConversationMessageCounts(
        pb,
        conversations.items.map(
          (
            item
          ) =>
            item.id
        )
      );

    /*
     * ========================================
     * Last Activity
     * ========================================
     */

    const conversationActivity =
      String(
        conversations
          .items[0]
          ?.last_message_at ||
          conversations
            .items[0]
            ?.updated ||
          conversations
            .items[0]
            ?.created ||
          ""
      );

    const questionActivity =
      String(
        lastQuestion
          .items[0]
          ?.created ||
          ""
      );

    const lastActivity =
      latestDate(
        conversationActivity,
        questionActivity
      );

    /*
     * ========================================
     * Response
     * ========================================
     */

    return accountApiResponse(
      {
        success:
          true,

        account:
          serializeAccount(
            record,
            {
              conversationCount:
                conversations.totalItems,

              questionCount:
                questions.totalItems,

              lastActivity,
            }
          ),

        currentAccountId:
          admin.account.id,

        conversations:
          conversations.items.map(
            (
              conversation
            ) => ({
              id:
                conversation.id,

              title:
                String(
                  conversation.title ||
                    "گفتگوی بدون عنوان"
                ),

              status:
                String(
                  conversation.status ||
                    ""
                ),

              created:
                String(
                  conversation.created ||
                    ""
                ),

              updated:
                String(
                  conversation.updated ||
                    ""
                ),

              last_message_at:
                String(
                  conversation.last_message_at ||
                    ""
                ),

              message_count:
                messageCounts.get(
                  conversation.id
                ) ||
                0,
            })
          ),
      },
      200,
      requestId
    );
  } catch (error) {
    console.error(
      "Account details load failed",
      {
        requestId,

        adminId:
          admin.account.id,

        accountId:
          id,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return loadError(
      requestId,
      error
    );
  }
}

/*
 * ============================================
 * PATCH
 *
 * Update Account
 *
 * Rate Limit:
 *
 * account.update
 * 20 requests / minute / admin
 * ============================================
 */

export async function PATCH(
  request: Request,
  {
    params,
  }: Context
) {
  const requestId =
    crypto.randomUUID();

  /*
   * ==========================================
   * Admin Authorization
   * ==========================================
   */

  const admin =
    await getAdminSession();

  if (
    !admin.ok
  ) {
    return accountApiError(
      requestId,
      admin.status,
      admin.code,
      admin.message
    );
  }

  /*
   * ==========================================
   * Account ID
   * ==========================================
   */

  const {
    id,
  } = await params;

  if (
    !isSafeRecordId(
      id
    )
  ) {
    return invalidAccountId(
      requestId
    );
  }

  /*
   * ==========================================
   * Admin Rate Limit
   *
   * account.update
   * 20 requests / minute / admin
   *
   * Target Account ID بخشی از Bucket نیست.
   *
   * بنابراین تغییر Target باعث دور زدن
   * Rate Limit نمی‌شود.
   *
   * Fail-closed:
   * Rate Limiter unavailable => Mutation
   * انجام نمی‌شود.
   * ==========================================
   */

  let rateLimit:
    Awaited<
      ReturnType<
        typeof consumeAdminRateLimit
      >
    >;

  try {
    rateLimit =
      await consumeAdminRateLimit({
        adminId:
          admin.account.id,

        action:
          "account.update",

        requestId,
      });
  } catch (error) {
    console.error(
      "Admin account update rate limit unavailable",
      {
        requestId,

        adminId:
          admin.account.id,

        accountId:
          id,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return accountApiError(
      requestId,
      503,
      "ADMIN_RATE_LIMIT_UNAVAILABLE",
      "سرویس کنترل تعداد درخواست‌ها موقتاً در دسترس نیست."
    );
  }

  /*
   * ==========================================
   * Rate Limited
   * ==========================================
   */

  if (
    !rateLimit.allowed
  ) {
    console.warn(
      "Admin account update rate limited",
      {
        requestId,

        adminId:
          admin.account.id,

        accountId:
          id,

        retryAfterSeconds:
          rateLimit.retryAfterSeconds,

        resetAt:
          rateLimit.resetAt,
      }
    );

    const response =
      accountApiError(
        requestId,
        429,
        "ADMIN_RATE_LIMITED",
        "تعداد درخواست‌های بروزرسانی حساب بیش از حد مجاز است.",
        {
          retryAfterSeconds:
            rateLimit.retryAfterSeconds,

          limit:
            rateLimit.limit,

          remaining:
            rateLimit.remaining,

          resetAt:
            rateLimit.resetAt,
        }
      );

    response.headers.set(
      "Retry-After",
      String(
        rateLimit.retryAfterSeconds
      )
    );

    response.headers.set(
      "X-RateLimit-Limit",
      String(
        rateLimit.limit
      )
    );

    response.headers.set(
      "X-RateLimit-Remaining",
      "0"
    );

    response.headers.set(
      "X-RateLimit-Reset",
      rateLimit.resetAt
    );

    return response;
  }

  /*
   * تمام Responseهای بعد از Consume باید
   * Headerهای Rate Limit را داشته باشند.
   */
  const respond =
    <TResponse extends Response>(
      response:
        TResponse
    ) =>
      withRateLimitHeaders(
        response,
        rateLimit
      );

  /*
   * ==========================================
   * Content Type
   * ==========================================
   */

  const contentType =
    String(
      request.headers.get(
        "content-type"
      ) ||
        ""
    )
      .split(
        ";"
      )[0]
      .trim()
      .toLowerCase();

  if (
    contentType !==
    "application/json"
  ) {
    return respond(
      accountApiError(
        requestId,
        415,
        "UNSUPPORTED_MEDIA_TYPE",
        "نوع محتوای درخواست معتبر نیست."
      )
    );
  }

  /*
   * ==========================================
   * Content Length
   * ==========================================
   */

  const rawContentLength =
    request.headers.get(
      "content-length"
    );

  if (
    rawContentLength
  ) {
    const contentLength =
      Number(
        rawContentLength
      );

    if (
      !Number.isSafeInteger(
        contentLength
      ) ||
      contentLength <
        0
    ) {
      return respond(
        accountApiError(
          requestId,
          400,
          "INVALID_CONTENT_LENGTH",
          "حجم درخواست معتبر نیست."
        )
      );
    }

    if (
      contentLength >
      MAX_REQUEST_BODY_BYTES
    ) {
      return respond(
        accountApiError(
          requestId,
          413,
          "REQUEST_BODY_TOO_LARGE",
          "حجم درخواست بیش از حد مجاز است."
        )
      );
    }
  }

  /*
   * ==========================================
   * Bounded JSON
   * ==========================================
   */

  const bodyResult =
    await readJsonBodyWithLimit(
      request,
      MAX_REQUEST_BODY_BYTES
    );

  if (
    !bodyResult.ok
  ) {
    return respond(
      accountApiError(
        requestId,
        bodyResult.status,
        bodyResult.code,
        bodyResult.message
      )
    );
  }

  const body =
    bodyResult.body;

  /*
   * ==========================================
   * Strict Raw Payload Validation
   * ==========================================
   */

  const rawValidation =
    validateAccountPatchPayload(
      body
    );

  if (
    !rawValidation.success
  ) {
    return respond(
      accountApiError(
        requestId,
        400,
        rawValidation.code,
        rawValidation.message,
        {
          fieldErrors:
            rawValidation.fieldErrors,
        }
      )
    );
  }

  /*
   * ==========================================
   * Parse / Normalize
   * ==========================================
   */

  const parsed =
    parseAccountInput(
      body,
      {
        requirePassword:
          false,
      }
    );

  if (
    !parsed.success
  ) {
    return respond(
      accountApiError(
        requestId,
        400,
        parsed.code,
        parsed.message,
        {
          fieldErrors:
            parsed.fieldErrors,
        }
      )
    );
  }

  /*
   * ==========================================
   * Service Client
   * ==========================================
   */

  let pb:
    PocketBase;

  try {
    pb =
      await getPocketBaseServiceClient();
  } catch (error) {
    console.error(
      "Account update service unavailable",
      {
        requestId,

        adminId:
          admin.account.id,

        accountId:
          id,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    await safeAudit({
      request,

      requestId,

      actorId:
        admin.account.id,

      targetUserId:
        id,

      action:
        "account.update",

      result:
        "failure",

      errorCode:
        "ACCOUNT_SERVICE_UNAVAILABLE",

      metadata: {
        stage:
          "service_client",
      },
    });

    return respond(
      serviceUnavailable(
        requestId
      )
    );
  }

  /*
   * ==========================================
   * Existing Account
   * ==========================================
   */

  let existing:
    AccountRecord;

  try {
    existing =
      await pb
        .collection(
          "accounts"
        )
        .getOne<AccountRecord>(
          id
        );
  } catch (error) {
    const metadata =
      getPocketBaseError(
        error
      );

    if (
      metadata.status ===
      404
    ) {
      return respond(
        accountApiError(
          requestId,
          404,
          "ACCOUNT_NOT_FOUND",
          "حساب موردنظر پیدا نشد."
        )
      );
    }

    console.error(
      "Account load before update failed",
      {
        requestId,

        adminId:
          admin.account.id,

        accountId:
          id,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return respond(
      accountApiError(
        requestId,
        503,
        "ACCOUNT_LOAD_FAILED",
        "دریافت اطلاعات حساب ناموفق بود."
      )
    );
  }

  /*
   * ==========================================
   * Previous / Next Values
   * ==========================================
   */

  const previousRole =
    normalizeRole(
      existing.role
    );

  const previousActive =
    existing.active !==
    false;

  const previousDepartment =
    String(
      existing.department ||
        ""
    );

  const previousName =
    String(
      existing.name ||
        ""
    );

  const previousEmail =
    String(
      existing.email ||
        ""
    );

  const previousEmployeeCode =
    String(
      existing.employee_code ||
        ""
    );

  const previousJobTitle =
    String(
      existing.job_title ||
        ""
    );

  const nextRole =
    parsed.data.role;

  const nextActive =
    parsed.data.active;

  const roleChanged =
    previousRole !==
    nextRole;

  const activeChanged =
    previousActive !==
    nextActive;

  const disabling =
    previousActive &&
    !nextActive;

  const enabling =
    !previousActive &&
    nextActive;

  /*
   * ==========================================
   * Changed Fields
   * ==========================================
   */

  const requestedChangedFields =
    getChangedFields({
      previous: {
        name:
          previousName,

        email:
          previousEmail,

        employeeCode:
          previousEmployeeCode,

        department:
          previousDepartment,

        jobTitle:
          previousJobTitle,

        role:
          previousRole,

        active:
          previousActive,
      },

      next: {
        name:
          parsed.data.name,

        email:
          parsed.data.email,

        employeeCode:
          parsed.data.employeeCode,

        department:
          parsed.data.department,

        jobTitle:
          parsed.data.jobTitle,

        role:
          parsed.data.role,

        active:
          parsed.data.active,
      },
    });

  /*
   * ==========================================
   * No-op
   *
   * Rate Limit Consume شده است.
   *
   * این رفتار عمدی است؛ repeated no-op نیز
   * Request مدیریتی محسوب می‌شود.
   * ==========================================
   */

  if (
    requestedChangedFields.length ===
    0
  ) {
    let account:
      AccountRecord;

    try {
      account =
        await pb
          .collection(
            "accounts"
          )
          .getOne<AccountRecord>(
            id,
            {
              expand:
                "department",
            }
          );
    } catch {
      account =
        existing;
    }

    return respond(
      accountApiResponse(
        {
          success:
            true,

          unchanged:
            true,

          account:
            serializeAccount(
              account
            ),

          message:
            "تغییری برای ذخیره وجود ندارد.",
        },
        200,
        requestId
      )
    );
  }

  /*
   * ==========================================
   * Guards
   * ==========================================
   */

  let guard;

  try {
    guard =
      await enforceAccountGuards({
        pb,

        actorId:
          admin.account.id,

        target:
          existing,

        nextRole,

        nextActive,
      });
  } catch (error) {
    console.error(
      "Account guard check failed",
      {
        requestId,

        adminId:
          admin.account.id,

        accountId:
          id,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    await safeAudit({
      request,

      requestId,

      actorId:
        admin.account.id,

      targetUserId:
        id,

      action:
        "account.update",

      result:
        "failure",

      errorCode:
        "ACCOUNT_GUARD_CHECK_FAILED",

      metadata: {
        previous_role:
          previousRole,

        requested_role:
          nextRole,

        previous_active:
          previousActive,

        requested_active:
          nextActive,
      },
    });

    return respond(
      accountApiError(
        requestId,
        503,
        "ACCOUNT_GUARD_CHECK_FAILED",
        "بررسی محدودیت‌های حساب ناموفق بود."
      )
    );
  }

  /*
   * ==========================================
   * Guard Block
   * ==========================================
   */

  if (
    guard
  ) {
    await safeAudit({
      request,

      requestId,

      actorId:
        admin.account.id,

      targetUserId:
        id,

      action:
        "account.update",

      result:
        "blocked",

      errorCode:
        guard.code,

      metadata: {
        previous_role:
          previousRole,

        requested_role:
          nextRole,

        previous_active:
          previousActive,

        requested_active:
          nextActive,

        self_change:
          admin.account.id ===
          id,
      },
    });

    if (
      roleChanged
    ) {
      await safeAudit({
        request,

        requestId,

        actorId:
          admin.account.id,

        targetUserId:
          id,

        action:
          "account.role_change",

        result:
          "blocked",

        errorCode:
          guard.code,

        metadata: {
          previous_role:
            previousRole,

          requested_role:
            nextRole,

          self_change:
            admin.account.id ===
            id,
        },
      });
    }

    if (
      disabling
    ) {
      await safeAudit({
        request,

        requestId,

        actorId:
          admin.account.id,

        targetUserId:
          id,

        action:
          "account.disable",

        result:
          "blocked",

        errorCode:
          guard.code,

        metadata: {
          previous_active:
            true,

          requested_active:
            false,

          self_change:
            admin.account.id ===
            id,
        },
      });
    }

    if (
      enabling
    ) {
      await safeAudit({
        request,

        requestId,

        actorId:
          admin.account.id,

        targetUserId:
          id,

        action:
          "account.enable",

        result:
          "blocked",

        errorCode:
          guard.code,

        metadata: {
          previous_active:
            false,

          requested_active:
            true,
        },
      });
    }

    return respond(
      accountApiError(
        requestId,
        409,
        guard.code,
        guard.message
      )
    );
  }

  /*
   * ==========================================
   * Uniqueness / Department
   * ==========================================
   */

  try {
    const [
      uniqueErrors,
      departmentError,
    ] =
      await Promise.all([
        validateAccountUniqueness(
          pb,
          parsed.data,
          id
        ),

        validateDepartment(
          pb,
          parsed.data.department,
          {
            allowInactiveId:
              previousDepartment,
          }
        ),
      ]);

    const fieldErrors = {
      ...uniqueErrors,

      ...(departmentError
        ? {
            department:
              departmentError,
          }
        : {}),
    };

    if (
      Object.keys(
        fieldErrors
      ).length >
      0
    ) {
      return respond(
        accountApiError(
          requestId,
          409,
          "ACCOUNT_CONFLICT",
          Object.values(
            fieldErrors
          )[0],
          {
            fieldErrors,
          }
        )
      );
    }
  } catch (error) {
    console.error(
      "Account validation failed",
      {
        requestId,

        adminId:
          admin.account.id,

        accountId:
          id,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return respond(
      accountApiError(
        requestId,
        503,
        "ACCOUNT_VALIDATION_FAILED",
        "بررسی اطلاعات حساب ناموفق بود."
      )
    );
  }

  /*
   * ==========================================
   * Pre-mutation Session Revocation
   * ==========================================
   */

  let preSessionRevocation:
    SessionRevocationInfo |
    undefined;

  if (
    roleChanged ||
    enabling
  ) {
    const reason =
      roleChanged
        ? "account_role_changed"
        : "account_reactivated";

    try {
      const result =
        await revokeAllAppSessionsForUser({
          userId:
            id,

          reason,
        });

      const complete =
        result.revoked ===
        result.total;

      preSessionRevocation = {
        reason,

        total:
          result.total,

        revoked:
          result.revoked,

        complete,
      };

      await safeAudit({
        request,

        requestId,

        actorId:
          admin.account.id,

        targetUserId:
          id,

        action:
          "account.sessions.revoke_all",

        result:
          complete
            ? "success"
            : "failure",

        errorCode:
          complete
            ? undefined
            : "SESSION_REVOCATION_PARTIAL",

        metadata: {
          reason,

          stage:
            "before_account_update",

          total_sessions:
            result.total,

          revoked_sessions:
            result.revoked,
        },
      });

      if (
        !complete
      ) {
        return respond(
          accountApiError(
            requestId,
            503,
            "SESSION_REVOCATION_INCOMPLETE",
            roleChanged
              ? "تغییر سطح دسترسی انجام نشد؛ بستن نشست‌های قبلی کاربر کامل نشد."
              : "فعال‌سازی حساب انجام نشد؛ بستن نشست‌های قبلی کاربر کامل نشد."
          )
        );
      }
    } catch (error) {
      console.error(
        "Pre-update account session revocation failed",
        {
          requestId,

          adminId:
            admin.account.id,

          accountId:
            id,

          reason,

          error:
            safeErrorMetadata(
              error
            ),
        }
      );

      await safeAudit({
        request,

        requestId,

        actorId:
          admin.account.id,

        targetUserId:
          id,

        action:
          "account.sessions.revoke_all",

        result:
          "failure",

        errorCode:
          "SESSION_REVOCATION_FAILED",

        metadata: {
          reason,

          stage:
            "before_account_update",
        },
      });

      return respond(
        accountApiError(
          requestId,
          503,
          "SESSION_REVOCATION_FAILED",
          roleChanged
            ? "تغییر سطح دسترسی انجام نشد؛ نشست‌های قبلی کاربر قابل ابطال نبودند."
            : "فعال‌سازی حساب انجام نشد؛ نشست‌های قبلی کاربر قابل ابطال نبودند."
        )
      );
    }
  }

  /*
   * ==========================================
   * Update
   * ==========================================
   */

  let updatedRecord:
    AccountRecord;

  try {
    updatedRecord =
      await pb
        .collection(
          "accounts"
        )
        .update<AccountRecord>(
          id,
          buildAccountPayload(
            parsed.data
          )
        );
  } catch (error) {
    const metadata =
      getPocketBaseError(
        error
      );

    console.error(
      "Account update failed",
      {
        requestId,

        adminId:
          admin.account.id,

        accountId:
          id,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    await safeAudit({
      request,

      requestId,

      actorId:
        admin.account.id,

      targetUserId:
        id,

      action:
        "account.update",

      result:
        "failure",

      errorCode:
        "ACCOUNT_UPDATE_FAILED",

      metadata: {
        changed_fields:
          requestedChangedFields,

        previous_role:
          previousRole,

        requested_role:
          nextRole,

        previous_active:
          previousActive,

        requested_active:
          nextActive,

        role_changed:
          roleChanged,

        active_changed:
          activeChanged,

        sessions_revoked_before_update:
          Boolean(
            preSessionRevocation
              ?.complete
          ),

        pocketbase_status:
          metadata.status,
      },
    });

    if (
      roleChanged
    ) {
      await safeAudit({
        request,

        requestId,

        actorId:
          admin.account.id,

        targetUserId:
          id,

        action:
          "account.role_change",

        result:
          "failure",

        errorCode:
          "ACCOUNT_ROLE_CHANGE_FAILED",

        metadata: {
          previous_role:
            previousRole,

          requested_role:
            nextRole,
        },
      });
    }

    if (
      disabling
    ) {
      await safeAudit({
        request,

        requestId,

        actorId:
          admin.account.id,

        targetUserId:
          id,

        action:
          "account.disable",

        result:
          "failure",

        errorCode:
          "ACCOUNT_DISABLE_FAILED",
      });
    }

    if (
      enabling
    ) {
      await safeAudit({
        request,

        requestId,

        actorId:
          admin.account.id,

        targetUserId:
          id,

        action:
          "account.enable",

        result:
          "failure",

        errorCode:
          "ACCOUNT_ENABLE_FAILED",
      });
    }

    if (
      metadata.status ===
      404
    ) {
      return respond(
        accountApiError(
          requestId,
          404,
          "ACCOUNT_NOT_FOUND",
          "حساب موردنظر پیدا نشد."
        )
      );
    }

    return respond(
      accountApiError(
        requestId,

        metadata.status ===
          400
          ? 400
          : 503,

        "ACCOUNT_UPDATE_FAILED",

        metadata.status ===
          400
          ? "بروزرسانی حساب به‌دلیل ناسازگاری اطلاعات ناموفق بود."
          : "بروزرسانی حساب کاربری ناموفق بود."
      )
    );
  }

  /*
   * ==========================================
   * Actual Changed Fields
   * ==========================================
   */

  const changedFields =
    getChangedFields({
      previous: {
        name:
          previousName,

        email:
          previousEmail,

        employeeCode:
          previousEmployeeCode,

        department:
          previousDepartment,

        jobTitle:
          previousJobTitle,

        role:
          previousRole,

        active:
          previousActive,
      },

      next: {
        name:
          String(
            updatedRecord.name ||
              ""
          ),

        email:
          String(
            updatedRecord.email ||
              ""
          ),

        employeeCode:
          String(
            updatedRecord.employee_code ||
              ""
          ),

        department:
          String(
            updatedRecord.department ||
              ""
          ),

        jobTitle:
          String(
            updatedRecord.job_title ||
              ""
          ),

        role:
          normalizeRole(
            updatedRecord.role
          ),

        active:
          updatedRecord.active !==
          false,
      },
    });

  /*
   * ==========================================
   * Success Audits
   * ==========================================
   */

  await safeAudit({
    request,

    requestId,

    actorId:
      admin.account.id,

    targetUserId:
      id,

    action:
      "account.update",

    result:
      "success",

    metadata: {
      changed_fields:
        changedFields,

      previous_role:
        previousRole,

      new_role:
        normalizeRole(
          updatedRecord.role
        ),

      previous_active:
        previousActive,

      new_active:
        updatedRecord.active !==
        false,

      self_change:
        admin.account.id ===
        id,
    },
  });

  if (
    roleChanged
  ) {
    await safeAudit({
      request,

      requestId,

      actorId:
        admin.account.id,

      targetUserId:
        id,

      action:
        "account.role_change",

      result:
        "success",

      metadata: {
        previous_role:
          previousRole,

        new_role:
          normalizeRole(
            updatedRecord.role
          ),

        self_change:
          admin.account.id ===
          id,
      },
    });
  }

  if (
    disabling
  ) {
    await safeAudit({
      request,

      requestId,

      actorId:
        admin.account.id,

      targetUserId:
        id,

      action:
        "account.disable",

      result:
        "success",

      metadata: {
        previous_active:
          true,

        new_active:
          false,

        self_change:
          admin.account.id ===
          id,
      },
    });
  }

  if (
    enabling
  ) {
    await safeAudit({
      request,

      requestId,

      actorId:
        admin.account.id,

      targetUserId:
        id,

      action:
        "account.enable",

      result:
        "success",

      metadata: {
        previous_active:
          false,

        new_active:
          true,
      },
    });
  }

  /*
   * ==========================================
   * Post-mutation Session Revocation
   * ==========================================
   */

  let sessionWarning:
    string |
    undefined;

  let postSessionRevocation:
    SessionRevocationInfo |
    undefined;

  if (
    disabling ||
    roleChanged
  ) {
    const reason =
      disabling
        ? "account_disabled"
        : "account_role_changed";

    try {
      const result =
        await revokeAllAppSessionsForUser({
          userId:
            id,

          reason,
        });

      const complete =
        result.revoked ===
        result.total;

      postSessionRevocation = {
        reason,

        total:
          result.total,

        revoked:
          result.revoked,

        complete,
      };

      await safeAudit({
        request,

        requestId,

        actorId:
          admin.account.id,

        targetUserId:
          id,

        action:
          "account.sessions.revoke_all",

        result:
          complete
            ? "success"
            : "failure",

        errorCode:
          complete
            ? undefined
            : "SESSION_REVOCATION_PARTIAL",

        metadata: {
          reason,

          stage:
            "after_account_update",

          total_sessions:
            result.total,

          revoked_sessions:
            result.revoked,
        },
      });

      if (
        !complete
      ) {
        sessionWarning =
          roleChanged
            ? "اطلاعات حساب تغییر کرد، اما ابطال همه نشست‌های دارای سطح دسترسی قبلی کامل انجام نشد."
            : "حساب غیرفعال شد، اما ابطال همه نشست‌های قبلی کامل انجام نشد.";
      }
    } catch (error) {
      console.error(
        "Post-update account session revocation failed",
        {
          requestId,

          adminId:
            admin.account.id,

          accountId:
            id,

          reason,

          error:
            safeErrorMetadata(
              error
            ),
        }
      );

      sessionWarning =
        roleChanged
          ? "اطلاعات حساب تغییر کرد، اما سرویس ابطال نشست‌های دارای سطح دسترسی قبلی موقتاً در دسترس نبود."
          : "حساب غیرفعال شد، اما سرویس ابطال نشست‌ها موقتاً در دسترس نبود.";

      await safeAudit({
        request,

        requestId,

        actorId:
          admin.account.id,

        targetUserId:
          id,

        action:
          "account.sessions.revoke_all",

        result:
          "failure",

        errorCode:
          "SESSION_REVOCATION_FAILED",

        metadata: {
          reason,

          stage:
            "after_account_update",
        },
      });
    }
  }

  /*
   * ==========================================
   * Reload Expanded Account
   * ==========================================
   */

  try {
    const updated =
      await pb
        .collection(
          "accounts"
        )
        .getOne<AccountRecord>(
          id,
          {
            expand:
              "department",
          }
        );

    return respond(
      accountApiResponse(
        {
          success:
            true,

          account:
            serializeAccount(
              updated
            ),

          message:
            "اطلاعات حساب با موفقیت بروزرسانی شد.",

          ...(sessionWarning
            ? {
                warning:
                  sessionWarning,

                warningCode:
                  "SESSION_REVOCATION_WARNING",
              }
            : {}),

          ...(
            preSessionRevocation ||
            postSessionRevocation
              ? {
                  sessionRevocation: {
                    beforeUpdate:
                      preSessionRevocation ||
                      null,

                    afterUpdate:
                      postSessionRevocation ||
                      null,
                  },
                }
              : {}
          ),
        },
        200,
        requestId
      )
    );
  } catch (error) {
    /*
     * Mutation واقعاً موفق شده است.
     */

    console.error(
      "Account updated but reload failed",
      {
        requestId,

        adminId:
          admin.account.id,

        accountId:
          id,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return respond(
      accountApiResponse(
        {
          success:
            true,

          account:
            serializeAccount(
              updatedRecord
            ),

          message:
            "اطلاعات حساب با موفقیت بروزرسانی شد.",

          warning:
            sessionWarning
              ? `${sessionWarning} همچنین دریافت اطلاعات تکمیلی حساب ناموفق بود.`
              : "اطلاعات حساب بروزرسانی شد، اما دریافت اطلاعات تکمیلی حساب ناموفق بود.",

          warningCode:
            sessionWarning
              ? "ACCOUNT_UPDATE_WITH_WARNINGS"
              : "ACCOUNT_RELOAD_FAILED",

          ...(
            preSessionRevocation ||
            postSessionRevocation
              ? {
                  sessionRevocation: {
                    beforeUpdate:
                      preSessionRevocation ||
                      null,

                    afterUpdate:
                      postSessionRevocation ||
                      null,
                  },
                }
              : {}
          ),
        },
        200,
        requestId
      )
    );
  }
}

/*
 * ============================================
 * Rate Limit Headers
 * ============================================
 */

function withRateLimitHeaders<
  TResponse extends Response,
>(
  response:
    TResponse,

  rateLimit: {
    limit:
      number;

    remaining:
      number;

    resetAt:
      string;
  }
) {
  response.headers.set(
    "X-RateLimit-Limit",
    String(
      rateLimit.limit
    )
  );

  response.headers.set(
    "X-RateLimit-Remaining",
    String(
      rateLimit.remaining
    )
  );

  response.headers.set(
    "X-RateLimit-Reset",
    rateLimit.resetAt
  );

  return response;
}

/*
 * ============================================
 * Strict Account PATCH Payload
 * ============================================
 */

function validateAccountPatchPayload(
  body:
    unknown
):
  | {
      success:
        true;
    }
  | {
      success:
        false;

      code:
        string;

      message:
        string;

      fieldErrors:
        Record<
          string,
          string
        >;
    } {
  if (
    typeof body !==
      "object" ||
    body ===
      null ||
    Array.isArray(
      body
    )
  ) {
    return {
      success:
        false,

      code:
        "VALIDATION_ERROR",

      message:
        "ساختار درخواست معتبر نیست.",

      fieldErrors: {
        form:
          "ساختار درخواست معتبر نیست.",
      },
    };
  }

  const value =
    body as Record<
      string,
      unknown
    >;

  const unknownFields =
    Object.keys(
      value
    ).filter(
      (
        key
      ) =>
        !ALLOWED_PATCH_FIELDS.has(
          key
        )
    );

  if (
    unknownFields.length >
    0
  ) {
    return {
      success:
        false,

      code:
        "UNEXPECTED_FIELDS",

      message:
        "فیلدهای ارسالی برای بروزرسانی حساب معتبر نیستند.",

      fieldErrors: {
        form:
          "فقط فیلدهای مجاز اطلاعات حساب قابل ارسال هستند.",
      },
    };
  }

  const fieldErrors:
    Record<
      string,
      string
    > = {};

  if (
    value.name !==
      undefined &&
    typeof value.name !==
      "string"
  ) {
    fieldErrors.name =
      "نام معتبر نیست.";
  }

  if (
    value.email !==
      undefined &&
    typeof value.email !==
      "string"
  ) {
    fieldErrors.email =
      "ایمیل معتبر نیست.";
  }

  if (
    value.employee_code !==
      undefined &&
    typeof value.employee_code !==
      "string"
  ) {
    fieldErrors.employee_code =
      "کد کارشناس معتبر نیست.";
  }

  if (
    value.department !==
      undefined &&
    typeof value.department !==
      "string"
  ) {
    fieldErrors.department =
      "دپارتمان معتبر نیست.";
  }

  if (
    value.job_title !==
      undefined &&
    typeof value.job_title !==
      "string"
  ) {
    fieldErrors.job_title =
      "عنوان شغلی معتبر نیست.";
  }

  if (
    typeof value.name ===
      "string" &&
    normalizedSingleLineLength(
      value.name
    ) >
      120
  ) {
    fieldErrors.name =
      "نام نباید بیشتر از ۱۲۰ نویسه باشد.";
  }

  if (
    typeof value.email ===
      "string" &&
    value.email
      .trim()
      .length >
      254
  ) {
    fieldErrors.email =
      "ایمیل نباید بیشتر از ۲۵۴ نویسه باشد.";
  }

  if (
    typeof value.employee_code ===
      "string" &&
    normalizedSingleLineLength(
      value.employee_code
    ) >
      50
  ) {
    fieldErrors.employee_code =
      "کد کارشناس نباید بیشتر از ۵۰ نویسه باشد.";
  }

  if (
    typeof value.job_title ===
      "string" &&
    normalizedSingleLineLength(
      value.job_title
    ) >
      120
  ) {
    fieldErrors.job_title =
      "عنوان شغلی نباید بیشتر از ۱۲۰ نویسه باشد.";
  }

  if (
    typeof value.department ===
      "string"
  ) {
    const department =
      value.department.trim();

    if (
      department &&
      !isSafeRecordId(
        department
      )
    ) {
      fieldErrors.department =
        "شناسه دپارتمان معتبر نیست.";
    }
  }

  if (
    value.role !==
      undefined &&
    value.role !==
      "employee" &&
    value.role !==
      "admin"
  ) {
    fieldErrors.role =
      "Role انتخاب‌شده معتبر نیست.";
  }

  if (
    value.active !==
      undefined &&
    typeof value.active !==
      "boolean"
  ) {
    fieldErrors.active =
      "وضعیت حساب معتبر نیست.";
  }

  if (
    Object.keys(
      fieldErrors
    ).length >
    0
  ) {
    return {
      success:
        false,

      code:
        "VALIDATION_ERROR",

      message:
        Object.values(
          fieldErrors
        )[0],

      fieldErrors,
    };
  }

  return {
    success:
      true,
  };
}

/*
 * ============================================
 * Limited JSON Body
 * ============================================
 */

async function readJsonBodyWithLimit(
  request:
    Request,

  maximumBytes:
    number
): Promise<
  | {
      ok:
        true;

      body:
        unknown;
    }
  | {
      ok:
        false;

      status:
        number;

      code:
        string;

      message:
        string;
    }
> {
  if (
    !request.body
  ) {
    return {
      ok:
        false,

      status:
        400,

      code:
        "INVALID_JSON",

      message:
        "ساختار درخواست معتبر نیست.",
    };
  }

  const reader =
    request.body
      .getReader();

  const decoder =
    new TextDecoder(
      "utf-8",
      {
        fatal:
          true,
      }
    );

  let totalBytes =
    0;

  let text =
    "";

  try {
    while (
      true
    ) {
      const {
        done,
        value,
      } =
        await reader.read();

      if (
        done
      ) {
        break;
      }

      if (
        !value
      ) {
        continue;
      }

      totalBytes +=
        value.byteLength;

      if (
        totalBytes >
        maximumBytes
      ) {
        try {
          await reader.cancel();
        } catch {
          // Ignore cancel failure.
        }

        return {
          ok:
            false,

          status:
            413,

          code:
            "REQUEST_BODY_TOO_LARGE",

          message:
            "حجم درخواست بیش از حد مجاز است.",
        };
      }

      text +=
        decoder.decode(
          value,
          {
            stream:
              true,
          }
        );
    }

    text +=
      decoder.decode();
  } catch {
    return {
      ok:
        false,

      status:
        400,

      code:
        "INVALID_JSON",

      message:
        "ساختار درخواست معتبر نیست.",
    };
  }

  if (
    !text.trim()
  ) {
    return {
      ok:
        false,

      status:
        400,

      code:
        "INVALID_JSON",

      message:
        "ساختار درخواست معتبر نیست.",
    };
  }

  try {
    return {
      ok:
        true,

      body:
        JSON.parse(
          text
        ),
    };
  } catch {
    return {
      ok:
        false,

      status:
        400,

      code:
        "INVALID_JSON",

      message:
        "ساختار درخواست معتبر نیست.",
    };
  }
}

/*
 * ============================================
 * Conversation Message Counts
 * ============================================
 */

async function getConversationMessageCounts(
  pb:
    PocketBase,

  conversationIds:
    string[]
) {
  const counts =
    new Map<
      string,
      number
    >();

  const safeIds =
    [
      ...new Set(
        conversationIds.filter(
          isSafeRecordId
        )
      ),
    ].slice(
      0,
      CONVERSATION_LIMIT
    );

  if (
    safeIds.length ===
    0
  ) {
    return counts;
  }

  await mapWithConcurrency(
    safeIds,
    MESSAGE_COUNT_CONCURRENCY,
    async (
      conversationId
    ) => {
      try {
        const result =
          await pb
            .collection(
              "messages"
            )
            .getList(
              1,
              1,
              {
                filter:
                  pb.filter(
                    "conversation = {:conversation}",
                    {
                      conversation:
                        conversationId,
                    }
                  ),

                fields:
                  "id",
              }
            );

        counts.set(
          conversationId,
          result.totalItems
        );
      } catch (error) {
        console.error(
          "Conversation message count failed",
          {
            conversationId,

            error:
              safeErrorMetadata(
                error
              ),
          }
        );

        counts.set(
          conversationId,
          0
        );
      }
    }
  );

  return counts;
}

/*
 * ============================================
 * Limited Concurrency
 * ============================================
 */

async function mapWithConcurrency<
  TItem
>(
  items:
    TItem[],

  concurrency:
    number,

  worker: (
    item:
      TItem
  ) => Promise<void>
) {
  if (
    items.length ===
    0
  ) {
    return;
  }

  const workerCount =
    Math.min(
      Math.max(
        1,
        Math.floor(
          concurrency
        )
      ),
      items.length
    );

  let nextIndex =
    0;

  async function runWorker() {
    while (
      true
    ) {
      const currentIndex =
        nextIndex;

      if (
        currentIndex >=
        items.length
      ) {
        return;
      }

      nextIndex +=
        1;

      await worker(
        items[
          currentIndex
        ]
      );
    }
  }

  await Promise.all(
    Array.from(
      {
        length:
          workerCount,
      },
      () =>
        runWorker()
    )
  );
}

/*
 * ============================================
 * Audit Helper
 * ============================================
 */

async function safeAudit({
  request,
  requestId,
  actorId,
  targetUserId,
  action,
  result,
  errorCode,
  metadata,
}: {
  request:
    Request;

  requestId:
    string;

  actorId:
    string;

  targetUserId:
    string;

  action:
    string;

  result:
    AuditResult;

  errorCode?:
    string;

  metadata?:
    Record<
      string,
      unknown
    >;
}) {
  try {
    await recordAuditLog({
      request,

      requestId,

      actorId,

      actorRole:
        "admin",

      action,

      result,

      entityType:
        "account",

      entityId:
        targetUserId,

      targetUserId,

      ...(errorCode
        ? {
            errorCode,
          }
        : {}),

      ...(metadata
        ? {
            metadata,
          }
        : {}),
    });
  } catch (error) {
    console.error(
      "Account audit failed",
      {
        requestId,

        targetUserId,

        action,

        result,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );
  }
}

/*
 * ============================================
 * Changed Fields
 * ============================================
 */

function getChangedFields({
  previous,
  next,
}: {
  previous: {
    name:
      string;

    email:
      string;

    employeeCode:
      string;

    department:
      string;

    jobTitle:
      string;

    role:
      string;

    active:
      boolean;
  };

  next: {
    name:
      string;

    email:
      string;

    employeeCode:
      string;

    department:
      string;

    jobTitle:
      string;

    role:
      string;

    active:
      boolean;
  };
}) {
  const fields:
    string[] = [];

  if (
    previous.name !==
    next.name
  ) {
    fields.push(
      "name"
    );
  }

  if (
    previous.email !==
    next.email
  ) {
    fields.push(
      "email"
    );
  }

  if (
    previous.employeeCode !==
    next.employeeCode
  ) {
    fields.push(
      "employee_code"
    );
  }

  if (
    previous.department !==
    next.department
  ) {
    fields.push(
      "department"
    );
  }

  if (
    previous.jobTitle !==
    next.jobTitle
  ) {
    fields.push(
      "job_title"
    );
  }

  if (
    previous.role !==
    next.role
  ) {
    fields.push(
      "role"
    );
  }

  if (
    previous.active !==
    next.active
  ) {
    fields.push(
      "active"
    );
  }

  return fields;
}

/*
 * ============================================
 * Normalized Single-Line Length
 * ============================================
 */

function normalizedSingleLineLength(
  value:
    string
) {
  return value
    .replace(
      /[\u0000-\u001f\u007f]/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim()
    .length;
}

/*
 * ============================================
 * Role
 * ============================================
 */

function normalizeRole(
  value:
    unknown
) {
  if (
    value ===
    "admin"
  ) {
    return "admin";
  }

  if (
    value ===
    "employee"
  ) {
    return "employee";
  }

  return "unknown";
}

/*
 * ============================================
 * Load Error
 * ============================================
 */

function loadError(
  requestId:
    string,

  error:
    unknown
) {
  const metadata =
    getPocketBaseError(
      error
    );

  return accountApiError(
    requestId,

    metadata.status ===
      404
      ? 404
      : 503,

    metadata.status ===
      404
      ? "ACCOUNT_NOT_FOUND"
      : "ACCOUNT_LOAD_FAILED",

    metadata.status ===
      404
      ? "حساب موردنظر پیدا نشد."
      : "دریافت اطلاعات حساب ناموفق بود."
  );
}

/*
 * ============================================
 * Service Unavailable
 * ============================================
 */

function serviceUnavailable(
  requestId:
    string
) {
  return accountApiError(
    requestId,
    503,
    "ACCOUNT_SERVICE_UNAVAILABLE",
    "سرویس امن مدیریت حساب‌ها پیکربندی نشده است."
  );
}

/*
 * ============================================
 * Invalid ID
 * ============================================
 */

function invalidAccountId(
  requestId:
    string
) {
  return accountApiError(
    requestId,
    400,
    "INVALID_ACCOUNT_ID",
    "شناسه حساب معتبر نیست."
  );
}

/*
 * ============================================
 * Latest Date
 * ============================================
 */

function latestDate(
  left:
    string,

  right:
    string
) {
  if (
    !left
  ) {
    return right;
  }

  if (
    !right
  ) {
    return left;
  }

  const leftTime =
    Date.parse(
      left
    );

  const rightTime =
    Date.parse(
      right
    );

  if (
    !Number.isFinite(
      leftTime
    )
  ) {
    return right;
  }

  if (
    !Number.isFinite(
      rightTime
    )
  ) {
    return left;
  }

  return rightTime >
    leftTime
    ? right
    : left;
}

/*
 * ============================================
 * Safe Error Metadata
 * ============================================
 */

function safeErrorMetadata(
  error:
    unknown
) {
  if (
    typeof error !==
      "object" ||
    error ===
      null
  ) {
    return {
      name:
        "UnknownError",
    };
  }

  const value =
    error as {
      name?:
        unknown;

      message?:
        unknown;

      status?:
        unknown;

      code?:
        unknown;
    };

  return {
    name:
      typeof value.name ===
      "string"
        ? value.name
        : undefined,

    message:
      typeof value.message ===
      "string"
        ? value.message
        : undefined,

    status:
      typeof value.status ===
      "number"
        ? value.status
        : undefined,

    code:
      typeof value.code ===
        "string" ||
      typeof value.code ===
        "number"
        ? value.code
        : undefined,
  };
}