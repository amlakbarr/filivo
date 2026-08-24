import {
  getTopicAnalyticsDashboard,
  parseTopicAnalyticsFilters,
} from "@/lib/analytics/topics";
import {
  AnalyticsRangeError,
  resolveAnalyticsRange,
} from "@/lib/analytics/range";
import {
  analyticsError,
  analyticsResponse,
} from "@/lib/analytics/response";
import { getAdminSession } from "@/lib/pocketbase/admin";
import { getPocketBaseServiceClient } from "@/lib/pocketbase/service";

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  const admin = await getAdminSession();

  if (!admin.ok) {
    return analyticsError(
      requestId,
      admin.status,
      admin.code,
      admin.message
    );
  }

  const params = new URL(request.url).searchParams;
  let range;

  try {
    range = resolveAnalyticsRange(params);
  } catch (error) {
    if (error instanceof AnalyticsRangeError) {
      return analyticsError(
        requestId,
        400,
        "INVALID_DATE_RANGE",
        error.message
      );
    }
    throw error;
  }

  try {
    const pb = await getPocketBaseServiceClient();
    const dashboard = await getTopicAnalyticsDashboard(
      pb,
      range,
      parseTopicAnalyticsFilters(params)
    );

    return analyticsResponse(
      { success: true, dashboard },
      200,
      requestId
    );
  } catch (error) {
    console.error("Topic analytics dashboard failed", {
      requestId,
      adminId: admin.account.id,
      error: metadata(error),
    });
    return analyticsError(
      requestId,
      503,
      "TOPIC_ANALYTICS_UNAVAILABLE",
      "اطلاعات تحلیل موضوعی در دسترس نیست."
    );
  }
}

function metadata(error: unknown) {
  if (typeof error !== "object" || error === null) {
    return { message: String(error) };
  }
  const value = error as { message?: unknown; status?: unknown };
  return {
    message:
      typeof value.message === "string" ? value.message : undefined,
    status:
      typeof value.status === "number" ? value.status : undefined,
  };
}
