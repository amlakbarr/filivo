import {
  NextResponse,
} from "next/server";

import type PocketBase from "pocketbase";

import type {
  RecordModel,
} from "pocketbase";

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
 * Constants
 * ============================================
 */

const RECORD_ID_PATTERN =
  /^[a-zA-Z0-9_-]{1,64}$/;

const MAX_REQUEST_BODY_BYTES =
  8 * 1024;

/*
 * ============================================
 * POST
 *
 * Resolve negative Feedback with a published
 * and successfully synced Knowledge Item.
 * ============================================
 */

export async function POST(
  request:
    Request,

  {
    params,
  }: {
    params:
      Promise<{
        feedbackId:
          string;
      }>;
  }
) {
  const requestId =
    crypto.randomUUID();

  /*
   * ==========================================
   * Admin Authentication
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
   * Feedback ID
   * ==========================================
   */

  const {
    feedbackId:
      rawFeedbackId,
  } = await params;

  const feedbackId =
    cleanRecordId(
      rawFeedbackId
    );

  if (
    !feedbackId
  ) {
    return apiError(
      requestId,
      400,
      "INVALID_FEEDBACK_ID",
      "شناسه بازخورد معتبر نیست."
    );
  }

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
      .split(
        ";"
      )[0]
      .trim()
      .toLowerCase();

  if (
    contentType !==
    "application/json"
  ) {
    return apiError(
      requestId,
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "نوع محتوای درخواست معتبر نیست."
    );
  }

  /*
   * ==========================================
   * Body
   * ==========================================
   */

  const parsedBody =
    await readJsonBodyWithLimit(
      request,
      MAX_REQUEST_BODY_BYTES
    );

  if (
    !parsedBody.ok
  ) {
    return apiError(
      requestId,
      parsedBody.status,
      parsedBody.code,
      parsedBody.message
    );
  }

  const knowledgeItemId =
    getKnowledgeItemId(
      parsedBody.body
    );

  if (
    !knowledgeItemId
  ) {
    return apiError(
      requestId,
      400,
      "INVALID_KNOWLEDGE_ITEM_ID",
      "شناسه مطلب پایگاه دانش معتبر نیست."
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
      "Feedback resolve service unavailable",
      {
        requestId,

        adminId:
          admin.account.id,

        feedbackId,

        knowledgeItemId,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return apiError(
      requestId,
      503,
      "FEEDBACK_RESOLVE_SERVICE_UNAVAILABLE",
      "سرویس رسیدگی به بازخورد موقتاً در دسترس نیست."
    );
  }

  /*
   * ==========================================
   * Load Feedback
   * ==========================================
   */

  let feedback:
    RecordModel;

  try {
    feedback =
      await pb
        .collection(
          "message_feedback"
        )
        .getOne(
          feedbackId,
          {
            fields: [
              "id",
              "rating",
              "review_status",
              "review_note",
              "reviewed_by",
              "reviewed_at",
              "resolved_knowledge_item",
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
      return apiError(
        requestId,
        404,
        "FEEDBACK_NOT_FOUND",
        "بازخورد موردنظر پیدا نشد."
      );
    }

    console.error(
      "Feedback resolve lookup failed",
      {
        requestId,

        adminId:
          admin.account.id,

        feedbackId,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return apiError(
      requestId,
      503,
      "FEEDBACK_RESOLVE_LOOKUP_FAILED",
      "بررسی بازخورد انجام نشد."
    );
  }

  /*
   * فقط Feedback منفی وارد چرخه اصلاح Knowledge
   * می‌شود.
   */

  if (
    feedback.rating !==
    "down"
  ) {
    return apiError(
      requestId,
      409,
      "NEGATIVE_FEEDBACK_REQUIRED",
      "فقط بازخورد منفی را می‌توان با مطلب اصلاحی حل کرد."
    );
  }

  const previousStatus =
    normalizeReviewStatus(
      feedback.review_status
    );

  const previousKnowledgeItemId =
    cleanRecordId(
      feedback.resolved_knowledge_item
    );

  /*
   * ==========================================
   * Idempotency
   * ==========================================
   */

  if (
    previousStatus ===
      "resolved" &&
    previousKnowledgeItemId ===
      knowledgeItemId
  ) {
    return apiSuccess(
      requestId,
      {
        alreadyResolved:
          true,

        feedback: {
          id:
            feedback.id,

          reviewStatus:
            "resolved",

          resolvedKnowledgeItem:
            knowledgeItemId,

          reviewedBy:
            String(
              feedback.reviewed_by ||
                ""
            ) ||
            undefined,

          reviewedAt:
            String(
              feedback.reviewed_at ||
                ""
            ) ||
            undefined,
        },
      }
    );
  }

  /*
   * اگر قبلاً با Knowledge دیگری حل شده،
   * بدون بازکردن Review اجازه تعویض Relation
   * نمی‌دهیم.
   */

  if (
    previousStatus ===
      "resolved" &&
    previousKnowledgeItemId &&
    previousKnowledgeItemId !==
      knowledgeItemId
  ) {
    await safeAudit({
      request,

      requestId,

      actorId:
        admin.account.id,

      feedbackId,

      result:
        "blocked",

      errorCode:
        "FEEDBACK_ALREADY_RESOLVED_WITH_OTHER_KNOWLEDGE",

      metadata: {
        previous_status:
          previousStatus,

        previous_knowledge_item_id:
          previousKnowledgeItemId,

        requested_knowledge_item_id:
          knowledgeItemId,
      },
    });

    return apiError(
      requestId,
      409,
      "FEEDBACK_ALREADY_RESOLVED_WITH_OTHER_KNOWLEDGE",
      "این بازخورد قبلاً با مطلب دیگری حل شده است. ابتدا وضعیت بررسی را دوباره باز کنید."
    );
  }

  /*
   * ==========================================
   * Load Knowledge Item
   * ==========================================
   */

  let knowledgeItem:
    RecordModel;

  try {
    knowledgeItem =
      await pb
        .collection(
          "knowledge_items"
        )
        .getOne(
          knowledgeItemId,
          {
            fields: [
              "id",
              "title",
              "status",
              "sync_status",
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
      return apiError(
        requestId,
        404,
        "KNOWLEDGE_ITEM_NOT_FOUND",
        "مطلب پایگاه دانش پیدا نشد."
      );
    }

    console.error(
      "Feedback resolve knowledge lookup failed",
      {
        requestId,

        adminId:
          admin.account.id,

        feedbackId,

        knowledgeItemId,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return apiError(
      requestId,
      503,
      "KNOWLEDGE_ITEM_LOOKUP_FAILED",
      "بررسی مطلب پایگاه دانش انجام نشد."
    );
  }

  const knowledgeTitle =
    String(
      knowledgeItem.title ||
        ""
    )
      .replace(
        /\s+/g,
        " "
      )
      .trim()
      .slice(
        0,
        300
      );

  /*
   * ==========================================
   * Knowledge State Guard
   *
   * Feedback فقط با Knowledge آماده استفاده
   * بسته می‌شود.
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

      feedbackId,

      result:
        "blocked",

      errorCode:
        "KNOWLEDGE_ITEM_NOT_PUBLISHED",

      metadata: {
        previous_status:
          previousStatus,

        knowledge_item_id:
          knowledgeItemId,

        knowledge_title:
          knowledgeTitle,

        knowledge_status:
          String(
            knowledgeItem.status ||
              ""
          ),

        knowledge_sync_status:
          String(
            knowledgeItem.sync_status ||
              ""
          ),
      },
    });

    return apiError(
      requestId,
      409,
      "KNOWLEDGE_ITEM_NOT_PUBLISHED",
      "برای حل بازخورد، مطلب باید ابتدا منتشر شود."
    );
  }

  if (
    knowledgeItem.sync_status !==
    "synced"
  ) {
    await safeAudit({
      request,

      requestId,

      actorId:
        admin.account.id,

      feedbackId,

      result:
        "blocked",

      errorCode:
        "KNOWLEDGE_ITEM_NOT_SYNCED",

      metadata: {
        previous_status:
          previousStatus,

        knowledge_item_id:
          knowledgeItemId,

        knowledge_title:
          knowledgeTitle,

        knowledge_status:
          "published",

        knowledge_sync_status:
          String(
            knowledgeItem.sync_status ||
              ""
          ),
      },
    });

    return apiError(
      requestId,
      409,
      "KNOWLEDGE_ITEM_NOT_SYNCED",
      "مطلب منتشر شده اما هنوز همگام‌سازی موفق با پایگاه دانش AI ندارد."
    );
  }

  /*
   * ==========================================
   * Resolve
   * ==========================================
   */

  const resolvedAt =
    new Date()
      .toISOString();

  const existingReviewNote =
    String(
      feedback.review_note ||
        ""
    )
      .replace(
        /\s+/g,
        " "
      )
      .trim();

  const generatedNote =
    knowledgeTitle
      ? `با انتشار مطلب «${knowledgeTitle}» در پایگاه دانش رفع شد.`
      : "با انتشار مطلب اصلاحی در پایگاه دانش رفع شد.";

  const reviewNote =
    existingReviewNote ||
    generatedNote;

  let updated:
    RecordModel;

  try {
    updated =
      await pb
        .collection(
          "message_feedback"
        )
        .update(
          feedback.id,
          {
            review_status:
              "resolved",

            review_note:
              reviewNote,

            reviewed_by:
              admin.account.id,

            reviewed_at:
              resolvedAt,

            resolved_knowledge_item:
              knowledgeItem.id,
          }
        );
  } catch (error) {
    console.error(
      "Feedback resolve update failed",
      {
        requestId,

        adminId:
          admin.account.id,

        feedbackId,

        knowledgeItemId,

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

      feedbackId,

      result:
        "failure",

      errorCode:
        "FEEDBACK_RESOLVE_FAILED",

      metadata: {
        previous_status:
          previousStatus,

        knowledge_item_id:
          knowledgeItemId,

        knowledge_title:
          knowledgeTitle,

        knowledge_status:
          "published",

        knowledge_sync_status:
          "synced",

        error:
          safeErrorMetadata(
            error
          ),
      },
    });

    return apiError(
      requestId,
      503,
      "FEEDBACK_RESOLVE_FAILED",
      "بستن بازخورد با مطلب اصلاحی انجام نشد."
    );
  }

  /*
   * ==========================================
   * Audit Success
   * ==========================================
   */

  await safeAudit({
    request,

    requestId,

    actorId:
      admin.account.id,

    feedbackId,

    result:
      "success",

    metadata: {
      previous_status:
        previousStatus,

      new_status:
        "resolved",

      knowledge_item_id:
        knowledgeItem.id,

      knowledge_title:
        knowledgeTitle,

      knowledge_status:
        "published",

      knowledge_sync_status:
        "synced",

      resolved_at:
        resolvedAt,
    },
  });

  /*
   * ==========================================
   * Response
   * ==========================================
   */

  return apiSuccess(
    requestId,
    {
      alreadyResolved:
        false,

      feedback: {
        id:
          updated.id,

        reviewStatus:
          "resolved",

        reviewNote:
          String(
            updated.review_note ||
              reviewNote
          ),

        resolvedKnowledgeItem:
          String(
            updated.resolved_knowledge_item ||
              knowledgeItem.id
          ),

        reviewedBy:
          String(
            updated.reviewed_by ||
              admin.account.id
          ),

        reviewedAt:
          String(
            updated.reviewed_at ||
              resolvedAt
          ),
      },

      knowledgeItem: {
        id:
          knowledgeItem.id,

        title:
          knowledgeTitle,

        status:
          "published",

        syncStatus:
          "synced",
      },
    }
  );
}

/*
 * ============================================
 * Request Body
 * ============================================
 */

function getKnowledgeItemId(
  body:
    unknown
) {
  if (
    typeof body !==
      "object" ||
    body ===
      null ||
    Array.isArray(
      body
    ) ||
    !(
      "knowledgeItemId" in
      body
    )
  ) {
    return "";
  }

  return cleanRecordId(
    (
      body as {
        knowledgeItemId?:
          unknown;
      }
    ).knowledgeItemId
  );
}

/*
 * ============================================
 * Review Status
 * ============================================
 */

function normalizeReviewStatus(
  value:
    unknown
):
  | "new"
  | "in_progress"
  | "resolved"
  | "ignored" {
  if (
    value ===
      "in_progress" ||
    value ===
      "resolved" ||
    value ===
      "ignored"
  ) {
    return value;
  }

  return "new";
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
        "INVALID_JSON",

      message:
        "ساختار درخواست معتبر نیست.",
    };
  }

  const reader =
    request.body.getReader();

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
        "INVALID_JSON",

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
        "INVALID_JSON",

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
        "INVALID_JSON",

      message:
        "ساختار درخواست معتبر نیست.",
    };
  }
}

/*
 * ============================================
 * Audit
 * ============================================
 */

async function safeAudit({
  request,
  requestId,
  actorId,
  feedbackId,
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

  feedbackId:
    string;

  result:
    | "success"
    | "failure"
    | "blocked";

  errorCode?:
    string;

  metadata:
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

      action:
        "feedback.resolve_with_knowledge",

      result,

      entityType:
        "message_feedback",

      entityId:
        feedbackId,

      ...(errorCode
        ? {
            errorCode,
          }
        : {}),

      metadata,
    });
  } catch (error) {
    console.error(
      "Feedback resolve audit failed",
      {
        requestId,

        actorId,

        feedbackId,

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
 * Responses
 * ============================================
 */

function apiSuccess(
  requestId:
    string,

  data:
    Record<
      string,
      unknown
    >
) {
  return NextResponse.json(
    {
      success:
        true,

      ...data,

      requestId,
    },
    {
      status:
        200,

      headers: {
        "X-Request-Id":
          requestId,

        "Cache-Control":
          "no-store",

        "Pragma":
          "no-cache",
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
    string
) {
  return NextResponse.json(
    {
      success:
        false,

      code,

      message,

      requestId,
    },
    {
      status,

      headers: {
        "X-Request-Id":
          requestId,

        "Cache-Control":
          "no-store",

        "Pragma":
          "no-cache",
      },
    }
  );
}

/*
 * ============================================
 * Error Helpers
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
