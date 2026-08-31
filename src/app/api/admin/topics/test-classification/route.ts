import {
  recordAuditLog,
} from "@/lib/audit/log";

import {
  consumeAdminRateLimit,
} from "@/lib/admin/rate-limit";

import {
  previewTopicClassification,
  type ClassificationContextMessage,
  type TopicClassificationPreviewTopicOverride,
} from "@/lib/ai/classification";

import {
  getAdminSession,
} from "@/lib/pocketbase/admin";

const MAX_QUESTION_LENGTH =
  4_000;

const MAX_CONTEXT_LENGTH =
  300;

const MAX_CONTEXT_MESSAGES =
  4;

const MAX_OVERRIDE_KEYWORDS_LENGTH =
  1_000;

const MAX_OVERRIDE_EXAMPLES_LENGTH =
  4_000;

const MAX_OVERRIDE_NEGATIVE_EXAMPLES_LENGTH =
  4_000;

const MAX_OVERRIDE_CLASSIFICATION_NOTE_LENGTH =
  2_000;

const RECORD_ID_PATTERN =
  /^[a-zA-Z0-9_-]{1,64}$/;

export async function POST(
  request:
    Request
) {
  const requestId =
    crypto.randomUUID();

  const admin =
    await getAdminSession();

  if (!admin.ok) {
    return apiError(
      requestId,
      admin.status,
      admin.code,
      admin.message
    );
  }

  try {
    const rateLimit =
      await consumeAdminRateLimit({
        adminId:
          admin.account.id,

        action:
          "topic.classification_test",

        requestId,
      });

    if (!rateLimit.allowed) {
      return apiError(
        requestId,
        429,
        rateLimit.code,
        "تعداد تست‌های طبقه‌بندی بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.",
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
      "Classification test rate limit unavailable",
      {
        requestId,
        adminId:
          admin.account.id,
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

  let body:
    unknown;

  try {
    body =
      await request.json();
  } catch {
    return apiError(
      requestId,
      400,
      "CLASSIFICATION_TEST_INVALID_JSON",
      "بدنه JSON درخواست معتبر نیست."
    );
  }

  const parsed =
    parseRequest(
      body
    );

  if (!parsed.ok) {
    return apiError(
      requestId,
      400,
      parsed.code,
      parsed.message
    );
  }

  try {
    const result =
      await previewTopicClassification({
        question:
          parsed.question,

        context:
          parsed.context,

        topicOverride:
          parsed.topicOverride,
      });

    await recordAuditLog({
      action:
        "topic.classification_test",

      result:
        "success",

      actorId:
        admin.account.id,

      actorRole:
        "admin",

      entityType:
        "topic",

      requestId,

      request,

      metadata: {
        question_length:
          parsed.question.length,

        context_messages:
          parsed.context.length,

        preview_override:
          Boolean(
            parsed.topicOverride
          ),

        preview_override_topic_id:
          parsed.topicOverride
            ?.topicId ||
          null,

        classification_status:
          result.status,

        topic_id:
          result.topicId,

        suggested_topic_id:
          result.suggestedTopicId,

        confidence:
          result.confidence,

        threshold:
          result.threshold,

        candidate_count:
          result.candidateCount,

        model:
          String(
            result.model ||
              ""
          )
            .trim()
            .slice(
              0,
              120
            ),
      },
    });

    return Response.json(
      {
        success:
          true,

        result,

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
  } catch (error) {
    const metadata =
      errorMetadata(
        error
      );

    console.error(
      "Classification test failed",
      {
        requestId,
        adminId:
          admin.account.id,
        error:
          metadata,
      }
    );

    await recordAuditLog({
      action:
        "topic.classification_test",

      result:
        "failure",

      actorId:
        admin.account.id,

      actorRole:
        "admin",

      entityType:
        "topic",

      requestId,

      request,

      errorCode:
        "CLASSIFICATION_TEST_FAILED",

      metadata: {
        question_length:
          parsed.question.length,

        context_messages:
          parsed.context.length,

        preview_override:
          Boolean(
            parsed.topicOverride
          ),

        preview_override_topic_id:
          parsed.topicOverride
            ?.topicId ||
          null,
      },
    });

    return apiError(
      requestId,
      metadata.status ===
        429
        ? 429
        : 503,
      metadata.status ===
        429
        ? "OPENAI_RATE_LIMITED"
        : "CLASSIFICATION_TEST_FAILED",
      metadata.status ===
        429
        ? "ظرفیت سرویس هوش مصنوعی موقتاً تکمیل است."
        : "اجرای تست طبقه‌بندی ناموفق بود."
    );
  }
}

function parseRequest(
  value:
    unknown
):
  | {
      ok:
        true;

      question:
        string;

      context:
        ClassificationContextMessage[];

      topicOverride?:
        TopicClassificationPreviewTopicOverride;
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
        "CLASSIFICATION_TEST_INVALID_BODY",

      message:
        "بدنه درخواست تست معتبر نیست.",
    };
  }

  const body =
    value as {
      question?:
        unknown;

      context?:
        unknown;

      topicOverride?:
        unknown;
    };

  const question =
    typeof body.question ===
    "string"
      ? body.question
          .trim()
          .slice(
            0,
            MAX_QUESTION_LENGTH
          )
      : "";

  if (!question) {
    return {
      ok:
        false,

      code:
        "CLASSIFICATION_TEST_QUESTION_REQUIRED",

      message:
        "سؤال آزمایشی الزامی است.",
    };
  }

  const context:
    ClassificationContextMessage[] = [];

  if (
    Array.isArray(
      body.context
    )
  ) {
    for (
      const raw of
      body.context.slice(
        -MAX_CONTEXT_MESSAGES
      )
    ) {
      if (
        typeof raw !==
          "object" ||
        raw ===
          null ||
        Array.isArray(
          raw
        )
      ) {
        continue;
      }

      const item =
        raw as {
          role?:
            unknown;

          content?:
            unknown;
        };

      const content =
        typeof item.content ===
        "string"
          ? item.content
              .trim()
              .slice(
                0,
                MAX_CONTEXT_LENGTH
              )
          : "";

      if (!content) {
        continue;
      }

      context.push({
        role:
          item.role ===
          "assistant"
            ? "assistant"
            : "user",

        content,
      });
    }
  }

  const topicOverride =
    parseTopicOverride(
      body.topicOverride
    );

  if (
    topicOverride &&
    "error" in
      topicOverride
  ) {
    return {
      ok:
        false,

      code:
        "CLASSIFICATION_TEST_OVERRIDE_INVALID",

      message:
        topicOverride.error,
    };
  }

  return {
    ok:
      true,

    question,

    context,

    topicOverride:
      topicOverride ||
      undefined,
  };
}

function parseTopicOverride(
  value:
    unknown
):
  | TopicClassificationPreviewTopicOverride
  | {
      error:
        string;
    }
  | null {
  if (
    value ===
      undefined ||
    value ===
      null
  ) {
    return null;
  }

  if (
    typeof value !==
      "object" ||
    Array.isArray(
      value
    )
  ) {
    return {
      error:
        "ساختار Guidance آزمایشی معتبر نیست.",
    };
  }

  const source =
    value as {
      topicId?:
        unknown;

      keywords?:
        unknown;

      examples?:
        unknown;

      negativeExamples?:
        unknown;

      classificationNote?:
        unknown;
    };

  const topicId =
    typeof source.topicId ===
      "string"
      ? source.topicId
          .trim()
      : "";

  if (
    !RECORD_ID_PATTERN.test(
      topicId
    )
  ) {
    return {
      error:
        "شناسه Topic برای Guidance آزمایشی معتبر نیست.",
    };
  }

  return {
    topicId,

    keywords:
      cleanOverrideText(
        source.keywords,
        MAX_OVERRIDE_KEYWORDS_LENGTH
      ),

    examples:
      cleanOverrideText(
        source.examples,
        MAX_OVERRIDE_EXAMPLES_LENGTH
      ),

    negativeExamples:
      cleanOverrideText(
        source.negativeExamples,
        MAX_OVERRIDE_NEGATIVE_EXAMPLES_LENGTH
      ),

    classificationNote:
      cleanOverrideText(
        source.classificationNote,
        MAX_OVERRIDE_CLASSIFICATION_NOTE_LENGTH
      ),
  };
}

function cleanOverrideText(
  value:
    unknown,

  maxLength:
    number
) {
  return typeof value ===
    "string"
    ? value
        .replace(
          /\r\n?/g,
          "\n"
        )
        .trim()
        .slice(
          0,
          maxLength
        )
    : "";
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
