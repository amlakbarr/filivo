import type PocketBase from "pocketbase";

import {
  NextResponse,
} from "next/server";

import {
  consumeAdminRateLimit,
} from "@/lib/admin/rate-limit";

import {
  recordAuditLog,
} from "@/lib/audit/log";

import {
  getAdminSession,
} from "@/lib/pocketbase/admin";

import {
  getPocketBaseServiceClient,
} from "@/lib/pocketbase/service";

/*
 * ============================================
 * Types
 * ============================================
 */

type Context = {
  params: Promise<{
    id: string;
  }>;
};

type ResolvePayload =
  | {
      success:
        true;

      knowledgeItemId:
        string;
    }
  | {
      success:
        false;

      code:
        string;

      message:
        string;
    };

type AllowedRateLimit = {
  allowed:
    true;

  limit:
    number;

  remaining:
    number;

  resetAt:
    string;
};

/*
 * ============================================
 * Limits
 * ============================================
 */

const MAX_REQUEST_BODY_BYTES =
  8 * 1024;

const RECORD_ID_PATTERN =
  /^[a-zA-Z0-9_-]{1,64}$/;

/*
 * ============================================
 * POST
 *
 * Resolve Knowledge Gap with a published,
 * successfully synced Knowledge Item.
 *
 * Rate Limit:
 *
 * knowledge_gap.resolve
 * 10 requests / minute / admin
 * ============================================
 */

export async function POST(
  request: Request,
  {
    params,
  }: Context
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
    return jsonResponse(
      {
        success:
          false,

        code:
          admin.code,

        message:
          admin.message,
      },
      admin.status,
      requestId
    );
  }

  /*
   * ==========================================
   * Gap ID
   * ==========================================
   */

  const {
    id: rawGapId,
  } = await params;

  const gapId =
    cleanRecordId(
      rawGapId
    );

  if (
    !gapId
  ) {
    return jsonResponse(
      {
        success:
          false,

        code:
          "INVALID_GAP_ID",

        message:
          "شناسه Knowledge Gap معتبر نیست.",
      },
      400,
      requestId
    );
  }

  /*
   * ==========================================
   * Admin Rate Limit
   *
   * knowledge_gap.resolve
   *
   * 10 requests / minute / admin
   *
   * Gap ID و Knowledge Item ID بخشی از Bucket
   * نیستند.
   *
   * بنابراین Admin نمی‌تواند با تغییر Target
   * محدودیت را دور بزند.
   *
   * Fail-closed:
   * اگر Rate Limiter در دسترس نباشد هیچ Resolve
   * یا PocketBase mutation انجام نمی‌شود.
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
          "knowledge_gap.resolve",

        requestId,
      });
  } catch (error) {
    console.error(
      "Admin knowledge gap resolve rate limit unavailable",
      {
        requestId,

        adminId:
          admin.account.id,

        gapId,

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
    return rateLimitedResponse(
      requestId,
      rateLimit
    );
  }

  const allowedRateLimit:
    AllowedRateLimit =
    rateLimit;

  /*
   * تمام Responseهای بعد از Consume باید
   * Headerهای Rate Limit را داشته باشند.
   */

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
   * Content Type
   * ==========================================
   */

  const contentType =
    String(
      request.headers.get(
        "content-type"
      ) ||
        ""
    )
      .split(";")[0]
      .trim()
      .toLowerCase();

  if (
    contentType !==
    "application/json"
  ) {
    return respond(
      jsonResponse(
        {
          success:
            false,

          code:
            "UNSUPPORTED_MEDIA_TYPE",

          message:
            "نوع محتوای درخواست معتبر نیست.",
        },
        415,
        requestId
      )
    );
  }

  /*
   * ==========================================
   * Content-Length Fast Reject
   * ==========================================
   */

  const rawContentLength =
    request.headers.get(
      "content-length"
    );

  if (
    rawContentLength
  ) {
    const contentLength =
      Number(
        rawContentLength
      );

    if (
      !Number.isSafeInteger(
        contentLength
      ) ||
      contentLength <
        0
    ) {
      return respond(
        jsonResponse(
          {
            success:
              false,

            code:
              "INVALID_CONTENT_LENGTH",

            message:
              "حجم درخواست معتبر نیست.",
          },
          400,
          requestId
        )
      );
    }

    if (
      contentLength >
      MAX_REQUEST_BODY_BYTES
    ) {
      return respond(
        jsonResponse(
          {
            success:
              false,

            code:
              "REQUEST_BODY_TOO_LARGE",

            message:
              "حجم درخواست بیش از حد مجاز است.",
          },
          413,
          requestId
        )
      );
    }
  }

  /*
   * ==========================================
   * Bounded JSON Body
   * ==========================================
   */

  const bodyResult =
    await readJsonBodyWithLimit(
      request,
      MAX_REQUEST_BODY_BYTES
    );

  if (
    !bodyResult.ok
  ) {
    return respond(
      jsonResponse(
        {
          success:
            false,

          code:
            bodyResult.code,

          message:
            bodyResult.message,
        },
        bodyResult.status,
        requestId
      )
    );
  }

  /*
   * ==========================================
   * Strict Payload
   * ==========================================
   */

  const payload =
    parseResolvePayload(
      bodyResult.body
    );

  if (
    !payload.success
  ) {
    return respond(
      jsonResponse(
        {
          success:
            false,

          code:
            payload.code,

          message:
            payload.message,
        },
        400,
        requestId
      )
    );
  }

  const {
    knowledgeItemId,
  } = payload;

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
      "Knowledge gap resolve service unavailable",
      {
        requestId,

        adminId:
          admin.account.id,

        gapId,

        knowledgeItemId,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return respond(
      jsonResponse(
        {
          success:
            false,

          code:
            "KNOWLEDGE_SERVICE_UNAVAILABLE",

          message:
            "سرویس پایگاه دانش موقتاً در دسترس نیست.",
        },
        503,
        requestId
      )
    );
  }

  /*
   * ==========================================
   * Load Gap
   * ==========================================
   */

  let gap;

  try {
    gap =
      await pb
        .collection(
          "knowledge_gaps"
        )
        .getOne(
          gapId,
          {
            fields:
              [
                "id",
                "title",
                "status",
                "topic",
                "resolved_knowledge_item",
                "resolved_by",
                "resolved_at",
              ].join(
                ","
              ),
          }
        );
  } catch (error) {
    if (
      getErrorStatus(
        error
      ) ===
      404
    ) {
      return respond(
        jsonResponse(
          {
            success:
              false,

            code:
              "KNOWLEDGE_GAP_NOT_FOUND",

            message:
              "Knowledge Gap پیدا نشد.",
          },
          404,
          requestId
        )
      );
    }

    console.error(
      "Knowledge gap resolve lookup failed",
      {
        requestId,

        adminId:
          admin.account.id,

        gapId,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return respond(
      jsonResponse(
        {
          success:
            false,

          code:
            "KNOWLEDGE_GAP_LOAD_FAILED",

          message:
            "در بررسی Knowledge Gap خطایی رخ داد.",
        },
        503,
        requestId
      )
    );
  }

  const gapTitle =
    cleanAuditText(
      gap.title,
      200
    );

  const previousStatus =
    cleanAuditText(
      gap.status,
      50
    );

  /*
   * ==========================================
   * Already Resolved
   *
   * این بررسی قبل از Knowledge Item Validation
   * انجام می‌شود تا Retry موفق Idempotent باشد.
   *
   * Rate Limit همچنان Consume شده است.
   * ==========================================
   */

  if (
    gap.status ===
    "resolved"
  ) {
    const existingKnowledgeItemId =
      cleanRecordId(
        gap.resolved_knowledge_item
      );

    /*
     * ========================================
     * Same Knowledge → Idempotent Success
     * ========================================
     */

    if (
      existingKnowledgeItemId ===
      knowledgeItemId
    ) {
      await safeAudit({
        request,

        requestId,

        actorId:
          admin.account.id,

        gapId,

        action:
          "gap.resolve",

        result:
          "success",

        metadata: {
          title:
            gapTitle,

          previous_status:
            "resolved",

          new_status:
            "resolved",

          knowledge_item_id:
            knowledgeItemId,

          already_resolved:
            true,
        },
      });

      return respond(
        jsonResponse(
          {
            success:
              true,

            alreadyResolved:
              true,

            gap: {
              id:
                gap.id,

              status:
                "resolved",

              resolvedKnowledgeItem:
                existingKnowledgeItemId,

              resolvedBy:
                cleanRecordId(
                  gap.resolved_by
                ),

              resolvedAt:
                cleanDateText(
                  gap.resolved_at
                ),
            },
          },
          200,
          requestId
        )
      );
    }

    /*
     * ========================================
     * Different Knowledge Item
     * ========================================
     */

    await safeAudit({
      request,

      requestId,

      actorId:
        admin.account.id,

      gapId,

      action:
        "gap.resolve",

      result:
        "blocked",

      errorCode:
        "GAP_ALREADY_RESOLVED",

      metadata: {
        title:
          gapTitle,

        previous_status:
          "resolved",

        existing_knowledge_item_id:
          existingKnowledgeItemId,

        requested_knowledge_item_id:
          knowledgeItemId,

        reason:
          "resolved_with_another_knowledge_item",
      },
    });

    return respond(
      jsonResponse(
        {
          success:
            false,

          code:
            "GAP_ALREADY_RESOLVED",

          message:
            "این Knowledge Gap قبلاً با مطلب دیگری حل شده است.",
        },
        409,
        requestId
      )
    );
  }

  /*
   * ==========================================
   * Load Knowledge Item
   * ==========================================
   */

  let knowledgeItem;

  try {
    knowledgeItem =
      await pb
        .collection(
          "knowledge_items"
        )
        .getOne(
          knowledgeItemId,
          {
            fields:
              [
                "id",
                "title",
                "status",
                "sync_status",
                "openai_file_id",
                "topic",
              ].join(
                ","
              ),
          }
        );
  } catch (error) {
    if (
      getErrorStatus(
        error
      ) ===
      404
    ) {
      await safeAudit({
        request,

        requestId,

        actorId:
          admin.account.id,

        gapId,

        action:
          "gap.resolve",

        result:
          "blocked",

        errorCode:
          "KNOWLEDGE_ITEM_NOT_FOUND",

        metadata: {
          title:
            gapTitle,

          previous_status:
            previousStatus,

          requested_knowledge_item_id:
            knowledgeItemId,

          reason:
            "knowledge_item_not_found",
        },
      });

      return respond(
        jsonResponse(
          {
            success:
              false,

            code:
              "KNOWLEDGE_ITEM_NOT_FOUND",

            message:
              "مطلب پایگاه دانش پیدا نشد.",
          },
          404,
          requestId
        )
      );
    }

    console.error(
      "Resolve gap knowledge lookup failed",
      {
        requestId,

        adminId:
          admin.account.id,

        gapId,

        knowledgeItemId,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return respond(
      jsonResponse(
        {
          success:
            false,

          code:
            "KNOWLEDGE_ITEM_LOAD_FAILED",

          message:
            "در بررسی مطلب پایگاه دانش خطایی رخ داد.",
        },
        503,
        requestId
      )
    );
  }

  const knowledgeTitle =
    cleanAuditText(
      knowledgeItem.title,
      200
    );

  /*
   * ==========================================
   * Must be Published
   * ==========================================
   */

  if (
    knowledgeItem.status !==
    "published"
  ) {
    await safeAudit({
      request,

      requestId,

      actorId:
        admin.account.id,

      gapId,

      action:
        "gap.resolve",

      result:
        "blocked",

      errorCode:
        "KNOWLEDGE_NOT_PUBLISHED",

      metadata: {
        title:
          gapTitle,

        previous_status:
          previousStatus,

        knowledge_item_id:
          knowledgeItemId,

        knowledge_title:
          knowledgeTitle,

        knowledge_status:
          cleanAuditText(
            knowledgeItem.status,
            50
          ),

        reason:
          "knowledge_not_published",
      },
    });

    return respond(
      jsonResponse(
        {
          success:
            false,

          code:
            "KNOWLEDGE_NOT_PUBLISHED",

          message:
            "برای حل Knowledge Gap، مطلب باید ابتدا منتشر شود.",
        },
        409,
        requestId
      )
    );
  }

  /*
   * ==========================================
   * Must be Synced
   * ==========================================
   */

  if (
    knowledgeItem.sync_status !==
    "synced"
  ) {
    await safeAudit({
      request,

      requestId,

      actorId:
        admin.account.id,

      gapId,

      action:
        "gap.resolve",

      result:
        "blocked",

      errorCode:
        "KNOWLEDGE_NOT_SYNCED",

      metadata: {
        title:
          gapTitle,

        previous_status:
          previousStatus,

        knowledge_item_id:
          knowledgeItemId,

        knowledge_title:
          knowledgeTitle,

        sync_status:
          cleanAuditText(
            knowledgeItem.sync_status,
            50
          ),

        reason:
          "knowledge_not_synced",
      },
    });

    return respond(
      jsonResponse(
        {
          success:
            false,

          code:
            "KNOWLEDGE_NOT_SYNCED",

          message:
            "مطلب هنوز با پایگاه دانش هوش مصنوعی همگام نشده است.",
        },
        409,
        requestId
      )
    );
  }

  /*
   * ==========================================
   * OpenAI File Check
   * ==========================================
   */

  const openAiFileId =
    typeof knowledgeItem
      .openai_file_id ===
    "string"
      ? knowledgeItem
          .openai_file_id
          .trim()
          .slice(
            0,
            500
          )
      : "";

  if (
    !openAiFileId
  ) {
    await safeAudit({
      request,

      requestId,

      actorId:
        admin.account.id,

      gapId,

      action:
        "gap.resolve",

      result:
        "blocked",

      errorCode:
        "OPENAI_FILE_MISSING",

      metadata: {
        title:
          gapTitle,

        previous_status:
          previousStatus,

        knowledge_item_id:
          knowledgeItemId,

        knowledge_title:
          knowledgeTitle,

        reason:
          "synced_knowledge_without_openai_file",
      },
    });

    return respond(
      jsonResponse(
        {
          success:
            false,

          code:
            "OPENAI_FILE_MISSING",

          message:
            "فایل همگام‌شده OpenAI برای این مطلب ثبت نشده است.",
        },
        409,
        requestId
      )
    );
  }

  /*
   * ==========================================
   * Re-check Gap Before Mutation
   *
   * احتمال overwrite شدن Resolve همزمان را
   * کاهش می‌دهد.
   *
   * توجه:
   * این یک optimistic re-check است و Transaction
   * واقعی دیتابیس نیست، اما احتمال Race Window
   * را بسیار کمتر می‌کند.
   * ==========================================
   */

  try {
    const latestGap =
      await pb
        .collection(
          "knowledge_gaps"
        )
        .getOne(
          gapId,
          {
            fields:
              [
                "id",
                "status",
                "resolved_knowledge_item",
                "resolved_by",
                "resolved_at",
                "topic",
              ].join(
                ","
              ),
          }
        );

    if (
      latestGap.status ===
      "resolved"
    ) {
      const existingKnowledgeItemId =
        cleanRecordId(
          latestGap
            .resolved_knowledge_item
        );

      /*
       * ======================================
       * Concurrent Same Resolve
       * ======================================
       */

      if (
        existingKnowledgeItemId ===
        knowledgeItemId
      ) {
        await safeAudit({
          request,

          requestId,

          actorId:
            admin.account.id,

          gapId,

          action:
            "gap.resolve",

          result:
            "success",

          metadata: {
            title:
              gapTitle,

            previous_status:
              previousStatus,

            new_status:
              "resolved",

            knowledge_item_id:
              knowledgeItemId,

            concurrent_resolution:
              true,

            already_resolved:
              true,
          },
        });

        return respond(
          jsonResponse(
            {
              success:
                true,

              alreadyResolved:
                true,

              gap: {
                id:
                  latestGap.id,

                status:
                  "resolved",

                resolvedKnowledgeItem:
                  existingKnowledgeItemId,

                resolvedBy:
                  cleanRecordId(
                    latestGap
                      .resolved_by
                  ),

                resolvedAt:
                  cleanDateText(
                    latestGap
                      .resolved_at
                  ),
              },
            },
            200,
            requestId
          )
        );
      }

      /*
       * ======================================
       * Concurrent Different Resolve
       * ======================================
       */

      await safeAudit({
        request,

        requestId,

        actorId:
          admin.account.id,

        gapId,

        action:
          "gap.resolve",

        result:
          "blocked",

        errorCode:
          "GAP_ALREADY_RESOLVED",

        metadata: {
          title:
            gapTitle,

          existing_knowledge_item_id:
            existingKnowledgeItemId,

          requested_knowledge_item_id:
            knowledgeItemId,

          concurrent_resolution:
            true,
        },
      });

      return respond(
        jsonResponse(
          {
            success:
              false,

            code:
              "GAP_ALREADY_RESOLVED",

            message:
              "این Knowledge Gap هم‌زمان با درخواست دیگری حل شده است.",
          },
          409,
          requestId
        )
      );
    }

    /*
     * جدیدترین Topic استفاده شود.
     */

    gap.topic =
      latestGap.topic;
  } catch (error) {
    if (
      getErrorStatus(
        error
      ) ===
      404
    ) {
      return respond(
        jsonResponse(
          {
            success:
              false,

            code:
              "KNOWLEDGE_GAP_NOT_FOUND",

            message:
              "Knowledge Gap پیدا نشد.",
          },
          404,
          requestId
        )
      );
    }

    console.error(
      "Knowledge gap pre-update recheck failed",
      {
        requestId,

        adminId:
          admin.account.id,

        gapId,

        knowledgeItemId,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return respond(
      jsonResponse(
        {
          success:
            false,

          code:
            "KNOWLEDGE_GAP_RECHECK_FAILED",

          message:
            "بررسی نهایی Knowledge Gap ناموفق بود.",
        },
        503,
        requestId
      )
    );
  }

  /*
   * ==========================================
   * Resolve Data
   * ==========================================
   */

  const resolvedAt =
    new Date()
      .toISOString();

  const updateData:
    Record<
      string,
      unknown
    > = {
      status:
        "resolved",

      resolved_knowledge_item:
        knowledgeItemId,

      resolved_by:
        admin.account.id,

      resolved_at:
        resolvedAt,

      resolution_note:
        knowledgeTitle
          ? `با انتشار مطلب «${knowledgeTitle}» در پایگاه دانش حل شد.`
          : "با انتشار مطلب جدید در پایگاه دانش حل شد.",

      ignore_note:
        "",
    };

  /*
   * ==========================================
   * Inherit Topic
   * ==========================================
   */

  const gapTopic =
    cleanRecordId(
      gap.topic
    );

  const knowledgeTopic =
    cleanRecordId(
      knowledgeItem.topic
    );

  const inheritedTopic =
    !gapTopic &&
    Boolean(
      knowledgeTopic
    );

  if (
    inheritedTopic
  ) {
    updateData.topic =
      knowledgeTopic;
  }

  /*
   * ==========================================
   * Update
   * ==========================================
   */

  try {
    const updated =
      await pb
        .collection(
          "knowledge_gaps"
        )
        .update(
          gapId,
          updateData
        );

    /*
     * ========================================
     * Audit Success
     * ========================================
     */

    await safeAudit({
      request,

      requestId,

      actorId:
        admin.account.id,

      gapId,

      action:
        "gap.resolve",

      result:
        "success",

      metadata: {
        title:
          gapTitle,

        previous_status:
          previousStatus,

        new_status:
          "resolved",

        knowledge_item_id:
          knowledgeItemId,

        knowledge_title:
          knowledgeTitle,

        knowledge_sync_status:
          "synced",

        resolved_at:
          resolvedAt,

        topic_inherited:
          inheritedTopic,
      },
    });

    /*
     * ========================================
     * Response
     * ========================================
     */

    return respond(
      jsonResponse(
        {
          success:
            true,

          gap: {
            id:
              updated.id,

            status:
              cleanAuditText(
                updated.status,
                50
              ) ||
              "resolved",

            resolvedKnowledgeItem:
              cleanRecordId(
                updated
                  .resolved_knowledge_item
              ) ||
              knowledgeItemId,

            resolvedBy:
              cleanRecordId(
                updated.resolved_by
              ) ||
              admin.account.id,

            resolvedAt:
              cleanDateText(
                updated.resolved_at
              ) ||
              resolvedAt,
          },

          knowledgeItem: {
            id:
              knowledgeItem.id,

            title:
              knowledgeTitle,
          },
        },
        200,
        requestId
      )
    );
  } catch (error) {
    const status =
      getErrorStatus(
        error
      );

    await safeAudit({
      request,

      requestId,

      actorId:
        admin.account.id,

      gapId,

      action:
        "gap.resolve",

      result:
        "failure",

      errorCode:
        status ===
        404
          ? "KNOWLEDGE_GAP_NOT_FOUND"
          : "KNOWLEDGE_GAP_RESOLVE_FAILED",

      metadata: {
        title:
          gapTitle,

        previous_status:
          previousStatus,

        requested_status:
          "resolved",

        knowledge_item_id:
          knowledgeItemId,

        knowledge_title:
          knowledgeTitle,

        upstream_status:
          status ||
          null,
      },
    });

    console.error(
      "Knowledge gap resolve failed",
      {
        requestId,

        adminId:
          admin.account.id,

        gapId,

        knowledgeItemId,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    if (
      status ===
      404
    ) {
      return respond(
        jsonResponse(
          {
            success:
              false,

            code:
              "KNOWLEDGE_GAP_NOT_FOUND",

            message:
              "Knowledge Gap پیدا نشد.",
          },
          404,
          requestId
        )
      );
    }

    return respond(
      jsonResponse(
        {
          success:
            false,

          code:
            "KNOWLEDGE_GAP_RESOLVE_FAILED",

          message:
            "حل Knowledge Gap انجام نشد.",
        },
        503,
        requestId
      )
    );
  }
}

/*
 * ============================================
 * Rate Limited Response
 * ============================================
 */

function rateLimitedResponse(
  requestId:
    string,

  rateLimit: {
    allowed:
      false;

    code:
      "ADMIN_RATE_LIMITED";

    limit:
      number;

    remaining:
      0;

    retryAfterSeconds:
      number;

    resetAt:
      string;
  }
) {
  const response =
    jsonResponse(
      {
        success:
          false,

        code:
          "ADMIN_RATE_LIMITED",

        message:
          "تعداد درخواست‌های حل Knowledge Gap بیش از حد مجاز است.",

        retryAfterSeconds:
          rateLimit.retryAfterSeconds,

        limit:
          rateLimit.limit,

        remaining:
          rateLimit.remaining,

        resetAt:
          rateLimit.resetAt,
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
 * Strict Resolve Payload
 * ============================================
 */

function parseResolvePayload(
  body:
    unknown
): ResolvePayload {
  if (
    typeof body !==
      "object" ||
    body ===
      null ||
    Array.isArray(
      body
    )
  ) {
    return {
      success:
        false,

      code:
        "INVALID_REQUEST",

      message:
        "ساختار درخواست معتبر نیست.",
    };
  }

  const value =
    body as Record<
      string,
      unknown
    >;

  /*
   * ==========================================
   * Unknown Fields
   * ==========================================
   */

  const keys =
    Object.keys(
      value
    );

  if (
    keys.some(
      (
        key
      ) =>
        key !==
        "knowledgeItemId"
    )
  ) {
    return {
      success:
        false,

      code:
        "UNEXPECTED_FIELDS",

      message:
        "فیلدهای ارسالی برای حل Knowledge Gap معتبر نیستند.",
    };
  }

  /*
   * ==========================================
   * Knowledge Item ID
   * ==========================================
   */

  if (
    typeof value
      .knowledgeItemId !==
    "string"
  ) {
    return {
      success:
        false,

      code:
        "KNOWLEDGE_ITEM_REQUIRED",

      message:
        "شناسه مطلب پایگاه دانش الزامی است.",
    };
  }

  const knowledgeItemId =
    cleanRecordId(
      value.knowledgeItemId
    );

  if (
    !knowledgeItemId
  ) {
    return {
      success:
        false,

      code:
        "INVALID_KNOWLEDGE_ITEM_ID",

      message:
        "شناسه مطلب پایگاه دانش معتبر نیست.",
    };
  }

  return {
    success:
      true,

    knowledgeItemId,
  };
}

/*
 * ============================================
 * Limited JSON Body
 * ============================================
 */

async function readJsonBodyWithLimit(
  request:
    Request,

  maximumBytes:
    number
): Promise<
  | {
      ok:
        true;

      body:
        unknown;
    }
  | {
      ok:
        false;

      status:
        number;

      code:
        string;

      message:
        string;
    }
> {
  if (
    !request.body
  ) {
    return {
      ok:
        false,

      status:
        400,

      code:
        "INVALID_REQUEST",

      message:
        "ساختار درخواست معتبر نیست.",
    };
  }

  const reader =
    request.body
      .getReader();

  const decoder =
    new TextDecoder(
      "utf-8",
      {
        fatal:
          true,
      }
    );

  let totalBytes =
    0;

  let text =
    "";

  try {
    while (
      true
    ) {
      const {
        done,
        value,
      } =
        await reader.read();

      if (
        done
      ) {
        break;
      }

      if (
        !value
      ) {
        continue;
      }

      totalBytes +=
        value.byteLength;

      if (
        totalBytes >
        maximumBytes
      ) {
        try {
          await reader.cancel();
        } catch {
          // Ignore cancel failure.
        }

        return {
          ok:
            false,

          status:
            413,

          code:
            "REQUEST_BODY_TOO_LARGE",

          message:
            "حجم درخواست بیش از حد مجاز است.",
        };
      }

      text +=
        decoder.decode(
          value,
          {
            stream:
              true,
          }
        );
    }

    text +=
      decoder.decode();
  } catch {
    return {
      ok:
        false,

      status:
        400,

      code:
        "INVALID_REQUEST",

      message:
        "ساختار درخواست معتبر نیست.",
    };
  }

  if (
    !text.trim()
  ) {
    return {
      ok:
        false,

      status:
        400,

      code:
        "INVALID_REQUEST",

      message:
        "ساختار درخواست معتبر نیست.",
    };
  }

  try {
    return {
      ok:
        true,

      body:
        JSON.parse(
          text
        ),
    };
  } catch {
    return {
      ok:
        false,

      status:
        400,

      code:
        "INVALID_REQUEST",

      message:
        "ساختار درخواست معتبر نیست.",
    };
  }
}

/*
 * ============================================
 * Safe Audit
 * ============================================
 */

async function safeAudit({
  request,
  requestId,
  actorId,
  gapId,
  action,
  result,
  errorCode,
  metadata,
}: {
  request:
    Request;

  requestId:
    string;

  actorId:
    string;

  gapId:
    string;

  action:
    string;

  result:
    | "success"
    | "failure"
    | "blocked";

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
        "knowledge_gap",

      entityId:
        gapId,

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
      "Knowledge gap resolve audit failed",
      {
        requestId,

        actorId,

        gapId,

        action,

        result,

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
 * Record ID
 * ============================================
 */

function cleanRecordId(
  value:
    unknown
) {
  if (
    typeof value !==
    "string"
  ) {
    return "";
  }

  const id =
    value.trim();

  return RECORD_ID_PATTERN.test(
    id
  )
    ? id
    : "";
}

/*
 * ============================================
 * Date Text
 * ============================================
 */

function cleanDateText(
  value:
    unknown
) {
  if (
    typeof value !==
    "string"
  ) {
    return "";
  }

  const text =
    value
      .trim()
      .slice(
        0,
        64
      );

  if (
    !text
  ) {
    return "";
  }

  const date =
    new Date(
      text
    );

  return Number.isNaN(
    date.getTime()
  )
    ? ""
    : text;
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
      /[\u0000-\u001F\u007F]/g,
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
    {
      ...body,

      requestId,
    },
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
 * Safe HTTP Status
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
 * Error Status
 * ============================================
 */

function getErrorStatus(
  error:
    unknown
) {
  if (
    typeof error !==
      "object" ||
    error ===
      null
  ) {
    return undefined;
  }

  const value =
    error as {
      status?:
        unknown;
    };

  return typeof value.status ===
    "number"
    ? value.status
    : undefined;
}

/*
 * ============================================
 * Safe Error
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