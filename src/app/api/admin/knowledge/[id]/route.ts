import type PocketBase from "pocketbase";

import {
  removeKnowledgeItemFromOpenAI,
  syncKnowledgeItem,
  type KnowledgeItemRecord,
} from "@/lib/ai/knowledge";

import {
  consumeAdminRateLimit,
} from "@/lib/admin/rate-limit";

import {
  recordAuditLog,
} from "@/lib/audit/log";

import {
  buildKnowledgePayload,
  getPocketBaseError,
  hasKnowledgeContentChanged,
  parseKnowledgeRequest,
  serializeKnowledgeItem,
  toPositiveInteger,
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
 * Types
 * ============================================
 */

type Context = {
  params: Promise<{
    id: string;
  }>;
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
 * Validation
 * ============================================
 */

const RECORD_ID_PATTERN =
  /^[a-zA-Z0-9_-]{1,64}$/;

/*
 * ============================================
 * GET
 *
 * Read Knowledge Item
 *
 * Read-only:
 * Mutation Rate Limit روی GET اعمال نمی‌شود.
 * ============================================
 */

export async function GET(
  _request: Request,
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
    return knowledgeApiError(
      requestId,
      admin.status,
      admin.code,
      admin.message
    );
  }

  /*
   * ==========================================
   * Knowledge ID
   * ==========================================
   */

  const {
    id: rawId,
  } = await params;

  const id =
    cleanRecordId(
      rawId
    );

  if (
    !id
  ) {
    return knowledgeApiError(
      requestId,
      400,
      "INVALID_KNOWLEDGE_ID",
      "شناسه مطلب معتبر نیست."
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

        knowledgeId:
          id,

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
   * Load Item
   * ==========================================
   */

  try {
    const item =
      await pb
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

    return knowledgeApiResponse(
      {
        success:
          true,

        item:
          serializeKnowledgeItem(
            item
          ),
      },
      200,
      requestId
    );
  } catch (error) {
    return itemErrorResponse(
      requestId,
      error
    );
  }
}

/*
 * ============================================
 * PATCH
 *
 * Update Knowledge Item
 *
 * Rate Limit:
 *
 * knowledge.update
 * 20 requests / minute / admin
 * ============================================
 */

export async function PATCH(
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
    return knowledgeApiError(
      requestId,
      admin.status,
      admin.code,
      admin.message
    );
  }

  /*
   * ==========================================
   * Knowledge ID
   * ==========================================
   */

  const {
    id: rawId,
  } = await params;

  const id =
    cleanRecordId(
      rawId
    );

  if (
    !id
  ) {
    return knowledgeApiError(
      requestId,
      400,
      "INVALID_KNOWLEDGE_ID",
      "شناسه مطلب معتبر نیست."
    );
  }

  /*
   * ==========================================
   * Admin Rate Limit
   *
   * knowledge.update
   * 20 requests / minute / admin
   *
   * Target Knowledge ID بخشی از Bucket نیست.
   *
   * Fail-closed:
   * اگر Rate Limiter در دسترس نباشد هیچ
   * Mutation یا OpenAI Sync انجام نمی‌شود.
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
          "knowledge.update",

        requestId,
      });
  } catch (error) {
    console.error(
      "Admin knowledge update rate limit unavailable",
      {
        requestId,

        adminId:
          admin.account.id,

        knowledgeId:
          id,

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
    return rateLimitedResponse(
      requestId,
      rateLimit,
      "تعداد درخواست‌های بروزرسانی مطالب بیش از حد مجاز است."
    );
  }

  const allowedRateLimit:
    AllowedRateLimit =
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

        knowledgeId:
          id,

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
        "KNOWLEDGE_SERVICE_UNAVAILABLE",
        "سرویس پایگاه دانش موقتاً در دسترس نیست."
      )
    );
  }

  /*
   * ==========================================
   * Existing Knowledge
   * ==========================================
   */

  let existing:
    KnowledgeItemRecord;

  try {
    existing =
      await pb
        .collection(
          "knowledge_items"
        )
        .getOne<KnowledgeItemRecord>(
          id
        );
  } catch (error) {
    return respond(
      itemErrorResponse(
        requestId,
        error
      )
    );
  }

  const previousStatus =
    normalizeStatusText(
      existing.status
    );

  const previousSyncStatus =
    normalizeSyncStatus(
      existing.sync_status
    );

  const previousVersion =
    toPositiveInteger(
      existing.version,
      1
    );

  const previousTitle =
    cleanAuditText(
      existing.title,
      200
    );

  /*
   * ==========================================
   * Existing Attachment
   * ==========================================
   */

  const existingAttachment =
    Array.isArray(
      existing.attachment
    )
      ? String(
          existing
            .attachment[0] ||
            ""
        ).trim()
      : String(
          existing.attachment ||
            ""
        ).trim();

  /*
   * ==========================================
   * Parse Request
   * ==========================================
   */

  const parsed =
    await parseKnowledgeRequest(
      request,
      {
        existingAttachment,
      }
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

        knowledgeId:
          id,

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
   * Change Detection
   * ==========================================
   */

  const contentChanged =
    hasKnowledgeContentChanged(
      existing,
      parsed.data
    );

  const version =
    previousVersion +
    (
      contentChanged
        ? 1
        : 0
    );

  const shouldSync =
    parsed.data.status ===
      "published" &&
    (
      contentChanged ||
      previousStatus !==
        "published" ||
      previousSyncStatus !==
        "synced"
    );

  const shouldRemove =
    parsed.data.status ===
      "draft" &&
    Boolean(
      existing.openai_file_id
    );

  const isPublishing =
    previousStatus !==
      "published" &&
    parsed.data.status ===
      "published";

  const isUnpublishing =
    previousStatus ===
      "published" &&
    parsed.data.status ===
      "draft";

  /*
   * ==========================================
   * State
   * ==========================================
   */

  let updateCompleted =
    false;

  let syncAuditWritten =
    false;

  let removeAuditWritten =
    false;

  let updatedRecord:
    KnowledgeItemRecord |
    null =
    null;

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
          updatedBy:
            admin.account.id,
        },
        {
          version,

          syncStatus:
            shouldSync ||
            shouldRemove
              ? "pending"
              : previousSyncStatus,

          clearAttachment:
            parsed.data
              .sourceType ===
              "text" &&
            Boolean(
              existingAttachment
            ),
        }
      );

    /*
     * ========================================
     * PocketBase Update
     * ========================================
     */

    updatedRecord =
      await pb
        .collection(
          "knowledge_items"
        )
        .update<KnowledgeItemRecord>(
          id,
          payload
        );

    updateCompleted =
      true;

    /*
     * ========================================
     * Audit: Update
     * ========================================
     */

    await safeAudit({
      request,

      requestId,

      actorId:
        admin.account.id,

      action:
        "knowledge.update",

      result:
        "success",

      entityId:
        id,

      metadata: {
        title:
          cleanAuditText(
            parsed.data.title ||
              previousTitle,
            200
          ),

        previous_status:
          previousStatus,

        new_status:
          parsed.data.status,

        previous_sync_status:
          previousSyncStatus,

        content_changed:
          contentChanged,

        previous_version:
          previousVersion,

        new_version:
          version,

        source_type:
          parsed.data
            .sourceType,
      },
    });

    /*
     * ========================================
     * Audit: Publish
     * ========================================
     */

    if (
      isPublishing
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
          id,

        metadata: {
          title:
            cleanAuditText(
              parsed.data.title ||
                previousTitle,
              200
            ),

          previous_status:
            previousStatus,

          new_status:
            "published",

          version,
        },
      });
    }

    /*
     * ========================================
     * Audit: Unpublish
     * ========================================
     */

    if (
      isUnpublishing
    ) {
      await safeAudit({
        request,

        requestId,

        actorId:
          admin.account.id,

        action:
          "knowledge.unpublish",

        result:
          "success",

        entityId:
          id,

        metadata: {
          title:
            cleanAuditText(
              parsed.data.title ||
                previousTitle,
              200
            ),

          previous_status:
            previousStatus,

          new_status:
            "draft",
        },
      });
    }

    /*
     * ========================================
     * OpenAI Sync / Remove
     * ========================================
     */

    const sync =
      shouldSync
        ? await syncKnowledgeItem(
            id,
            pb
          )
        : shouldRemove
          ? await removeKnowledgeItemFromOpenAI(
              id,
              pb
            )
          : null;

    /*
     * ========================================
     * Audit: Sync
     * ========================================
     */

    if (
      shouldSync
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
            id,

          metadata: {
            title:
              cleanAuditText(
                parsed.data.title ||
                  previousTitle,
                200
              ),

            content_changed:
              contentChanged,

            version,

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
            id,

          errorCode:
            getOperationCode(
              sync,
              "KNOWLEDGE_SYNC_FAILED"
            ),

          metadata: {
            title:
              cleanAuditText(
                parsed.data.title ||
                  previousTitle,
                200
              ),

            version,

            sync_status:
              "error",

            message:
              getOperationMessage(
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
     * Audit: Remove from OpenAI
     * ========================================
     */

    if (
      shouldRemove
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
            "knowledge.openai.remove.success",

          result:
            "success",

          entityId:
            id,

          metadata: {
            title:
              cleanAuditText(
                parsed.data.title ||
                  previousTitle,
                200
              ),

            reason:
              "knowledge_changed_to_draft",
          },
        });
      } else {
        await safeAudit({
          request,

          requestId,

          actorId:
            admin.account.id,

          action:
            "knowledge.openai.remove.failure",

          result:
            "failure",

          entityId:
            id,

          errorCode:
            getOperationCode(
              sync,
              "OPENAI_FILE_REMOVE_FAILED"
            ),

          metadata: {
            title:
              cleanAuditText(
                parsed.data.title ||
                  previousTitle,
                200
              ),

            reason:
              "knowledge_changed_to_draft",

            message:
              getOperationMessage(
                sync
              ),
          },
        });
      }

      removeAuditWritten =
        true;
    }

    /*
     * ========================================
     * Reload Expanded Item
     *
     * Reload failure نباید Mutation موفق را
     * Failure نشان دهد.
     * ========================================
     */

    let item:
      KnowledgeItemRecord;

    try {
      item =
        await pb
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
    } catch (error) {
      console.error(
        "Knowledge updated but reload failed",
        {
          requestId,

          adminId:
            admin.account.id,

          knowledgeId:
            id,

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
                updatedRecord ||
                  existing
              ),

            contentChanged,

            sync,

            message:
              getUpdateSuccessMessage(
                parsed.data.status,
                sync
              ),

            warning:
              "تغییرات ذخیره شد، اما دریافت اطلاعات تکمیلی مطلب ناموفق بود.",

            warningCode:
              "KNOWLEDGE_RELOAD_FAILED",
          },
          200,
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

          contentChanged,

          sync,

          message:
            getUpdateSuccessMessage(
              parsed.data.status,
              sync
            ),
        },
        200,
        requestId
      )
    );
  } catch (error) {
    const metadata =
      getPocketBaseError(
        error
      );

    console.error(
      "Knowledge update failed",
      {
        requestId,

        adminId:
          admin.account.id,

        knowledgeId:
          id,

        updateCompleted,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    /*
     * ========================================
     * Update Failure
     * ========================================
     */

    if (
      !updateCompleted
    ) {
      await safeAudit({
        request,

        requestId,

        actorId:
          admin.account.id,

        action:
          "knowledge.update",

        result:
          "failure",

        entityId:
          id,

        errorCode:
          "KNOWLEDGE_UPDATE_FAILED",

        metadata: {
          title:
            previousTitle,

          previous_status:
            previousStatus,

          requested_status:
            parsed.data.status,

          content_changed:
            contentChanged,

          previous_version:
            previousVersion,

          requested_version:
            version,

          pocketbase_status:
            metadata.status,
        },
      });

      if (
        isPublishing
      ) {
        await safeAudit({
          request,

          requestId,

          actorId:
            admin.account.id,

          action:
            "knowledge.publish",

          result:
            "failure",

          entityId:
            id,

          errorCode:
            "KNOWLEDGE_PUBLISH_FAILED",

          metadata: {
            title:
              previousTitle,

            previous_status:
              previousStatus,

            requested_status:
              "published",
          },
        });
      }
    }

    /*
     * ========================================
     * Unexpected Sync Exception
     * ========================================
     */

    if (
      updateCompleted &&
      shouldSync &&
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
          id,

        errorCode:
          "KNOWLEDGE_SYNC_EXCEPTION",

        metadata: {
          title:
            cleanAuditText(
              parsed.data.title ||
                previousTitle,
              200
            ),

          version,
        },
      });
    }

    /*
     * ========================================
     * Unexpected Remove Exception
     * ========================================
     */

    if (
      updateCompleted &&
      shouldRemove &&
      !removeAuditWritten
    ) {
      await safeAudit({
        request,

        requestId,

        actorId:
          admin.account.id,

        action:
          "knowledge.openai.remove.failure",

        result:
          "failure",

        entityId:
          id,

        errorCode:
          "OPENAI_FILE_REMOVE_EXCEPTION",

        metadata: {
          title:
            cleanAuditText(
              parsed.data.title ||
                previousTitle,
              200
            ),

          reason:
            "knowledge_changed_to_draft",
        },
      });
    }

    /*
     * ========================================
     * Error Response
     *
     * اگر PocketBase Update انجام شده باشد،
     * Client صریحاً می‌فهمد Mutation ذخیره شده
     * ولی مرحله OpenAI کامل نشده است.
     * ========================================
     */

    return respond(
      knowledgeApiError(
        requestId,

        metadata.status ===
          400
          ? 400
          : 503,

        updateCompleted
          ? "KNOWLEDGE_UPDATE_PARTIAL"
          : "KNOWLEDGE_UPDATE_FAILED",

        metadata.status ===
          400 &&
        !updateCompleted
          ? "اطلاعات مطلب با ساختار PocketBase سازگار نیست."
          : updateCompleted
            ? "تغییرات ذخیره شد، اما تکمیل عملیات OpenAI ناموفق بود."
            : "ذخیره تغییرات مطلب ناموفق بود.",

        updateCompleted
          ? {
              updated:
                true,

              knowledgeId:
                id,
            }
          : undefined
      )
    );
  }
}

/*
 * ============================================
 * DELETE
 *
 * Permanent Delete Draft
 *
 * Rate Limit:
 *
 * knowledge.delete
 * 5 requests / minute / admin
 * ============================================
 */

export async function DELETE(
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
    return knowledgeApiError(
      requestId,
      admin.status,
      admin.code,
      admin.message
    );
  }

  /*
   * ==========================================
   * Knowledge ID
   * ==========================================
   */

  const {
    id: rawId,
  } = await params;

  const id =
    cleanRecordId(
      rawId
    );

  if (
    !id
  ) {
    return knowledgeApiError(
      requestId,
      400,
      "INVALID_KNOWLEDGE_ID",
      "شناسه مطلب معتبر نیست."
    );
  }

  /*
   * ==========================================
   * Admin Rate Limit
   *
   * knowledge.delete
   * 5 requests / minute / admin
   *
   * Fail-closed.
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
          "knowledge.delete",

        requestId,
      });
  } catch (error) {
    console.error(
      "Admin knowledge delete rate limit unavailable",
      {
        requestId,

        adminId:
          admin.account.id,

        knowledgeId:
          id,

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
    return rateLimitedResponse(
      requestId,
      rateLimit,
      "تعداد درخواست‌های حذف مطلب بیش از حد مجاز است."
    );
  }

  const allowedRateLimit:
    AllowedRateLimit =
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

        knowledgeId:
          id,

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
        "KNOWLEDGE_SERVICE_UNAVAILABLE",
        "سرویس پایگاه دانش موقتاً در دسترس نیست."
      )
    );
  }

  /*
   * ==========================================
   * Load Item
   * ==========================================
   */

  let item:
    KnowledgeItemRecord;

  try {
    item =
      await pb
        .collection(
          "knowledge_items"
        )
        .getOne<KnowledgeItemRecord>(
          id
        );
  } catch (error) {
    return respond(
      itemErrorResponse(
        requestId,
        error
      )
    );
  }

  const title =
    cleanAuditText(
      item.title,
      200
    );

  /*
   * ==========================================
   * Draft Only
   * ==========================================
   */

  if (
    item.status !==
    "draft"
  ) {
    await safeAudit({
      request,

      requestId,

      actorId:
        admin.account.id,

      action:
        "knowledge.delete",

      result:
        "blocked",

      entityId:
        id,

      errorCode:
        "DRAFT_REQUIRED",

      metadata: {
        title,

        status:
          normalizeStatusText(
            item.status
          ),

        reason:
          "permanent_delete_requires_draft",
      },
    });

    return respond(
      knowledgeApiError(
        requestId,
        409,
        "DRAFT_REQUIRED",
        "حذف دائمی فقط برای پیش‌نویس مجاز است؛ مطلب منتشرشده را ابتدا بایگانی کنید."
      )
    );
  }

  /*
   * ==========================================
   * Remove Active OpenAI File
   *
   * اگر Cleanup شکست بخورد PocketBase Record
   * حذف نمی‌شود.
   * ==========================================
   */

  if (
    item.openai_file_id
  ) {
    let cleanup:
      Awaited<
        ReturnType<
          typeof removeKnowledgeItemFromOpenAI
        >
      >;

    try {
      cleanup =
        await removeKnowledgeItemFromOpenAI(
          id,
          pb,
          item
        );
    } catch (error) {
      console.error(
        "Knowledge OpenAI cleanup failed",
        {
          requestId,

          adminId:
            admin.account.id,

          knowledgeId:
            id,

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
          "knowledge.openai.remove.failure",

        result:
          "failure",

        entityId:
          id,

        errorCode:
          "OPENAI_FILE_REMOVE_EXCEPTION",

        metadata: {
          title,

          reason:
            "knowledge_delete",
        },
      });

      await safeAudit({
        request,

        requestId,

        actorId:
          admin.account.id,

        action:
          "knowledge.delete",

        result:
          "blocked",

        entityId:
          id,

        errorCode:
          "OPENAI_CLEANUP_FAILED",

        metadata: {
          title,

          reason:
            "openai_cleanup_exception",
        },
      });

      return respond(
        knowledgeApiError(
          requestId,
          503,
          "OPENAI_FILE_REMOVE_FAILED",
          "حذف فایل فعال از OpenAI ناموفق بود؛ رکورد حذف نشد."
        )
      );
    }

    /*
     * ========================================
     * Cleanup Failure
     * ========================================
     */

    if (
      !cleanup.success
    ) {
      const cleanupCode =
        getOperationCode(
          cleanup,
          "OPENAI_FILE_REMOVE_FAILED"
        );

      const cleanupStatus =
        getOperationStatus(
          cleanup,
          503
        );

      await safeAudit({
        request,

        requestId,

        actorId:
          admin.account.id,

        action:
          "knowledge.openai.remove.failure",

        result:
          "failure",

        entityId:
          id,

        errorCode:
          cleanupCode,

        metadata: {
          title,

          reason:
            "knowledge_delete",

          message:
            getOperationMessage(
              cleanup
            ),
        },
      });

      await safeAudit({
        request,

        requestId,

        actorId:
          admin.account.id,

        action:
          "knowledge.delete",

        result:
          "blocked",

        entityId:
          id,

        errorCode:
          "OPENAI_CLEANUP_FAILED",

        metadata: {
          title,

          reason:
            "active_openai_file_could_not_be_removed",

          cleanup_code:
            cleanupCode,
        },
      });

      return respond(
        knowledgeApiError(
          requestId,
          cleanupStatus,
          cleanupCode,
          "حذف فایل فعال از OpenAI ناموفق بود؛ رکورد برای جلوگیری از باقی‌ماندن داده حذف نشد."
        )
      );
    }

    /*
     * ========================================
     * Cleanup Success
     * ========================================
     */

    await safeAudit({
      request,

      requestId,

      actorId:
        admin.account.id,

      action:
        "knowledge.openai.remove.success",

      result:
        "success",

      entityId:
        id,

      metadata: {
        title,

        reason:
          "knowledge_delete",
      },
    });
  }

  /*
   * ==========================================
   * Delete PocketBase Record
   * ==========================================
   */

  try {
    await pb
      .collection(
        "knowledge_items"
      )
      .delete(
        id
      );
  } catch (error) {
    console.error(
      "Knowledge delete failed",
      {
        requestId,

        adminId:
          admin.account.id,

        knowledgeId:
          id,

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
        "knowledge.delete",

      result:
        "failure",

      entityId:
        id,

      errorCode:
        "KNOWLEDGE_DELETE_FAILED",

      metadata: {
        title,

        openai_cleanup_completed:
          Boolean(
            item.openai_file_id
          ),
      },
    });

    return respond(
      knowledgeApiError(
        requestId,
        503,
        "KNOWLEDGE_DELETE_FAILED",
        "حذف پیش‌نویس ناموفق بود."
      )
    );
  }

  /*
   * ==========================================
   * Audit: Delete Success
   * ==========================================
   */

  await safeAudit({
    request,

    requestId,

    actorId:
      admin.account.id,

    action:
      "knowledge.delete",

    result:
      "success",

    entityId:
      id,

    metadata: {
      title,

      previous_status:
        normalizeStatusText(
          item.status
        ),

      version:
        toPositiveInteger(
          item.version,
          1
        ),

      had_openai_file:
        Boolean(
          item.openai_file_id
        ),
    },
  });

  /*
   * ==========================================
   * Success
   * ==========================================
   */

  return respond(
    knowledgeApiResponse(
      {
        success:
          true,

        id,

        message:
          "پیش‌نویس برای همیشه حذف شد.",
      },
      200,
      requestId
    )
  );
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
  },

  message:
    string
) {
  const response =
    knowledgeApiError(
      requestId,
      429,
      "ADMIN_RATE_LIMITED",
      message,
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
 * Audit failure هیچ‌وقت Mutation اصلی را
 * تغییر نمی‌دهد.
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
 * Item Error
 * ============================================
 */

function itemErrorResponse(
  requestId:
    string,

  error:
    unknown
) {
  const metadata =
    getPocketBaseError(
      error
    );

  return knowledgeApiError(
    requestId,

    metadata.status ===
      404
      ? 404
      : 503,

    metadata.status ===
      404
      ? "KNOWLEDGE_NOT_FOUND"
      : "KNOWLEDGE_LOAD_FAILED",

    metadata.status ===
      404
      ? "مطلب موردنظر پیدا نشد."
      : "دریافت اطلاعات مطلب ناموفق بود."
  );
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
 * Knowledge Status
 * ============================================
 */

function normalizeStatusText(
  value:
    unknown
) {
  if (
    value ===
    "published"
  ) {
    return "published";
  }

  if (
    value ===
    "draft"
  ) {
    return "draft";
  }

  if (
    typeof value !==
    "string"
  ) {
    return "unknown";
  }

  return value
    .trim()
    .slice(
      0,
      50
    ) ||
    "unknown";
}

/*
 * ============================================
 * Sync Status
 * ============================================
 */

function normalizeSyncStatus(
  value:
    unknown
):
  | "pending"
  | "synced"
  | "error" {
  if (
    value ===
    "synced"
  ) {
    return "synced";
  }

  if (
    value ===
    "error"
  ) {
    return "error";
  }

  return "pending";
}

/*
 * ============================================
 * Operation Code
 * ============================================
 */

function getOperationCode(
  result:
    unknown,

  fallback:
    string
) {
  if (
    typeof result !==
      "object" ||
    result ===
      null
  ) {
    return fallback;
  }

  const value =
    result as {
      code?:
        unknown;
    };

  if (
    typeof value.code !==
    "string"
  ) {
    return fallback;
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
    fallback
  );
}

/*
 * ============================================
 * Operation Message
 * ============================================
 */

function getOperationMessage(
  result:
    unknown
) {
  if (
    typeof result !==
      "object" ||
    result ===
      null
  ) {
    return "";
  }

  const value =
    result as {
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
 * Operation Status
 * ============================================
 */

function getOperationStatus(
  result:
    unknown,

  fallback:
    number
) {
  if (
    typeof result !==
      "object" ||
    result ===
      null
  ) {
    return fallback;
  }

  const value =
    result as {
      status?:
        unknown;
    };

  const status =
    Number(
      value.status
    );

  if (
    !Number.isSafeInteger(
      status
    ) ||
    status <
      400 ||
    status >
      599
  ) {
    return fallback;
  }

  return status;
}

/*
 * ============================================
 * Update Success Message
 * ============================================
 */

function getUpdateSuccessMessage(
  status:
    string,

  operation:
    unknown
) {
  const operationFailed =
    typeof operation ===
      "object" &&
    operation !==
      null &&
    "success" in
      operation &&
    (
      operation as {
        success?:
          unknown;
      }
    ).success ===
      false;

  if (
    status ===
    "draft"
  ) {
    return operationFailed
      ? "پیش‌نویس ذخیره شد، اما حذف فایل قبلی از OpenAI ناموفق بود."
      : "پیش‌نویس با موفقیت ذخیره شد.";
  }

  return operationFailed
    ? "تغییرات ذخیره شد، اما همگام‌سازی ناموفق بود."
    : "تغییرات با موفقیت ذخیره شد.";
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