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
 * GET
 *
 * Knowledge form lookups:
 * - Topics
 * - Departments
 * ============================================
 */

export async function GET() {
  const requestId =
    crypto.randomUUID();

  /*
   * ==========================================
   * Admin Authorization
   * ==========================================
   */

  const admin =
    await getAdminSession();

  if (!admin.ok) {
    return knowledgeApiError(
      requestId,
      admin.status,
      admin.code,
      admin.message
    );
  }

  /*
   * ==========================================
   * Service Client
   *
   * Admin Session فقط Authorization است.
   * خواندن داده‌ها با Superuser Client
   * انجام می‌شود.
   * ==========================================
   */

  let pb;

  try {
    pb =
      await getPocketBaseServiceClient();
  } catch (error) {
    console.error(
      "Knowledge lookups service unavailable",
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

    return knowledgeApiError(
      requestId,
      503,
      "KNOWLEDGE_SERVICE_UNAVAILABLE",
      "سرویس پایگاه دانش موقتاً در دسترس نیست."
    );
  }

  /*
   * ==========================================
   * Load Topics + Departments
   * ==========================================
   */

  try {
    const [
      topicRecords,
      departmentRecords,
    ] =
      await Promise.all([
        pb
          .collection(
            "topics"
          )
          .getFullList({
            /*
             * Topicهای غیرفعال نباید در فرم
             * Knowledge قابل انتخاب باشند.
             */
            filter:
              "active = true",

            /*
             * ساختار فعلی topics تخت (Flat) است
             * و parent ندارد.
             *
             * sort_order اولویت مدیریتی را مشخص
             * می‌کند و name ترتیب پایدار ثانویه است.
             */
            sort:
              "sort_order,name",

            fields:
              [
                "id",
                "name",
                "code",
                "description",
                "active",
                "sort_order",
              ].join(
                ","
              ),
          }),

        pb
          .collection(
            "departments"
          )
          .getFullList({
            sort:
              "name",
          }),
      ]);

    /*
     * ========================================
     * Topics
     *
     * TopicOption هنوز parent_id / parent_name
     * دارد تا Compatibility فرم فعلی حفظ شود،
     * اما در Schema فعلی این مقادیر خالی هستند.
     * ========================================
     */

    const topics =
      topicRecords
        .map(
          (
            record
          ) => {
            const name =
              String(
                record.name ||
                  ""
              ).trim();

            return {
              id:
                record.id,

              name,

              parent_id:
                "",

              parent_name:
                "",

              label:
                name,
            };
          }
        )
        .filter(
          (
            topic
          ) =>
            Boolean(
              topic.name
            )
        );

    /*
     * ========================================
     * Departments
     * ========================================
     */

    const departments =
      departmentRecords
        .filter(
          (
            record
          ) =>
            record.active !==
            false
        )
        .map(
          (
            record
          ) => ({
            id:
              record.id,

            name:
              String(
                record.name ||
                  ""
              ).trim(),
          })
        )
        .filter(
          (
            department
          ) =>
            Boolean(
              department.name
            )
        );

    /*
     * ========================================
     * Response
     * ========================================
     */

    return knowledgeApiResponse(
      {
        success:
          true,

        topics,

        departments,
      },
      200,
      requestId
    );
  } catch (error) {
    console.error(
      "Knowledge lookups failed",
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

    return knowledgeApiError(
      requestId,
      503,
      "KNOWLEDGE_LOOKUPS_FAILED",
      "دریافت موضوعات و واحدها ناموفق بود."
    );
  }
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