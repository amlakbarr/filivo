import { isSafeRecordId } from "@/lib/accounts/admin";
import {
  getAccountTopicAnalytics,
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
  { params }: { params: Promise<{ id: string }> }
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
  const { id } = await params;
  if (!isSafeRecordId(id)) {
    return analyticsError(
      requestId,
      400,
      "INVALID_ACCOUNT_ID",
      "شناسه حساب معتبر نیست."
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
    const analytics = await getAccountTopicAnalytics(
      pb,
      range,
      parseTopicAnalyticsFilters(searchParams),
      id
    );
    if (!analytics) {
      return analyticsError(
        requestId,
        404,
        "ACCOUNT_NOT_FOUND",
        "حساب موردنظر پیدا نشد."
      );
    }
    return analyticsResponse(
      { success: true, analytics },
      200,
      requestId
    );
  } catch (error) {
    console.error("Account topic analytics failed", {
      requestId,
      accountId: id,
      error,
    });
    return analyticsError(
      requestId,
      503,
      "ACCOUNT_TOPIC_ANALYTICS_UNAVAILABLE",
      "گزارش موضوعی کارشناس در دسترس نیست."
    );
  }
}
