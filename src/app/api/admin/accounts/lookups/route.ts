import {
  accountApiError,
  accountApiResponse,
} from "@/lib/accounts/response";
import { getAdminSession } from "@/lib/pocketbase/admin";
import { getPocketBaseServiceClient } from "@/lib/pocketbase/service";

export async function GET() {
  const requestId = crypto.randomUUID();
  const admin = await getAdminSession();

  if (!admin.ok) {
    return accountApiError(
      requestId,
      admin.status,
      admin.code,
      admin.message
    );
  }

  try {
    const pb = await getPocketBaseServiceClient();
    const records = await pb
      .collection("departments")
      .getFullList({ sort: "name" });

    return accountApiResponse(
      {
        success: true,
        departments: records
          .map((record) => ({
            id: record.id,
            name: String(record.name || "").trim(),
            active: record.active !== false,
          }))
          .filter((record) => record.name),
      },
      200,
      requestId
    );
  } catch (error) {
    console.error("Account lookups failed", {
      requestId,
      error,
    });
    return accountApiError(
      requestId,
      503,
      "ACCOUNT_LOOKUPS_FAILED",
      "دریافت فهرست دپارتمان‌ها ناموفق بود."
    );
  }
}
