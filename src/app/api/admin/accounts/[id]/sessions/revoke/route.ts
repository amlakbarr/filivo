import {
  recordAuditLog,
} from "@/lib/audit/log";

import {
  isSafeRecordId,
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

/*
 * ============================================
 * POST
 *
 * Revoke all application sessions
 *
 * Rate Limit:
 *
 * account.sessions.revoke
 * 10 requests / minute / admin
 * ============================================
 */

export async function POST(
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
   * 10 requests / minute / admin
   *
   * Target Account ID بخشی از Bucket نیست.
   *
   * بنابراین Admin نمی‌تواند با تغییر حساب
   * مقصد Rate Limit را دور بزند.
   *
   * Fail-closed:
   * اگر Rate Limiter در دسترس نباشد هیچ
   * Sessionی revoke نمی‌شود.
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
          "account.sessions.revoke",

        requestId,
      });
  } catch (error) {
    console.error(
      "Admin session revoke rate limit unavailable",
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
      "Admin session revoke rate limited",
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
        "تعداد درخواست‌های خروج اجباری کاربران بیش از حد مجاز است.",
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
   * ==========================================
   * Allowed Rate Limit
   * ==========================================
   */

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
   * Account Exists
   * ==========================================
   */

  let targetActive =
    false;

  try {
    const pb =
      await getPocketBaseServiceClient();

    const account =
      await pb
        .collection(
          "accounts"
        )
        .getOne(
          id,
          {
            fields:
              "id,active",
          }
        );

    targetActive =
      account.active ===
      true;
  } catch (error) {
    const status =
      getErrorStatus(
        error
      );

    if (
      status ===
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
      "Admin session revoke account lookup failed",
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
   * Revoke All Sessions
   * ==========================================
   */

  let result:
    Awaited<
      ReturnType<
        typeof revokeAllAppSessionsForUser
      >
    >;

  try {
    result =
      await revokeAllAppSessionsForUser({
        userId:
          id,

        reason:
          "admin_force_logout",
      });
  } catch (error) {
    console.error(
      "Admin session revoke all failed",
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

      result:
        "failure",

      errorCode:
        "SESSION_REVOCATION_FAILED",

      metadata: {
        reason:
          "admin_force_logout",

        target_active:
          targetActive,
      },
    });

    return respond(
      accountApiError(
        requestId,
        503,
        "SESSION_REVOCATION_FAILED",
        "خروج کاربر از همه دستگاه‌ها انجام نشد."
      )
    );
  }

  /*
   * ==========================================
   * Defensive Result Normalization
   * ==========================================
   */

  const total =
    safeNonNegativeInteger(
      result.total
    );

  const revoked =
    safeNonNegativeInteger(
      result.revoked
    );

  /*
   * revoked نباید از total بیشتر باشد.
   *
   * اگر داده نامعتبر باشد آن را Failure
   * در نظر می‌گیریم.
   */

  const validResult =
    revoked <=
    total;

  const complete =
    validResult &&
    revoked ===
      total;

  /*
   * ==========================================
   * Audit
   * ==========================================
   */

  await safeAudit({
    request,

    requestId,

    actorId:
      admin.account.id,

    targetUserId:
      id,

    result:
      complete
        ? "success"
        : "failure",

    errorCode:
      complete
        ? undefined
        : validResult
          ? "SESSION_REVOCATION_PARTIAL"
          : "SESSION_REVOCATION_INVALID_RESULT",

    metadata: {
      reason:
        "admin_force_logout",

      target_active:
        targetActive,

      total_sessions:
        total,

      revoked_sessions:
        revoked,

      result_valid:
        validResult,
    },
  });

  /*
   * ==========================================
   * Invalid Result
   * ==========================================
   */

  if (
    !validResult
  ) {
    console.error(
      "Admin session revoke returned invalid counters",
      {
        requestId,

        adminId:
          admin.account.id,

        accountId:
          id,

        totalSessions:
          total,

        revokedSessions:
          revoked,
      }
    );

    return respond(
      accountApiError(
        requestId,
        503,
        "SESSION_REVOCATION_INVALID_RESULT",
        "نتیجه ابطال نشست‌های کاربر معتبر نبود."
      )
    );
  }

  /*
   * ==========================================
   * Partial Failure
   * ==========================================
   */

  if (
    !complete
  ) {
    return respond(
      accountApiError(
        requestId,
        503,
        "SESSION_REVOCATION_INCOMPLETE",
        `از ${total.toLocaleString(
          "fa-IR"
        )} نشست، ${revoked.toLocaleString(
          "fa-IR"
        )} نشست بسته شد. عملیات را دوباره اجرا کنید.`,
        {
          totalSessions:
            total,

          revokedSessions:
            revoked,
        }
      )
    );
  }

  /*
   * ==========================================
   * Success
   * ==========================================
   */

  return respond(
    accountApiResponse(
      {
        success:
          true,

        revokedSessions:
          revoked,

        totalSessions:
          total,

        message:
          total ===
          0
            ? "نشست فعالی برای این کاربر وجود نداشت."
            : `${revoked.toLocaleString(
                "fa-IR"
              )} نشست کاربر با موفقیت بسته شد.`,
      },
      200,
      requestId
    )
  );
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
 * Audit
 *
 * Audit failure نباید نتیجه Force Logout را
 * تغییر دهد.
 * ============================================
 */

async function safeAudit({
  request,
  requestId,
  actorId,
  targetUserId,
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

  result:
    | "success"
    | "failure";

  errorCode?:
    string;

  metadata:
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

      action:
        "account.sessions.revoke_all",

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

      metadata,
    });
  } catch (error) {
    console.error(
      "Session revoke audit failed",
      {
        requestId,

        actorId,

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
 * Safe Non-negative Integer
 * ============================================
 */

function safeNonNegativeInteger(
  value:
    unknown
) {
  const number =
    Number(
      value
    );

  if (
    !Number.isSafeInteger(
      number
    ) ||
    number <
      0
  ) {
    return 0;
  }

  return number;
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