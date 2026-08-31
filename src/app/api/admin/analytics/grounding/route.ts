import {
  analyticsError,
  analyticsResponse,
} from "@/lib/analytics/response";

import {
  getGroundingAnalyticsDashboard,
  parseGroundingAnalyticsRange,
} from "@/lib/analytics/grounding";

import {
  getAdminSession,
} from "@/lib/pocketbase/admin";

import {
  getPocketBaseServiceClient,
} from "@/lib/pocketbase/service";

export async function GET(
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
    return analyticsError(
      requestId,
      admin.status,
      admin.code,
      admin.message
    );
  }

  const params =
    new URL(
      request.url
    ).searchParams;

  const range =
    parseGroundingAnalyticsRange(
      params.get(
        "range"
      )
    );

  try {
    const pb =
      await getPocketBaseServiceClient();

    const dashboard =
      await getGroundingAnalyticsDashboard(
        pb,
        range
      );

    return analyticsResponse(
      {
        success:
          true,

        dashboard,
      },
      200,
      requestId
    );
  } catch (error) {
    console.error(
      "Grounding analytics failed",
      {
        requestId,

        adminId:
          admin.account.id,

        error:
          errorMetadata(
            error
          ),
      }
    );

    return analyticsError(
      requestId,
      503,
      "GROUNDING_ANALYTICS_UNAVAILABLE",
      "اطلاعات کنترل صحت پاسخ‌ها در دسترس نیست."
    );
  }
}

function errorMetadata(
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
      message?:
        unknown;

      status?:
        unknown;
    };

  return {
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
  };
}
