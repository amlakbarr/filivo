import {
  NextResponse,
} from "next/server";

import {
  consumeAdminRateLimit,
} from "@/lib/admin/rate-limit";

import {
  removeKnowledgeItemFromOpenAI,
  syncKnowledgeItem,
  type KnowledgeItemRecord,
} from "@/lib/ai/knowledge";

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

const SYNC_CONCURRENCY =
  3;

const DEFAULT_MAX_SYNC_ITEMS_PER_RUN =
  25;

const DEFAULT_MAX_CLEANUP_ITEMS_PER_RUN =
  25;

const ABSOLUTE_MAX_ITEMS_PER_GROUP =
  100;

/*
 * ============================================
 * POST
 *
 * Sync a bounded batch of pending published
 * Knowledge Items and cleanup inactive items.
 *
 * Rate Limit:
 *
 * knowledge.sync_batch
 * 2 requests / minute / admin
 * ============================================
 */

export async function POST() {
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
    return jsonResponse(
      {
        success:
          false,

        code:
          admin.code,

        message:
          admin.message,

        requestId,
      },
      admin.status,
      requestId
    );
  }

  /*
   * ==========================================
   * Admin Rate Limit
   *
   * این Endpoint می‌تواند در هر اجرا چندین
   * عملیات OpenAI انجام دهد؛ بنابراین Policy
   * آن عمداً سخت‌تر است.
   *
   * knowledge.sync_batch:
   * 2 executions / minute / admin
   *
   * Fail-closed:
   * اگر Rate Limiter در دسترس نباشد Batch
   * اجرا نمی‌شود.
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
          "knowledge.sync_batch",

        requestId,
      });
  } catch (error) {
    console.error(
      "Admin knowledge batch rate limit unavailable",
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

    return jsonResponse(
      {
        success:
          false,

        code:
          "ADMIN_RATE_LIMIT_UNAVAILABLE",

        message:
          "سرویس کنترل تعداد درخواست‌ها موقتاً در دسترس نیست.",

        requestId,
      },
      503,
      requestId
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
    const response =
      jsonResponse(
        {
          success:
            false,

          code:
            "ADMIN_RATE_LIMITED",

          message:
            "تعداد اجرای همگام‌سازی گروهی بیش از حد مجاز است.",

          retryAfterSeconds:
            rateLimit.retryAfterSeconds,

          limit:
            rateLimit.limit,

          remaining:
            rateLimit.remaining,

          resetAt:
            rateLimit.resetAt,

          requestId,
        },
        429,
        requestId
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
   * Service Client
   * ==========================================
   */

  let pb;

  try {
    pb =
      await getPocketBaseServiceClient();
  } catch (error) {
    console.error(
      "Knowledge pending sync service unavailable",
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

    return withRateLimitHeaders(
      jsonResponse(
        {
          success:
            false,

          code:
            "KNOWLEDGE_SERVICE_UNAVAILABLE",

          message:
            "سرویس پایگاه دانش موقتاً در دسترس نیست.",

          requestId,
        },
        503,
        requestId
      ),
      rateLimit
    );
  }

  /*
   * ==========================================
   * Batch Limits
   * ==========================================
   */

  const maxSyncItems =
    environmentInteger(
      process.env
        .KNOWLEDGE_SYNC_BATCH_SIZE,
      1,
      ABSOLUTE_MAX_ITEMS_PER_GROUP,
      DEFAULT_MAX_SYNC_ITEMS_PER_RUN
    );

  const maxCleanupItems =
    environmentInteger(
      process.env
        .KNOWLEDGE_CLEANUP_BATCH_SIZE,
      1,
      ABSOLUTE_MAX_ITEMS_PER_GROUP,
      DEFAULT_MAX_CLEANUP_ITEMS_PER_RUN
    );

  /*
   * ==========================================
   * Load Bounded Pending Records
   *
   * 1. Published but not synced
   * 2. Inactive/Draft but still has OpenAI data
   *
   * getFullList عمداً استفاده نمی‌شود.
   * ==========================================
   */

  let pendingResult;

  let inactiveResult;

  try {
    [
      pendingResult,
      inactiveResult,
    ] =
      await Promise.all([
        pb
          .collection(
            "knowledge_items"
          )
          .getList<KnowledgeItemRecord>(
            1,
            maxSyncItems,
            {
              filter:
                "status = 'published' && sync_status != 'synced'",

              /*
               * قدیمی‌ترین Pendingها اول.
               */
              sort:
                "created",
            }
          ),

        pb
          .collection(
            "knowledge_items"
          )
          .getList<KnowledgeItemRecord>(
            1,
            maxCleanupItems,
            {
              filter:
                "status != 'published' && (openai_file_id != '' || sync_status = 'synced')",

              /*
               * قدیمی‌ترین Cleanupها اول.
               */
              sort:
                "created",
            }
          ),
      ]);
  } catch (error) {
    console.error(
      "Failed to load pending knowledge items",
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

    return withRateLimitHeaders(
      jsonResponse(
        {
          success:
            false,

          code:
            "KNOWLEDGE_LIST_FAILED",

          message:
            "دریافت فهرست دانش‌های در انتظار ناموفق بود.",

          requestId,
        },
        503,
        requestId
      ),
      rateLimit
    );
  }

  const pendingItems =
    pendingResult.items;

  const inactiveItems =
    inactiveResult.items;

  /*
   * ==========================================
   * Initial Remaining Counts
   *
   * رکوردهایی که در Batch جاری وارد نشده‌اند.
   * ==========================================
   */

  const queuedSyncRemaining =
    Math.max(
      0,
      pendingResult.totalItems -
        pendingItems.length
    );

  const queuedCleanupRemaining =
    Math.max(
      0,
      inactiveResult.totalItems -
        inactiveItems.length
    );

  /*
   * ==========================================
   * Build Tasks
   * ==========================================
   */

  const tasks:
    SyncTask[] = [
    ...pendingItems.map(
      (
        item
      ) => ({
        action:
          "sync" as const,

        item,
      })
    ),

    ...inactiveItems.map(
      (
        item
      ) => ({
        action:
          "remove" as const,

        item,
      })
    ),
  ];

  /*
   * ==========================================
   * Nothing to do
   *
   * Rate Limit همچنان Consume شده است.
   *
   * این رفتار عمدی است تا Client نتواند
   * Endpoint هزینه‌دار را برای Polling سریع
   * استفاده کند.
   * ==========================================
   */

  if (
    tasks.length ===
    0
  ) {
    return withRateLimitHeaders(
      jsonResponse(
        {
          success:
            true,

          requestId,

          concurrency:
            SYNC_CONCURRENCY,

          limits: {
            sync:
              maxSyncItems,

            cleanup:
              maxCleanupItems,

            maximum_per_run:
              maxSyncItems +
              maxCleanupItems,
          },

          summary: {
            total:
              0,

            pending:
              0,

            inactive_cleanup:
              0,

            succeeded:
              0,

            failed:
              0,

            sync_succeeded:
              0,

            sync_failed:
              0,

            cleanup_succeeded:
              0,

            cleanup_failed:
              0,

            matched_sync:
              0,

            matched_cleanup:
              0,

            remaining_sync:
              0,

            remaining_cleanup:
              0,

            remaining_total:
              0,

            has_more:
              false,
          },

          results:
            [],
        },
        200,
        requestId
      ),
      rateLimit
    );
  }

  /*
   * ==========================================
   * Process
   *
   * Failure یک Task باعث توقف Batch نمی‌شود.
   *
   * Concurrency کل Batch محدود است.
   * ==========================================
   */

  const results =
    await mapWithConcurrency(
      tasks,
      SYNC_CONCURRENCY,

      async (
        task
      ): Promise<SyncTaskResult> => {
        try {
          /*
           * ==================================
           * Sync
           * ==================================
           */

          if (
            task.action ===
            "sync"
          ) {
            const result =
              await syncKnowledgeItem(
                task.item.id,
                pb
              );

            return {
              action:
                "sync",

              knowledgeId:
                task.item.id,

              ...result,
            };
          }

          /*
           * ==================================
           * Remove / Cleanup
           * ==================================
           */

          const result =
            await removeKnowledgeItemFromOpenAI(
              task.item.id,
              pb,
              task.item
            );

          return {
            action:
              "remove",

            knowledgeId:
              task.item.id,

            ...result,
          };
        } catch (error) {
          console.error(
            "Knowledge pending task failed",
            {
              requestId,

              adminId:
                admin.account.id,

              knowledgeId:
                task.item.id,

              action:
                task.action,

              error:
                safeErrorMetadata(
                  error
                ),
            }
          );

          return {
            action:
              task.action,

            knowledgeId:
              task.item.id,

            success:
              false,

            status:
              503,

            code:
              task.action ===
              "sync"
                ? "KNOWLEDGE_SYNC_EXCEPTION"
                : "OPENAI_FILE_REMOVE_EXCEPTION",

            message:
              task.action ===
              "sync"
                ? "همگام‌سازی مطلب ناموفق بود."
                : "حذف مطلب از پایگاه دانش هوش مصنوعی ناموفق بود.",
          };
        }
      }
    );

  /*
   * ==========================================
   * Result Groups
   * ==========================================
   */

  const syncResults =
    results.filter(
      (
        result
      ) =>
        result.action ===
        "sync"
    );

  const cleanupResults =
    results.filter(
      (
        result
      ) =>
        result.action ===
        "remove"
    );

  /*
   * ==========================================
   * Success / Failure Counts
   * ==========================================
   */

  const syncSucceeded =
    syncResults.filter(
      (
        result
      ) =>
        result.success ===
        true
    ).length;

  const syncFailed =
    syncResults.length -
    syncSucceeded;

  const cleanupSucceeded =
    cleanupResults.filter(
      (
        result
      ) =>
        result.success ===
        true
    ).length;

  const cleanupFailed =
    cleanupResults.length -
    cleanupSucceeded;

  const succeeded =
    syncSucceeded +
    cleanupSucceeded;

  const failed =
    syncFailed +
    cleanupFailed;

  /*
   * ==========================================
   * Estimated Remaining
   *
   * unseen rows
   * +
   * failed processed rows
   * ==========================================
   */

  const remainingSync =
    queuedSyncRemaining +
    syncFailed;

  const remainingCleanup =
    queuedCleanupRemaining +
    cleanupFailed;

  const remainingTotal =
    remainingSync +
    remainingCleanup;

  const hasMore =
    remainingTotal >
    0;

  /*
   * ==========================================
   * Response
   *
   * HTTP 200 چون Batch اجرا شده است.
   *
   * Failure تک Taskها در results و summary
   * مشخص می‌شود.
   * ==========================================
   */

  return withRateLimitHeaders(
    jsonResponse(
      {
        success:
          failed ===
          0,

        requestId,

        concurrency:
          SYNC_CONCURRENCY,

        limits: {
          sync:
            maxSyncItems,

          cleanup:
            maxCleanupItems,

          maximum_per_run:
            maxSyncItems +
            maxCleanupItems,
        },

        summary: {
          /*
           * ==================================
           * This Run
           * ==================================
           */

          total:
            results.length,

          pending:
            pendingItems.length,

          inactive_cleanup:
            inactiveItems.length,

          succeeded,

          failed,

          /*
           * ==================================
           * Per Action
           * ==================================
           */

          sync_succeeded:
            syncSucceeded,

          sync_failed:
            syncFailed,

          cleanup_succeeded:
            cleanupSucceeded,

          cleanup_failed:
            cleanupFailed,

          /*
           * ==================================
           * Matched Before Run
           * ==================================
           */

          matched_sync:
            pendingResult.totalItems,

          matched_cleanup:
            inactiveResult.totalItems,

          /*
           * ==================================
           * Estimated Remaining
           * ==================================
           */

          remaining_sync:
            remainingSync,

          remaining_cleanup:
            remainingCleanup,

          remaining_total:
            remainingTotal,

          has_more:
            hasMore,
        },

        results,
      },
      200,
      requestId
    ),
    rateLimit
  );
}

/*
 * ============================================
 * Types
 * ============================================
 */

type SyncTask = {
  action:
    | "sync"
    | "remove";

  item:
    KnowledgeItemRecord;
};

type SyncTaskResult = {
  action:
    | "sync"
    | "remove";

  knowledgeId:
    string;

  success:
    boolean;

  status?:
    number;

  code?:
    string;

  message?:
    string;

  [key: string]:
    unknown;
};

/*
 * ============================================
 * Concurrency Worker
 * ============================================
 */

async function mapWithConcurrency<
  TItem,
  TResult,
>(
  items:
    TItem[],

  concurrency:
    number,

  worker: (
    item:
      TItem
  ) => Promise<TResult>
) {
  const results =
    new Array<TResult>(
      items.length
    );

  if (
    items.length ===
    0
  ) {
    return results;
  }

  const workerCount =
    Math.min(
      Math.max(
        1,
        Math.floor(
          concurrency
        )
      ),
      items.length
    );

  let nextIndex =
    0;

  async function runWorker() {
    while (
      true
    ) {
      const currentIndex =
        nextIndex;

      if (
        currentIndex >=
        items.length
      ) {
        return;
      }

      /*
       * Index قبل از اولین await رزرو می‌شود.
       */
      nextIndex +=
        1;

      results[
        currentIndex
      ] =
        await worker(
          items[
            currentIndex
          ]
        );
    }
  }

  await Promise.all(
    Array.from(
      {
        length:
          workerCount,
      },
      () =>
        runWorker()
    )
  );

  return results;
}

/*
 * ============================================
 * Environment Integer
 * ============================================
 */

function environmentInteger(
  value:
    string |
    undefined,

  minimum:
    number,

  maximum:
    number,

  fallback:
    number
) {
  const parsed =
    Number(
      value
    );

  if (
    !Number.isSafeInteger(
      parsed
    )
  ) {
    return fallback;
  }

  return Math.min(
    Math.max(
      parsed,
      minimum
    ),
    maximum
  );
}

/*
 * ============================================
 * Rate Limit Headers
 * ============================================
 */

function withRateLimitHeaders(
  response:
    NextResponse,

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
 * JSON Response
 * ============================================
 */

function jsonResponse(
  body:
    Record<
      string,
      unknown
    >,

  status:
    number,

  requestId:
    string
) {
  return NextResponse.json(
    body,
    {
      status:
        safeHttpStatus(
          status,
          500
        ),

      headers: {
        "X-Request-Id":
          requestId,

        "Cache-Control":
          "private, no-store, no-cache, max-age=0, must-revalidate",

        "Pragma":
          "no-cache",

        "Expires":
          "0",

        "X-Content-Type-Options":
          "nosniff",
      },
    }
  );
}

/*
 * ============================================
 * HTTP Status
 * ============================================
 */

function safeHttpStatus(
  value:
    unknown,

  fallback:
    number
) {
  const status =
    Number(
      value
    );

  if (
    !Number.isSafeInteger(
      status
    ) ||
    status <
      100 ||
    status >
      599
  ) {
    return fallback;
  }

  return status;
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