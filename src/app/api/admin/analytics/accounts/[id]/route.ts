import {
  isSafeRecordId,
  serializeAccount,
  type AccountRecord,
} from "@/lib/accounts/admin";
import { getDashboardAnalytics } from "@/lib/analytics/dashboard";
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
    const accountRecord = await pb
      .collection("accounts")
      .getOne<AccountRecord>(id, {
        expand: "department",
      });
    const [dashboard, recentConversations] =
      await Promise.all([
        getDashboardAnalytics(pb, range, {
          accountId: id,
          employeePerPage: 1,
        }),
        pb.collection("conversations").getList(1, 10, {
          filter: pb.filter(
            "user = {:user} && created >= {:from} && created < {:to}",
            {
              user: id,
              from: range.from.toISOString(),
              to: range.to.toISOString(),
            }
          ),
          sort: "-last_message_at,-updated",
          fields:
            "id,title,status,created,updated,last_message_at",
        }),
      ]);

    return analyticsResponse(
      {
        success: true,
        account: serializeAccount(accountRecord),
        dashboard,
        conversations: recentConversations.items.map(
          (record) => ({
            id: record.id,
            title: String(
              record.title || "گفتگوی بدون عنوان"
            ),
            status: String(record.status || ""),
            created: String(record.created || ""),
            updated: String(record.updated || ""),
            last_message_at: String(
              record.last_message_at || ""
            ),
          })
        ),
      },
      200,
      requestId
    );
  } catch (error) {
    const status =
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      typeof error.status === "number"
        ? error.status
        : 503;
    return analyticsError(
      requestId,
      status === 404 ? 404 : 503,
      status === 404
        ? "ACCOUNT_NOT_FOUND"
        : "ACCOUNT_ANALYTICS_UNAVAILABLE",
      status === 404
        ? "حساب موردنظر پیدا نشد."
        : "اطلاعات مصرف کارشناس در دسترس نیست."
    );
  }
}
