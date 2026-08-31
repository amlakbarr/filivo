import type PocketBase from "pocketbase";
import type {
  RecordModel,
} from "pocketbase";

import {
  recordAuditLog,
} from "@/lib/audit/log";

import {
  consumeAdminRateLimit,
} from "@/lib/admin/rate-limit";

import {
  getPocketBaseErrorStatus,
  isSafeTopicId,
  safeTopicErrorMetadata,
} from "@/lib/topics/admin";

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

const MOVE_BATCH_SIZE =
  100;

/*
 * ============================================
 * Types
 * ============================================
 */

type Context = {
  params:
    Promise<{
      id:
        string;
    }>;
};

type TopicRecord =
  RecordModel & {
    name?:
      string;

    code?:
      string;

    active?:
      boolean;
  };

type MoveSummary = {
  messages:
    number;

  knowledgeItems:
    number;

  knowledgeGaps:
    number;

  gapOccurrences:
    number;

  knowledgeSyncPending:
    number;
};

/*
 * ============================================
 * POST
 *
 * Merge Source Topic -> Target Topic
 *
 * Source:
 * - ابتدا غیرفعال می‌شود تا Classification
 *   جدید به آن متصل نشود.
 *
 * Relations:
 * - messages.topic
 * - knowledge_items.topic
 * - knowledge_gaps.topic
 * - knowledge_gap_occurrences.topic
 *
 * Knowledge:
 * Published itemها بعد از تغییر Topic روی
 * sync_status=pending قرار می‌گیرند تا با
 * Vector Store مجدداً همگام شوند.
 *
 * Source Topic حذف فیزیکی نمی‌شود.
 * ============================================
 */

export async function POST(
  request:
    Request,

  {
    params,
  }:
    Context
) {
  const requestId =
    crypto.randomUUID();

  /*
   * ==========================================
   * Authorization
   * ==========================================
   */

  const admin =
    await getAdminSession();

  if (
    !admin.ok
  ) {
    return apiError(
      requestId,
      admin.status,
      admin.code,
      admin.message
    );
  }

  /*
   * ==========================================
   * Source ID
   * ==========================================
   */

  const {
    id:
      sourceTopicId,
  } =
    await params;

  if (
    !isSafeTopicId(
      sourceTopicId
    )
  ) {
    return apiError(
      requestId,
      400,
      "TOPIC_MERGE_SOURCE_INVALID",
      "شناسه موضوع مبدا معتبر نیست."
    );
  }

  /*
   * ==========================================
   * Rate Limit
   * ==========================================
   */

  try {
    const rateLimit =
      await consumeAdminRateLimit({
        adminId:
          admin.account.id,

        action:
          "topic.merge",

        requestId,
      });

    if (
      !rateLimit.allowed
    ) {
      return apiError(
        requestId,
        429,
        rateLimit.code,
        "تعداد عملیات ادغام موضوعات بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.",
        {
          retryAfterSeconds:
            rateLimit.retryAfterSeconds,
        },
        {
          "Retry-After":
            String(
              rateLimit.retryAfterSeconds
            ),
        }
      );
    }
  } catch (error) {
    console.error(
      "Topic merge rate limit unavailable",
      {
        requestId,

        adminId:
          admin.account.id,

        sourceTopicId,

        error:
          safeTopicErrorMetadata(
            error
          ),
      }
    );

    return apiError(
      requestId,
      503,
      "ADMIN_RATE_LIMIT_UNAVAILABLE",
      "کنترل محدودیت درخواست‌های مدیریتی موقتاً در دسترس نیست."
    );
  }

  /*
   * ==========================================
   * Parse Target
   * ==========================================
   */

  let body:
    unknown;

  try {
    body =
      await request.json();
  } catch {
    return apiError(
      requestId,
      400,
      "TOPIC_MERGE_INVALID_JSON",
      "بدنه JSON درخواست معتبر نیست."
    );
  }

  const targetTopicId =
    parseTargetTopicId(
      body
    );

  if (
    !targetTopicId
  ) {
    return apiError(
      requestId,
      400,
      "TOPIC_MERGE_TARGET_INVALID",
      "موضوع مقصد معتبر نیست."
    );
  }

  if (
    targetTopicId ===
    sourceTopicId
  ) {
    return apiError(
      requestId,
      409,
      "TOPIC_MERGE_SELF",
      "یک موضوع را نمی‌توان داخل خودش ادغام کرد."
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
      "Topic merge service unavailable",
      {
        requestId,

        adminId:
          admin.account.id,

        sourceTopicId,

        targetTopicId,

        error:
          safeTopicErrorMetadata(
            error
          ),
      }
    );

    return apiError(
      requestId,
      503,
      "TOPIC_SERVICE_UNAVAILABLE",
      "سرویس مدیریت موضوعات موقتاً در دسترس نیست."
    );
  }

  /*
   * ==========================================
   * Load Source + Target
   * ==========================================
   */

  let sourceTopic:
    TopicRecord;

  let targetTopic:
    TopicRecord;

  try {
    [
      sourceTopic,
      targetTopic,
    ] =
      await Promise.all([
        pb
          .collection(
            "topics"
          )
          .getOne<TopicRecord>(
            sourceTopicId,
            {
              fields:
                "id,name,code,active",
            }
          ),

        pb
          .collection(
            "topics"
          )
          .getOne<TopicRecord>(
            targetTopicId,
            {
              fields:
                "id,name,code,active",
            }
          ),
      ]);
  } catch (error) {
    if (
      getPocketBaseErrorStatus(
        error
      ) ===
      404
    ) {
      return apiError(
        requestId,
        404,
        "TOPIC_MERGE_TOPIC_NOT_FOUND",
        "موضوع مبدا یا مقصد پیدا نشد."
      );
    }

    console.error(
      "Topic merge lookup failed",
      {
        requestId,

        adminId:
          admin.account.id,

        sourceTopicId,

        targetTopicId,

        error:
          safeTopicErrorMetadata(
            error
          ),
      }
    );

    return apiError(
      requestId,
      503,
      "TOPIC_MERGE_LOOKUP_FAILED",
      "بررسی موضوعات قبل از ادغام ناموفق بود."
    );
  }

  if (
    targetTopic.active !==
    true
  ) {
    return apiError(
      requestId,
      409,
      "TOPIC_MERGE_TARGET_INACTIVE",
      "موضوع مقصد باید فعال باشد."
    );
  }

  /*
   * ==========================================
   * Stop new assignments to Source
   *
   * حتی در Retry هم این Update امن است.
   * ==========================================
   */

  try {
    if (
      sourceTopic.active ===
      true
    ) {
      await pb
        .collection(
          "topics"
        )
        .update(
          sourceTopicId,
          {
            active:
              false,
          }
        );
    }
  } catch (error) {
    console.error(
      "Topic merge failed to deactivate source",
      {
        requestId,

        adminId:
          admin.account.id,

        sourceTopicId,

        targetTopicId,

        error:
          safeTopicErrorMetadata(
            error
          ),
      }
    );

    return apiError(
      requestId,
      503,
      "TOPIC_MERGE_SOURCE_DEACTIVATE_FAILED",
      "غیرفعال‌سازی موضوع مبدا قبل از ادغام ناموفق بود."
    );
  }

  /*
   * ==========================================
   * Move Relations
   *
   * اگر هر مرحله Fail شود:
   * - Source غیرفعال باقی می‌ماند.
   * - رکوردهای منتقل‌شده Rollback نمی‌شوند.
   * - Route قابل Retry است و فقط Relationهای
   *   باقی‌مانده را منتقل خواهد کرد.
   * ==========================================
   */

  const summary:
    MoveSummary = {
      messages:
        0,

      knowledgeItems:
        0,

      knowledgeGaps:
        0,

      gapOccurrences:
        0,

      knowledgeSyncPending:
        0,
    };

  try {
    summary.messages =
      await moveSimpleRelation({
        pb,

        collection:
          "messages",

        sourceTopicId,

        targetTopicId,
      });

    const knowledgeResult =
      await moveKnowledgeRelations({
        pb,

        sourceTopicId,

        targetTopicId,
      });

    summary.knowledgeItems =
      knowledgeResult.moved;

    summary.knowledgeSyncPending =
      knowledgeResult.syncPending;

    summary.knowledgeGaps =
      await moveSimpleRelation({
        pb,

        collection:
          "knowledge_gaps",

        sourceTopicId,

        targetTopicId,
      });

    summary.gapOccurrences =
      await moveSimpleRelation({
        pb,

        collection:
          "knowledge_gap_occurrences",

        sourceTopicId,

        targetTopicId,
      });
  } catch (error) {
    console.error(
      "Topic merge partially failed",
      {
        requestId,

        adminId:
          admin.account.id,

        sourceTopicId,

        targetTopicId,

        summary,

        error:
          safeTopicErrorMetadata(
            error
          ),
      }
    );

    await recordAuditLog({
      action:
        "topic.merge",

      result:
        "failure",

      actorId:
        admin.account.id,

      actorRole:
        "admin",

      entityType:
        "topic",

      entityId:
        sourceTopicId,

      requestId,

      request,

      errorCode:
        "TOPIC_MERGE_PARTIAL",

      metadata:
        mergeAuditMetadata({
          sourceTopic,

          targetTopic,

          summary,

          partial:
            true,
        }),
    });

    return apiSuccess(
      {
        success:
          true,

        partial:
          true,

        code:
          "TOPIC_MERGE_PARTIAL",

        message:
          "ادغام به‌صورت ناقص انجام شد. موضوع مبدا غیرفعال است؛ همان ادغام را دوباره اجرا کنید تا Relationهای باقی‌مانده منتقل شوند.",

        sourceTopicId,

        targetTopicId,

        summary,

        knowledgeSyncRequired:
          summary.knowledgeSyncPending >
          0,

        requestId,
      },
      207
    );
  }

  /*
   * ==========================================
   * Audit Success
   * ==========================================
   */

  await recordAuditLog({
    action:
      "topic.merge",

    result:
      "success",

    actorId:
      admin.account.id,

    actorRole:
      "admin",

    entityType:
      "topic",

    entityId:
      sourceTopicId,

    requestId,

    request,

    metadata:
      mergeAuditMetadata({
        sourceTopic,

        targetTopic,

        summary,

        partial:
          false,
      }),
  });

  /*
   * ==========================================
   * Response
   * ==========================================
   */

  return apiSuccess({
    success:
      true,

    partial:
      false,

    message:
      "موضوع با موفقیت ادغام شد.",

    sourceTopicId,

    targetTopicId,

    sourceActive:
      false,

    summary,

    knowledgeSyncRequired:
      summary.knowledgeSyncPending >
      0,

    requestId,
  });
}

/*
 * ============================================
 * Move a simple topic relation
 *
 * چون Update باعث خروج رکورد از Filter می‌شود،
 * همیشه Page 1 خوانده می‌شود تا Collection
 * خالی از Source Topic شود.
 * ============================================
 */

async function moveSimpleRelation({
  pb,
  collection,
  sourceTopicId,
  targetTopicId,
}: {
  pb:
    PocketBase;

  collection:
    "messages" |
    "knowledge_gaps" |
    "knowledge_gap_occurrences";

  sourceTopicId:
    string;

  targetTopicId:
    string;
}) {
  let moved =
    0;

  while (
    true
  ) {
    const result =
      await pb
        .collection(
          collection
        )
        .getList(
          1,
          MOVE_BATCH_SIZE,
          {
            filter:
              pb.filter(
                "topic = {:sourceTopicId}",
                {
                  sourceTopicId,
                }
              ),

            fields:
              "id",
          }
        );

    if (
      result.items.length ===
      0
    ) {
      break;
    }

    for (
      const item of
      result.items
    ) {
      await pb
        .collection(
          collection
        )
        .update(
          item.id,
          {
            topic:
              targetTopicId,
          }
        );

      moved +=
        1;
    }
  }

  return moved;
}

/*
 * ============================================
 * Knowledge Relation
 *
 * Published Knowledge:
 * topic change باعث تغییر document/attributes
 * در OpenAI Vector Store می‌شود. بنابراین
 * sync_status=pending می‌شود تا Endpoint
 * sync-pending فایل را مجدداً بسازد.
 * ============================================
 */

async function moveKnowledgeRelations({
  pb,
  sourceTopicId,
  targetTopicId,
}: {
  pb:
    PocketBase;

  sourceTopicId:
    string;

  targetTopicId:
    string;
}) {
  let moved =
    0;

  let syncPending =
    0;

  while (
    true
  ) {
    const result =
      await pb
        .collection(
          "knowledge_items"
        )
        .getList(
          1,
          MOVE_BATCH_SIZE,
          {
            filter:
              pb.filter(
                "topic = {:sourceTopicId}",
                {
                  sourceTopicId,
                }
              ),

            fields:
              "id,status",
          }
        );

    if (
      result.items.length ===
      0
    ) {
      break;
    }

    for (
      const item of
      result.items
    ) {
      const published =
        item.status ===
        "published";

      await pb
        .collection(
          "knowledge_items"
        )
        .update(
          item.id,
          {
            topic:
              targetTopicId,

            ...(published
              ? {
                  sync_status:
                    "pending",

                  sync_error:
                    "",
                }
              : {}),
          }
        );

      moved +=
        1;

      if (
        published
      ) {
        syncPending +=
          1;
      }
    }
  }

  return {
    moved,

    syncPending,
  };
}

/*
 * ============================================
 * Target Parser
 * ============================================
 */

function parseTargetTopicId(
  value:
    unknown
) {
  if (
    typeof value !==
      "object" ||
    value ===
      null ||
    Array.isArray(
      value
    )
  ) {
    return "";
  }

  const body =
    value as {
      targetTopicId?:
        unknown;
  };

  if (
    typeof body.targetTopicId !==
    "string"
  ) {
    return "";
  }

  const id =
    body.targetTopicId
      .trim();

  return isSafeTopicId(
    id
  )
    ? id
    : "";
}

/*
 * ============================================
 * Audit Metadata
 * ============================================
 */

function mergeAuditMetadata({
  sourceTopic,
  targetTopic,
  summary,
  partial,
}: {
  sourceTopic:
    TopicRecord;

  targetTopic:
    TopicRecord;

  summary:
    MoveSummary;

  partial:
    boolean;
}) {
  return {
    partial,

    source_topic_id:
      sourceTopic.id,

    source_name:
      safeTopicText(
        sourceTopic.name
      ),

    source_code:
      safeTopicText(
        sourceTopic.code
      ),

    target_topic_id:
      targetTopic.id,

    target_name:
      safeTopicText(
        targetTopic.name
      ),

    target_code:
      safeTopicText(
        targetTopic.code
      ),

    moved_messages:
      summary.messages,

    moved_knowledge_items:
      summary.knowledgeItems,

    moved_knowledge_gaps:
      summary.knowledgeGaps,

    moved_gap_occurrences:
      summary.gapOccurrences,

    knowledge_sync_pending:
      summary.knowledgeSyncPending,
  };
}

function safeTopicText(
  value:
    unknown
) {
  return typeof value ===
    "string"
    ? value
        .trim()
        .slice(
          0,
          150
        )
    : "";
}

/*
 * ============================================
 * Responses
 * ============================================
 */

function apiSuccess(
  body:
    unknown,

  status =
    200
) {
  return Response.json(
    body,
    {
      status,

      headers: {
        "Cache-Control":
          "no-store",
      },
    }
  );
}

function apiError(
  requestId:
    string,

  status:
    number,

  code:
    string,

  message:
    string,

  extra?:
    Record<
      string,
      unknown
    >,

  headers?:
    Record<
      string,
      string
    >
) {
  return Response.json(
    {
      success:
        false,

      code,

      message,

      requestId,

      ...(extra ||
        {}),
    },
    {
      status,

      headers: {
        "Cache-Control":
          "no-store",

        ...(headers ||
          {}),
      },
    }
  );
}