import type PocketBase from "pocketbase";

import {
  recordAuditLog,
} from "@/lib/audit/log";

import {
  consumeAdminRateLimit,
} from "@/lib/admin/rate-limit";

import {
  getAdminSession,
} from "@/lib/pocketbase/admin";

import {
  getPocketBaseServiceClient,
} from "@/lib/pocketbase/service";

const RECORD_ID_PATTERN =
  /^[a-zA-Z0-9_-]{1,64}$/;

const MAX_NOTE_LENGTH =
  1_000;

type Context = {
  params:
    Promise<{
      messageId:
        string;
    }>;
};

/*
 * ============================================
 * PATCH
 *
 * Human review / manual correction of a real
 * user-message classification.
 *
 * Original AI result is preserved in:
 * - classification_original_topic
 * - classification_original_status
 * - classification_original_confidence
 *
 * Final message fields are updated so Analytics
 * reflects the reviewed ground truth.
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

  const {
    messageId,
  } =
    await params;

  if (
    !isSafeId(
      messageId
    )
  ) {
    return apiError(
      requestId,
      400,
      "CLASSIFICATION_REVIEW_INVALID_MESSAGE_ID",
      "شناسه پیام معتبر نیست."
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
          "topic.classification_review_update",

        requestId,
      });

    if (
      !rateLimit.allowed
    ) {
      return apiError(
        requestId,
        429,
        rateLimit.code,
        "تعداد اصلاح‌های Classification بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.",
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
      "Classification review rate limit unavailable",
      {
        requestId,

        adminId:
          admin.account.id,

        messageId,

        error:
          errorMetadata(
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
   * Body
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
      "CLASSIFICATION_REVIEW_INVALID_JSON",
      "بدنه JSON درخواست معتبر نیست."
    );
  }

  const parsed =
    parseReviewBody(
      body
    );

  if (
    !parsed.ok
  ) {
    return apiError(
      requestId,
      400,
      parsed.code,
      parsed.message
    );
  }

  /*
   * ==========================================
   * PocketBase
   * ==========================================
   */

  let pb:
    PocketBase;

  try {
    pb =
      await getPocketBaseServiceClient();
  } catch (error) {
    console.error(
      "Classification review service unavailable",
      {
        requestId,

        adminId:
          admin.account.id,

        messageId,

        error:
          errorMetadata(
            error
          ),
      }
    );

    return apiError(
      requestId,
      503,
      "CLASSIFICATION_REVIEW_SERVICE_UNAVAILABLE",
      "سرویس اصلاح Classification موقتاً در دسترس نیست."
    );
  }

  /*
   * ==========================================
   * Load Message
   * ==========================================
   */

  let message;

  try {
    message =
      await pb
        .collection(
          "messages"
        )
        .getOne(
          messageId,
          {
            fields:
              [
                "id",
                "role",
                "topic",
                "topic_confidence",
                "classification_status",
                "classification_reviewed",
                "classification_reviewed_by",
                "classification_reviewed_at",
                "classification_review_note",
                "classification_review_source",
                "classification_original_topic",
                "classification_original_status",
                "classification_original_confidence",
              ].join(
                ","
              ),
          }
        );
  } catch (error) {
    if (
      getStatus(
        error
      ) ===
      404
    ) {
      return apiError(
        requestId,
        404,
        "CLASSIFICATION_REVIEW_MESSAGE_NOT_FOUND",
        "پیام موردنظر پیدا نشد."
      );
    }

    console.error(
      "Classification review message lookup failed",
      {
        requestId,

        adminId:
          admin.account.id,

        messageId,

        error:
          errorMetadata(
            error
          ),
      }
    );

    return apiError(
      requestId,
      503,
      "CLASSIFICATION_REVIEW_LOOKUP_FAILED",
      "دریافت اطلاعات پیام ناموفق بود."
    );
  }

  if (
    message.role !==
    "user"
  ) {
    return apiError(
      requestId,
      409,
      "CLASSIFICATION_REVIEW_USER_MESSAGE_REQUIRED",
      "فقط Classification پیام کاربر قابل بررسی است."
    );
  }

  /*
   * ==========================================
   * Validate Target Topic
   * ==========================================
   */

  let targetTopic:
    {
      id:
        string;

      name:
        string;
    } |
    null =
      null;

  if (
    parsed.topicId
  ) {
    try {
      const record =
        await pb
          .collection(
            "topics"
          )
          .getOne(
            parsed.topicId,
            {
              fields:
                "id,name,active",
            }
          );

      if (
        record.active !==
        true
      ) {
        return apiError(
          requestId,
          409,
          "CLASSIFICATION_REVIEW_TOPIC_INACTIVE",
          "موضوع مقصد باید فعال باشد."
        );
      }

      targetTopic = {
        id:
          record.id,

        name:
          String(
            record.name ||
              ""
          )
            .trim()
            .slice(
              0,
              160
            ),
      };
    } catch (error) {
      if (
        getStatus(
          error
        ) ===
        404
      ) {
        return apiError(
          requestId,
          404,
          "CLASSIFICATION_REVIEW_TOPIC_NOT_FOUND",
          "موضوع انتخاب‌شده پیدا نشد."
        );
      }

      console.error(
        "Classification review topic lookup failed",
        {
          requestId,

          adminId:
            admin.account.id,

          messageId,

          topicId:
            parsed.topicId,

          error:
            errorMetadata(
              error
            ),
        }
      );

      return apiError(
        requestId,
        503,
        "CLASSIFICATION_REVIEW_TOPIC_LOOKUP_FAILED",
        "بررسی موضوع انتخاب‌شده ناموفق بود."
      );
    }
  }

  /*
   * ==========================================
   * Preserve Original AI Classification
   * ==========================================
   */

  const wasReviewed =
    message.classification_reviewed ===
    true;

  const previousTopicId =
    cleanId(
      message.topic
    ) ||
    null;

  const previousStatus =
    cleanStatus(
      message.classification_status
    );

  const previousConfidence =
    clampConfidence(
      message.topic_confidence
    );

  const originalTopicId =
    wasReviewed
      ? cleanId(
          message.classification_original_topic
        ) ||
        null
      : previousTopicId;

  const originalStatus =
    wasReviewed
      ? cleanStatus(
          message.classification_original_status
        )
      : previousStatus;

  const originalConfidence =
    wasReviewed
      ? clampConfidence(
          message.classification_original_confidence
        )
      : previousConfidence;

  const correctedStatus =
    targetTopic
      ? "classified"
      : "unclassified";

  /*
   * Manual reviewed labels use:
   * - 1.0 for a human-confirmed Topic
   * - 0.0 for a human-confirmed Unclassified
   *
   * Original AI confidence is preserved separately.
   */
  const correctedConfidence =
    targetTopic
      ? 1
      : 0;

  /*
   * ==========================================
   * Update Message
   * ==========================================
   */

  const reviewedAt =
    new Date()
      .toISOString();

  try {
    await pb
      .collection(
        "messages"
      )
      .update(
        messageId,
        {
          topic:
            targetTopic?.id ||
            "",

          topic_confidence:
            correctedConfidence,

          classification_status:
            correctedStatus,

          classification_reviewed:
            true,

          classification_reviewed_by:
            admin.account.id,

          classification_reviewed_at:
            reviewedAt,

          classification_review_note:
            parsed.note,

          classification_review_source:
            parsed.source,

          classification_original_topic:
            originalTopicId ||
            "",

          classification_original_status:
            originalStatus,

          classification_original_confidence:
            originalConfidence,
        }
      );
  } catch (error) {
    console.error(
      "Classification review update failed",
      {
        requestId,

        adminId:
          admin.account.id,

        messageId,

        error:
          errorMetadata(
            error
          ),
      }
    );

    return apiError(
      requestId,
      503,
      "CLASSIFICATION_REVIEW_UPDATE_FAILED",
      "ذخیره اصلاح Classification ناموفق بود."
    );
  }

  /*
   * ==========================================
   * Audit
   * ==========================================
   */

  await recordAuditLog({
    action:
      "topic.classification_review_update",

    result:
      "success",

    actorId:
      admin.account.id,

    actorRole:
      "admin",

    entityType:
      "message",

    entityId:
      messageId,

    requestId,

    request,

    metadata: {
      manual_override:
        true,

      previous_topic_id:
        previousTopicId,

      previous_status:
        previousStatus,

      previous_confidence:
        previousConfidence,

      original_topic_id:
        originalTopicId,

      original_status:
        originalStatus,

      original_confidence:
        originalConfidence,

      corrected_topic_id:
        targetTopic?.id ||
        null,

      corrected_topic_name:
        targetTopic?.name ||
        null,

      corrected_status:
        correctedStatus,

      corrected_confidence:
        correctedConfidence,

      note_length:
        parsed.note.length,

      review_source:
        parsed.source,

      reviewed_at:
        reviewedAt,

      re_review:
        wasReviewed,
    },
  });

  return Response.json(
    {
      success:
        true,

      item: {
        messageId,

        topicId:
          targetTopic?.id ||
          null,

        topicName:
          targetTopic?.name ||
          null,

        classificationStatus:
          correctedStatus,

        confidence:
          correctedConfidence,

        reviewed:
          true,

        reviewedAt,

        original: {
          topicId:
            originalTopicId,

          status:
            originalStatus,

          confidence:
            originalConfidence,
        },
      },

      requestId,
    },
    {
      status:
        200,

      headers: {
        "Cache-Control":
          "no-store",

        "X-Request-Id":
          requestId,
      },
    }
  );
}

/*
 * ============================================
 * Body Parser
 * ============================================
 */

function parseReviewBody(
  value:
    unknown
):
  | {
      ok:
        true;

      topicId:
        string |
        null;

      note:
        string;

      source:
        "needs_review" |
        "quality_sample";
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
        "CLASSIFICATION_REVIEW_INVALID_BODY",

      message:
        "بدنه درخواست بررسی معتبر نیست.",
    };
  }

  const body =
    value as {
      topicId?:
        unknown;

      note?:
        unknown;

      source?:
        unknown;
    };

  let topicId:
    string |
    null =
      null;

  if (
    body.topicId !==
      null &&
    body.topicId !==
      undefined &&
    body.topicId !==
      ""
  ) {
    if (
      typeof body.topicId !==
      "string"
    ) {
      return {
        ok:
          false,

        code:
          "CLASSIFICATION_REVIEW_TOPIC_INVALID",

        message:
          "موضوع انتخاب‌شده معتبر نیست.",
      };
    }

    const cleaned =
      body.topicId
        .trim();

    if (
      !isSafeId(
        cleaned
      )
    ) {
      return {
        ok:
          false,

        code:
          "CLASSIFICATION_REVIEW_TOPIC_INVALID",

        message:
          "موضوع انتخاب‌شده معتبر نیست.",
      };
    }

    topicId =
      cleaned;
  }

  const note =
    typeof body.note ===
    "string"
      ? body.note
          .replace(
            /\r\n?/g,
            "\n"
          )
          .trim()
          .slice(
            0,
            MAX_NOTE_LENGTH
          )
      : "";

  const source =
    body.source ===
      "quality_sample"
      ? "quality_sample"
      : "needs_review";

  return {
    ok:
      true,

    topicId,

    note,

    source,
  };
}

/*
 * ============================================
 * Helpers
 * ============================================
 */

function isSafeId(
  value:
    string
) {
  return RECORD_ID_PATTERN.test(
    String(
      value ||
        ""
    ).trim()
  );
}

function cleanId(
  value:
    unknown
) {
  const id =
    String(
      value ||
        ""
    ).trim();

  return isSafeId(
    id
  )
    ? id
    : "";
}

function cleanStatus(
  value:
    unknown
) {
  const status =
    String(
      value ||
        ""
    );

  return status ===
      "classified" ||
    status ===
      "unclassified" ||
    status ===
      "error" ||
    status ===
      "pending"
    ? status
    : "unknown";
}

function clampConfidence(
  value:
    unknown
) {
  const number =
    Number(
      value
    );

  if (
    !Number.isFinite(
      number
    )
  ) {
    return 0;
  }

  return Math.min(
    1,
    Math.max(
      0,
      number
    )
  );
}

function getStatus(
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

        "X-Request-Id":
          requestId,

        ...(headers ||
          {}),
      },
    }
  );
}

function errorMetadata(
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
