import {
  NextResponse,
} from "next/server";

import type PocketBase from "pocketbase";

import type {
  RecordModel,
} from "pocketbase";

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

const MAX_FEEDBACK_REASONS =
  3;

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

type ConversationDetailMessage = {
  id:
    string;

  role:
    "user" |
    "assistant";

  content:
    string;

  created:
    string;

  replyTo?:
    string;

  topic?: {
    id:
      string;

    name:
      string;
  };

  topicConfidence?:
    number;

  classificationStatus?:
    string;

  hasAnswer?:
    boolean;

  model?:
    string;

  responseTimeMs?:
    number;

  openAIResponseId?:
    string;

  sources:
    Array<{
      id:
        string;

      title:
        string;
    }>;

  feedback?: {
    id:
      string;

    rating:
      "up" |
      "down";

    reasons:
      string[];

    comment?:
      string;

    reviewStatus:
      FeedbackReviewStatus;

    reviewNote?:
      string;

    reviewedBy?:
      string;

    reviewedAt?:
      string;

    resolvedKnowledgeItem?: {
      id:
        string;

      title:
        string;
    };

    created:
      string;

    updated:
      string;
  };
};

/*
 * ============================================
 * GET
 *
 * Admin Conversation Detail
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
        conversationId:
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
   * Conversation ID
   * ==========================================
   */

  const {
    conversationId:
      rawConversationId,
  } = await params;

  const conversationId =
    cleanRecordId(
      rawConversationId
    );

  if (
    !conversationId
  ) {
    return apiError(
      requestId,
      400,
      "INVALID_CONVERSATION_ID",
      "شناسه گفتگو معتبر نیست."
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
      "Admin conversation detail service unavailable",
      {
        requestId,

        adminId:
          admin.account.id,

        conversationId,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return apiError(
      requestId,
      503,
      "CONVERSATION_DETAIL_SERVICE_UNAVAILABLE",
      "سرویس جزئیات مکالمه موقتاً در دسترس نیست."
    );
  }

  /*
   * ==========================================
   * Conversation
   * ==========================================
   */

  let conversation:
    RecordModel;

  try {
    conversation =
      await pb
        .collection(
          "conversations"
        )
        .getOne(
          conversationId,
          {
            expand:
              "user,user.department",
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
        "CONVERSATION_NOT_FOUND",
        "گفتگو پیدا نشد."
      );
    }

    console.error(
      "Admin conversation detail load failed",
      {
        requestId,

        adminId:
          admin.account.id,

        conversationId,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return apiError(
      requestId,
      503,
      "CONVERSATION_DETAIL_LOAD_FAILED",
      "دریافت اطلاعات گفتگو انجام نشد."
    );
  }

  /*
   * ==========================================
   * Messages
   * ==========================================
   */

  let messages:
    RecordModel[];

  try {
    messages =
      await pb
        .collection(
          "messages"
        )
        .getFullList({
          filter:
            pb.filter(
              "conversation = {:conversationId}",
              {
                conversationId,
              }
            ),

          sort:
            "created",

          expand:
            "topic,sources",
        });
  } catch (error) {
    console.error(
      "Admin conversation messages load failed",
      {
        requestId,

        adminId:
          admin.account.id,

        conversationId,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return apiError(
      requestId,
      503,
      "CONVERSATION_MESSAGES_LOAD_FAILED",
      "دریافت پیام‌های گفتگو انجام نشد."
    );
  }

  /*
   * ==========================================
   * Feedback
   * ==========================================
   */

  const assistantMessageIds =
    messages
      .filter(
        (
          message
        ) =>
          message.role ===
          "assistant"
      )
      .map(
        (
          message
        ) =>
          cleanRecordId(
            message.id
          )
      )
      .filter(
        Boolean
      );

  let feedbackRecords:
    RecordModel[] =
      [];

  if (
    assistantMessageIds.length >
    0
  ) {
    try {
      feedbackRecords =
        await pb
          .collection(
            "message_feedback"
          )
          .getFullList({
            filter:
              buildIdOrFilter(
                pb,
                "message",
                assistantMessageIds,
                "message"
              ),

            sort:
              "created",

            expand:
              "resolved_knowledge_item",
          });
    } catch (error) {
      console.error(
        "Admin conversation feedback load failed",
        {
          requestId,

          adminId:
            admin.account.id,

          conversationId,

          error:
            safeErrorMetadata(
              error
            ),
        }
      );

      return apiError(
        requestId,
        503,
        "CONVERSATION_FEEDBACK_LOAD_FAILED",
        "دریافت بازخوردهای گفتگو انجام نشد."
      );
    }
  }

  const feedbackByMessage =
    new Map<
      string,
      RecordModel
    >();

  for (
    const feedback of
    feedbackRecords
  ) {
    const messageId =
      cleanRecordId(
        feedback.message
      );

    if (
      messageId
    ) {
      feedbackByMessage.set(
        messageId,
        feedback
      );
    }
  }

  /*
   * ==========================================
   * Serialize
   * ==========================================
   */

  const user =
    getExpandedOne(
      conversation,
      "user"
    );

  const department =
    user
      ? getExpandedOne(
          user,
          "department"
        )
      : undefined;

  const serializedMessages:
    ConversationDetailMessage[] =
      messages
        .filter(
          (
            message
          ) =>
            message.role ===
              "user" ||
            message.role ===
              "assistant"
        )
        .map(
          (
            message
          ) =>
            serializeMessage(
              message,
              feedbackByMessage.get(
                message.id
              )
            )
        );

  const assistantMessages =
    serializedMessages.filter(
      (
        message
      ) =>
        message.role ===
        "assistant"
    );

  const userMessages =
    serializedMessages.filter(
      (
        message
      ) =>
        message.role ===
        "user"
    );

  const noAnswerCount =
    assistantMessages.filter(
      (
        message
      ) =>
        message.hasAnswer ===
        false
    ).length;

  const negativeFeedbackCount =
    assistantMessages.filter(
      (
        message
      ) =>
        message.feedback
          ?.rating ===
        "down"
    ).length;

  const openNegativeFeedbackCount =
    assistantMessages.filter(
      (
        message
      ) =>
        message.feedback
          ?.rating ===
          "down" &&
        (
          message.feedback
            .reviewStatus ===
            "new" ||
          message.feedback
            .reviewStatus ===
            "in_progress"
        )
    ).length;

  return apiSuccess(
    requestId,
    {
      conversation: {
        id:
          conversation.id,

        title:
          String(
            conversation.title ||
              "گفتگوی بدون عنوان"
          ),

        status:
          String(
            conversation.status ||
              ""
          ),

        created:
          String(
            conversation.created ||
              ""
          ),

        updated:
          String(
            conversation.updated ||
              ""
          ),

        lastMessageAt:
          String(
            conversation.last_message_at ||
              ""
          ) ||
          undefined,

        user: {
          id:
            cleanRecordId(
              conversation.user ||
                user?.id
            ),

          name:
            String(
              user?.name ||
                user?.email ||
                "کارشناس نامشخص"
            ),

          email:
            String(
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
        },

        metrics: {
          totalMessages:
            serializedMessages.length,

          userMessages:
            userMessages.length,

          assistantMessages:
            assistantMessages.length,

          noAnswer:
            noAnswerCount,

          negativeFeedback:
            negativeFeedbackCount,

          openNegativeFeedback:
            openNegativeFeedbackCount,
        },
      },

      messages:
        serializedMessages,
    }
  );
}

/*
 * ============================================
 * Message Serializer
 * ============================================
 */

function serializeMessage(
  message:
    RecordModel,

  feedback?:
    RecordModel
): ConversationDetailMessage {
  const role =
    message.role ===
    "assistant"
      ? "assistant"
      : "user";

  const topic =
    getExpandedOne(
      message,
      "topic"
    );

  const sources =
    getExpandedMany(
      message,
      "sources"
    )
      .map(
        (
          source
        ) => ({
          id:
            cleanRecordId(
              source.id
            ),

          title:
            String(
              source.title ||
                ""
            ).trim(),
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
      );

  const result:
    ConversationDetailMessage = {
    id:
      message.id,

    role,

    content:
      String(
        message.content ||
          ""
      ),

    created:
      String(
        message.created ||
          ""
      ),

    replyTo:
      cleanRecordId(
        message.reply_to
      ) ||
      undefined,

    sources,
  };

  if (
    role ===
    "user"
  ) {
    const topicId =
      cleanRecordId(
        topic?.id ||
          message.topic
      );

    const topicName =
      String(
        topic?.name ||
          ""
      ).trim();

    if (
      topicId
    ) {
      result.topic = {
        id:
          topicId,

        name:
          topicName ||
          "موضوع بدون نام",
      };
    }

    const confidence =
      Number(
        message.topic_confidence
      );

    if (
      Number.isFinite(
        confidence
      )
    ) {
      result.topicConfidence =
        confidence;
    }

    result.classificationStatus =
      String(
        message.classification_status ||
          ""
      ) ||
      undefined;
  }

  if (
    role ===
    "assistant"
  ) {
    if (
      typeof message.has_answer ===
      "boolean"
    ) {
      result.hasAnswer =
        message.has_answer;
    }

    const responseTime =
      Number(
        message.response_time_ms
      );

    if (
      Number.isFinite(
        responseTime
      )
    ) {
      result.responseTimeMs =
        responseTime;
    }

    result.model =
      String(
        message.model ||
          ""
      ) ||
      undefined;

    result.openAIResponseId =
      String(
        message.openai_response_id ||
          ""
      ) ||
      undefined;

    if (
      feedback
    ) {
      result.feedback =
        serializeFeedback(
          feedback
        );
    }
  }

  return result;
}

/*
 * ============================================
 * Feedback Serializer
 * ============================================
 */

function serializeFeedback(
  feedback:
    RecordModel
) {
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
        ? "down" as const
        : "up" as const,

    reasons:
      normalizeStringList(
        feedback.reasons
      )
        .slice(
          0,
          MAX_FEEDBACK_REASONS
        ),

    comment:
      String(
        feedback.comment ||
          ""
      ).trim() ||
      undefined,

    reviewStatus:
      normalizeReviewStatus(
        feedback.review_status
      ),

    reviewNote:
      String(
        feedback.review_note ||
          ""
      ).trim() ||
      undefined,

    reviewedBy:
      String(
        feedback.reviewed_by ||
          ""
      ).trim() ||
      undefined,

    reviewedAt:
      String(
        feedback.reviewed_at ||
          ""
      ).trim() ||
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
              ).trim() ||
              "مطلب اصلاحی",
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
  };
}

/*
 * ============================================
 * Helpers
 * ============================================
 */

function buildIdOrFilter(
  pb:
    PocketBase,

  field:
    string,

  ids:
    string[],

  keyPrefix:
    string
) {
  const values:
    Record<
      string,
      string
    > = {};

  const clauses =
    ids.map(
      (
        id,
        index
      ) => {
        const key =
          `${keyPrefix}${index}`;

        values[
          key
        ] =
          id;

        return `${field} = {:${key}}`;
      }
    );

  return pb.filter(
    `(${clauses.join(
      " || "
    )})`,
    values
  );
}

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

function normalizeReviewStatus(
  value:
    unknown
):
  FeedbackReviewStatus {
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
