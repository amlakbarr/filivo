import type PocketBase from "pocketbase";

import {
  recordAuditLog,
} from "@/lib/audit/log";

import {
  consumeAdminRateLimit,
} from "@/lib/admin/rate-limit";

import {
  isSafeTopicId,
  safeTopicErrorMetadata,
} from "@/lib/topics/admin";

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

const MAX_BULK_TOPICS =
  50;

/*
 * ============================================
 * POST
 *
 * Bulk activate / deactivate Topics
 * ============================================
 */

export async function POST(
  request:
    Request
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
   * Rate Limit
   * ==========================================
   */

  try {
    const rateLimit =
      await consumeAdminRateLimit({
        adminId:
          admin.account.id,

        action:
          "topic.bulk_status",

        requestId,
      });

    if (
      !rateLimit.allowed
    ) {
      return apiError(
        requestId,
        429,
        rateLimit.code,
        "تعداد عملیات گروهی موضوعات بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.",
        {
          retryAfterSeconds:
            rateLimit.retryAfterSeconds,
        },
        {
          "Retry-After":
            String(
              rateLimit.retryAfterSeconds
            ),
        }
      );
    }
  } catch (error) {
    console.error(
      "Topic bulk status rate limit unavailable",
      {
        requestId,

        adminId:
          admin.account.id,

        error:
          safeTopicErrorMetadata(
            error
          ),
      }
    );

    return apiError(
      requestId,
      503,
      "ADMIN_RATE_LIMIT_UNAVAILABLE",
      "کنترل محدودیت درخواست‌های مدیریتی موقتاً در دسترس نیست."
    );
  }

  /*
   * ==========================================
   * JSON Body
   * ==========================================
   */

  let body:
    unknown;

  try {
    body =
      await request.json();
  } catch {
    return apiError(
      requestId,
      400,
      "TOPIC_BULK_INVALID_JSON",
      "بدنه JSON درخواست معتبر نیست."
    );
  }

  const parsed =
    parseBulkStatusRequest(
      body
    );

  if (
    !parsed.ok
  ) {
    return apiError(
      requestId,
      400,
      parsed.code,
      parsed.message
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
      "Topic bulk status service unavailable",
      {
        requestId,

        adminId:
          admin.account.id,

        error:
          safeTopicErrorMetadata(
            error
          ),
      }
    );

    return apiError(
      requestId,
      503,
      "TOPIC_SERVICE_UNAVAILABLE",
      "سرویس مدیریت موضوعات موقتاً در دسترس نیست."
    );
  }

  /*
   * ==========================================
   * Apply Updates
   *
   * PocketBase SDK transaction مشترک برای این
   * Route نداریم، بنابراین نتیجه Partial را
   * صریح گزارش می‌کنیم.
   * ==========================================
   */

  const succeeded:
    string[] = [];

  const failed:
    Array<{
      id:
        string;

      status?:
        number;
    }> = [];

  for (
    const id of
    parsed.ids
  ) {
    try {
      await pb
        .collection(
          "topics"
        )
        .update(
          id,
          {
            active:
              parsed.active,
          }
        );

      succeeded.push(
        id
      );
    } catch (error) {
      failed.push({
        id,

        status:
          getErrorStatus(
            error
          ),
      });
    }
  }

  const partial =
    failed.length >
    0;

  /*
   * ==========================================
   * Audit
   * ==========================================
   */

  await recordAuditLog({
    action:
      "topic.bulk_status",

    result:
      partial
        ? "failure"
        : "success",

    actorId:
      admin.account.id,

    actorRole:
      "admin",

    entityType:
      "topic",

    requestId,

    request,

    metadata: {
      active:
        parsed.active,

      requested_count:
        parsed.ids.length,

      succeeded_count:
        succeeded.length,

      failed_count:
        failed.length,

      /*
       * IDها Record ID هستند و داده حساس
       * محسوب نمی‌شوند. با این حال سقف Bulk
       * حداکثر 50 است.
       */
      succeeded_ids:
        succeeded,

      failed_ids:
        failed.map(
          (
            item
          ) =>
            item.id
        ),
    },

    ...(partial
      ? {
          errorCode:
            "TOPIC_BULK_PARTIAL_FAILURE",
        }
      : {}),
  });

  /*
   * اگر هیچ Updateای موفق نشده باشد، عملیات را
   * Failure کامل در نظر می‌گیریم.
   */
  if (
    succeeded.length ===
    0
  ) {
    return apiError(
      requestId,
      500,
      "TOPIC_BULK_STATUS_FAILED",
      "تغییر گروهی وضعیت موضوعات ناموفق بود.",
      {
        summary: {
          requested:
            parsed.ids.length,

          succeeded:
            0,

          failed:
            failed.length,
        },
      }
    );
  }

  return apiSuccess(
    {
      success:
        true,

      partial,

      active:
        parsed.active,

      updatedIds:
        succeeded,

      failedIds:
        failed.map(
          (
            item
          ) =>
            item.id
        ),

      summary: {
        requested:
          parsed.ids.length,

        succeeded:
          succeeded.length,

        failed:
          failed.length,
      },

      requestId,
    },
    partial
      ? 207
      : 200
  );
}

/*
 * ============================================
 * Parse Body
 * ============================================
 */

function parseBulkStatusRequest(
  value:
    unknown
):
  | {
      ok:
        true;

      ids:
        string[];

      active:
        boolean;
    }
  | {
      ok:
        false;

      code:
        string;

      message:
        string;
    } {
  if (
    typeof value !==
      "object" ||
    value ===
      null ||
    Array.isArray(
      value
    )
  ) {
    return {
      ok:
        false,

      code:
        "TOPIC_BULK_INVALID_BODY",

      message:
        "بدنه درخواست عملیات گروهی معتبر نیست.",
    };
  }

  const body =
    value as {
      ids?:
        unknown;

      active?:
        unknown;
    };

  if (
    !Array.isArray(
      body.ids
    )
  ) {
    return {
      ok:
        false,

      code:
        "TOPIC_BULK_IDS_REQUIRED",

      message:
        "شناسه موضوعات برای عملیات گروهی الزامی است.",
    };
  }

  const ids =
    [
      ...new Set(
        body.ids
          .filter(
            (
              id
            ): id is string =>
              typeof id ===
              "string"
          )
          .map(
            (
              id
            ) =>
              id.trim()
          )
          .filter(
            Boolean
          )
      ),
    ];

  if (
    ids.length ===
    0
  ) {
    return {
      ok:
        false,

      code:
        "TOPIC_BULK_EMPTY",

      message:
        "حداقل یک موضوع را انتخاب کنید.",
    };
  }

  if (
    ids.length >
    MAX_BULK_TOPICS
  ) {
    return {
      ok:
        false,

      code:
        "TOPIC_BULK_TOO_LARGE",

      message:
        `در هر عملیات گروهی حداکثر ${MAX_BULK_TOPICS} موضوع قابل تغییر است.`,
    };
  }

  if (
    ids.some(
      (
        id
      ) =>
        !isSafeTopicId(
          id
        )
    )
  ) {
    return {
      ok:
        false,

      code:
        "TOPIC_BULK_INVALID_ID",

      message:
        "یکی از شناسه‌های موضوع معتبر نیست.",
    };
  }

  if (
    typeof body.active !==
    "boolean"
  ) {
    return {
      ok:
        false,

      code:
        "TOPIC_BULK_ACTIVE_INVALID",

      message:
        "وضعیت مقصد عملیات گروهی معتبر نیست.",
    };
  }

  return {
    ok:
      true,

    ids,

    active:
      body.active,
  };
}

/*
 * ============================================
 * Responses
 * ============================================
 */

function apiSuccess(
  body:
    unknown,

  status =
    200
) {
  return Response.json(
    body,
    {
      status,

      headers: {
        "Cache-Control":
          "no-store",
      },
    }
  );
}

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
    >,

  headers?:
    Record<
      string,
      string
    >
) {
  return Response.json(
    {
      success:
        false,

      code,

      message,

      requestId,

      ...(extra ||
        {}),
    },
    {
      status,

      headers: {
        "Cache-Control":
          "no-store",

        ...(headers ||
          {}),
      },
    }
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