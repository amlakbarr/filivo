import {
  NextResponse,
} from "next/server";

import type {
  RecordModel,
} from "pocketbase";

import type PocketBase from "pocketbase";

import {
  recordAuditLog,
} from "@/lib/audit/log";

import {
  checkAIBudgetGuard,
} from "@/lib/ai/budget-guard";

import {
  isSafeRecordId,
} from "@/lib/accounts/admin";

import {
  consumeAdminRateLimit,
} from "@/lib/admin/rate-limit";

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

type AILimitRecord =
  RecordModel & {
    user?: string;

    enabled?: boolean;

    daily_token_limit?: number;

    monthly_token_limit?: number;

    daily_cost_limit_usd?: number;

    monthly_cost_limit_usd?: number;

    warning_percent?: number;
  };

type LimitInput = {
  enabled: boolean;

  dailyTokenLimit: number;

  monthlyTokenLimit: number;

  dailyCostLimitUsd: number;

  monthlyCostLimitUsd: number;

  warningPercent: number;
};

type LimitParseResult =
  | {
      success: true;

      data: LimitInput;
    }
  | {
      success: false;

      code: string;

      message: string;

      fieldErrors:
        Record<
          string,
          string
        >;
    };

/*
 * ============================================
 * Limits
 * ============================================
 */

const MAX_REQUEST_BODY_BYTES =
  8 * 1024;

const MAX_DAILY_TOKEN_LIMIT =
  100_000_000;

const MAX_MONTHLY_TOKEN_LIMIT =
  1_000_000_000;

const MAX_DAILY_COST_LIMIT_USD =
  100_000;

const MAX_MONTHLY_COST_LIMIT_USD =
  1_000_000;

const ALLOWED_PATCH_FIELDS =
  new Set([
    "enabled",
    "dailyTokenLimit",
    "monthlyTokenLimit",
    "dailyCostLimitUsd",
    "monthlyCostLimitUsd",
    "warningPercent",
  ]);

/*
 * ============================================
 * GET
 *
 * Read-only.
 *
 * Admin mutation Rate Limit عمداً روی GET
 * اعمال نمی‌شود.
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
    return apiError(
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
    id: accountId,
  } = await params;

  if (
    !isSafeRecordId(
      accountId
    )
  ) {
    return apiError(
      requestId,
      400,
      "INVALID_ACCOUNT_ID",
      "شناسه حساب معتبر نیست."
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
      "AI limit service unavailable",
      {
        requestId,

        adminId:
          admin.account.id,

        accountId,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return apiError(
      requestId,
      503,
      "ACCOUNT_SERVICE_UNAVAILABLE",
      "سرویس مدیریت سهمیه در دسترس نیست."
    );
  }

  /*
   * ==========================================
   * Target Account
   * ==========================================
   */

  const accountCheck =
    await ensureAccountExists(
      pb,
      accountId
    );

  if (
    !accountCheck.ok
  ) {
    return apiError(
      requestId,
      accountCheck.status,
      accountCheck.code,
      accountCheck.message
    );
  }

  /*
   * ==========================================
   * Load Limit + Budget
   * ==========================================
   */

  try {
    const [
      configuredLimit,
      budget,
    ] =
      await Promise.all([
        findLimitRecord(
          pb,
          accountId
        ),

        checkAIBudgetGuard({
          userId:
            accountId,
        }),
      ]);

    return apiResponse(
      {
        success:
          true,

        configured:
          configuredLimit
            ? serializeConfiguredLimit(
                configuredLimit
              )
            : null,

        effective:
          budget.limits,

        usage:
          budget.usage,

        budgetStatus:
          serializeBudgetStatus(
            budget
          ),
      },
      200,
      requestId
    );
  } catch (error) {
    console.error(
      "Account AI limit load failed",
      {
        requestId,

        adminId:
          admin.account.id,

        accountId,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return apiError(
      requestId,
      503,
      "AI_LIMIT_LOAD_FAILED",
      "دریافت اطلاعات سهمیه هوش مصنوعی ناموفق بود."
    );
  }
}

/*
 * ============================================
 * PATCH
 *
 * Create / Update Account Override
 *
 * Rate Limit:
 *
 * account.ai_limit
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
    return apiError(
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
    id: accountId,
  } = await params;

  if (
    !isSafeRecordId(
      accountId
    )
  ) {
    return apiError(
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
   * PATCH و DELETE از Bucket مشترک:
   *
   * account.ai_limit
   *
   * استفاده می‌کنند.
   *
   * Target Account ID بخشی از Bucket نیست.
   *
   * Fail-closed:
   * اگر Rate Limiter در دسترس نباشد هیچ
   * تنظیم سهمیه‌ای تغییر نمی‌کند.
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
          "account.ai_limit",

        requestId,
      });
  } catch (error) {
    console.error(
      "Admin AI limit rate limit unavailable",
      {
        requestId,

        adminId:
          admin.account.id,

        accountId,

        operation:
          "update",

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return apiError(
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
      "Admin AI limit update rate limited",
      {
        requestId,

        adminId:
          admin.account.id,

        accountId,

        retryAfterSeconds:
          rateLimit.retryAfterSeconds,

        resetAt:
          rateLimit.resetAt,
      }
    );

    return rateLimitedResponse(
      requestId,
      rateLimit,
      "تعداد درخواست‌های تغییر سهمیه هوش مصنوعی بیش از حد مجاز است."
    );
  }

  const allowedRateLimit =
    rateLimit;

  const respond =
    <TResponse extends Response>(
      response:
        TResponse
    ) =>
      withRateLimitHeaders(
        response,
        allowedRateLimit
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
      apiError(
        requestId,
        415,
        "UNSUPPORTED_MEDIA_TYPE",
        "نوع محتوای درخواست معتبر نیست."
      )
    );
  }

  /*
   * ==========================================
   * Content-Length Fast Reject
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
        apiError(
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
        apiError(
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
      apiError(
        requestId,
        bodyResult.status,
        bodyResult.code,
        bodyResult.message
      )
    );
  }

  /*
   * ==========================================
   * Strict Input Validation
   * ==========================================
   */

  const parsed =
    parseLimitInput(
      bodyResult.body
    );

  if (
    !parsed.success
  ) {
    return respond(
      apiError(
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

  const data =
    parsed.data;

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
      "AI limit update service unavailable",
      {
        requestId,

        adminId:
          admin.account.id,

        accountId,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return respond(
      apiError(
        requestId,
        503,
        "ACCOUNT_SERVICE_UNAVAILABLE",
        "سرویس مدیریت سهمیه در دسترس نیست."
      )
    );
  }

  /*
   * ==========================================
   * Target Account
   * ==========================================
   */

  const accountCheck =
    await ensureAccountExists(
      pb,
      accountId
    );

  if (
    !accountCheck.ok
  ) {
    return respond(
      apiError(
        requestId,
        accountCheck.status,
        accountCheck.code,
        accountCheck.message
      )
    );
  }

  /*
   * ==========================================
   * Existing Override
   * ==========================================
   */

  let existing:
    AILimitRecord |
    null;

  try {
    existing =
      await findLimitRecord(
        pb,
        accountId
      );
  } catch (error) {
    console.error(
      "Account AI limit lookup failed",
      {
        requestId,

        adminId:
          admin.account.id,

        accountId,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return respond(
      apiError(
        requestId,
        503,
        "AI_LIMIT_LOAD_FAILED",
        "بررسی سهمیه فعلی ناموفق بود."
      )
    );
  }

  /*
   * ==========================================
   * PocketBase Payload
   * ==========================================
   */

  const payload = {
    user:
      accountId,

    enabled:
      data.enabled,

    daily_token_limit:
      data.dailyTokenLimit,

    monthly_token_limit:
      data.monthlyTokenLimit,

    daily_cost_limit_usd:
      data.dailyCostLimitUsd,

    monthly_cost_limit_usd:
      data.monthlyCostLimitUsd,

    warning_percent:
      data.warningPercent,
  };

  /*
   * ==========================================
   * Save
   * ==========================================
   */

  let saved:
    AILimitRecord;

  try {
    if (
      existing
    ) {
      saved =
        await pb
          .collection(
            "account_ai_limits"
          )
          .update<AILimitRecord>(
            existing.id,
            payload
          );
    } else {
      saved =
        await pb
          .collection(
            "account_ai_limits"
          )
          .create<AILimitRecord>(
            payload
          );
    }
  } catch (error) {
    console.error(
      "Account AI limit update failed",
      {
        requestId,

        adminId:
          admin.account.id,

        accountId,

        operation:
          existing
            ? "update"
            : "create",

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

      accountId,

      action:
        "account.ai_limit.update",

      result:
        "failure",

      errorCode:
        "AI_LIMIT_UPDATE_FAILED",

      metadata: {
        operation:
          existing
            ? "update"
            : "create",
      },
    });

    return respond(
      apiError(
        requestId,
        503,
        "AI_LIMIT_UPDATE_FAILED",
        "ذخیره سهمیه هوش مصنوعی ناموفق بود."
      )
    );
  }

  /*
   * ==========================================
   * Audit Success
   * ==========================================
   */

  await safeAudit({
    request,

    requestId,

    actorId:
      admin.account.id,

    accountId,

    action:
      "account.ai_limit.update",

    result:
      "success",

    metadata: {
      operation:
        existing
          ? "update"
          : "create",

      previous:
        existing
          ? serializeConfiguredLimit(
              existing
            )
          : null,

      next:
        serializeConfiguredLimit(
          saved
        ),
    },
  });

  /*
   * ==========================================
   * Refresh Effective Budget
   * ==========================================
   */

  try {
    const budget =
      await checkAIBudgetGuard({
        userId:
          accountId,
      });

    return respond(
      apiResponse(
        {
          success:
            true,

          configured:
            serializeConfiguredLimit(
              saved
            ),

          effective:
            budget.limits,

          usage:
            budget.usage,

          budgetStatus:
            serializeBudgetStatus(
              budget
            ),

          message:
            "سهمیه هوش مصنوعی کارشناس با موفقیت ذخیره شد.",
        },
        200,
        requestId
      )
    );
  } catch (error) {
    console.error(
      "AI limit saved but budget refresh failed",
      {
        requestId,

        adminId:
          admin.account.id,

        accountId,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return respond(
      apiResponse(
        {
          success:
            true,

          configured:
            serializeConfiguredLimit(
              saved
            ),

          message:
            "سهمیه هوش مصنوعی ذخیره شد.",

          warning:
            "سهمیه ذخیره شد، اما محاسبه مصرف و سهمیه مؤثر جدید موقتاً در دسترس نیست.",

          warningCode:
            "AI_BUDGET_REFRESH_FAILED",
        },
        200,
        requestId
      )
    );
  }
}

/*
 * ============================================
 * DELETE
 *
 * حذف Override و برگشت به Defaults
 *
 * Rate Limit:
 *
 * همان Bucket مشترک account.ai_limit
 * ============================================
 */

export async function DELETE(
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
    return apiError(
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
    id: accountId,
  } = await params;

  if (
    !isSafeRecordId(
      accountId
    )
  ) {
    return apiError(
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
   * PATCH + DELETE:
   *
   * account.ai_limit
   * 20/min/admin
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
          "account.ai_limit",

        requestId,
      });
  } catch (error) {
    console.error(
      "Admin AI limit reset rate limit unavailable",
      {
        requestId,

        adminId:
          admin.account.id,

        accountId,

        operation:
          "reset",

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return apiError(
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
      "Admin AI limit reset rate limited",
      {
        requestId,

        adminId:
          admin.account.id,

        accountId,

        retryAfterSeconds:
          rateLimit.retryAfterSeconds,

        resetAt:
          rateLimit.resetAt,
      }
    );

    return rateLimitedResponse(
      requestId,
      rateLimit,
      "تعداد درخواست‌های تغییر سهمیه هوش مصنوعی بیش از حد مجاز است."
    );
  }

  const allowedRateLimit =
    rateLimit;

  const respond =
    <TResponse extends Response>(
      response:
        TResponse
    ) =>
      withRateLimitHeaders(
        response,
        allowedRateLimit
      );

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
      "AI limit reset service unavailable",
      {
        requestId,

        adminId:
          admin.account.id,

        accountId,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return respond(
      apiError(
        requestId,
        503,
        "ACCOUNT_SERVICE_UNAVAILABLE",
        "سرویس مدیریت سهمیه در دسترس نیست."
      )
    );
  }

  /*
   * ==========================================
   * Target Account
   * ==========================================
   */

  const accountCheck =
    await ensureAccountExists(
      pb,
      accountId
    );

  if (
    !accountCheck.ok
  ) {
    return respond(
      apiError(
        requestId,
        accountCheck.status,
        accountCheck.code,
        accountCheck.message
      )
    );
  }

  /*
   * ==========================================
   * Existing Override
   * ==========================================
   */

  let record:
    AILimitRecord |
    null;

  try {
    record =
      await findLimitRecord(
        pb,
        accountId
      );
  } catch (error) {
    console.error(
      "Account AI limit lookup failed",
      {
        requestId,

        adminId:
          admin.account.id,

        accountId,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return respond(
      apiError(
        requestId,
        503,
        "AI_LIMIT_LOAD_FAILED",
        "بررسی سهمیه فعلی ناموفق بود."
      )
    );
  }

  /*
   * ==========================================
   * Idempotent Reset
   *
   * حتی No-op نیز Rate Limit Consume کرده است.
   * ==========================================
   */

  if (
    !record
  ) {
    try {
      const budget =
        await checkAIBudgetGuard({
          userId:
            accountId,
        });

      return respond(
        apiResponse(
          {
            success:
              true,

            configured:
              null,

            effective:
              budget.limits,

            usage:
              budget.usage,

            budgetStatus:
              serializeBudgetStatus(
                budget
              ),

            alreadyDefault:
              true,

            message:
              "این حساب از قبل از سهمیه پیش‌فرض سیستم استفاده می‌کند.",
          },
          200,
          requestId
        )
      );
    } catch (error) {
      console.error(
        "AI limit default budget refresh failed",
        {
          requestId,

          adminId:
            admin.account.id,

          accountId,

          error:
            safeErrorMetadata(
              error
            ),
        }
      );

      return respond(
        apiResponse(
          {
            success:
              true,

            configured:
              null,

            alreadyDefault:
              true,

            message:
              "این حساب از قبل از سهمیه پیش‌فرض سیستم استفاده می‌کند.",

            warning:
              "محاسبه مصرف و سهمیه مؤثر فعلی موقتاً در دسترس نیست.",

            warningCode:
              "AI_BUDGET_REFRESH_FAILED",
          },
          200,
          requestId
        )
      );
    }
  }

  /*
   * ==========================================
   * Delete Override
   * ==========================================
   */

  try {
    await pb
      .collection(
        "account_ai_limits"
      )
      .delete(
        record.id
      );
  } catch (error) {
    console.error(
      "Account AI limit reset failed",
      {
        requestId,

        adminId:
          admin.account.id,

        accountId,

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

      accountId,

      action:
        "account.ai_limit.reset",

      result:
        "failure",

      errorCode:
        "AI_LIMIT_RESET_FAILED",
    });

    return respond(
      apiError(
        requestId,
        503,
        "AI_LIMIT_RESET_FAILED",
        "بازنشانی سهمیه هوش مصنوعی ناموفق بود."
      )
    );
  }

  /*
   * ==========================================
   * Audit Success
   * ==========================================
   */

  await safeAudit({
    request,

    requestId,

    actorId:
      admin.account.id,

    accountId,

    action:
      "account.ai_limit.reset",

    result:
      "success",

    metadata: {
      previous:
        serializeConfiguredLimit(
          record
        ),

      next:
        "system_defaults",
    },
  });

  /*
   * ==========================================
   * Refresh Budget
   * ==========================================
   */

  try {
    const budget =
      await checkAIBudgetGuard({
        userId:
          accountId,
      });

    return respond(
      apiResponse(
        {
          success:
            true,

          configured:
            null,

          effective:
            budget.limits,

          usage:
            budget.usage,

          budgetStatus:
            serializeBudgetStatus(
              budget
            ),

          message:
            "سهمیه اختصاصی حذف شد و حساب به تنظیمات پیش‌فرض سیستم بازگشت.",
        },
        200,
        requestId
      )
    );
  } catch (error) {
    console.error(
      "AI limit reset succeeded but budget refresh failed",
      {
        requestId,

        adminId:
          admin.account.id,

        accountId,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return respond(
      apiResponse(
        {
          success:
            true,

          configured:
            null,

          message:
            "سهمیه اختصاصی حذف شد و حساب به تنظیمات پیش‌فرض سیستم بازگشت.",

          warning:
            "بازنشانی انجام شد، اما محاسبه مصرف و سهمیه مؤثر جدید موقتاً در دسترس نیست.",

          warningCode:
            "AI_BUDGET_REFRESH_FAILED",
        },
        200,
        requestId
      )
    );
  }
}

/*
 * ============================================
 * Rate Limited Response
 * ============================================
 */

function rateLimitedResponse(
  requestId:
    string,

  rateLimit: {
    allowed:
      false;

    code:
      "ADMIN_RATE_LIMITED";

    limit:
      number;

    remaining:
      0;

    retryAfterSeconds:
      number;

    resetAt:
      string;
  },

  message:
    string
) {
  const response =
    apiError(
      requestId,
      429,
      "ADMIN_RATE_LIMITED",
      message,
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
 * Ensure Account Exists
 * ============================================
 */

async function ensureAccountExists(
  pb:
    PocketBase,

  accountId:
    string
):
  Promise<
    | {
        ok:
          true;
      }
    | {
        ok:
          false;

        status:
          404 |
          503;

        code:
          string;

        message:
          string;
      }
  > {
  try {
    await pb
      .collection(
        "accounts"
      )
      .getOne(
        accountId,
        {
          fields:
            "id",
        }
      );

    return {
      ok:
        true,
    };
  } catch (error) {
    if (
      getErrorStatus(
        error
      ) ===
      404
    ) {
      return {
        ok:
          false,

        status:
          404,

        code:
          "ACCOUNT_NOT_FOUND",

        message:
          "حساب موردنظر پیدا نشد.",
      };
    }

    console.error(
      "AI limit target account lookup failed",
      {
        accountId,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return {
      ok:
        false,

      status:
        503,

      code:
        "ACCOUNT_LOAD_FAILED",

      message:
        "دریافت اطلاعات حساب ناموفق بود.",
    };
  }
}

/*
 * ============================================
 * Find Limit Record
 * ============================================
 */

async function findLimitRecord(
  pb:
    PocketBase,

  accountId:
    string
): Promise<
  AILimitRecord |
  null
> {
  try {
    return await pb
      .collection(
        "account_ai_limits"
      )
      .getFirstListItem<AILimitRecord>(
        pb.filter(
          "user = {:userId}",
          {
            userId:
              accountId,
          }
        )
      );
  } catch (error) {
    if (
      getErrorStatus(
        error
      ) ===
      404
    ) {
      return null;
    }

    throw error;
  }
}

/*
 * ============================================
 * Parse Input
 * ============================================
 */

function parseLimitInput(
  body:
    unknown
): LimitParseResult {
  if (
    typeof body !==
      "object" ||
    body ===
      null ||
    Array.isArray(
      body
    )
  ) {
    return validationFailure({
      form:
        "اطلاعات سهمیه معتبر نیست.",
    });
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
    return validationFailure(
      {
        form:
          "فیلدهای ارسالی برای سهمیه معتبر نیستند.",
      },
      "UNEXPECTED_FIELDS"
    );
  }

  const fieldErrors:
    Record<
      string,
      string
    > = {};

  /*
   * ==========================================
   * Enabled
   * ==========================================
   */

  if (
    typeof value.enabled !==
    "boolean"
  ) {
    fieldErrors.enabled =
      "وضعیت فعال بودن سهمیه معتبر نیست.";
  }

  /*
   * ==========================================
   * Daily Token
   * ==========================================
   */

  const dailyTokenLimit =
    parseNonNegativeInteger(
      value.dailyTokenLimit,
      MAX_DAILY_TOKEN_LIMIT
    );

  if (
    dailyTokenLimit ===
    null
  ) {
    fieldErrors.dailyTokenLimit =
      `سقف روزانه Token باید عدد صحیح بین صفر تا ${MAX_DAILY_TOKEN_LIMIT.toLocaleString(
        "fa-IR"
      )} باشد.`;
  }

  /*
   * ==========================================
   * Monthly Token
   * ==========================================
   */

  const monthlyTokenLimit =
    parseNonNegativeInteger(
      value.monthlyTokenLimit,
      MAX_MONTHLY_TOKEN_LIMIT
    );

  if (
    monthlyTokenLimit ===
    null
  ) {
    fieldErrors.monthlyTokenLimit =
      `سقف ماهانه Token باید عدد صحیح بین صفر تا ${MAX_MONTHLY_TOKEN_LIMIT.toLocaleString(
        "fa-IR"
      )} باشد.`;
  }

  /*
   * ==========================================
   * Daily Cost
   * ==========================================
   */

  const dailyCostLimitUsd =
    parseNonNegativeFiniteNumber(
      value.dailyCostLimitUsd,
      MAX_DAILY_COST_LIMIT_USD
    );

  if (
    dailyCostLimitUsd ===
    null
  ) {
    fieldErrors.dailyCostLimitUsd =
      `سقف هزینه روزانه باید عددی بین صفر تا ${MAX_DAILY_COST_LIMIT_USD.toLocaleString(
        "fa-IR"
      )} دلار باشد.`;
  }

  /*
   * ==========================================
   * Monthly Cost
   * ==========================================
   */

  const monthlyCostLimitUsd =
    parseNonNegativeFiniteNumber(
      value.monthlyCostLimitUsd,
      MAX_MONTHLY_COST_LIMIT_USD
    );

  if (
    monthlyCostLimitUsd ===
    null
  ) {
    fieldErrors.monthlyCostLimitUsd =
      `سقف هزینه ماهانه باید عددی بین صفر تا ${MAX_MONTHLY_COST_LIMIT_USD.toLocaleString(
        "fa-IR"
      )} دلار باشد.`;
  }

  /*
   * ==========================================
   * Warning Percent
   * ==========================================
   */

  const warningPercent =
    parseIntegerInRange(
      value.warningPercent,
      1,
      100
    );

  if (
    warningPercent ===
    null
  ) {
    fieldErrors.warningPercent =
      "درصد هشدار باید عدد صحیح بین ۱ تا ۱۰۰ باشد.";
  }

  /*
   * ==========================================
   * Result
   * ==========================================
   */

  if (
    Object.keys(
      fieldErrors
    ).length >
    0
  ) {
    return validationFailure(
      fieldErrors
    );
  }

  return {
    success:
      true,

    data: {
      enabled:
        value.enabled as boolean,

      dailyTokenLimit:
        dailyTokenLimit as number,

      monthlyTokenLimit:
        monthlyTokenLimit as number,

      dailyCostLimitUsd:
        dailyCostLimitUsd as number,

      monthlyCostLimitUsd:
        monthlyCostLimitUsd as number,

      warningPercent:
        warningPercent as number,
    },
  };
}

/*
 * ============================================
 * Validation Failure
 * ============================================
 */

function validationFailure(
  fieldErrors:
    Record<
      string,
      string
    >,

  code =
    "INVALID_AI_LIMIT"
): LimitParseResult {
  return {
    success:
      false,

    code,

    message:
      Object.values(
        fieldErrors
      )[0] ||
      "اطلاعات سهمیه معتبر نیست.",

    fieldErrors,
  };
}

/*
 * ============================================
 * Strict Number Parsers
 * ============================================
 */

function parseNonNegativeInteger(
  value:
    unknown,

  maximum:
    number
) {
  if (
    typeof value !==
    "number"
  ) {
    return null;
  }

  if (
    !Number.isSafeInteger(
      value
    ) ||
    value <
      0 ||
    value >
      maximum
  ) {
    return null;
  }

  return value;
}

function parseNonNegativeFiniteNumber(
  value:
    unknown,

  maximum:
    number
) {
  if (
    typeof value !==
    "number"
  ) {
    return null;
  }

  if (
    !Number.isFinite(
      value
    ) ||
    value <
      0 ||
    value >
      maximum
  ) {
    return null;
  }

  return value;
}

function parseIntegerInRange(
  value:
    unknown,

  minimum:
    number,

  maximum:
    number
) {
  if (
    typeof value !==
    "number"
  ) {
    return null;
  }

  if (
    !Number.isSafeInteger(
      value
    ) ||
    value <
      minimum ||
    value >
      maximum
  ) {
    return null;
  }

  return value;
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
        await reader
          .read();

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
  accountId,
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

  accountId:
    string;

  action:
    string;

  result:
    | "success"
    | "failure";

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
        accountId,

      targetUserId:
        accountId,

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
      "Account AI limit audit failed",
      {
        requestId,

        accountId,

        action,

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
 * Budget Status
 * ============================================
 */

function serializeBudgetStatus(
  budget:
    Awaited<
      ReturnType<
        typeof checkAIBudgetGuard
      >
    >
) {
  return budget.allowed
    ? {
        allowed:
          true,

        warnings:
          budget.warnings,
      }
    : {
        allowed:
          false,

        code:
          budget.code,

        retryAfterSeconds:
          budget.retryAfterSeconds,
      };
}

/*
 * ============================================
 * Serialize Configured Limit
 * ============================================
 */

function serializeConfiguredLimit(
  record:
    AILimitRecord
) {
  return {
    id:
      record.id,

    enabled:
      record.enabled ===
      true,

    dailyTokenLimit:
      safeNumber(
        record.daily_token_limit
      ),

    monthlyTokenLimit:
      safeNumber(
        record.monthly_token_limit
      ),

    dailyCostLimitUsd:
      safeNumber(
        record.daily_cost_limit_usd
      ),

    monthlyCostLimitUsd:
      safeNumber(
        record.monthly_cost_limit_usd
      ),

    warningPercent:
      safeNumber(
        record.warning_percent,
        80
      ),

    created:
      String(
        record.created ||
          ""
      ),

    updated:
      String(
        record.updated ||
          ""
      ),
  };
}

/*
 * ============================================
 * Safe Number
 * ============================================
 */

function safeNumber(
  value:
    unknown,

  fallback =
    0
) {
  const parsed =
    Number(
      value
    );

  return Number.isFinite(
    parsed
  )
    ? parsed
    : fallback;
}

/*
 * ============================================
 * Response
 * ============================================
 */

function apiResponse(
  body:
    Record<
      string,
      unknown
    >,

  status:
    number,

  requestId:
    string
) {
  return NextResponse.json(
    {
      ...body,

      requestId,
    },
    {
      status,

      headers: {
        "X-Request-Id":
          requestId,

        "Cache-Control":
          "private, no-store, no-cache, max-age=0, must-revalidate",

        "Pragma":
          "no-cache",

        "Expires":
          "0",

        "X-Content-Type-Options":
          "nosniff",
      },
    }
  );
}

/*
 * ============================================
 * Error Response
 * ============================================
 */

function apiError(
  requestId:
    string,

  status:
    number,

  code:
    string,

  message:
    string,

  extra?:
    Record<
      string,
      unknown
    >
) {
  return apiResponse(
    {
      success:
        false,

      code,

      message,

      ...(extra ||
        {}),
    },
    status,
    requestId
  );
}

/*
 * ============================================
 * Error Status
 * ============================================
 */

function getErrorStatus(
  error:
    unknown
) {
  if (
    typeof error !==
      "object" ||
    error ===
      null
  ) {
    return undefined;
  }

  const value =
    error as {
      status?:
        unknown;
    };

  return typeof value.status ===
    "number"
    ? value.status
    : undefined;
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