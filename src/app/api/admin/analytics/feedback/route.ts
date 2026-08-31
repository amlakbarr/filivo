import {
  getFeedbackAnalytics,
  normalizeFeedbackRange,
  normalizeFeedbackReviewFilter,
} from "@/lib/analytics/feedback";

import {
  getAdminSession,
} from "@/lib/pocketbase/admin";

/*
 * ============================================
 * GET
 *
 * Admin Feedback Analytics
 * ============================================
 */

export async function GET(
  request:
    Request
) {
  const requestId =
    crypto.randomUUID();

  /*
   * ==========================================
   * Authentication
   * ==========================================
   */

  const admin =
    await getAdminSession();

  if (
    !admin.ok
  ) {
    return Response.json(
      {
        success:
          false,

        code:
          admin.code,

        message:
          admin.message,

        requestId,
      },
      {
        status:
          admin.status,

        headers: {
          "X-Request-Id":
            requestId,

          "Cache-Control":
            "no-store",

          "Pragma":
            "no-cache",
        },
      }
    );
  }

  /*
   * ==========================================
   * Range
   * ==========================================
   */

  const searchParams =
    new URL(
      request.url
    ).searchParams;

  const range =
    normalizeFeedbackRange(
      searchParams.get(
        "range"
      ) ||
        undefined
    );

  const review =
    normalizeFeedbackReviewFilter(
      searchParams.get(
        "review"
      ) ||
        undefined
    );

  /*
   * ==========================================
   * Analytics
   * ==========================================
   */

  try {
    const analytics =
      await getFeedbackAnalytics(
        range,
        review
      );

    return Response.json(
      {
        success:
          true,

        analytics,

        requestId,
      },
      {
        status:
          200,

        headers: {
          "X-Request-Id":
            requestId,

          "Cache-Control":
            "no-store",

          "Pragma":
            "no-cache",
        },
      }
    );
  } catch (error) {
    console.error(
      "Feedback analytics failed",
      {
        requestId,

        adminId:
          admin.account.id,

        range,

        review,

        error:
          getErrorMetadata(
            error
          ),
      }
    );

    return Response.json(
      {
        success:
          false,

        code:
          "FEEDBACK_ANALYTICS_UNAVAILABLE",

        message:
          "گزارش کیفیت پاسخ‌ها موقتاً در دسترس نیست.",

        requestId,
      },
      {
        status:
          503,

        headers: {
          "X-Request-Id":
            requestId,

          "Cache-Control":
            "no-store",

          "Pragma":
            "no-cache",
        },
      }
    );
  }
}

/*
 * ============================================
 * Error Metadata
 * ============================================
 */

function getErrorMetadata(
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
      message:
        String(
          error
        ),
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
