import type { RecordModel } from "pocketbase";

import { getAdminPocketBase } from "@/lib/pocketbase/admin";

export type FeedbackRangeKey =
  | "24h"
  | "7d"
  | "30d"
  | "90d"
  | "all";

export type FeedbackReviewFilterKey =
  | "all"
  | "new"
  | "in_progress"
  | "resolved"
  | "ignored";

export type FeedbackReasonKey =
  | "incorrect"
  | "incomplete"
  | "outdated"
  | "irrelevant"
  | "unclear"
  | "source_issue"
  | "other";

export type FeedbackBreakdownItem = {
  id: string;
  name: string;

  total: number;
  up: number;
  down: number;

  satisfactionRate: number;
  negativeRate: number;
};

export type FeedbackReasonTopicItem = {
  id: string;
  name: string;
  count: number;
};

export type FeedbackReasonBreakdownItem = {
  key: FeedbackReasonKey;
  label: string;

  /*
   * تعداد Feedbackهای منفی که این Reason
   * را انتخاب کرده‌اند.
   */
  count: number;

  /*
   * درصد از کل Feedbackهای منفی.
   *
   * چون هر Feedback می‌تواند چند Reason داشته
   * باشد، مجموع percentageها ممکن است بیش از
   * 100 درصد شود.
   */
  percentage: number;

  /*
   * Topicهای پرتکرار برای همین Reason.
   */
  topics: FeedbackReasonTopicItem[];
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

  reasons: FeedbackReasonKey[];

  comment?: string;

  reviewStatus:
    | "new"
    | "in_progress"
    | "resolved"
    | "ignored";

  reviewNote?: string;

  reviewedBy?: string;
  reviewedAt?: string;

  resolvedKnowledgeItem?: {
    id: string;
    title: string;
  };

  created: string;
};

export type FeedbackAnalytics = {
  range: {
    key: FeedbackRangeKey;
    label: string;
    since?: string;
  };

  reviewFilter: {
    key: FeedbackReviewFilterKey;
    label: string;
  };

  reviewSummary: {
    all: number;
    new: number;
    inProgress: number;
    resolved: number;
    ignored: number;
  };

  summary: {
    assistantMessages: number;

    totalFeedback: number;

    positive: number;
    negative: number;

    comments: number;

    /*
     * تعداد Feedbackهای منفی که حداقل یک
     * Structured Reason دارند.
     */
    negativeWithReasons: number;

    /*
     * درصد Feedbackهای منفی دارای Reason.
     */
    negativeReasonCoverageRate: number;

    satisfactionRate: number;

    coverageRate: number;
  };

  topics: FeedbackBreakdownItem[];

  sources: FeedbackBreakdownItem[];

  employees: FeedbackBreakdownItem[];

  negativeReasons: FeedbackReasonBreakdownItem[];

  recentNegative: RecentNegativeFeedback[];
};

/*
 * ============================================
 * Feedback Reason Labels
 * ============================================
 */

const FEEDBACK_REASON_LABELS: Record<
  FeedbackReasonKey,
  string
> = {
  incorrect:
    "پاسخ اشتباه است",

  incomplete:
    "پاسخ ناقص است",

  outdated:
    "اطلاعات قدیمی است",

  irrelevant:
    "پاسخ نامرتبط است",

  unclear:
    "پاسخ مبهم است",

  source_issue:
    "مشکل در منبع یا اطلاعات",

  other:
    "مورد دیگر",
};

const MAX_FEEDBACK_REASONS =
  3;

const MAX_REASON_TOPICS =
  5;

/*
 * ============================================
 * Main Analytics
 * ============================================
 */

export async function getFeedbackAnalytics(
  rangeKey: FeedbackRangeKey,
  reviewFilterKey: FeedbackReviewFilterKey = "all"
): Promise<FeedbackAnalytics> {
  const pb =
    await getAdminPocketBase();

  const range =
    resolveFeedbackRange(
      rangeKey
    );

  const reviewFilter =
    resolveFeedbackReviewFilter(
      reviewFilterKey
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
            "resolved_knowledge_item",
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

  let negativeWithReasons =
    0;

  const reviewSummary = {
    all:
      0,

    new:
      0,

    inProgress:
      0,

    resolved:
      0,

    ignored:
      0,
  };

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

  const reasonMap =
    new Map<
      FeedbackReasonKey,
      MutableReasonBreakdown
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
     * Structured Negative Reasons
     *
     * Up Voteها عمداً Reason ندارند.
     */
    const reasons =
      isPositive
        ? []
        : normalizeFeedbackReasons(
            feedback.reasons
          );

    if (
      !isPositive &&
      reasons.length >
        0
    ) {
      negativeWithReasons +=
        1;
    }

    const reviewStatus =
      isPositive
        ? "new"
        : normalizeReviewStatus(
            feedback.review_status
          );

    if (
      !isPositive
    ) {
      reviewSummary.all +=
        1;

      if (
        reviewStatus ===
        "new"
      ) {
        reviewSummary.new +=
          1;
      } else if (
        reviewStatus ===
        "in_progress"
      ) {
        reviewSummary.inProgress +=
          1;
      } else if (
        reviewStatus ===
        "resolved"
      ) {
        reviewSummary.resolved +=
          1;
      } else if (
        reviewStatus ===
        "ignored"
      ) {
        reviewSummary.ignored +=
          1;
      }
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
      /*
       * Counters عمومی Feedback همچنان معتبرند،
       * ولی Breakdownهای وابسته به Message بدون
       * Expand قابل محاسبه نیستند.
       */
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

    const normalizedTopicId =
      topicId ||
      "__without_topic__";

    const normalizedTopicName =
      topicName ||
      "بدون موضوع";

    /*
     * Topic Breakdown
     *
     * سؤال‌های بدون Topic را هم عمداً
     * نگه می‌داریم تا کیفیت پاسخ‌های
     * Unclassified را ببینیم.
     */
    addToBreakdown(
      topicMap,
      normalizedTopicId,
      normalizedTopicName,
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
     * ========================================
     * Negative Reason Breakdown
     *
     * هر Reason برای همان Feedback فقط یک بار
     * شمرده می‌شود.
     * ========================================
     */

    if (
      !isPositive &&
      reasons.length >
        0
    ) {
      for (
        const reason of
        reasons
      ) {
        addToReasonBreakdown(
          reasonMap,
          reason,
          normalizedTopicId,
          normalizedTopicName
        );
      }
    }

    const resolvedKnowledgeItem =
      getExpandedOne(
        feedback,
        "resolved_knowledge_item"
      );

    /*
     * Recent Negative Feedback
     */
    if (
      !isPositive &&
      (
        reviewFilter.key ===
          "all" ||
        reviewStatus ===
          reviewFilter.key
      ) &&
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

        reasons,

        comment:
          comment ||
          undefined,

        reviewStatus,

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

  const negativeReasonCoverageRate =
    negative >
    0
      ? percentage(
          negativeWithReasons,
          negative
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

    reviewFilter: {
      key:
        reviewFilter.key,

      label:
        reviewFilter.label,
    },

    reviewSummary,

    summary: {
      assistantMessages:
        assistantMessages.totalItems,

      totalFeedback,

      positive,

      negative,

      comments,

      negativeWithReasons,

      negativeReasonCoverageRate,

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

    negativeReasons:
      finalizeReasonBreakdown(
        reasonMap,
        negative
      ),

    recentNegative,
  };
}

/*
 * ============================================
 * Range
 * ============================================
 */

export function normalizeFeedbackReviewFilter(
  value:
    | string
    | undefined
): FeedbackReviewFilterKey {
  if (
    value ===
      "new" ||
    value ===
      "in_progress" ||
    value ===
      "resolved" ||
    value ===
      "ignored" ||
    value ===
      "all"
  ) {
    return value;
  }

  return "all";
}

function resolveFeedbackReviewFilter(
  key:
    FeedbackReviewFilterKey
) {
  switch (
    key
  ) {
    case "new":
      return {
        key,
        label:
          "جدید",
      };

    case "in_progress":
      return {
        key,
        label:
          "در حال بررسی",
      };

    case "resolved":
      return {
        key,
        label:
          "رفع‌شده",
      };

    case "ignored":
      return {
        key,
        label:
          "نادیده گرفته‌شده",
      };

    default:
      return {
        key:
          "all" as const,
        label:
          "همه",
      };
  }
}

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
 * General Breakdown
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
 * Negative Reason Breakdown
 * ============================================
 */

type MutableReasonTopic = {
  id: string;
  name: string;
  count: number;
};

type MutableReasonBreakdown = {
  key: FeedbackReasonKey;
  count: number;

  topics: Map<
    string,
    MutableReasonTopic
  >;
};

function addToReasonBreakdown(
  map: Map<
    FeedbackReasonKey,
    MutableReasonBreakdown
  >,

  reason:
    FeedbackReasonKey,

  topicId:
    string,

  topicName:
    string
) {
  let item =
    map.get(
      reason
    );

  if (!item) {
    item = {
      key:
        reason,

      count:
        0,

      topics:
        new Map(),
    };

    map.set(
      reason,
      item
    );
  }

  item.count +=
    1;

  const existingTopic =
    item.topics.get(
      topicId
    );

  if (
    existingTopic
  ) {
    existingTopic.count +=
      1;

    return;
  }

  item.topics.set(
    topicId,
    {
      id:
        topicId,

      name:
        topicName,

      count:
        1,
    }
  );
}

function finalizeReasonBreakdown(
  map: Map<
    FeedbackReasonKey,
    MutableReasonBreakdown
  >,

  totalNegative:
    number
): FeedbackReasonBreakdownItem[] {
  /*
   * تمام Reasonها حتی اگر Count صفر داشته باشند
   * در خروجی وجود دارند تا UI ثابت و قابل پیش‌بینی
   * باشد.
   */
  const keys =
    Object.keys(
      FEEDBACK_REASON_LABELS
    ) as FeedbackReasonKey[];

  return keys
    .map(
      (
        key
      ) => {
        const item =
          map.get(
            key
          );

        const count =
          item?.count ||
          0;

        const topics =
          item
            ? [
                ...item.topics.values(),
              ]
                .sort(
                  (
                    first,
                    second
                  ) => {
                    if (
                      second.count !==
                      first.count
                    ) {
                      return (
                        second.count -
                        first.count
                      );
                    }

                    return first.name.localeCompare(
                      second.name,
                      "fa"
                    );
                  }
                )
                .slice(
                  0,
                  MAX_REASON_TOPICS
                )
            : [];

        return {
          key,

          label:
            FEEDBACK_REASON_LABELS[
              key
            ],

          count,

          percentage:
            totalNegative >
            0
              ? percentage(
                  count,
                  totalNegative
                )
              : 0,

          topics,
        };
      }
    )
    .sort(
      (
        first,
        second
      ) => {
        if (
          second.count !==
          first.count
        ) {
          return (
            second.count -
            first.count
          );
        }

        return first.label.localeCompare(
          second.label,
          "fa"
        );
      }
    );
}

/*
 * ============================================
 * Feedback Reasons
 * ============================================
 */

function normalizeFeedbackReasons(
  value:
    unknown
): FeedbackReasonKey[] {
  if (
    !Array.isArray(
      value
    )
  ) {
    return [];
  }

  const result:
    FeedbackReasonKey[] =
      [];

  for (
    const item of
    value
  ) {
    if (
      !isFeedbackReason(
        item
      ) ||
      result.includes(
        item
      )
    ) {
      continue;
    }

    result.push(
      item
    );

    if (
      result.length >=
      MAX_FEEDBACK_REASONS
    ) {
      break;
    }
  }

  return result;
}

function isFeedbackReason(
  value:
    unknown
): value is FeedbackReasonKey {
  return (
    value ===
      "incorrect" ||
    value ===
      "incomplete" ||
    value ===
      "outdated" ||
    value ===
      "irrelevant" ||
    value ===
      "unclear" ||
    value ===
      "source_issue" ||
    value ===
      "other"
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
