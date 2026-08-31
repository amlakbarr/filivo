import type PocketBase from "pocketbase";

import {
  recordAuditLog,
} from "@/lib/audit/log";

import {
  consumeAdminRateLimit,
} from "@/lib/admin/rate-limit";

import {
  cleanupExpiredGuidanceValidationUses,
} from "@/lib/topics/guidance-validation-use";

import {
  getAdminSession,
} from "@/lib/pocketbase/admin";

import {
  getPocketBaseServiceClient,
} from "@/lib/pocketbase/service";

const MAX_BATCHES =
  5;

const BATCH_SIZE =
  200;

/*
 * ============================================
 * POST
 *
 * Manual maintenance action for Admins.
 *
 * - Only expired replay-lock rows are removed.
 * - Runs multiple bounded batches.
 * - Audit logs are preserved.
 * - Uses existing topic.update mutation budget.
 * ============================================
 */

export async function POST(
  request:
    Request
) {
  const requestId =
    crypto.randomUUID();

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

  try {
    const rateLimit =
      await consumeAdminRateLimit({
        adminId:
          admin.account.id,

        action:
          "topic.update",

        requestId,
      });

    if (
      !rateLimit.allowed
    ) {
      return apiError(
        requestId,
        429,
        rateLimit.code,
        "تعداد درخواست‌های مدیریتی بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.",
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
      "Manual validation cleanup rate limit unavailable",
      {
        requestId,

        adminId:
          admin.account.id,

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
      "کنترل محدودیت درخواست‌های مدیریتی موقتاً در دسترس نیست."
    );
  }

  let pb:
    PocketBase;

  try {
    pb =
      await getPocketBaseServiceClient();
  } catch (error) {
    console.error(
      "Manual validation cleanup service unavailable",
      {
        requestId,

        adminId:
          admin.account.id,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return apiError(
      requestId,
      503,
      "VALIDATION_CLEANUP_SERVICE_UNAVAILABLE",
      "سرویس Cleanup موقتاً در دسترس نیست."
    );
  }

  let matched =
    0;

  let deleted =
    0;

  let alreadyGone =
    0;

  let failed =
    0;

  let hasMore =
    false;

  let batches =
    0;

  try {
    for (
      let index =
        0;
      index <
      MAX_BATCHES;
      index +=
        1
    ) {
      const result =
        await cleanupExpiredGuidanceValidationUses({
          pb,

          limit:
            BATCH_SIZE,
        });

      batches +=
        1;

      matched +=
        result.matched;

      deleted +=
        result.deleted;

      alreadyGone +=
        result.alreadyGone;

      failed +=
        result.failed;

      hasMore =
        result.hasMore;

      /*
       * اگر Batch کامل نبود یا چیزی پیدا نشد،
       * Backlog این اجرای bounded تمام شده است.
       */
      if (
        !result.hasMore ||
        result.matched ===
          0
      ) {
        break;
      }
    }

    await recordAuditLog({
      action:
        "topic.validation_cleanup.manual",

      result:
        failed >
        0
          ? "failure"
          : "success",

      actorId:
        admin.account.id,

      actorRole:
        "admin",

      entityType:
        "topic_guidance_validation_uses",

      requestId,

      request,

      metadata: {
        batches,

        matched,

        deleted,

        already_gone:
          alreadyGone,

        failed,

        has_more:
          hasMore,
      },
    });

    return Response.json(
      {
        success:
          true,

        status:
          failed >
            0
            ? "partial"
            : hasMore
              ? "more_remaining"
              : "complete",

        batches,

        matched,

        deleted,

        alreadyGone,

        failed,

        hasMore,

        requestId,
      },
      {
        status:
          200,

        headers: {
          "Cache-Control":
            "no-store",

          "X-Request-Id":
            requestId,
        },
      }
    );
  } catch (error) {
    console.error(
      "Manual validation cleanup failed",
      {
        requestId,

        adminId:
          admin.account.id,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    await recordAuditLog({
      action:
        "topic.validation_cleanup.manual",

      result:
        "failure",

      actorId:
        admin.account.id,

      actorRole:
        "admin",

      entityType:
        "topic_guidance_validation_uses",

      requestId,

      request,

      errorCode:
        "VALIDATION_CLEANUP_FAILED",

      metadata: {
        batches,

        matched,

        deleted,

        already_gone:
          alreadyGone,

        failed,
      },
    });

    return apiError(
      requestId,
      503,
      "VALIDATION_CLEANUP_FAILED",
      "پاکسازی دستی Validation ناموفق بود."
    );
  }
}

/*
 * ============================================
 * Helpers
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

        "X-Request-Id":
          requestId,

        ...(headers ||
          {}),
      },
    }
  );
}
