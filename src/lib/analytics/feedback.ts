import type { RecordModel } from "pocketbase";

import { getAdminPocketBase } from "@/lib/pocketbase/admin";

export type FeedbackRangeKey =
  | "24h"
  | "7d"
  | "30d"
  | "90d"
  | "all";

export type FeedbackBreakdownItem = {
  id: string;
  name: string;

  total: number;
  up: number;
  down: number;

  satisfactionRate: number;
  negativeRate: number;
};

export type RecentNegativeFeedback = {
  feedbackId: string;

  messageId: string;
  conversationId?: string;

  userId?: string;
  userName: string;
  employeeCode?: string;

  departmentName?: string;

  question: string;
  answer: string;

  topicName?: string;

  sources: Array<{
    id: string;
    title: string;
  }>;

  comment?: string;

  created: string;
};

export type FeedbackAnalytics = {
  range: {
    key: FeedbackRangeKey;
    label: string;
    since?: string;
  };

  summary: {
    assistantMessages: number;

    totalFeedback: number;

    positive: number;
    negative: number;

    comments: number;

    satisfactionRate: number;

    coverageRate: number;
  };

  topics: FeedbackBreakdownItem[];

  sources: FeedbackBreakdownItem[];

  employees: FeedbackBreakdownItem[];

  recentNegative: RecentNegativeFeedback[];
};

/*
 * ============================================
 * Main Analytics
 * ============================================
 */

export async function getFeedbackAnalytics(
  rangeKey: FeedbackRangeKey
): Promise<FeedbackAnalytics> {
  const pb =
    await getAdminPocketBase();

  const range =
    resolveFeedbackRange(
      rangeKey
    );

  /*
   * Feedback filter
   */
  const feedbackFilter =
    range.since
      ? pb.filter(
          "created >= {:since}",
          {
            since:
              range.since.toISOString(),
          }
        )
      : "";

  /*
   * Assistant Message filter
   *
   * برای Coverage می‌خواهیم بدانیم در همان
   * بازه چند پاسخ Assistant ساخته شده است.
   */
  const assistantFilter =
    range.since
      ? pb.filter(
          "role = 'assistant' && created >= {:since}",
          {
            since:
              range.since.toISOString(),
          }
        )
      : "role = 'assistant'";

  /*
   * این دو Query مستقل هستند.
   */
  const [
    feedbackRecords,
    assistantMessages,
  ] =
    await Promise.all([
      pb
        .collection(
          "message_feedback"
        )
        .getFullList({
          filter:
            feedbackFilter,

          sort:
            "-created",

          /*
           * message
           * ├── user
           * │   └── department
           * ├── reply_to
           * │   └── topic
           * └── sources
           */
          expand: [
            "message",
            "message.user",
            "message.user.department",
            "message.reply_to",
            "message.reply_to.topic",
            "message.sources",
          ].join(","),
        }),

      pb
        .collection(
          "messages"
        )
        .getList(
          1,
          1,
          {
            filter:
              assistantFilter,

            fields:
              "id",
          }
        ),
    ]);

  /*
   * ==========================================
   * General counters
   * ==========================================
   */

  let positive =
    0;

  let negative =
    0;

  let comments =
    0;

  const topicMap =
    new Map<
      string,
      MutableBreakdown
    >();

  const sourceMap =
    new Map<
      string,
      MutableBreakdown
    >();

  const employeeMap =
    new Map<
      string,
      MutableBreakdown
    >();

  const recentNegative:
    RecentNegativeFeedback[] =
      [];

  /*
   * ==========================================
   * Analyze every Feedback
   * ==========================================
   */

  for (
    const feedback of
    feedbackRecords
  ) {
    const isPositive =
      feedback.rating ===
      "up";

    if (isPositive) {
      positive += 1;
    } else {
      negative += 1;
    }

    const comment =
      String(
        feedback.comment ||
          ""
      ).trim();

    if (comment) {
      comments += 1;
    }

    /*
     * Assistant Message
     */
    const message =
      getExpandedOne(
        feedback,
        "message"
      );

    if (!message) {
      continue;
    }

    /*
     * Account
     */
    const user =
      getExpandedOne(
        message,
        "user"
      );

    const userId =
      String(
        message.user ||
          user?.id ||
          ""
      ).trim();

    const userName =
      String(
        user?.name ||
          user?.email ||
          "کارشناس نامشخص"
      ).trim();

    const employeeCode =
      String(
        user?.employee_code ||
          ""
      ).trim();

    /*
     * Department
     */
    const department =
      user
        ? getExpandedOne(
            user,
            "department"
          )
        : undefined;

    const departmentName =
      String(
        department?.name ||
          ""
      ).trim();

    /*
     * User Message that Assistant replied to
     */
    const userMessage =
      getExpandedOne(
        message,
        "reply_to"
      );

    /*
     * Topic روی User Message قرار دارد.
     */
    const topic =
      userMessage
        ? getExpandedOne(
            userMessage,
            "topic"
          )
        : undefined;

    const topicId =
      String(
        topic?.id ||
          userMessage?.topic ||
          ""
      ).trim();

    const topicName =
      String(
        topic?.name ||
          ""
      ).trim();

    /*
     * Topic Breakdown
     *
     * سؤال‌های بدون Topic را هم عمداً
     * نگه می‌داریم تا کیفیت پاسخ‌های
     * Unclassified را ببینیم.
     */
    addToBreakdown(
      topicMap,
      topicId ||
        "__without_topic__",
      topicName ||
        "بدون موضوع",
      isPositive
    );

    /*
     * Employee Breakdown
     */
    if (userId) {
      addToBreakdown(
        employeeMap,
        userId,
        employeeCode
          ? `${userName} — ${employeeCode}`
          : userName,
        isPositive
      );
    }

    /*
     * Knowledge Sources
     */
    const sources =
      getExpandedMany(
        message,
        "sources"
      );

    const normalizedSources: Array<{
      id: string;
      title: string;
    }> = [];

    /*
     * اگر یک Answer چند Source داشته باشد،
     * همان Feedback برای هر Source یک Signal
     * کیفی محسوب می‌شود.
     *
     * این Breakdown مستقل از Global Total است.
     */
    for (
      const source of
      sources
    ) {
      const sourceId =
        String(
          source.id ||
            ""
        ).trim();

      const sourceTitle =
        String(
          source.title ||
            ""
        ).trim();

      if (
        !sourceId ||
        !sourceTitle
      ) {
        continue;
      }

      normalizedSources.push({
        id:
          sourceId,

        title:
          sourceTitle,
      });

      addToBreakdown(
        sourceMap,
        sourceId,
        sourceTitle,
        isPositive
      );
    }

    /*
     * Recent Negative Feedback
     */
    if (
      !isPositive &&
      recentNegative.length <
        20
    ) {
      recentNegative.push({
        feedbackId:
          feedback.id,

        messageId:
          message.id,

        conversationId:
          message.conversation
            ? String(
                message.conversation
              )
            : undefined,

        userId:
          userId ||
          undefined,

        userName,

        employeeCode:
          employeeCode ||
          undefined,

        departmentName:
          departmentName ||
          undefined,

        question:
          String(
            userMessage?.content ||
              ""
          ).trim(),

        answer:
          String(
            message.content ||
              ""
          ).trim(),

        topicName:
          topicName ||
          undefined,

        sources:
          normalizedSources,

        comment:
          comment ||
          undefined,

        created:
          String(
            feedback.created ||
              ""
          ),
      });
    }
  }

  /*
   * ==========================================
   * Summary
   * ==========================================
   */

  const totalFeedback =
    feedbackRecords.length;

  const satisfactionRate =
    totalFeedback > 0
      ? percentage(
          positive,
          totalFeedback
        )
      : 0;

  const coverageRate =
    assistantMessages.totalItems >
    0
      ? percentage(
          totalFeedback,
          assistantMessages.totalItems
        )
      : 0;

  /*
   * ==========================================
   * Response
   * ==========================================
   */

  return {
    range: {
      key:
        range.key,

      label:
        range.label,

      since:
        range.since
          ? range.since.toISOString()
          : undefined,
    },

    summary: {
      assistantMessages:
        assistantMessages.totalItems,

      totalFeedback,

      positive,

      negative,

      comments,

      satisfactionRate,

      coverageRate,
    },

    topics:
      finalizeBreakdown(
        topicMap
      ).slice(
        0,
        12
      ),

    sources:
      finalizeBreakdown(
        sourceMap
      ).slice(
        0,
        12
      ),

    employees:
      finalizeBreakdown(
        employeeMap
      ).slice(
        0,
        12
      ),

    recentNegative,
  };
}

/*
 * ============================================
 * Range
 * ============================================
 */

export function normalizeFeedbackRange(
  value:
    | string
    | undefined
): FeedbackRangeKey {
  if (
    value === "24h" ||
    value === "7d" ||
    value === "30d" ||
    value === "90d" ||
    value === "all"
  ) {
    return value;
  }

  return "30d";
}

function resolveFeedbackRange(
  key: FeedbackRangeKey
) {
  const now =
    new Date();

  if (
    key === "all"
  ) {
    return {
      key,
      label:
        "کل دوره",
      since:
        undefined,
    };
  }

  const durations: Record<
    Exclude<
      FeedbackRangeKey,
      "all"
    >,
    {
      milliseconds: number;
      label: string;
    }
  > = {
    "24h": {
      milliseconds:
        24 *
        60 *
        60 *
        1000,

      label:
        "۲۴ ساعت اخیر",
    },

    "7d": {
      milliseconds:
        7 *
        24 *
        60 *
        60 *
        1000,

      label:
        "۷ روز اخیر",
    },

    "30d": {
      milliseconds:
        30 *
        24 *
        60 *
        60 *
        1000,

      label:
        "۳۰ روز اخیر",
    },

    "90d": {
      milliseconds:
        90 *
        24 *
        60 *
        60 *
        1000,

      label:
        "۹۰ روز اخیر",
    },
  };

  const config =
    durations[key];

  return {
    key,
    label:
      config.label,

    since:
      new Date(
        now.getTime() -
          config.milliseconds
      ),
  };
}

/*
 * ============================================
 * Breakdown
 * ============================================
 */

type MutableBreakdown = {
  id: string;
  name: string;

  total: number;
  up: number;
  down: number;
};

function addToBreakdown(
  map: Map<
    string,
    MutableBreakdown
  >,
  id: string,
  name: string,
  positive: boolean
) {
  const existing =
    map.get(id);

  if (existing) {
    existing.total += 1;

    if (positive) {
      existing.up += 1;
    } else {
      existing.down += 1;
    }

    return;
  }

  map.set(
    id,
    {
      id,
      name,

      total:
        1,

      up:
        positive
          ? 1
          : 0,

      down:
        positive
          ? 0
          : 1,
    }
  );
}

function finalizeBreakdown(
  map: Map<
    string,
    MutableBreakdown
  >
): FeedbackBreakdownItem[] {
  return [
    ...map.values(),
  ]
    .map(
      (
        item
      ) => ({
        ...item,

        satisfactionRate:
          percentage(
            item.up,
            item.total
          ),

        negativeRate:
          percentage(
            item.down,
            item.total
          ),
      })
    )
    .sort(
      (
        first,
        second
      ) => {
        /*
         * ابتدا موارد با Feedback بیشتر،
         * سپس موارد با رأی منفی بیشتر.
         */
        if (
          second.total !==
          first.total
        ) {
          return (
            second.total -
            first.total
          );
        }

        return (
          second.down -
          first.down
        );
      }
    );
}

/*
 * ============================================
 * PocketBase Expand Helpers
 * ============================================
 */

function getExpandedOne(
  record: RecordModel,
  key: string
): RecordModel | undefined {
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

  return value as RecordModel;
}

function getExpandedMany(
  record: RecordModel,
  key: string
): RecordModel[] {
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
        item !== null
    );
  }

  if (
    typeof value ===
      "object"
  ) {
    return [
      value as RecordModel,
    ];
  }

  return [];
}

/*
 * ============================================
 * Math
 * ============================================
 */

function percentage(
  value: number,
  total: number
) {
  if (
    total <= 0
  ) {
    return 0;
  }

  return Math.round(
    (value /
      total) *
      1000
  ) / 10;
}