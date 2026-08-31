import {
  after,
} from "next/server";

import type PocketBase from "pocketbase";

import {
  consumeAdminRateLimit,
} from "@/lib/admin/rate-limit";

import {
  removeKnowledgeItemFromOpenAI,
  syncKnowledgeItem,
  type KnowledgeItemRecord,
} from "@/lib/ai/knowledge";

import {
  runKnowledgeTriggeredEvals,
} from "@/lib/ai/knowledge-eval-trigger";

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

type Context = {
  params:
    Promise<{
      id:
        string;
    }>;
};

/*
 * ============================================
 * GET
 * ============================================
 */

export async function GET(
  _request:
    Request,

  {
    params,
  }:
    Context
) {
  const requestId =
    crypto.randomUUID();

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

  const {
    id:
      rawId,
  } =
    await params;

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
 * ============================================
 */

export async function PATCH(
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
    id:
      rawId,
  } =
    await params;

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
   * Rate Limit
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

  if (
    !rateLimit.allowed
  ) {
    const response =
      knowledgeApiError(
        requestId,
        429,
        "ADMIN_RATE_LIMITED",
        "تعداد درخواست‌های ویرایش مطلب بیش از حد مجاز است.",
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

  const respond =
    <TResponse extends Response>(
      response:
        TResponse
    ) =>
      withRateLimitHeaders(
        response,
        rateLimit
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
    String(
      existing.status ||
        ""
    );

  const previousSyncStatus =
    String(
      existing.sync_status ||
        ""
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

  const existingAttachment =
    Array.isArray(
      existing.attachment
    )
      ? String(
          existing
            .attachment[0] ||
            ""
        )
      : String(
          existing.attachment ||
            ""
        );

  /*
   * ==========================================
   * Parse
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
      existing.status !==
        "published" ||
      existing.sync_status !==
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

  let updateCompleted =
    false;

  let syncAuditWritten =
    false;

  let removeAuditWritten =
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
          updatedBy:
            admin.account.id,
        },
        {
          version,

          syncStatus:
            shouldSync ||
            shouldRemove
              ? "pending"
              : String(
                  existing.sync_status ||
                    "pending"
                ) as
                  | "pending"
                  | "synced"
                  | "error",

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

    await pb
      .collection(
        "knowledge_items"
      )
      .update(
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
     * Audit: Publish / Unpublish
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

          version,
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
     * Automatic Golden Tests
     *
     * فقط وقتی Sync واقعی انجام شده و موفق است.
     * Draft/Remove تست خودکار اجرا نمی‌کند.
     * ========================================
     */

    if (
      shouldSync &&
      sync?.success ===
        true
    ) {
      const knowledgeId =
        id;

      const adminId =
        admin.account.id;

      const evalTrigger =
        isPublishing
          ? "publish" as const
          : "update" as const;

      after(
        async () => {
          try {
            await runKnowledgeTriggeredEvals({
              knowledgeId,

              adminId,

              trigger:
                evalTrigger,
            });
          } catch (error) {
            console.error(
              "Automatic knowledge update eval failed",
              {
                knowledgeId,

                adminId,

                evalTrigger,

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
     * Reload Expanded Item
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

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    /*
     * ========================================
     * Update Failure Audit
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
          400
          ? "اطلاعات مطلب با ساختار PocketBase سازگار نیست."
          : updateCompleted
            ? "تغییرات ذخیره شد، اما تکمیل عملیات OpenAI ناموفق بود."
            : "ذخیره تغییرات مطلب ناموفق بود.",

        updateCompleted
          ? {
              knowledgeId:
                id,

              updated:
                true,
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
 * Permanent delete is allowed for Draft only.
 * ============================================
 */

export async function DELETE(
  request:
    Request,

  {
    params,
  }:
    Context
) {
  const requestId =
    crypto.randomUUID();

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

  const {
    id:
      rawId,
  } =
    await params;

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
   * Rate Limit
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

  if (
    !rateLimit.allowed
  ) {
    const response =
      knowledgeApiError(
        requestId,
        429,
        "ADMIN_RATE_LIMITED",
        "تعداد درخواست‌های حذف مطلب بیش از حد مجاز است.",
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

  const respond =
    <TResponse extends Response>(
      response:
        TResponse
    ) =>
      withRateLimitHeaders(
        response,
        rateLimit
      );

  let pb:
    PocketBase;

  try {
    pb =
      await getPocketBaseServiceClient();
  } catch (error) {
    console.error(
      "Knowledge delete service unavailable",
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

        current_status:
          String(
            item.status ||
              ""
          ),
      },
    });

    return respond(
      knowledgeApiError(
        requestId,
        409,
        "DRAFT_REQUIRED",
        "فقط پیش‌نویس را می‌توان برای همیشه حذف کرد."
      )
    );
  }

  /*
   * اگر Draft هنوز OpenAI file دارد،
   * قبل از حذف Record آن را پاک می‌کنیم.
   */
  if (
    item.openai_file_id
  ) {
    const removal =
      await removeKnowledgeItemFromOpenAI(
        id,
        pb
      );

    if (
      !removal.success
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
          getOperationCode(
            removal,
            "OPENAI_FILE_REMOVE_FAILED"
          ),

        metadata: {
          title,

          reason:
            "knowledge_permanent_delete",

          message:
            getOperationMessage(
              removal
            ),
        },
      });

      return respond(
        knowledgeApiError(
          requestId,
          503,
          "OPENAI_FILE_REMOVE_FAILED",
          "حذف فایل مطلب از OpenAI ناموفق بود؛ مطلب حذف نشد."
        )
      );
    }

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
          "knowledge_permanent_delete",
      },
    });
  }

  try {
    await pb
      .collection(
        "knowledge_items"
      )
      .delete(
        id
      );
  } catch (error) {
    const metadata =
      getPocketBaseError(
        error
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

        pocketbase_status:
          metadata.status,
      },
    });

    return respond(
      knowledgeApiError(
        requestId,
        metadata.status ===
          404
          ? 404
          : 503,
        metadata.status ===
          404
          ? "KNOWLEDGE_NOT_FOUND"
          : "KNOWLEDGE_DELETE_FAILED",
        metadata.status ===
          404
          ? "مطلب موردنظر پیدا نشد."
          : "حذف مطلب ناموفق بود."
      )
    );
  }

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
        String(
          item.status ||
            ""
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
      : "دریافت مطلب ناموفق بود."
  );
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
 * Update Message
 * ============================================
 */

function getUpdateSuccessMessage(
  status:
    string,

  operation:
    unknown
) {
  if (
    status ===
    "draft"
  ) {
    return operation &&
      !isOperationSuccess(
        operation
      )
      ? "پیش‌نویس ذخیره شد، اما حذف فایل قبلی از OpenAI ناموفق بود."
      : "پیش‌نویس با موفقیت ذخیره شد.";
  }

  return operation &&
    !isOperationSuccess(
      operation
    )
    ? "تغییرات ذخیره شد، اما همگام‌سازی ناموفق بود."
    : "تغییرات با موفقیت ذخیره شد.";
}

/*
 * ============================================
 * Operation Helpers
 * ============================================
 */

function isOperationSuccess(
  value:
    unknown
) {
  if (
    typeof value !==
      "object" ||
    value ===
      null
  ) {
    return false;
  }

  return (
    value as {
      success?:
        unknown;
    }
  ).success ===
    true;
}

function getOperationCode(
  value:
    unknown,

  fallback:
    string
) {
  if (
    typeof value !==
      "object" ||
    value ===
      null
  ) {
    return fallback;
  }

  const code =
    (
      value as {
        code?:
          unknown;
      }
    ).code;

  return typeof code ===
    "string" &&
    code.trim()
      ? code
          .trim()
          .slice(
            0,
            120
          )
      : fallback;
}

function getOperationMessage(
  value:
    unknown
) {
  if (
    typeof value !==
      "object" ||
    value ===
      null
  ) {
    return "";
  }

  const message =
    (
      value as {
        message?:
          unknown;
      }
    ).message;

  return cleanAuditText(
    message,
    500
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
  const id =
    String(
      value ||
        ""
    ).trim();

  return /^[a-zA-Z0-9_-]{1,64}$/.test(
    id
  )
    ? id
    : "";
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
      message:
        String(
          error
        ),
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

      request_id?:
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

    requestId:
      typeof value.request_id ===
      "string"
        ? value.request_id
        : undefined,
  };
}
