import {
  NextResponse,
} from "next/server";

import {
  consumeAdminRateLimit,
} from "@/lib/admin/rate-limit";

import {
  removeKnowledgeItemFromOpenAI,
  syncKnowledgeItem,
} from "@/lib/ai/knowledge";

import {
  recordAuditLog,
} from "@/lib/audit/log";

import {
  getAdminSession,
} from "@/lib/pocketbase/admin";

import {
  getPocketBaseServiceClient,
} from "@/lib/pocketbase/service";

/*
 * ============================================
 * Limits / Validation
 * ============================================
 */

const RECORD_ID_PATTERN =
  /^[a-zA-Z0-9_-]{1,64}$/;

/*
 * ============================================
 * POST
 *
 * Manual Sync Knowledge → OpenAI
 * ============================================
 */

export async function POST(
  request: Request,
  {
    params,
  }: RouteContext<
    "/api/admin/knowledge/[id]/sync"
  >
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
    return apiResponse(
      {
        success:
          false,

        code:
          admin.code,

        message:
          admin.message,

        requestId,
      },
      admin.status,
      requestId
    );
  }

  /*
   * ==========================================
   * Knowledge ID
   * ==========================================
   */

  const {
    id: rawId,
  } = await params;

  const id =
    cleanRecordId(
      rawId
    );

  if (
    !id
  ) {
    return apiResponse(
      {
        success:
          false,

        code:
          "INVALID_KNOWLEDGE_ID",

        message:
          "شناسه مطلب معتبر نیست.",

        requestId,
      },
      400,
      requestId
    );
  }

  /*
   * ==========================================
   * Admin Rate Limit
   *
   * knowledge.sync:
   * 5 operations / minute / admin
   *
   * POST و DELETE از همین Bucket استفاده
   * می‌کنند.
   *
   * Fail-closed:
   * اگر Rate Limiter در دسترس نباشد هیچ تماس
   * با OpenAI انجام نمی‌شود.
   * ==========================================
   */

  const rateLimitResult =
    await consumeKnowledgeSyncRateLimit({
      requestId,

      adminId:
        admin.account.id,

      knowledgeId:
        id,

      operation:
        "sync",
    });

  if (
    !rateLimitResult.ok
  ) {
    return rateLimitResult.response;
  }

  const rateLimit =
    rateLimitResult.rateLimit;

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
      "Knowledge sync service unavailable",
      {
        requestId,

        adminId:
          admin.account.id,

        knowledgeId:
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

      action:
        "knowledge.sync.failure",

      result:
        "failure",

      entityId:
        id,

      errorCode:
        "KNOWLEDGE_SERVICE_UNAVAILABLE",

      metadata: {
        trigger:
          "manual",

        operation:
          "sync",

        reason:
          "service_client_unavailable",
      },
    });

    return withRateLimitHeaders(
      apiResponse(
        {
          success:
            false,

          code:
            "KNOWLEDGE_SERVICE_UNAVAILABLE",

          message:
            "سرویس پایگاه دانش موقتاً در دسترس نیست.",

          requestId,
        },
        503,
        requestId
      ),
      rateLimit
    );
  }

  /*
   * ==========================================
   * Sync
   * ==========================================
   */

  try {
    const result =
      await syncKnowledgeItem(
        id,
        pb
      );

    /*
     * ========================================
     * Audit
     * ========================================
     */

    if (
      result.success
    ) {
      await safeAudit({
        request,

        requestId,

        actorId:
          admin.account.id,

        action:
          "knowledge.sync.success",

        result:
          "success",

        entityId:
          id,

        metadata: {
          trigger:
            "manual",

          operation:
            "sync",
        },
      });
    } else {
      await safeAudit({
        request,

        requestId,

        actorId:
          admin.account.id,

        action:
          "knowledge.sync.failure",

        result:
          "failure",

        entityId:
          id,

        errorCode:
          getResultCode(
            result,
            "KNOWLEDGE_SYNC_FAILED"
          ),

        metadata: {
          trigger:
            "manual",

          operation:
            "sync",

          status:
            result.status,

          message:
            getResultMessage(
              result
            ),
        },
      });
    }

    /*
     * ========================================
     * Response
     * ========================================
     */

    const response =
      apiResponse(
        {
          ...result,

          requestId,
        },

        result.success
          ? 200
          : safeHttpStatus(
              result.status,
              503
            ),

        requestId
      );

    return withRateLimitHeaders(
      response,
      rateLimit
    );
  } catch (error) {
    /*
     * ========================================
     * Unexpected Exception
     * ========================================
     */

    console.error(
      "Manual knowledge sync failed",
      {
        requestId,

        adminId:
          admin.account.id,

        knowledgeId:
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

      action:
        "knowledge.sync.failure",

      result:
        "failure",

      entityId:
        id,

      errorCode:
        "KNOWLEDGE_SYNC_EXCEPTION",

      metadata: {
        trigger:
          "manual",

        operation:
          "sync",

        reason:
          "unexpected_exception",
      },
    });

    return withRateLimitHeaders(
      apiResponse(
        {
          success:
            false,

          code:
            "KNOWLEDGE_SYNC_FAILED",

          message:
            "همگام‌سازی مطلب با پایگاه دانش هوش مصنوعی ناموفق بود.",

          requestId,
        },
        503,
        requestId
      ),
      rateLimit
    );
  }
}

/*
 * ============================================
 * DELETE
 *
 * Manual Remove Knowledge from OpenAI
 * ============================================
 */

export async function DELETE(
  request: Request,
  {
    params,
  }: RouteContext<
    "/api/admin/knowledge/[id]/sync"
  >
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
    return apiResponse(
      {
        success:
          false,

        code:
          admin.code,

        message:
          admin.message,

        requestId,
      },
      admin.status,
      requestId
    );
  }

  /*
   * ==========================================
   * Knowledge ID
   * ==========================================
   */

  const {
    id: rawId,
  } = await params;

  const id =
    cleanRecordId(
      rawId
    );

  if (
    !id
  ) {
    return apiResponse(
      {
        success:
          false,

        code:
          "INVALID_KNOWLEDGE_ID",

        message:
          "شناسه مطلب معتبر نیست.",

        requestId,
      },
      400,
      requestId
    );
  }

  /*
   * ==========================================
   * Admin Rate Limit
   *
   * همان Bucket مربوط به POST:
   *
   * knowledge.sync
   * ==========================================
   */

  const rateLimitResult =
    await consumeKnowledgeSyncRateLimit({
      requestId,

      adminId:
        admin.account.id,

      knowledgeId:
        id,

      operation:
        "remove_from_openai",
    });

  if (
    !rateLimitResult.ok
  ) {
    return rateLimitResult.response;
  }

  const rateLimit =
    rateLimitResult.rateLimit;

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
      "Knowledge remove service unavailable",
      {
        requestId,

        adminId:
          admin.account.id,

        knowledgeId:
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

      action:
        "knowledge.openai.remove.failure",

      result:
        "failure",

      entityId:
        id,

      errorCode:
        "KNOWLEDGE_SERVICE_UNAVAILABLE",

      metadata: {
        trigger:
          "manual",

        operation:
          "remove_from_openai",

        reason:
          "service_client_unavailable",
      },
    });

    return withRateLimitHeaders(
      apiResponse(
        {
          success:
            false,

          code:
            "KNOWLEDGE_SERVICE_UNAVAILABLE",

          message:
            "سرویس پایگاه دانش موقتاً در دسترس نیست.",

          requestId,
        },
        503,
        requestId
      ),
      rateLimit
    );
  }

  /*
   * ==========================================
   * Remove
   * ==========================================
   */

  try {
    const result =
      await removeKnowledgeItemFromOpenAI(
        id,
        pb
      );

    /*
     * ========================================
     * Audit
     * ========================================
     */

    if (
      result.success
    ) {
      await safeAudit({
        request,

        requestId,

        actorId:
          admin.account.id,

        action:
          "knowledge.openai.remove.success",

        result:
          "success",

        entityId:
          id,

        metadata: {
          trigger:
            "manual",

          operation:
            "remove_from_openai",
        },
      });
    } else {
      await safeAudit({
        request,

        requestId,

        actorId:
          admin.account.id,

        action:
          "knowledge.openai.remove.failure",

        result:
          "failure",

        entityId:
          id,

        errorCode:
          getResultCode(
            result,
            "OPENAI_FILE_REMOVE_FAILED"
          ),

        metadata: {
          trigger:
            "manual",

          operation:
            "remove_from_openai",

          status:
            result.status,

          message:
            getResultMessage(
              result
            ),
        },
      });
    }

    /*
     * ========================================
     * Response
     * ========================================
     */

    const response =
      apiResponse(
        {
          ...result,

          requestId,
        },

        result.success
          ? 200
          : safeHttpStatus(
              result.status,
              503
            ),

        requestId
      );

    return withRateLimitHeaders(
      response,
      rateLimit
    );
  } catch (error) {
    /*
     * ========================================
     * Unexpected Exception
     * ========================================
     */

    console.error(
      "Manual knowledge OpenAI remove failed",
      {
        requestId,

        adminId:
          admin.account.id,

        knowledgeId:
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

      action:
        "knowledge.openai.remove.failure",

      result:
        "failure",

      entityId:
        id,

      errorCode:
        "OPENAI_FILE_REMOVE_EXCEPTION",

      metadata: {
        trigger:
          "manual",

        operation:
          "remove_from_openai",

        reason:
          "unexpected_exception",
      },
    });

    return withRateLimitHeaders(
      apiResponse(
        {
          success:
            false,

          code:
            "OPENAI_FILE_REMOVE_FAILED",

          message:
            "حذف مطلب از پایگاه دانش هوش مصنوعی ناموفق بود.",

          requestId,
        },
        503,
        requestId
      ),
      rateLimit
    );
  }
}

/*
 * ============================================
 * Admin Knowledge Sync Rate Limit
 * ============================================
 */

async function consumeKnowledgeSyncRateLimit({
  requestId,
  adminId,
  knowledgeId,
  operation,
}: {
  requestId:
    string;

  adminId:
    string;

  knowledgeId:
    string;

  operation:
    "sync" |
    "remove_from_openai";
}): Promise<
  | {
      ok:
        true;

      rateLimit:
        {
          allowed:
            true;

          limit:
            number;

          remaining:
            number;

          resetAt:
            string;
        };
    }
  | {
      ok:
        false;

      response:
        NextResponse;
    }
> {
  try {
    const rateLimit =
      await consumeAdminRateLimit({
        adminId,

        action:
          "knowledge.sync",

        requestId,
      });

    /*
     * ========================================
     * Allowed
     * ========================================
     */

    if (
      rateLimit.allowed
    ) {
      return {
        ok:
          true,

        rateLimit,
      };
    }

    /*
     * ========================================
     * 429
     * ========================================
     */

    console.warn(
      "Admin knowledge sync rate limited",
      {
        requestId,

        adminId,

        knowledgeId,

        operation,

        retryAfterSeconds:
          rateLimit.retryAfterSeconds,

        resetAt:
          rateLimit.resetAt,
      }
    );

    const response =
      apiResponse(
        {
          success:
            false,

          code:
            "ADMIN_RATE_LIMITED",

          message:
            "تعداد عملیات همگام‌سازی پایگاه دانش بیش از حد مجاز است.",

          retryAfterSeconds:
            rateLimit.retryAfterSeconds,

          limit:
            rateLimit.limit,

          remaining:
            rateLimit.remaining,

          resetAt:
            rateLimit.resetAt,

          requestId,
        },
        429,
        requestId
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

    return {
      ok:
        false,

      response,
    };
  } catch (error) {
    /*
     * ========================================
     * Fail Closed
     * ========================================
     */

    console.error(
      "Admin knowledge sync rate limit unavailable",
      {
        requestId,

        adminId,

        knowledgeId,

        operation,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return {
      ok:
        false,

      response:
        apiResponse(
          {
            success:
              false,

            code:
              "ADMIN_RATE_LIMIT_UNAVAILABLE",

            message:
              "سرویس کنترل تعداد درخواست‌ها موقتاً در دسترس نیست.",

            requestId,
          },
          503,
          requestId
        ),
    };
  }
}

/*
 * ============================================
 * Rate Limit Headers
 * ============================================
 */

function withRateLimitHeaders(
  response:
    NextResponse,

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
 * Audit Helper
 *
 * Audit نباید باعث Failure عملیات اصلی شود.
 * ============================================
 */

async function safeAudit({
  request,
  requestId,
  actorId,
  action,
  result,
  entityId,
  errorCode,
  metadata,
}: {
  request:
    Request;

  requestId:
    string;

  actorId:
    string;

  action:
    string;

  result:
    "success" |
    "failure";

  entityId:
    string;

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

      action,

      result,

      entityType:
        "knowledge_item",

      entityId,

      ...(errorCode
        ? {
            errorCode,
          }
        : {}),

      metadata,
    });
  } catch (error) {
    console.error(
      "Knowledge sync audit failed",
      {
        requestId,

        actorId,

        entityId,

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
 * API Response
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
    body,
    {
      status:

        /*
         * Defensive status validation.
         */
        safeHttpStatus(
          status,
          500
        ),

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
 * Record ID
 * ============================================
 */

function cleanRecordId(
  value:
    unknown
) {
  if (
    typeof value !==
      "string"
  ) {
    return "";
  }

  const id =
    value.trim();

  return RECORD_ID_PATTERN.test(
    id
  )
    ? id
    : "";
}

/*
 * ============================================
 * HTTP Status
 * ============================================
 */

function safeHttpStatus(
  value:
    unknown,

  fallback:
    number
) {
  const status =
    Number(
      value
    );

  if (
    !Number.isSafeInteger(
      status
    ) ||
    status <
      100 ||
    status >
      599
  ) {
    return fallback;
  }

  return status;
}

/*
 * ============================================
 * Result Code
 * ============================================
 */

function getResultCode(
  result:
    unknown,

  fallback:
    string
) {
  if (
    typeof result !==
      "object" ||
    result ===
      null ||
    !(
      "code" in
      result
    )
  ) {
    return fallback;
  }

  const value =
    (
      result as {
        code?:
          unknown;
      }
    ).code;

  if (
    typeof value !==
    "string"
  ) {
    return fallback;
  }

  const code =
    value
      .trim()
      .slice(
        0,
        120
      );

  return (
    code ||
    fallback
  );
}

/*
 * ============================================
 * Result Message
 * ============================================
 */

function getResultMessage(
  result:
    unknown
) {
  if (
    typeof result !==
      "object" ||
    result ===
      null ||
    !(
      "message" in
      result
    )
  ) {
    return "";
  }

  const value =
    (
      result as {
        message?:
          unknown;
      }
    ).message;

  if (
    typeof value !==
    "string"
  ) {
    return "";
  }

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
    .slice(
      0,
      500
    );
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