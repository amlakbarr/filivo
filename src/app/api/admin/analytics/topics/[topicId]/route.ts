import {
  getTopicDetailsAnalytics,
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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ topicId: string }> }
) {
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
  const { topicId } = await params;
  if (!isId(topicId)) {
    return analyticsError(
      requestId,
      400,
      "INVALID_TOPIC_ID",
      "شناسه موضوع معتبر نیست."
    );
  }
  const searchParams = new URL(request.url).searchParams;
  let range;
  try {
    range = resolveAnalyticsRange(searchParams);
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
    const details = await getTopicDetailsAnalytics(
      pb,
      range,
      parseTopicAnalyticsFilters(searchParams),
      topicId
    );
    if (!details) {
      return analyticsError(
        requestId,
        404,
        "TOPIC_NOT_FOUND",
        "موضوع موردنظر پیدا نشد."
      );
    }
    return analyticsResponse(
      { success: true, details },
      200,
      requestId
    );
  } catch (error) {
    console.error("Topic details analytics failed", {
      requestId,
      topicId,
      error,
    });
    return analyticsError(
      requestId,
      503,
      "TOPIC_DETAILS_UNAVAILABLE",
      "جزئیات تحلیلی موضوع در دسترس نیست."
    );
  }
}

function isId(value: string) {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(value);
}
