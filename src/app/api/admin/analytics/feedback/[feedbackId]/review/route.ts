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
 * Limits
 * ============================================
 */

const MAX_REQUEST_BODY_BYTES =
  8 * 1024;

const MAX_REVIEW_NOTE_LENGTH =
  2000;

const RECORD_ID_PATTERN =
  /^[a-zA-Z0-9_-]{1,64}$/;

/*
 * ============================================
 * Types
 * ============================================
 */

type FeedbackReviewStatus =
  | "new"
  | "in_progress"
  | "resolved"
  | "ignored";

type ReviewPayload = {
  status:
    FeedbackReviewStatus;

  note:
    string;
};

/*
 * ============================================
 * GET
 *
 * دریافت جزئیات Feedback برای Review
 * ============================================
 */

export async function GET(
  _request:
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
      "Feedback review service unavailable",
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
      "FEEDBACK_REVIEW_SERVICE_UNAVAILABLE",
      "سرویس بررسی بازخورد موقتاً در دسترس نیست."
    );
  }

  /*
   * ==========================================
   * Feedback
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
            expand: [
              "message",
              "message.reply_to",
              "message.reply_to.topic",
              "message.user",
              "message.user.department",
              "message.sources",
              "resolved_knowledge_item",
            ].join(
              ","
            ),
          }
        );
  } catch (error) {
    const status =
      getErrorStatus(
        error
      );

    if (
      status ===
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
      "Feedback review load failed",
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
      "FEEDBACK_REVIEW_LOAD_FAILED",
      "دریافت اطلاعات بازخورد انجام نشد."
    );
  }

  /*
   * Review Workflow فقط برای Feedback منفی است.
   */

  if (
    feedback.rating !==
    "down"
  ) {
    return apiError(
      requestId,
      409,
      "NEGATIVE_FEEDBACK_REQUIRED",
      "فقط بازخورد منفی نیازمند فرایند بررسی است."
    );
  }

  return apiSuccess(
    requestId,
    {
      feedback:
        serializeFeedback(
          feedback
        ),
    }
  );
}

/*
 * ============================================
 * PATCH
 *
 * Update Review Status / Note
 * ============================================
 */

export async function PATCH(
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
   * Declared Body Size
   * ==========================================
   */

  const rawContentLength =
    request.headers.get(
      "content-length"
    );

  if (
    rawContentLength
  ) {
    const declaredLength =
      Number(
        rawContentLength
      );

    if (
      Number.isFinite(
        declaredLength
      ) &&
      declaredLength >
        MAX_REQUEST_BODY_BYTES
    ) {
      return apiError(
        requestId,
        413,
        "REQUEST_BODY_TOO_LARGE",
        "حجم درخواست بیش از حد مجاز است."
      );
    }
  }

  /*
   * ==========================================
   * Bounded JSON Body
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

  /*
   * ==========================================
   * Review Payload
   * ==========================================
   */

  const reviewResult =
    parseReviewPayload(
      parsedBody.body
    );

  if (
    !reviewResult.ok
  ) {
    return apiError(
      requestId,
      400,
      reviewResult.code,
      reviewResult.message
    );
  }

  const review =
    reviewResult.review;

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
      "Feedback review service unavailable",
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
      "FEEDBACK_REVIEW_SERVICE_UNAVAILABLE",
      "سرویس بررسی بازخورد موقتاً در دسترس نیست."
    );
  }

  /*
   * ==========================================
   * Existing Feedback
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
          feedbackId
        );
  } catch (error) {
    const status =
      getErrorStatus(
        error
      );

    if (
      status ===
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
      "Feedback review lookup failed",
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
      "FEEDBACK_REVIEW_LOOKUP_FAILED",
      "بررسی بازخورد انجام نشد."
    );
  }

  /*
   * Review Workflow فقط برای Feedback منفی است.
   */

  if (
    feedback.rating !==
    "down"
  ) {
    return apiError(
      requestId,
      409,
      "NEGATIVE_FEEDBACK_REQUIRED",
      "فقط بازخورد منفی نیازمند فرایند بررسی است."
    );
  }

  const previousReviewStatus =
    normalizeReviewStatus(
      feedback.review_status
    ) ||
    "new";

  const previousReviewNote =
    String(
      feedback.review_note ||
        ""
    ).trim();

  const previousResolvedKnowledgeItemId =
    cleanRecordId(
      feedback.resolved_knowledge_item
    );

  /*
   * ==========================================
   * Review State
   *
   * new:
   *   Reviewer/Time پاک می‌شود.
   *
   * in_progress / resolved / ignored:
   *   Admin فعلی و زمان اقدام ثبت می‌شود.
   * ==========================================
   */

  const now =
    new Date()
      .toISOString();

  const updateData:
    Record<
      string,
      unknown
    > = {
    review_status:
      review.status,

    review_note:
      review.note,
  };

  if (
    review.status ===
    "new"
  ) {
    updateData.reviewed_by =
      "";

    updateData.reviewed_at =
      "";
  } else {
    updateData.reviewed_by =
      admin.account.id;

    updateData.reviewed_at =
      now;
  }

  /*
   * resolved_knowledge_item فقط وقتی معتبر است
   * که خود Review در وضعیت resolved باشد.
   *
   * با بازکردن مجدد Feedback یا Ignore کردن آن،
   * Relation قبلی پاک می‌شود تا وضعیت ناسازگار
   * در دیتابیس باقی نماند.
   */
  if (
    review.status !==
    "resolved"
  ) {
    updateData.resolved_knowledge_item =
      "";
  }

  /*
   * ==========================================
   * Update
   * ==========================================
   */

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
          updateData,
          {
            expand: [
              "message",
              "message.reply_to",
              "message.reply_to.topic",
              "message.user",
              "message.user.department",
              "message.sources",
              "resolved_knowledge_item",
            ].join(
              ","
            ),
          }
        );
  } catch (error) {
    console.error(
      "Feedback review update failed",
      {
        requestId,

        adminId:
          admin.account.id,

        feedbackId,

        requestedStatus:
          review.status,

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
        "FEEDBACK_REVIEW_UPDATE_FAILED",

      metadata: {
        previous_status:
          previousReviewStatus,

        requested_status:
          review.status,

        note_changed:
          previousReviewNote !==
          review.note,

        previous_note_length:
          previousReviewNote.length,

        requested_note_length:
          review.note.length,

        previous_resolved_knowledge_item_id:
          previousResolvedKnowledgeItemId ||
          undefined,

        resolved_knowledge_relation_cleared:
          Boolean(
            previousResolvedKnowledgeItemId &&
            review.status !==
              "resolved"
          ),

        error:
          safeErrorMetadata(
            error
          ),
      },
    });

    return apiError(
      requestId,
      503,
      "FEEDBACK_REVIEW_UPDATE_FAILED",
      "به‌روزرسانی وضعیت بررسی بازخورد انجام نشد."
    );
  }

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
        previousReviewStatus,

      next_status:
        review.status,

      status_changed:
        previousReviewStatus !==
        review.status,

      note_changed:
        previousReviewNote !==
        review.note,

      previous_note_length:
        previousReviewNote.length,

      next_note_length:
        review.note.length,

      previous_resolved_knowledge_item_id:
        previousResolvedKnowledgeItemId ||
        undefined,

      resolved_knowledge_relation_cleared:
        Boolean(
          previousResolvedKnowledgeItemId &&
          review.status !==
            "resolved"
        ),
    },
  });

  /*
   * ==========================================
   * Success
   * ==========================================
   */

  return apiSuccess(
    requestId,
    {
      feedback:
        serializeFeedback(
          updated
        ),
    }
  );
}

/*
 * ============================================
 * Review Payload
 * ============================================
 */

function parseReviewPayload(
  value:
    unknown
):
  | {
      ok:
        true;

      review:
        ReviewPayload;
    }
  | {
      ok:
        false;

      code:
        string;

      message:
        string;
    } {
  if (
    typeof value !==
      "object" ||
    value ===
      null ||
    Array.isArray(
      value
    )
  ) {
    return {
      ok:
        false,

      code:
        "INVALID_REVIEW_BODY",

      message:
        "ساختار اطلاعات بررسی معتبر نیست.",
    };
  }

  const source =
    value as {
      status?:
        unknown;

      note?:
        unknown;
    };

  const status =
    normalizeReviewStatus(
      source.status
    );

  if (
    !status
  ) {
    return {
      ok:
        false,

      code:
        "INVALID_REVIEW_STATUS",

      message:
        "وضعیت بررسی معتبر نیست.",
    };
  }

  const noteResult =
    normalizeReviewNote(
      source.note
    );

  if (
    !noteResult.ok
  ) {
    return noteResult;
  }

  /*
   * برای resolved و ignored یادداشت اجباری است
   * تا تصمیم مدیریتی بدون توضیح ثبت نشود.
   */

  if (
    (
      status ===
        "resolved" ||
      status ===
        "ignored"
    ) &&
    !noteResult.note
  ) {
    return {
      ok:
        false,

      code:
        "REVIEW_NOTE_REQUIRED",

      message:
        "برای بستن یا نادیده گرفتن بازخورد، ثبت توضیح الزامی است.",
    };
  }

  return {
    ok:
      true,

    review: {
      status,

      note:
        noteResult.note,
    },
  };
}

function normalizeReviewStatus(
  value:
    unknown
):
  | FeedbackReviewStatus
  | null {
  if (
    value ===
      "new" ||
    value ===
      "in_progress" ||
    value ===
      "resolved" ||
    value ===
      "ignored"
  ) {
    return value;
  }

  return null;
}

function normalizeReviewNote(
  value:
    unknown
):
  | {
      ok:
        true;

      note:
        string;
    }
  | {
      ok:
        false;

      code:
        string;

      message:
        string;
    } {
  if (
    value ===
      undefined ||
    value ===
      null
  ) {
    return {
      ok:
        true,

      note:
        "",
    };
  }

  if (
    typeof value !==
    "string"
  ) {
    return {
      ok:
        false,

      code:
        "INVALID_REVIEW_NOTE",

      message:
        "متن توضیح بررسی معتبر نیست.",
    };
  }

  const note =
    value
      .replace(
        /[\u0000-\u001f\u007f]/g,
        " "
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim();

  if (
    note.length >
    MAX_REVIEW_NOTE_LENGTH
  ) {
    return {
      ok:
        false,

      code:
        "REVIEW_NOTE_TOO_LONG",

      message:
        `حداکثر طول توضیح بررسی ${MAX_REVIEW_NOTE_LENGTH} کاراکتر است.`,
    };
  }

  return {
    ok:
      true,

    note,
  };
}

/*
 * ============================================
 * Audit
 *
 * شکست Audit نباید عملیات اصلی Review را
 * Rollback کند.
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
    | "failure";

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
        "feedback.review",

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
      "Feedback review audit failed",
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
 * Serializer
 * ============================================
 */

function serializeFeedback(
  feedback:
    RecordModel
) {
  const message =
    getExpandedOne(
      feedback,
      "message"
    );

  const userMessage =
    message
      ? getExpandedOne(
          message,
          "reply_to"
        )
      : undefined;

  const topic =
    userMessage
      ? getExpandedOne(
          userMessage,
          "topic"
        )
      : undefined;

  const user =
    message
      ? getExpandedOne(
          message,
          "user"
        )
      : undefined;

  const department =
    user
      ? getExpandedOne(
          user,
          "department"
        )
      : undefined;

  const sources =
    message
      ? getExpandedMany(
          message,
          "sources"
        )
      : [];

  const resolvedKnowledgeItem =
    getExpandedOne(
      feedback,
      "resolved_knowledge_item"
    );

  return {
    id:
      feedback.id,

    rating:
      feedback.rating ===
      "down"
        ? "down"
        : "up",

    reasons:
      normalizeStringList(
        feedback.reasons
      ),

    comment:
      String(
        feedback.comment ||
          ""
      ),

    reviewStatus:
      normalizeReviewStatus(
        feedback.review_status
      ) ||
      "new",

    reviewNote:
      String(
        feedback.review_note ||
          ""
      ),

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

    resolvedKnowledgeItem:
      resolvedKnowledgeItem
        ? {
            id:
              String(
                resolvedKnowledgeItem.id ||
                  ""
              ),

            title:
              String(
                resolvedKnowledgeItem.title ||
                  ""
              ),

            status:
              String(
                resolvedKnowledgeItem.status ||
                  ""
              ),

            syncStatus:
              String(
                resolvedKnowledgeItem.sync_status ||
                  ""
              ),
          }
        : feedback.resolved_knowledge_item
          ? {
              id:
                String(
                  feedback.resolved_knowledge_item
                ),

              title:
                "",
              status:
                "",
              syncStatus:
                "",
            }
          : undefined,

    created:
      String(
        feedback.created ||
          ""
      ),

    updated:
      String(
        feedback.updated ||
          ""
      ),

    message:
      message
        ? {
            id:
              message.id,

            conversationId:
              String(
                message.conversation ||
                  ""
              ),

            answer:
              String(
                message.content ||
                  ""
              ),

            question:
              String(
                userMessage?.content ||
                  ""
              ),

            topicId:
              String(
                topic?.id ||
                  userMessage?.topic ||
                  ""
              ) ||
              undefined,

            topicName:
              String(
                topic?.name ||
                  ""
              ) ||
              undefined,

            userId:
              String(
                message.user ||
                  user?.id ||
                  ""
              ) ||
              undefined,

            userName:
              String(
                user?.name ||
                  user?.email ||
                  ""
              ) ||
              undefined,

            employeeCode:
              String(
                user?.employee_code ||
                  ""
              ) ||
              undefined,

            departmentName:
              String(
                department?.name ||
                  ""
              ) ||
              undefined,

            sources:
              sources
                .map(
                  (
                    source
                  ) => ({
                    id:
                      String(
                        source.id ||
                          ""
                      ),

                    title:
                      String(
                        source.title ||
                          ""
                      ),
                  })
                )
                .filter(
                  (
                    source
                  ) =>
                    Boolean(
                      source.id &&
                        source.title
                    )
                ),
          }
        : undefined,
  };
}

/*
 * ============================================
 * Expanded Record Helpers
 * ============================================
 */

function getExpandedOne(
  record:
    RecordModel,

  key:
    string
):
  | RecordModel
  | undefined {
  const expand =
    record.expand as
      | Record<
          string,
          unknown
        >
      | undefined;

  const value =
    expand?.[key];

  if (
    !value ||
    Array.isArray(
      value
    ) ||
    typeof value !==
      "object"
  ) {
    return undefined;
  }

  return value as
    RecordModel;
}

function getExpandedMany(
  record:
    RecordModel,

  key:
    string
):
  RecordModel[] {
  const expand =
    record.expand as
      | Record<
          string,
          unknown
        >
      | undefined;

  const value =
    expand?.[key];

  if (
    !value
  ) {
    return [];
  }

  if (
    Array.isArray(
      value
    )
  ) {
    return value.filter(
      (
        item
      ): item is RecordModel =>
        typeof item ===
          "object" &&
        item !==
          null
    );
  }

  if (
    typeof value ===
    "object"
  ) {
    return [
      value as
        RecordModel,
    ];
  }

  return [];
}

/*
 * ============================================
 * String List
 * ============================================
 */

function normalizeStringList(
  value:
    unknown
) {
  if (
    Array.isArray(
      value
    )
  ) {
    return value
      .map(
        (
          item
        ) =>
          String(
            item ||
              ""
          ).trim()
      )
      .filter(
        Boolean
      );
  }

  if (
    typeof value ===
    "string"
  ) {
    return value
      .split(
        ","
      )
      .map(
        (
          item
        ) =>
          item.trim()
      )
      .filter(
        Boolean
      );
  }

  return [];
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
          // Ignore cancel error.
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
 * Success Response
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

/*
 * ============================================
 * Error Response
 * ============================================
 */

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
