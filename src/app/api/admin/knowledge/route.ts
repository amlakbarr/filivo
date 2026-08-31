import {
  after,
} from "next/server";

import type PocketBase from "pocketbase";

import {
  recordAuditLog,
} from "@/lib/audit/log";

import {
  consumeAdminRateLimit,
} from "@/lib/admin/rate-limit";

import {
  syncKnowledgeItem,
  type KnowledgeItemRecord,
} from "@/lib/ai/knowledge";

import {
  runKnowledgeTriggeredEvals,
} from "@/lib/ai/knowledge-eval-trigger";

import {
  KNOWLEDGE_STATUSES,
  KNOWLEDGE_SYNC_STATUSES,
  buildKnowledgePayload,
  getPocketBaseError,
  parseKnowledgeRequest,
  serializeKnowledgeItem,
  validateKnowledgeRelations,
} from "@/lib/knowledge/admin";

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
 * Limits
 * ============================================
 */

const MAX_PAGE_SIZE =
  50;

/*
 * ============================================
 * GET
 *
 * List Knowledge Items
 *
 * Read-only:
 * Mutation Rate Limit روی GET اعمال نمی‌شود.
 * ============================================
 */

export async function GET(
  request: Request
) {
  const requestId =
    crypto.randomUUID();

  /*
   * ==========================================
   * Admin Authorization
   * ==========================================
   */

  const admin =
    await getAdminSession();

  if (
    !admin.ok
  ) {
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
   * ==========================================
   */

  let pb:
    PocketBase;

  try {
    pb =
      await getPocketBaseServiceClient();
  } catch (error) {
    console.error(
      "Knowledge service unavailable",
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
   * Query Parameters
   * ==========================================
   */

  const url =
    new URL(
      request.url
    );

  const page =
    clampInteger(
      url.searchParams.get(
        "page"
      ),
      1,
      100_000,
      1
    );

  const perPage =
    clampInteger(
      url.searchParams.get(
        "perPage"
      ),
      1,
      MAX_PAGE_SIZE,
      10
    );

  const search =
    cleanQuery(
      url.searchParams.get(
        "search"
      )
    );

  const status =
    url.searchParams.get(
      "status"
    ) ||
    "";

  const syncStatus =
    url.searchParams.get(
      "sync_status"
    ) ||
    "";

  const topic =
    cleanRelationFilter(
      url.searchParams.get(
        "topic"
      )
    );

  const order =
    url.searchParams.get(
      "order"
    ) ===
    "oldest"
      ? "created"
      : "-created";

  /*
   * ==========================================
   * Filters
   *
   * Client هیچ PocketBase Filter خامی ارسال
   * نمی‌کند.
   * ==========================================
   */

  const filters:
    string[] = [];

  const values:
    Record<
      string,
      string
    > = {};

  if (
    search
  ) {
    filters.push(
      "title ~ {:search}"
    );

    values.search =
      search;
  }

  if (
    KNOWLEDGE_STATUSES.includes(
      status as (
        typeof KNOWLEDGE_STATUSES
      )[number]
    )
  ) {
    filters.push(
      "status = {:status}"
    );

    values.status =
      status;
  }

  if (
    KNOWLEDGE_SYNC_STATUSES.includes(
      syncStatus as (
        typeof KNOWLEDGE_SYNC_STATUSES
      )[number]
    )
  ) {
    filters.push(
      "sync_status = {:syncStatus}"
    );

    values.syncStatus =
      syncStatus;
  }

  if (
    topic
  ) {
    filters.push(
      "topic = {:topic}"
    );

    values.topic =
      topic;
  }

  /*
   * ==========================================
   * Load Knowledge Items
   * ==========================================
   */

  try {
    const result =
      await pb
        .collection(
          "knowledge_items"
        )
        .getList<KnowledgeItemRecord>(
          page,
          perPage,
          {
            filter:
              filters.length >
              0
                ? pb.filter(
                    filters.join(
                      " && "
                    ),
                    values
                  )
                : "",

            sort:
              order,

            expand:
              "topic,topic.parent,departments",
          }
        );

    return knowledgeApiResponse(
      {
        success:
          true,

        items:
          result.items.map(
            serializeKnowledgeItem
          ),

        page:
          result.page,

        perPage:
          result.perPage,

        totalItems:
          result.totalItems,

        totalPages:
          result.totalPages,
      },
      200,
      requestId
    );
  } catch (error) {
    console.error(
      "Knowledge list failed",
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
      "KNOWLEDGE_LIST_FAILED",
      "دریافت فهرست پایگاه دانش ناموفق بود."
    );
  }
}

/*
 * ============================================
 * POST
 *
 * Create Knowledge Item
 *
 * Rate Limit:
 *
 * knowledge.create
 * 10 requests / minute / admin
 * ============================================
 */

export async function POST(
  request: Request
) {
  const requestId =
    crypto.randomUUID();

  /*
   * ==========================================
   * Admin Authorization
   * ==========================================
   */

  const admin =
    await getAdminSession();

  if (
    !admin.ok
  ) {
    return knowledgeApiError(
      requestId,
      admin.status,
      admin.code,
      admin.message
    );
  }

  /*
   * ==========================================
   * Admin Rate Limit
   *
   * knowledge.create
   * 10 requests / minute / admin
   *
   * Rate Limit قبل از:
   *
   * - Parse Request
   * - File handling
   * - PocketBase queries
   * - Create
   * - OpenAI Sync
   *
   * اجرا می‌شود.
   *
   * Fail-closed:
   * Rate Limiter unavailable => هیچ Knowledge
   * Item ساخته نمی‌شود.
   * ==========================================
   */

  let rateLimit:
    Awaited<
      ReturnType<
        typeof consumeAdminRateLimit
      >
    >;

  try {
    rateLimit =
      await consumeAdminRateLimit({
        adminId:
          admin.account.id,

        action:
          "knowledge.create",

        requestId,
      });
  } catch (error) {
    console.error(
      "Admin knowledge create rate limit unavailable",
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
      "ADMIN_RATE_LIMIT_UNAVAILABLE",
      "سرویس کنترل تعداد درخواست‌ها موقتاً در دسترس نیست."
    );
  }

  /*
   * ==========================================
   * Rate Limited
   * ==========================================
   */

  if (
    !rateLimit.allowed
  ) {
    console.warn(
      "Admin knowledge create rate limited",
      {
        requestId,

        adminId:
          admin.account.id,

        retryAfterSeconds:
          rateLimit.retryAfterSeconds,

        resetAt:
          rateLimit.resetAt,
      }
    );

    const response =
      knowledgeApiError(
        requestId,
        429,
        "ADMIN_RATE_LIMITED",
        "تعداد درخواست‌های ساخت مطلب بیش از حد مجاز است.",
        {
          retryAfterSeconds:
            rateLimit.retryAfterSeconds,

          limit:
            rateLimit.limit,

          remaining:
            rateLimit.remaining,

          resetAt:
            rateLimit.resetAt,
        }
      );

    response.headers.set(
      "Retry-After",
      String(
        rateLimit.retryAfterSeconds
      )
    );

    response.headers.set(
      "X-RateLimit-Limit",
      String(
        rateLimit.limit
      )
    );

    response.headers.set(
      "X-RateLimit-Remaining",
      "0"
    );

    response.headers.set(
      "X-RateLimit-Reset",
      rateLimit.resetAt
    );

    return response;
  }

  /*
   * ==========================================
   * Response Wrapper
   * ==========================================
   */

  const allowedRateLimit =
    rateLimit;

  const respond =
    <TResponse extends Response>(
      response:
        TResponse
    ) =>
      withRateLimitHeaders(
        response,
        allowedRateLimit
      );

  /*
   * ==========================================
   * Service Client
   * ==========================================
   */

  let pb:
    PocketBase;

  try {
    pb =
      await getPocketBaseServiceClient();
  } catch (error) {
    console.error(
      "Knowledge service unavailable",
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

    await safeAudit({
      request,

      requestId,

      actorId:
        admin.account.id,

      action:
        "knowledge.create",

      result:
        "failure",

      errorCode:
        "KNOWLEDGE_SERVICE_UNAVAILABLE",

      metadata: {
        stage:
          "service_client",
      },
    });

    return respond(
      knowledgeApiError(
        requestId,
        503,
        "KNOWLEDGE_SERVICE_UNAVAILABLE",
        "سرویس پایگاه دانش موقتاً در دسترس نیست."
      )
    );
  }

  /*
   * ==========================================
   * Parse Request
   *
   * parseKnowledgeRequest مسئول Validation و
   * محدودیت‌های Body/File این بخش است.
   * ==========================================
   */

  const parsed =
    await parseKnowledgeRequest(
      request
    );

  if (
    !parsed.success
  ) {
    return respond(
      knowledgeApiError(
        requestId,
        400,
        parsed.code,
        parsed.message,
        {
          fieldErrors:
            parsed.fieldErrors,
        }
      )
    );
  }

  /*
   * ==========================================
   * Validate Relations
   * ==========================================
   */

  let relationErrors:
    Record<
      string,
      string
    >;

  try {
    relationErrors =
      await validateKnowledgeRelations(
        pb,
        parsed.data
      );
  } catch (error) {
    console.error(
      "Knowledge relation validation failed",
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

    return respond(
      knowledgeApiError(
        requestId,
        503,
        "KNOWLEDGE_RELATION_VALIDATION_FAILED",
        "بررسی اطلاعات مرتبط با مطلب ناموفق بود."
      )
    );
  }

  if (
    Object.keys(
      relationErrors
    ).length >
    0
  ) {
    return respond(
      knowledgeApiError(
        requestId,
        400,
        "VALIDATION_ERROR",
        Object.values(
          relationErrors
        )[0],
        {
          fieldErrors:
            relationErrors,
        }
      )
    );
  }

  /*
   * ==========================================
   * State
   *
   * برای تشخیص اینکه Failure قبل یا بعد از
   * ایجاد Record رخ داده است.
   * ==========================================
   */

  let created:
    KnowledgeItemRecord |
    null =
    null;

  let syncAuditWritten =
    false;

  try {
    /*
     * ========================================
     * Payload
     * ========================================
     */

    const payload =
      buildKnowledgePayload(
        parsed.data,
        {
          createdBy:
            admin.account.id,

          updatedBy:
            admin.account.id,
        },
        {
          version:
            1,

          syncStatus:
            "pending",
        }
      );

    /*
     * ========================================
     * Create Record
     * ========================================
     */

    created =
      await pb
        .collection(
          "knowledge_items"
        )
        .create<KnowledgeItemRecord>(
          payload
        );

    /*
     * ========================================
     * Audit: Create Success
     *
     * Audit failure نباید Create موفق را Fail
     * کند.
     * ========================================
     */

    await safeAudit({
      request,

      requestId,

      actorId:
        admin.account.id,

      action:
        "knowledge.create",

      result:
        "success",

      entityId:
        created.id,

      metadata: {
        title:
          cleanAuditText(
            created.title ||
              parsed.data.title,
            200
          ),

        status:
          parsed.data.status,

        source_type:
          parsed.data.sourceType,

        topic_id:
          parsed.data.topic ||
          null,

        department_count:
          parsed.data.departments
            ?.length ||
          0,
      },
    });

    /*
     * ========================================
     * Audit: Publish
     * ========================================
     */

    if (
      parsed.data.status ===
      "published"
    ) {
      await safeAudit({
        request,

        requestId,

        actorId:
          admin.account.id,

        action:
          "knowledge.publish",

        result:
          "success",

        entityId:
          created.id,

        metadata: {
          title:
            cleanAuditText(
              created.title ||
                parsed.data.title,
              200
            ),

          previous_status:
            null,

          new_status:
            "published",
        },
      });
    }

    /*
     * ========================================
     * OpenAI / Vector Store Sync
     * ========================================
     */

    const sync =
      parsed.data.status ===
      "published"
        ? await syncKnowledgeItem(
            created.id,
            pb
          )
        : null;

    /*
     * ========================================
     * Audit: Sync
     * ========================================
     */

    if (
      parsed.data.status ===
      "published"
    ) {
      if (
        sync?.success ===
        true
      ) {
        await safeAudit({
          request,

          requestId,

          actorId:
            admin.account.id,

          action:
            "knowledge.sync.success",

          result:
            "success",

          entityId:
            created.id,

          metadata: {
            title:
              cleanAuditText(
                created.title ||
                  parsed.data.title,
                200
              ),

            sync_status:
              "synced",
          },
        });
      } else {
        await safeAudit({
          request,

          requestId,

          actorId:
            admin.account.id,

          action:
            "knowledge.sync.failure",

          result:
            "failure",

          entityId:
            created.id,

          errorCode:
            getSyncErrorCode(
              sync
            ),

          metadata: {
            title:
              cleanAuditText(
                created.title ||
                  parsed.data.title,
                200
              ),

            sync_status:
              "error",

            message:
              getSyncMessage(
                sync
              ),
          },
        });
      }

      syncAuditWritten =
        true;
    }

    /*
     * ========================================
     * Automatic Golden Tests
     *
     * فقط بعد از Publish + Sync موفق.
     * after() باعث می‌شود Response منتظر
     * اجرای Eval نماند.
     * ========================================
     */

    if (
      parsed.data.status ===
        "published" &&
      sync?.success ===
        true
    ) {
      const knowledgeId =
        created.id;

      const adminId =
        admin.account.id;

      after(
        async () => {
          try {
            await runKnowledgeTriggeredEvals({
              knowledgeId,

              adminId,

              trigger:
                "publish",
            });
          } catch (error) {
            console.error(
              "Automatic knowledge publish eval failed",
              {
                knowledgeId,

                adminId,

                error:
                  safeErrorMetadata(
                    error
                  ),
              }
            );
          }
        }
      );
    }

    /*
     * ========================================
     * Reload Expanded Record
     * ========================================
     */

    let item:
      KnowledgeItemRecord;

    try {
      item =
        await getExpandedKnowledgeItem(
          pb,
          created.id
        );
    } catch (error) {
      /*
       * Record واقعاً ساخته شده است.
       *
       * Reload failure نباید Create را Failure
       * نشان دهد.
       */

      console.error(
        "Knowledge created but reload failed",
        {
          requestId,

          adminId:
            admin.account.id,

          knowledgeId:
            created.id,

          error:
            safeErrorMetadata(
              error
            ),
        }
      );

      return respond(
        knowledgeApiResponse(
          {
            success:
              true,

            item:
              serializeKnowledgeItem(
                created
              ),

            sync,

            message:
              parsed.data.status ===
              "draft"
                ? "پیش‌نویس با موفقیت ذخیره شد."
                : sync?.success
                  ? "مطلب منتشر و با پایگاه برداری همگام شد."
                  : "مطلب منتشر شد، اما همگام‌سازی ناموفق بود.",

            warning:
              "مطلب ذخیره شد، اما دریافت اطلاعات تکمیلی آن ناموفق بود.",

            warningCode:
              "KNOWLEDGE_RELOAD_FAILED",
          },
          201,
          requestId
        )
      );
    }

    /*
     * ========================================
     * Response
     * ========================================
     */

    return respond(
      knowledgeApiResponse(
        {
          success:
            true,

          item:
            serializeKnowledgeItem(
              item
            ),

          sync,

          message:
            parsed.data.status ===
            "draft"
              ? "پیش‌نویس با موفقیت ذخیره شد."
              : sync?.success
                ? "مطلب منتشر و با پایگاه برداری همگام شد."
                : "مطلب منتشر شد، اما همگام‌سازی ناموفق بود.",
        },
        201,
        requestId
      )
    );
  } catch (error) {
    const metadata =
      getPocketBaseError(
        error
      );

    console.error(
      "Knowledge create failed",
      {
        requestId,

        adminId:
          admin.account.id,

        knowledgeId:
          created?.id,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    /*
     * ========================================
     * Audit: Create Failure
     *
     * فقط اگر Record اصلاً ساخته نشده باشد.
     * ========================================
     */

    if (
      !created
    ) {
      await safeAudit({
        request,

        requestId,

        actorId:
          admin.account.id,

        action:
          "knowledge.create",

        result:
          "failure",

        errorCode:
          "KNOWLEDGE_CREATE_FAILED",

        metadata: {
          requested_status:
            parsed.data.status,

          source_type:
            parsed.data.sourceType,

          title:
            cleanAuditText(
              parsed.data.title,
              200
            ),

          pocketbase_status:
            metadata.status,
        },
      });
    }

    /*
     * ========================================
     * Unexpected Sync Failure
     * ========================================
     */

    if (
      created &&
      parsed.data.status ===
        "published" &&
      !syncAuditWritten
    ) {
      await safeAudit({
        request,

        requestId,

        actorId:
          admin.account.id,

        action:
          "knowledge.sync.failure",

        result:
          "failure",

        entityId:
          created.id,

        errorCode:
          "KNOWLEDGE_SYNC_EXCEPTION",

        metadata: {
          title:
            cleanAuditText(
              created.title ||
                parsed.data.title,
              200
            ),
        },
      });
    }

    /*
     * ========================================
     * Important:
     *
     * اگر Record قبلاً ایجاد شده باشد 503
     * برمی‌گردانیم اما صریحاً مشخص می‌کنیم که
     * Create انجام شده است.
     * ========================================
     */

    return respond(
      knowledgeApiError(
        requestId,

        metadata.status ===
          400
          ? 400
          : 503,

        created
          ? "KNOWLEDGE_CREATE_PARTIAL"
          : "KNOWLEDGE_CREATE_FAILED",

        metadata.status ===
          400
          ? "ذخیره مطلب به‌دلیل ناسازگاری اطلاعات با ساختار PocketBase ناموفق بود."
          : created
            ? "مطلب ایجاد شد، اما تکمیل عملیات انتشار یا همگام‌سازی ناموفق بود."
            : "ذخیره مطلب جدید ناموفق بود.",

        created
          ? {
              knowledgeId:
                created.id,

              created:
                true,
            }
          : undefined
      )
    );
  }
}

/*
 * ============================================
 * Rate Limit Headers
 * ============================================
 */

function withRateLimitHeaders<
  TResponse extends Response,
>(
  response:
    TResponse,

  rateLimit: {
    limit:
      number;

    remaining:
      number;

    resetAt:
      string;
  }
) {
  response.headers.set(
    "X-RateLimit-Limit",
    String(
      rateLimit.limit
    )
  );

  response.headers.set(
    "X-RateLimit-Remaining",
    String(
      rateLimit.remaining
    )
  );

  response.headers.set(
    "X-RateLimit-Reset",
    rateLimit.resetAt
  );

  return response;
}

/*
 * ============================================
 * Audit Helper
 *
 * Audit failure هیچ‌وقت نباید عملیات اصلی
 * Knowledge را Fail کند.
 * ============================================
 */

async function safeAudit({
  request,
  requestId,
  actorId,
  action,
  result,
  entityId,
  errorCode,
  metadata,
}: {
  request:
    Request;

  requestId:
    string;

  actorId:
    string;

  action:
    string;

  result:
    | "success"
    | "failure"
    | "blocked";

  entityId?:
    string;

  errorCode?:
    string;

  metadata?:
    Record<
      string,
      unknown
    >;
}) {
  try {
    await recordAuditLog({
      request,

      requestId,

      actorId,

      actorRole:
        "admin",

      action,

      result,

      entityType:
        "knowledge_item",

      ...(entityId
        ? {
            entityId,
          }
        : {}),

      ...(errorCode
        ? {
            errorCode,
          }
        : {}),

      ...(metadata
        ? {
            metadata,
          }
        : {}),
    });
  } catch (error) {
    console.error(
      "Knowledge audit failed",
      {
        requestId,

        actorId,

        action,

        entityId,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );
  }
}

/*
 * ============================================
 * Expanded Knowledge Item
 * ============================================
 */

async function getExpandedKnowledgeItem(
  pb:
    PocketBase,

  id:
    string
) {
  return pb
    .collection(
      "knowledge_items"
    )
    .getOne<KnowledgeItemRecord>(
      id,
      {
        expand:
          "topic,topic.parent,departments",
      }
    );
}

/*
 * ============================================
 * Sync Error Code
 * ============================================
 */

function getSyncErrorCode(
  sync:
    unknown
) {
  if (
    typeof sync !==
      "object" ||
    sync ===
      null
  ) {
    return "KNOWLEDGE_SYNC_FAILED";
  }

  const value =
    sync as {
      code?:
        unknown;
    };

  if (
    typeof value.code !==
    "string"
  ) {
    return "KNOWLEDGE_SYNC_FAILED";
  }

  const code =
    value.code
      .trim()
      .slice(
        0,
        120
      );

  return (
    code ||
    "KNOWLEDGE_SYNC_FAILED"
  );
}

/*
 * ============================================
 * Sync Message
 * ============================================
 */

function getSyncMessage(
  sync:
    unknown
) {
  if (
    typeof sync !==
      "object" ||
    sync ===
      null
  ) {
    return "";
  }

  const value =
    sync as {
      message?:
        unknown;
    };

  if (
    typeof value.message !==
    "string"
  ) {
    return "";
  }

  return cleanAuditText(
    value.message,
    500
  );
}

/*
 * ============================================
 * Audit Text
 * ============================================
 */

function cleanAuditText(
  value:
    unknown,

  maximumLength:
    number
) {
  return String(
    value ||
      ""
  )
    .replace(
      /[\u0000-\u001f\u007f]/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim()
    .slice(
      0,
      maximumLength
    );
}

/*
 * ============================================
 * Integer
 * ============================================
 */

function clampInteger(
  value:
    string |
    null,

  minimum:
    number,

  maximum:
    number,

  fallback:
    number
) {
  const number =
    Number(
      value
    );

  return Number.isInteger(
    number
  )
    ? Math.min(
        Math.max(
          number,
          minimum
        ),
        maximum
      )
    : fallback;
}

/*
 * ============================================
 * Search
 * ============================================
 */

function cleanQuery(
  value:
    string |
    null
) {
  return String(
    value ||
      ""
  )
    .replace(
      /[\u0000-\u001f\u007f]/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim()
    .slice(
      0,
      100
    );
}

/*
 * ============================================
 * Relation Filter
 * ============================================
 */

function cleanRelationFilter(
  value:
    string |
    null
) {
  const cleaned =
    String(
      value ||
        ""
    ).trim();

  return /^[a-zA-Z0-9_-]{1,64}$/.test(
    cleaned
  )
    ? cleaned
    : "";
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