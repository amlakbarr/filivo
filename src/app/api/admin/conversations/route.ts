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
 * Limits
 * ============================================
 */

const DEFAULT_PER_PAGE =
  20;

const MAX_PER_PAGE =
  50;

const MAX_SEARCH_LENGTH =
  200;

const RECORD_ID_PATTERN =
  /^[a-zA-Z0-9_-]{1,64}$/;

/*
 * ============================================
 * Types
 * ============================================
 */

type ConversationStatusFilter =
  | "all"
  | "active"
  | "inactive";

type ConversationTopicSummary = {
  id:
    string;

  name:
    string;

  count:
    number;
};

type ConversationReasonSummary = {
  key:
    string;

  count:
    number;
};

type ConversationListItem = {
  id:
    string;

  title:
    string;

  status:
    string;

  user: {
    id:
      string;

    name:
      string;

    email?:
      string;

    employeeCode?:
      string;

    departmentName?:
      string;
  };

  created:
    string;

  updated:
    string;

  lastMessageAt?:
    string;

  metrics: {
    totalMessages:
      number;

    userMessages:
      number;

    assistantMessages:
      number;

    noAnswer:
      number;

    negativeFeedback:
      number;

    unreviewedNegativeFeedback:
      number;
  };

  topics:
    ConversationTopicSummary[];

  negativeReasons:
    ConversationReasonSummary[];

  lastQuestion?:
    string;

  lastAnswer?:
    string;

  needsAttention:
    boolean;
};

/*
 * ============================================
 * GET
 *
 * Admin Conversation Review List
 * ============================================
 */

export async function GET(
  request:
    Request
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
   * Query Params
   * ==========================================
   */

  const params =
    new URL(
      request.url
    ).searchParams;

  const page =
    clampInteger(
      params.get(
        "page"
      ),
      1,
      Number.MAX_SAFE_INTEGER,
      1
    );

  const perPage =
    clampInteger(
      params.get(
        "perPage"
      ),
      1,
      MAX_PER_PAGE,
      DEFAULT_PER_PAGE
    );

  const search =
    cleanSearch(
      params.get(
        "search"
      )
    );

  const status =
    normalizeStatusFilter(
      params.get(
        "status"
      )
    );

  const userId =
    cleanRecordId(
      params.get(
        "userId"
      )
    );

  const from =
    normalizeDateParam(
      params.get(
        "from"
      )
    );

  const to =
    normalizeDateParam(
      params.get(
        "to"
      )
    );

  if (
    from &&
    to &&
    from.getTime() >
      to.getTime()
  ) {
    return apiError(
      requestId,
      400,
      "INVALID_DATE_RANGE",
      "تاریخ شروع نمی‌تواند بعد از تاریخ پایان باشد."
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
      "Admin conversations service unavailable",
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

    return apiError(
      requestId,
      503,
      "CONVERSATIONS_SERVICE_UNAVAILABLE",
      "سرویس مکالمات موقتاً در دسترس نیست."
    );
  }

  /*
   * ==========================================
   * Conversation Filter
   * ==========================================
   */

  const filters:
    string[] =
      [];

  const filterValues:
    Record<
      string,
      string
    > = {};

  if (
    status !==
    "all"
  ) {
    filters.push(
      "status = {:status}"
    );

    filterValues.status =
      status;
  }

  if (
    userId
  ) {
    filters.push(
      "user = {:userId}"
    );

    filterValues.userId =
      userId;
  }

  if (
    search
  ) {
    filters.push(
      [
        "(",
        "title ~ {:search}",
        " || ",
        "user.name ~ {:search}",
        " || ",
        "user.email ~ {:search}",
        " || ",
        "user.employee_code ~ {:search}",
        ")",
      ].join(
        ""
      )
    );

    filterValues.search =
      search;
  }

  if (
    from
  ) {
    filters.push(
      "created >= {:from}"
    );

    filterValues.from =
      from.toISOString();
  }

  if (
    to
  ) {
    filters.push(
      "created <= {:to}"
    );

    filterValues.to =
      to.toISOString();
  }

  const conversationFilter =
    filters.length >
    0
      ? pb.filter(
          filters.join(
            " && "
          ),
          filterValues
        )
      : "";

  /*
   * ==========================================
   * Conversation Page
   * ==========================================
   */

  let conversationResult;

  try {
    conversationResult =
      await pb
        .collection(
          "conversations"
        )
        .getList(
          page,
          perPage,
          {
            filter:
              conversationFilter,

            sort:
              "-last_message_at,-updated",

            expand:
              "user,user.department",
          }
        );
  } catch (error) {
    console.error(
      "Admin conversations list failed",
      {
        requestId,

        adminId:
          admin.account.id,

        page,

        perPage,

        status,

        userId:
          userId ||
          undefined,

        search:
          search ||
          undefined,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return apiError(
      requestId,
      503,
      "CONVERSATIONS_LOAD_FAILED",
      "دریافت فهرست مکالمات انجام نشد."
    );
  }

  const conversationIds =
    conversationResult.items
      .map(
        (
          item
        ) =>
          cleanRecordId(
            item.id
          )
      )
      .filter(
        Boolean
      );

  /*
   * ==========================================
   * Empty Page
   * ==========================================
   */

  if (
    conversationIds.length ===
    0
  ) {
    return apiSuccess(
      requestId,
      {
        items:
          [],

        page:
          conversationResult.page,

        perPage:
          conversationResult.perPage,

        totalItems:
          conversationResult.totalItems,

        totalPages:
          conversationResult.totalPages,
      }
    );
  }

  /*
   * ==========================================
   * Messages for Current Conversation Page
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
            buildIdOrFilter(
              pb,
              "conversation",
              conversationIds,
              "conversation"
            ),

          sort:
            "created",

          expand:
            "topic",
        });
  } catch (error) {
    console.error(
      "Admin conversation messages load failed",
      {
        requestId,

        adminId:
          admin.account.id,

        conversationIds,

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
      "دریافت پیام‌های مکالمات انجام نشد."
    );
  }

  /*
   * ==========================================
   * Feedback for Assistant Messages
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
          });
    } catch (error) {
      console.error(
        "Admin conversation feedback load failed",
        {
          requestId,

          adminId:
            admin.account.id,

          conversationIds,

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
        "دریافت بازخورد مکالمات انجام نشد."
      );
    }
  }

  /*
   * ==========================================
   * Build Lookup Maps
   * ==========================================
   */

  const messagesByConversation =
    new Map<
      string,
      RecordModel[]
    >();

  const messageConversationMap =
    new Map<
      string,
      string
    >();

  for (
    const message of
    messages
  ) {
    const conversationId =
      cleanRecordId(
        message.conversation
      );

    if (
      !conversationId
    ) {
      continue;
    }

    const existing =
      messagesByConversation.get(
        conversationId
      );

    if (
      existing
    ) {
      existing.push(
        message
      );
    } else {
      messagesByConversation.set(
        conversationId,
        [
          message,
        ]
      );
    }

    messageConversationMap.set(
      message.id,
      conversationId
    );
  }

  const feedbackByConversation =
    new Map<
      string,
      RecordModel[]
    >();

  for (
    const feedback of
    feedbackRecords
  ) {
    const messageId =
      cleanRecordId(
        feedback.message
      );

    const conversationId =
      messageConversationMap.get(
        messageId
      );

    if (
      !conversationId
    ) {
      continue;
    }

    const existing =
      feedbackByConversation.get(
        conversationId
      );

    if (
      existing
    ) {
      existing.push(
        feedback
      );
    } else {
      feedbackByConversation.set(
        conversationId,
        [
          feedback,
        ]
      );
    }
  }

  /*
   * ==========================================
   * Serialize
   * ==========================================
   */

  const items:
    ConversationListItem[] =
      conversationResult.items.map(
        (
          conversation
        ) =>
          serializeConversation({
            conversation,

            messages:
              messagesByConversation.get(
                conversation.id
              ) ||
              [],

            feedback:
              feedbackByConversation.get(
                conversation.id
              ) ||
              [],
          })
      );

  return apiSuccess(
    requestId,
    {
      items,

      page:
        conversationResult.page,

      perPage:
        conversationResult.perPage,

      totalItems:
        conversationResult.totalItems,

      totalPages:
        conversationResult.totalPages,
    }
  );
}

/*
 * ============================================
 * Conversation Serializer
 * ============================================
 */

function serializeConversation({
  conversation,
  messages,
  feedback,
}: {
  conversation:
    RecordModel;

  messages:
    RecordModel[];

  feedback:
    RecordModel[];
}): ConversationListItem {
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

  let userMessages =
    0;

  let assistantMessages =
    0;

  let noAnswer =
    0;

  let lastQuestion =
    "";

  let lastAnswer =
    "";

  const topicMap =
    new Map<
      string,
      ConversationTopicSummary
    >();

  for (
    const message of
    messages
  ) {
    if (
      message.role ===
      "user"
    ) {
      userMessages +=
        1;

      const content =
        String(
          message.content ||
            ""
        ).trim();

      if (
        content
      ) {
        lastQuestion =
          content;
      }

      const topic =
        getExpandedOne(
          message,
          "topic"
        );

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
        const existing =
          topicMap.get(
            topicId
          );

        if (
          existing
        ) {
          existing.count +=
            1;
        } else {
          topicMap.set(
            topicId,
            {
              id:
                topicId,

              name:
                topicName ||
                "موضوع بدون نام",

              count:
                1,
            }
          );
        }
      }
    } else if (
      message.role ===
      "assistant"
    ) {
      assistantMessages +=
        1;

      if (
        message.has_answer ===
        false
      ) {
        noAnswer +=
          1;
      }

      const content =
        String(
          message.content ||
            ""
        ).trim();

      if (
        content
      ) {
        lastAnswer =
          content;
      }
    }
  }

  let negativeFeedback =
    0;

  let unreviewedNegativeFeedback =
    0;

  const reasonMap =
    new Map<
      string,
      number
    >();

  for (
    const item of
    feedback
  ) {
    if (
      item.rating !==
      "down"
    ) {
      continue;
    }

    negativeFeedback +=
      1;

    const reviewStatus =
      normalizeReviewStatus(
        item.review_status
      );

    if (
      reviewStatus ===
        "new" ||
      reviewStatus ===
        "in_progress"
    ) {
      unreviewedNegativeFeedback +=
        1;
    }

    for (
      const reason of
      normalizeStringList(
        item.reasons
      )
    ) {
      reasonMap.set(
        reason,
        (
          reasonMap.get(
            reason
          ) ||
          0
        ) +
          1
      );
    }
  }

  const topics = [
    ...topicMap.values(),
  ]
    .sort(
      (
        first,
        second
      ) =>
        second.count -
        first.count
    )
    .slice(
      0,
      5
    );

  const negativeReasons = [
    ...reasonMap.entries(),
  ]
    .map(
      (
        [
          key,
          count,
        ]
      ) => ({
        key,
        count,
      })
    )
    .sort(
      (
        first,
        second
      ) =>
        second.count -
        first.count
    )
    .slice(
      0,
      5
    );

  return {
    id:
      conversation.id,

    title:
      String(
        conversation.title ||
          "گفتگوی بدون عنوان"
      ).trim() ||
      "گفتگوی بدون عنوان",

    status:
      String(
        conversation.status ||
          ""
      ).trim() ||
      "unknown",

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
        ).trim(),

      email:
        String(
          user?.email ||
            ""
        ).trim() ||
        undefined,

      employeeCode:
        String(
          user?.employee_code ||
            ""
        ).trim() ||
        undefined,

      departmentName:
        String(
          department?.name ||
            ""
        ).trim() ||
        undefined,
    },

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
          conversation.updated ||
          ""
      ).trim() ||
      undefined,

    metrics: {
      totalMessages:
        messages.length,

      userMessages,

      assistantMessages,

      noAnswer,

      negativeFeedback,

      unreviewedNegativeFeedback,
    },

    topics,

    negativeReasons,

    lastQuestion:
      lastQuestion ||
      undefined,

    lastAnswer:
      lastAnswer ||
      undefined,

    needsAttention:
      noAnswer >
        0 ||
      unreviewedNegativeFeedback >
        0,
  };
}

/*
 * ============================================
 * OR Filter
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

/*
 * ============================================
 * PocketBase Expand Helpers
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

/*
 * ============================================
 * Params
 * ============================================
 */

function clampInteger(
  value:
    string |
    null,

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
    maximum,
    Math.max(
      minimum,
      parsed
    )
  );
}

function cleanSearch(
  value:
    string |
    null
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
      MAX_SEARCH_LENGTH
    );
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

function normalizeStatusFilter(
  value:
    string |
    null
):
  ConversationStatusFilter {
  if (
    value ===
      "active" ||
    value ===
      "inactive"
  ) {
    return value;
  }

  return "all";
}

function normalizeDateParam(
  value:
    string |
    null
) {
  if (
    !value
  ) {
    return undefined;
  }

  const timestamp =
    Date.parse(
      value
    );

  if (
    !Number.isFinite(
      timestamp
    )
  ) {
    return undefined;
  }

  return new Date(
    timestamp
  );
}

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
 * Response
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
