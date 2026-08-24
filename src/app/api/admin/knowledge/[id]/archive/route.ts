import type PocketBase from "pocketbase";

import {
  removeKnowledgeItemFromOpenAI,
  type KnowledgeItemRecord,
} from "@/lib/ai/knowledge";

import {
  consumeAdminRateLimit,
} from "@/lib/admin/rate-limit";

import {
  recordAuditLog,
} from "@/lib/audit/log";

import {
  getPocketBaseError,
} from "@/lib/knowledge/admin";

import {
  knowledgeApiError,
  knowledgeApiResponse,
} from "@/lib/knowledge/response";

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

type AllowedRateLimit = {
  allowed:
    true;

  limit:
    number;

  remaining:
    number;

  resetAt:
    string;
};

/*
 * ============================================
 * Validation
 * ============================================
 */

const RECORD_ID_PATTERN =
  /^[a-zA-Z0-9_-]{1,64}$/;

/*
 * ============================================
 * POST
 *
 * Archive Knowledge Item
 *
 * Rate Limit:
 *
 * knowledge.archive
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
    return knowledgeApiError(
      requestId,
      admin.status,
      admin.code,
      admin.message
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
    return knowledgeApiError(
      requestId,
      400,
      "INVALID_KNOWLEDGE_ID",
      "شناسه مطلب معتبر نیست."
    );
  }

  /*
   * ==========================================
   * Admin Rate Limit
   *
   * knowledge.archive
   * 10 requests / minute / admin
   *
   * Target Knowledge ID بخشی از Bucket نیست.
   *
   * بنابراین تغییر مطلب مقصد باعث دور زدن
   * Rate Limit نمی‌شود.
   *
   * Fail-closed:
   * اگر Rate Limiter در دسترس نباشد Archive
   * یا OpenAI cleanup انجام نمی‌شود.
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
          "knowledge.archive",

        requestId,
      });
  } catch (error) {
    console.error(
      "Admin knowledge archive rate limit unavailable",
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

    return knowledgeApiError(
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
    return rateLimitedResponse(
      requestId,
      rateLimit
    );
  }

  const allowedRateLimit:
    AllowedRateLimit =
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
      "Knowledge archive service unavailable",
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

    return respond(
      knowledgeApiError(
        requestId,
        503,
        "KNOWLEDGE_SERVICE_UNAVAILABLE",
        "سرویس پایگاه دانش موقتاً در دسترس نیست."
      )
    );
  }

  /*
   * ==========================================
   * Load Knowledge Item
   * ==========================================
   */

  let item:
    KnowledgeItemRecord;

  try {
    item =
      await pb
        .collection(
          "knowledge_items"
        )
        .getOne<KnowledgeItemRecord>(
          id
        );
  } catch (error) {
    const metadata =
      getPocketBaseError(
        error
      );

    return respond(
      knowledgeApiError(
        requestId,

        metadata.status ===
          404
          ? 404
          : 503,

        metadata.status ===
          404
          ? "KNOWLEDGE_NOT_FOUND"
          : "KNOWLEDGE_LOAD_FAILED",

        metadata.status ===
          404
          ? "مطلب موردنظر پیدا نشد."
          : "دریافت مطلب ناموفق بود."
      )
    );
  }

  const title =
    cleanAuditText(
      item.title,
      200
    );

  const previousStatus =
    cleanStatus(
      item.status
    );

  /*
   * ==========================================
   * Already Archived
   *
   * Idempotent operation.
   *
   * Rate Limit همچنان Consume شده است.
   * ==========================================
   */

  if (
    item.status ===
    "archived"
  ) {
    return respond(
      knowledgeApiResponse(
        {
          success:
            true,

          id,

          alreadyArchived:
            true,

          message:
            "این مطلب قبلاً بایگانی شده است.",
        },
        200,
        requestId
      )
    );
  }

  /*
   * ==========================================
   * Archive PocketBase Record
   * ==========================================
   */

  try {
    await pb
      .collection(
        "knowledge_items"
      )
      .update(
        id,
        {
          status:
            "archived",

          /*
           * تا زمان پاک‌شدن از OpenAI،
           * وضعیت Sync را Pending نگه می‌داریم.
           */
          sync_status:
            "pending",

          sync_error:
            "",

          updated_by:
            admin.account.id,
        }
      );
  } catch (error) {
    console.error(
      "Knowledge archive update failed",
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
        "knowledge.archive",

      result:
        "failure",

      entityId:
        id,

      errorCode:
        "KNOWLEDGE_ARCHIVE_FAILED",

      metadata: {
        title,

        previous_status:
          previousStatus,

        requested_status:
          "archived",
      },
    });

    return respond(
      knowledgeApiError(
        requestId,
        503,
        "KNOWLEDGE_ARCHIVE_FAILED",
        "بایگانی مطلب ناموفق بود."
      )
    );
  }

  /*
   * ==========================================
   * Audit: Archive Success
   * ==========================================
   */

  await safeAudit({
    request,

    requestId,

    actorId:
      admin.account.id,

    action:
      "knowledge.archive",

    result:
      "success",

    entityId:
      id,

    metadata: {
      title,

      previous_status:
        previousStatus,

      new_status:
        "archived",

      had_openai_file:
        Boolean(
          item.openai_file_id
        ),
    },
  });

  /*
   * ==========================================
   * Remove from OpenAI
   *
   * رکورد از این نقطه Archived است.
   *
   * اگر Cleanup شکست بخورد Archive Rollback
   * نمی‌شود؛ چون بهتر است مطلب دیگر Published
   * نباشد و Cleanup بعداً Retry شود.
   * ==========================================
   */

  let cleanup:
    Awaited<
      ReturnType<
        typeof removeKnowledgeItemFromOpenAI
      >
    >;

  try {
    cleanup =
      await removeKnowledgeItemFromOpenAI(
        id,
        pb,
        {
          ...item,

          status:
            "archived",
        }
      );
  } catch (error) {
    console.error(
      "Knowledge archive OpenAI cleanup failed",
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
        title,

        trigger:
          "archive",

        reason:
          "unexpected_exception",
      },
    });

    return respond(
      knowledgeApiError(
        requestId,
        503,
        "OPENAI_FILE_REMOVE_FAILED",
        "مطلب بایگانی شد، اما پاک‌سازی آن از OpenAI ناموفق بود.",
        {
          archived:
            true,

          knowledgeId:
            id,
        }
      )
    );
  }

  /*
   * ==========================================
   * Cleanup Failure
   * ==========================================
   */

  if (
    !cleanup.success
  ) {
    const cleanupCode =
      getResultCode(
        cleanup,
        "OPENAI_FILE_REMOVE_FAILED"
      );

    const cleanupStatus =
      getResultStatus(
        cleanup,
        503
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
        cleanupCode,

      metadata: {
        title,

        trigger:
          "archive",

        status:
          cleanupStatus,

        message:
          getResultMessage(
            cleanup
          ),
      },
    });

    return respond(
      knowledgeApiResponse(
        {
          success:
            false,

          id,

          archived:
            true,

          cleanup,

          code:
            cleanupCode,

          message:
            "مطلب بایگانی شد، اما پاک‌سازی OpenAI ناموفق بود.",
        },
        cleanupStatus,
        requestId
      )
    );
  }

  /*
   * ==========================================
   * Audit: Cleanup Success
   * ==========================================
   */

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
      title,

      trigger:
        "archive",
    },
  });

  /*
   * ==========================================
   * Success
   * ==========================================
   */

  return respond(
    knowledgeApiResponse(
      {
        success:
          true,

        id,

        cleanup,

        message:
          "مطلب بایگانی و از پایگاه برداری خارج شد.",
      },
      200,
      requestId
    )
  );
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
  }
) {
  const response =
    knowledgeApiError(
      requestId,
      429,
      "ADMIN_RATE_LIMITED",
      "تعداد درخواست‌های بایگانی مطلب بیش از حد مجاز است.",
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
 * Audit Helper
 *
 * Audit failure نباید Archive یا Cleanup اصلی
 * را Fail کند.
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
    | "success"
    | "failure";

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
      "Knowledge archive audit failed",
      {
        requestId,

        actorId,

        entityId,

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
 * Status
 * ============================================
 */

function cleanStatus(
  value:
    unknown
) {
  if (
    typeof value !==
    "string"
  ) {
    return "unknown";
  }

  return value
    .replace(
      /[\u0000-\u001f\u007f]/g,
      " "
    )
    .trim()
    .slice(
      0,
      50
    ) ||
    "unknown";
}

/*
 * ============================================
 * Result Code
 *
 * Object/Array به String تبدیل نمی‌شود.
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

  return cleanAuditText(
    value,
    500
  );
}

/*
 * ============================================
 * Result HTTP Status
 * ============================================
 */

function getResultStatus(
  result:
    unknown,

  fallback:
    number
) {
  if (
    typeof result !==
      "object" ||
    result ===
      null ||
    !(
      "status" in
      result
    )
  ) {
    return fallback;
  }

  const value =
    (
      result as {
        status?:
          unknown;
      }
    ).status;

  if (
    typeof value !==
      "number" ||
    !Number.isSafeInteger(
      value
    ) ||
    value <
      400 ||
    value >
      599
  ) {
    return fallback;
  }

  return value;
}

/*
 * ============================================
 * Audit Text
 * ============================================
 */

function cleanAuditText(
  value:
    unknown,

  maximumLength:
    number
) {
  return String(
    value ||
      ""
  )
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
      maximumLength
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