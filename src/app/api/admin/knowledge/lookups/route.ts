import type {
  RecordModel,
} from "pocketbase";

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
            sort:
              "name",

            expand:
              "parent",
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
     * ========================================
     */

    const topics =
      topicRecords
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
          ) => {
            const parent =
              expanded(
                record,
                "parent"
              );

            const name =
              String(
                record.name ||
                  ""
              ).trim();

            const parentName =
              String(
                parent?.name ||
                  ""
              ).trim();

            return {
              id:
                record.id,

              name,

              parent_id:
                String(
                  record.parent ||
                    ""
                ),

              parent_name:
                parentName,

              label:
                parentName
                  ? `${parentName} > ${name}`
                  : name,
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
 * Expanded Relation
 * ============================================
 */

function expanded(
  record:
    RecordModel,

  key:
    string
) {
  const value =
    record.expand?.[
      key
    ];

  return Array.isArray(
    value
  )
    ? value[0]
    : value;
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
      name?: unknown;

      status?: unknown;

      code?: unknown;
    };

  return {
    name:
      typeof value.name ===
      "string"
        ? value.name
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