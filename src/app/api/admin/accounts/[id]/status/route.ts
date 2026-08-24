import {
  enforceAccountGuards,
  getPocketBaseError,
  isSafeRecordId,
  serializeAccount,
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
  recordAuditLog,
} from "@/lib/audit/log";

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
 * Limits
 * ============================================
 */

const MAX_REQUEST_BODY_BYTES =
  8 * 1024;

/*
 * ============================================
 * PATCH
 *
 * Enable / Disable Account
 *
 * Rate Limit:
 *
 * account.status
 * 20 requests / minute / admin
 * ============================================
 */

export async function PATCH(
  request: Request,
  {
    params,
  }: {
    params: Promise<{
      id: string;
    }>;
  }
) {
  const requestId =
    crypto.randomUUID();

  /*
   * ==========================================
   * Admin Authentication
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
    return accountApiError(
      requestId,
      400,
      "INVALID_ACCOUNT_ID",
      "شناسه حساب معتبر نیست."
    );
  }

  /*
   * ==========================================
   * Admin Rate Limit
   *
   * account.status
   *
   * 20 requests / minute / admin
   *
   * Target Account ID بخشی از Bucket نیست.
   * بنابراین تغییر Account باعث دور زدن
   * Rate Limit نمی‌شود.
   *
   * Fail-closed:
   * اگر Rate Limiter در دسترس نباشد وضعیت
   * Account تغییر نمی‌کند.
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
          "account.status",

        requestId,
      });
  } catch (error) {
    console.error(
      "Admin account status rate limit unavailable",
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
      "Admin account status rate limited",
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
        "تعداد درخواست‌های تغییر وضعیت حساب بیش از حد مجاز است.",
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
   * تمام Responseهای بعدی باید وضعیت Bucket
   * مصرف‌شده را برگردانند.
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
   * Declared Content Length
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
   * Bounded JSON Body
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

  /*
   * ==========================================
   * Strict Payload
   *
   * فقط:
   *
   * {
   *   active: boolean
   * }
   * ==========================================
   */

  const payload =
    parseStatusPayload(
      bodyResult.body
    );

  if (
    !payload.success
  ) {
    return respond(
      accountApiError(
        requestId,
        400,
        payload.code,
        payload.message,
        {
          fieldErrors:
            payload.fieldErrors,
        }
      )
    );
  }

  const {
    active,
  } = payload;

  /*
   * ==========================================
   * Service Client
   * ==========================================
   */

  let pb;

  try {
    pb =
      await getPocketBaseServiceClient();
  } catch (error) {
    console.error(
      "Account status service unavailable",
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
        "ACCOUNT_SERVICE_UNAVAILABLE",
        "سرویس امن مدیریت حساب‌ها در دسترس نیست."
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

    console.error(
      "Account status target lookup failed",
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
      )
    );
  }

  /*
   * ==========================================
   * No-op
   *
   * Rate Limit مصرف شده است.
   * ==========================================
   */

  if (
    (
      existing.active ===
      true
    ) ===
    active
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

          account:
            serializeAccount(
              account
            ),

          unchanged:
            true,

          message:
            active
              ? "حساب کاربری از قبل فعال است."
              : "حساب کاربری از قبل غیرفعال است.",
        },
        200,
        requestId
      )
    );
  }

  /*
   * ==========================================
   * Account Guards
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

        nextRole:
          existing.role ===
          "admin"
            ? "admin"
            : "employee",

        nextActive:
          active,
      });
  } catch (error) {
    console.error(
      "Account status guard failed",
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
        "ACCOUNT_GUARD_UNAVAILABLE",
        "بررسی محدودیت‌های امنیتی حساب ناموفق بود."
      )
    );
  }

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
        active
          ? "account.enable"
          : "account.disable",

      result:
        "blocked",

      errorCode:
        guard.code,

      metadata: {
        previous_active:
          existing.active ===
          true,

        requested_active:
          active,

        self_change:
          admin.account.id ===
          id,
      },
    });

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
   * Reactivation Safety
   *
   * قبل از فعال‌سازی Account تمام App Session
   *های قدیمی باید بسته شوند.
   * ==========================================
   */

  if (
    active &&
    existing.active !==
      true
  ) {
    try {
      const revocation =
        await revokeAllAppSessionsForUser({
          userId:
            id,

          reason:
            "account_reactivated",
        });

      const complete =
        revocation.revoked ===
        revocation.total;

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
          reason:
            "account_reactivated",

          total_sessions:
            revocation.total,

          revoked_sessions:
            revocation.revoked,
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
            "فعال‌سازی حساب انجام نشد؛ بستن نشست‌های قدیمی کاربر کامل نشد."
          )
        );
      }
    } catch (error) {
      console.error(
        "Account reactivation session cleanup failed",
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
          "account.sessions.revoke_all",

        result:
          "failure",

        errorCode:
          "SESSION_REVOCATION_FAILED",

        metadata: {
          reason:
            "account_reactivated",
        },
      });

      return respond(
        accountApiError(
          requestId,
          503,
          "SESSION_REVOCATION_FAILED",
          "فعال‌سازی حساب انجام نشد؛ نشست‌های قبلی کاربر قابل ابطال نبودند."
        )
      );
    }
  }

  /*
   * ==========================================
   * Update Account
   * ==========================================
   */

  try {
    await pb
      .collection(
        "accounts"
      )
      .update(
        id,
        {
          active,
        }
      );
  } catch (error) {
    const metadata =
      getPocketBaseError(
        error
      );

    console.error(
      "Account status update failed",
      {
        requestId,

        adminId:
          admin.account.id,

        accountId:
          id,

        nextActive:
          active,

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
        active
          ? "account.enable"
          : "account.disable",

      result:
        "failure",

      errorCode:
        "ACCOUNT_STATUS_UPDATE_FAILED",

      metadata: {
        previous_active:
          existing.active ===
          true,

        next_active:
          active,

        pocketbase_status:
          metadata.status,
      },
    });

    return respond(
      accountApiError(
        requestId,

        metadata.status ===
          404
          ? 404
          : metadata.status ===
              400
            ? 400
            : 503,

        metadata.status ===
          404
          ? "ACCOUNT_NOT_FOUND"
          : "ACCOUNT_STATUS_UPDATE_FAILED",

        metadata.status ===
          404
          ? "حساب موردنظر پیدا نشد."
          : "تغییر وضعیت حساب ناموفق بود."
      )
    );
  }

  /*
   * ==========================================
   * Status Audit
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
      active
        ? "account.enable"
        : "account.disable",

    result:
      "success",

    metadata: {
      previous_active:
        existing.active ===
        true,

      next_active:
        active,
    },
  });

  /*
   * ==========================================
   * Disable → Revoke Every Session
   * ==========================================
   */

  let sessionWarning:
    string |
    undefined;

  let sessionRevocation:
    {
      total:
        number;

      revoked:
        number;

      complete:
        boolean;
    } |
    undefined;

  if (
    !active
  ) {
    try {
      const result =
        await revokeAllAppSessionsForUser({
          userId:
            id,

          reason:
            "account_disabled",
        });

      const complete =
        result.revoked ===
        result.total;

      sessionRevocation = {
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
          reason:
            "account_disabled",

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
          "حساب غیرفعال شد، اما ابطال همه نشست‌های قبلی کامل انجام نشد.";
      }
    } catch (error) {
      console.error(
        "Disabled account session revocation failed",
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

      sessionWarning =
        "حساب غیرفعال شد، اما سرویس ابطال نشست‌ها موقتاً در دسترس نبود.";

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
          reason:
            "account_disabled",
        },
      });
    }
  }

  /*
   * ==========================================
   * Updated Record
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
            active
              ? "حساب کاربری فعال شد."
              : sessionWarning
                ? "حساب کاربری غیرفعال شد."
                : "حساب کاربری غیرفعال شد و همه نشست‌های کاربر بسته شدند.",

          ...(sessionWarning
            ? {
                warning:
                  sessionWarning,

                warningCode:
                  "SESSION_REVOCATION_WARNING",
              }
            : {}),

          ...(sessionRevocation
            ? {
                sessionRevocation,
              }
            : {}),
        },
        200,
        requestId
      )
    );
  } catch (error) {
    /*
     * Mutation اصلی موفق بوده است.
     */

    console.error(
      "Updated account reload failed",
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

          message:
            active
              ? "حساب کاربری فعال شد."
              : "حساب کاربری غیرفعال شد.",

          warning:
            "وضعیت حساب تغییر کرد، اما دریافت اطلاعات جدید حساب ناموفق بود.",

          warningCode:
            "ACCOUNT_RELOAD_FAILED",

          ...(sessionWarning
            ? {
                sessionWarning,
              }
            : {}),

          ...(sessionRevocation
            ? {
                sessionRevocation,
              }
            : {}),
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
 * Status Payload
 * ============================================
 */

function parseStatusPayload(
  body:
    unknown
):
  | {
      success:
        true;

      active:
        boolean;
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

  /*
   * ==========================================
   * Unknown Fields
   * ==========================================
   */

  const keys =
    Object.keys(
      value
    );

  if (
    keys.some(
      (
        key
      ) =>
        key !==
        "active"
    )
  ) {
    return {
      success:
        false,

      code:
        "UNEXPECTED_FIELDS",

      message:
        "فیلدهای ارسالی برای تغییر وضعیت حساب معتبر نیستند.",

      fieldErrors: {
        form:
          "فقط فیلد active قابل ارسال است.",
      },
    };
  }

  if (
    typeof value.active !==
    "boolean"
  ) {
    return {
      success:
        false,

      code:
        "VALIDATION_ERROR",

      message:
        "وضعیت حساب معتبر نیست.",

      fieldErrors: {
        active:
          "وضعیت حساب معتبر نیست.",
      },
    };
  }

  return {
    success:
      true,

    active:
      value.active,
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
          await reader
            .cancel();
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
    | "success"
    | "failure"
    | "blocked";

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
      "Account status audit failed",
      {
        requestId,

        action,

        targetUserId,

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