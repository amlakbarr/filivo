import type PocketBase from "pocketbase";

import type {
  RecordModel,
} from "pocketbase";

import {
  getBucketKey,
  type AnalyticsRange,
} from "@/lib/analytics/range";

import {
  sanitizeAnalyticsError,
} from "@/lib/analytics/security";

import type {
  AnalyticsDashboard,
  AnalyticsMetric,
  AnalyticsPoint,
  DashboardFeedbackAnalytics,
  EmployeeUsageRow,
  ProblematicKnowledgeSource,
  UsageBreakdown,
} from "@/types/analytics";

/*
 * ============================================
 * Types
 * ============================================
 */

type AnalyticsOptions = {
  employeePage?:
    number;

  employeePerPage?:
    number;

  employeeSearch?:
    string;

  employeeSort?:
    string;

  accountId?:
    string;
};

type UsageRecord =
  RecordModel & {
    user?:
      string;

    request_type?:
      string;

    model?:
      string;

    input_tokens?:
      number;

    cached_input_tokens?:
      number;

    output_tokens?:
      number;

    reasoning_tokens?:
      number;

    total_tokens?:
      number;

    file_search_calls?:
      number;

    estimated_cost_usd?:
      number;

    cost_available?:
      boolean;

    latency_ms?:
      number;

    success?:
      boolean;

    error_message?:
      string;
  };

type EmployeeAccumulator =
  EmployeeUsageRow & {
    latencyTotal:
      number;

    latencyCount:
      number;
  };

type BreakdownAccumulator =
  UsageBreakdown & {
    latencyTotal:
      number;

    latencyCount:
      number;
  };

type FeedbackSourceAccumulator = {
  id:
    string;

  title:
    string;

  totalFeedback:
    number;

  positive:
    number;

  negative:
    number;
};

type BoundedListResult<
  T extends RecordModel
> = {
  items:
    T[];

  totalItems:
    number;

  truncated:
    boolean;
};

type BoundedListOptions = {
  filter?:
    string;

  sort?:
    string;

  fields?:
    string;

  expand?:
    string;
};

/*
 * ============================================
 * Constants
 * ============================================
 */

const EMPLOYEE_SORTS =
  new Set([
    "questions",
    "tokens",
    "cost",
    "activity",
    "conversations",
  ]);

/*
 * Route نیز همین سقف را دارد.
 */
const MAX_EMPLOYEE_PAGE =
  10_000;

const MAX_EMPLOYEE_PER_PAGE =
  50;

const MAX_EMPLOYEE_SEARCH_LENGTH =
  100;

/*
 * PocketBase fetch pagination.
 */
const ANALYTICS_QUERY_PAGE_SIZE =
  500;

/*
 * تعداد Lookupهای Account که همزمان اجرا
 * می‌شوند.
 */
const ACCOUNT_LOOKUP_CONCURRENCY =
  4;

const ACCOUNT_LOOKUP_CHUNK_SIZE =
  40;

/*
 * ============================================
 * Dataset Limits
 *
 * هدف جلوگیری از getFullList نامحدود است.
 *
 * در صورت عبور از Limit:
 * - درخواست Fail نمی‌شود.
 * - داده تا Limit تحلیل می‌شود.
 * - Warning در dashboard.errors قرار می‌گیرد.
 *
 * مقدار Production با Environment قابل تنظیم
 * است، ولی سقف نهایی نیز محدود باقی می‌ماند.
 * ============================================
 */

function getQuestionRowLimit() {
  return environmentInteger(
    process.env
      .ANALYTICS_MAX_QUESTION_ROWS,
    1_000,
    100_000,
    25_000
  );
}

function getUsageRowLimit() {
  return environmentInteger(
    process.env
      .ANALYTICS_MAX_USAGE_ROWS,
    1_000,
    100_000,
    25_000
  );
}

function getConversationRowLimit() {
  return environmentInteger(
    process.env
      .ANALYTICS_MAX_CONVERSATION_ROWS,
    1_000,
    100_000,
    20_000
  );
}

function getFeedbackRowLimit() {
  return environmentInteger(
    process.env
      .ANALYTICS_MAX_FEEDBACK_ROWS,
    1_000,
    100_000,
    20_000
  );
}

/*
 * ============================================
 * Main
 * ============================================
 */

export async function getDashboardAnalytics(
  pb:
    PocketBase,

  range:
    AnalyticsRange,

  options:
    AnalyticsOptions = {}
): Promise<AnalyticsDashboard> {
  const previousFrom =
    range.previousFrom
      .toISOString();

  const previousTo =
    range.previousTo
      .toISOString();

  const to =
    range.to
      .toISOString();

  const currentFrom =
    range.from
      .toISOString();

  /*
   * ==========================================
   * Optional Account Scope
   * ==========================================
   */

  const accountId =
    isRecordId(
      options.accountId
    )
      ? String(
          options.accountId
        )
      : "";

  const accountFilter =
    accountId
      ? " && user = {:accountId}"
      : "";

  const filterValues = {
    previousFrom,
    previousTo,
    to,
    currentFrom,

    ...(accountId
      ? {
          accountId,
        }
      : {}),
  };

  /*
   * ==========================================
   * Main Queries
   *
   * هیچ Dataset بزرگی دیگر با getFullList()
   * بدون سقف خوانده نمی‌شود.
   * ==========================================
   */

  const [
    questionsResult,
    usageResult,
    conversationsResult,
    feedbackResult,
    assistantMessagesResult,
  ] =
    await Promise.allSettled([
      /*
       * ======================================
       * Questions
       * ======================================
       */

      loadBoundedRecords<RecordModel>(
        pb,
        "messages",
        {
          filter:
            pb.filter(
              `role = 'user' && ((created >= {:previousFrom} && created < {:previousTo}) || (created >= {:currentFrom} && created < {:to}))${accountFilter}`,
              filterValues
            ),

          sort:
            "created",

          fields:
            "id,user,created",
        },
        getQuestionRowLimit()
      ),

      /*
       * ======================================
       * OpenAI Usage
       * ======================================
       */

      loadBoundedRecords<UsageRecord>(
        pb,
        "ai_usage",
        {
          filter:
            pb.filter(
              `((created >= {:previousFrom} && created < {:previousTo}) || (created >= {:currentFrom} && created < {:to}))${accountFilter}`,
              filterValues
            ),

          sort:
            "created",

          fields: [
            "id",
            "user",
            "request_type",
            "model",
            "input_tokens",
            "cached_input_tokens",
            "output_tokens",
            "reasoning_tokens",
            "total_tokens",
            "file_search_calls",
            "estimated_cost_usd",
            "cost_available",
            "latency_ms",
            "success",
            "error_message",
            "created",
          ].join(
            ","
          ),
        },
        getUsageRowLimit()
      ),

      /*
       * ======================================
       * Conversations
       * ======================================
       */

      loadBoundedRecords<RecordModel>(
        pb,
        "conversations",
        {
          filter:
            pb.filter(
              `created >= {:currentFrom} && created < {:to}${accountFilter}`,
              filterValues
            ),

          sort:
            "created",

          fields:
            "id,user,title,status,created,updated,last_message_at",
        },
        getConversationRowLimit()
      ),

      /*
       * ======================================
       * Feedback
       *
       * بازه براساس زمان Assistant Message
       * محاسبه می‌شود.
       * ======================================
       */

      loadBoundedRecords<RecordModel>(
        pb,
        "message_feedback",
        {
          filter:
            pb.filter(
              `message.role = 'assistant' && message.created >= {:currentFrom} && message.created < {:to}${accountFilter}`,
              filterValues
            ),

          sort:
            "-created",

          expand: [
            "message",
            "message.sources",
          ].join(
            ","
          ),
        },
        getFeedbackRowLimit()
      ),

      /*
       * ======================================
       * Feedback Coverage Denominator
       *
       * فقط Count لازم است.
       * ======================================
       */

      pb
        .collection(
          "messages"
        )
        .getList(
          1,
          1,
          {
            filter:
              pb.filter(
                `role = 'assistant' && created >= {:currentFrom} && created < {:to}${accountFilter}`,
                filterValues
              ),

            fields:
              "id",
          }
        ),
    ]);

  /*
   * ==========================================
   * Errors / Partial Data
   * ==========================================
   */

  const errors:
    string[] = [];

  const questionsData =
    settledBoundedValue(
      questionsResult,
      "داده تعداد سؤال در دسترس نیست.",
      errors
    );

  const usageData =
    settledBoundedValue(
      usageResult,
      "داده مصرف OpenAI در دسترس نیست.",
      errors
    );

  const conversationsData =
    settledBoundedValue(
      conversationsResult,
      "داده گفتگوها در دسترس نیست.",
      errors
    );

  const feedbackData =
    settledBoundedValue(
      feedbackResult,
      "داده کیفیت پاسخ‌ها در دسترس نیست.",
      errors
    );

  /*
   * ==========================================
   * Truncation Warnings
   * ==========================================
   */

  if (
    questionsData.truncated
  ) {
    errors.push(
      `حجم داده سؤال‌ها از سقف تحلیلی عبور کرده است؛ ${questionsData.items.length.toLocaleString(
        "fa-IR"
      )} رکورد از ${questionsData.totalItems.toLocaleString(
        "fa-IR"
      )} رکورد تحلیل شد.`
    );
  }

  if (
    usageData.truncated
  ) {
    errors.push(
      `حجم داده مصرف هوش مصنوعی از سقف تحلیلی عبور کرده است؛ ${usageData.items.length.toLocaleString(
        "fa-IR"
      )} رکورد از ${usageData.totalItems.toLocaleString(
        "fa-IR"
      )} رکورد تحلیل شد.`
    );
  }

  if (
    conversationsData.truncated
  ) {
    errors.push(
      `حجم داده گفتگوها از سقف تحلیلی عبور کرده است؛ ${conversationsData.items.length.toLocaleString(
        "fa-IR"
      )} رکورد از ${conversationsData.totalItems.toLocaleString(
        "fa-IR"
      )} رکورد تحلیل شد.`
    );
  }

  if (
    feedbackData.truncated
  ) {
    errors.push(
      `حجم داده بازخوردها از سقف تحلیلی عبور کرده است؛ ${feedbackData.items.length.toLocaleString(
        "fa-IR"
      )} رکورد از ${feedbackData.totalItems.toLocaleString(
        "fa-IR"
      )} رکورد تحلیل شد.`
    );
  }

  const questions =
    questionsData.items;

  const usage =
    usageData.items;

  const conversations =
    conversationsData.items;

  const feedbackRecords =
    feedbackData.items;

  /*
   * ==========================================
   * Assistant Messages Count
   * ==========================================
   */

  let assistantMessagesCount =
    0;

  if (
    assistantMessagesResult.status ===
    "fulfilled"
  ) {
    assistantMessagesCount =
      assistantMessagesResult
        .value
        .totalItems;
  } else {
    errors.push(
      "تعداد پاسخ‌های AI برای محاسبه نرخ مشارکت در دسترس نیست."
    );

    console.error(
      "Analytics assistant feedback denominator failed",
      {
        error:
          errorMetadata(
            assistantMessagesResult.reason
          ),
      }
    );
  }

  /*
   * ==========================================
   * Current / Previous
   * ==========================================
   */

  const currentQuestions =
    questions.filter(
      (
        record
      ) =>
        isCurrent(
          record.created,
          range
        )
    );

  const previousQuestions =
    questions.filter(
      (
        record
      ) =>
        isPrevious(
          record.created,
          range
        )
    );

  const currentUsage =
    usage.filter(
      (
        record
      ) =>
        isCurrent(
          record.created,
          range
        )
    );

  const previousUsage =
    usage.filter(
      (
        record
      ) =>
        isPrevious(
          record.created,
          range
        )
    );

  /*
   * ==========================================
   * Accounts
   * ==========================================
   */

  const accountIds =
    uniqueStrings([
      ...currentQuestions.map(
        (
          record
        ) =>
          record.user
      ),

      ...currentUsage.map(
        (
          record
        ) =>
          record.user
      ),

      ...conversations.map(
        (
          record
        ) =>
          record.user
      ),
    ]).filter(
      isRecordId
    );

  let accounts =
    new Map<
      string,
      RecordModel
    >();

  try {
    accounts =
      await loadAccounts(
        pb,
        accountIds
      );
  } catch (error) {
    errors.push(
      "مشخصات کارشناسان در دسترس نیست."
    );

    console.error(
      "Analytics accounts lookup failed",
      {
        error:
          errorMetadata(
            error
          ),
      }
    );
  }

  /*
   * ==========================================
   * Cost
   * ==========================================
   */

  const currentCost =
    summarizeCost(
      currentUsage
    );

  const previousCost =
    summarizeCost(
      previousUsage
    );

  /*
   * ==========================================
   * Tokens
   * ==========================================
   */

  const currentTokens =
    sum(
      currentUsage,
      (
        record
      ) =>
        number(
          record.total_tokens
        )
    );

  const previousTokens =
    sum(
      previousUsage,
      (
        record
      ) =>
        number(
          record.total_tokens
        )
    );

  /*
   * ==========================================
   * Chat
   * ==========================================
   */

  const chatUsage =
    currentUsage.filter(
      (
        record
      ) =>
        record.request_type ===
        "chat"
    );

  const successfulChat =
    chatUsage.filter(
      (
        record
      ) =>
        record.success ===
        true
    );

  const successCount =
    currentUsage.filter(
      (
        record
      ) =>
        record.success ===
        true
    ).length;

  /*
   * ==========================================
   * Active Users
   * ==========================================
   */

  const currentActive =
    new Set(
      currentQuestions
        .map(
          (
            record
          ) =>
            String(
              record.user ||
                ""
            )
        )
        .filter(
          Boolean
        )
    ).size;

  const previousActive =
    new Set(
      previousQuestions
        .map(
          (
            record
          ) =>
            String(
              record.user ||
                ""
            )
        )
        .filter(
          Boolean
        )
    ).size;

  /*
   * ==========================================
   * Series
   * ==========================================
   */

  const series =
    buildSeries(
      range,
      currentQuestions,
      currentUsage
    );

  /*
   * ==========================================
   * Breakdowns
   * ==========================================
   */

  const requestBreakdown =
    buildBreakdown(
      currentUsage,

      (
        record
      ) =>
        String(
          record.request_type ||
            "other"
        ),

      requestTypeLabel
    );

  const modelBreakdown =
    buildBreakdown(
      currentUsage,

      (
        record
      ) =>
        String(
          record.model ||
            "unknown"
        ),

      (
        model
      ) =>
        model
    );

  /*
   * ==========================================
   * Employees
   * ==========================================
   */

  const employeeRows =
    buildEmployeeRows(
      currentQuestions,
      conversations,
      currentUsage,
      accounts
    );

  const employees =
    paginateEmployees(
      employeeRows,
      options
    );

  /*
   * ==========================================
   * Failures
   * ==========================================
   */

  const failures =
    currentUsage
      .filter(
        (
          record
        ) =>
          record.success !==
          true
      )
      .sort(
        (
          left,
          right
        ) =>
          dateNumber(
            right.created
          ) -
          dateNumber(
            left.created
          )
      )
      .slice(
        0,
        10
      )
      .map(
        (
          record
        ) => {
          const userId =
            String(
              record.user ||
                ""
            );

          const account =
            accounts.get(
              userId
            );

          return {
            id:
              record.id,

            created:
              String(
                record.created ||
                  ""
              ),

            userId,

            userName:
              String(
                account?.name ||
                  account?.email ||
                  "کاربر نامشخص"
              ),

            requestType:
              String(
                record.request_type ||
                  "other"
              ),

            model:
              String(
                record.model ||
                  "unknown"
              ),

            errorMessage:
              sanitizeAnalyticsError(
                record.error_message
              ),

            latencyMs:
              number(
                record.latency_ms
              ),
          };
        }
      );

  /*
   * ==========================================
   * File Search
   * ==========================================
   */

  const fileSearchCalls =
    sum(
      chatUsage,
      (
        record
      ) =>
        number(
          record.file_search_calls
        )
    );

  const chatsWithSearch =
    chatUsage.filter(
      (
        record
      ) =>
        number(
          record.file_search_calls
        ) >
        0
    ).length;

  /*
   * ==========================================
   * Feedback Quality
   * ==========================================
   */

  const feedback =
    buildFeedbackAnalytics(
      feedbackRecords,
      assistantMessagesCount
    );

  /*
   * ==========================================
   * Response
   * ==========================================
   */

  return {
    range: {
      preset:
        range.preset,

      label:
        range.label,

      timezone:
        range.timezone,

      from:
        range.from
          .toISOString(),

      to:
        range.to
          .toISOString(),

      previousFrom:
        range.previousFrom
          .toISOString(),

      previousTo:
        range.previousTo
          .toISOString(),

      granularity:
        range.granularity,
    },

    kpis: {
      questions:
        metric(
          currentQuestions.length,
          previousQuestions.length
        ),

      activeUsers:
        metric(
          currentActive,
          previousActive
        ),

      requests:
        currentUsage.length,

      chatRequests:
        chatUsage.length,

      classificationRequests:
        currentUsage.filter(
          (
            record
          ) =>
            record.request_type ===
            "classification"
        ).length,

      totalTokens:
        metric(
          currentTokens,
          previousTokens
        ),

      cost:
        metric(
          currentCost.total,
          previousCost.total
        ),

      pricedRequests:
        currentCost.available,

      unpricedRequests:
        currentCost.unavailable,

      avgChatLatency:
        average(
          successfulChat.map(
            (
              record
            ) =>
              number(
                record.latency_ms
              )
          )
        ),

      successRate:
        currentUsage.length >
        0
          ? (
              successCount /
              currentUsage.length
            ) *
            100
          : 0,
    },

    series,

    requestBreakdown,

    modelBreakdown,

    fileSearch: {
      calls:
        fileSearchCalls,

      avgCallsPerChat:
        chatUsage.length >
        0
          ? fileSearchCalls /
            chatUsage.length
          : 0,

      chatsWithSearchPercent:
        chatUsage.length >
        0
          ? (
              chatsWithSearch /
              chatUsage.length
            ) *
            100
          : null,
    },

    feedback,

    failures,

    employees,

    errors,
  };
}

/*
 * ============================================
 * Bounded PocketBase Query
 *
 * جایگزین getFullList روی Datasetهای بزرگ.
 * ============================================
 */

async function loadBoundedRecords<
  T extends RecordModel
>(
  pb:
    PocketBase,

  collectionName:
    string,

  options:
    BoundedListOptions,

  maximumRecords:
    number
): Promise<BoundedListResult<T>> {
  const safeMaximum =
    Math.max(
      1,
      Math.floor(
        maximumRecords
      )
    );

  const pageSize =
    Math.min(
      ANALYTICS_QUERY_PAGE_SIZE,
      safeMaximum
    );

  const items:
    T[] = [];

  let page =
    1;

  let totalItems =
    0;

  let totalPages =
    1;

  do {
    const remaining =
      safeMaximum -
      items.length;

    if (
      remaining <=
      0
    ) {
      break;
    }

    const currentPageSize =
      Math.min(
        pageSize,
        remaining
      );

    const result =
      await pb
        .collection(
          collectionName
        )
        .getList<T>(
          page,
          currentPageSize,
          {
            filter:
              options.filter ||
              "",

            ...(options.sort
              ? {
                  sort:
                    options.sort,
                }
              : {}),

            ...(options.fields
              ? {
                  fields:
                    options.fields,
                }
              : {}),

            ...(options.expand
              ? {
                  expand:
                    options.expand,
                }
              : {}),
          }
        );

    /*
     * اولین Response تعداد واقعی Matchها را
     * مشخص می‌کند.
     */
    totalItems =
      result.totalItems;

    totalPages =
      result.totalPages;

    items.push(
      ...result.items
    );

    /*
     * اگر PocketBase کمتر از تعداد خواسته‌شده
     * برگرداند یا آخرین Page بود، پایان.
     */
    if (
      result.items.length ===
        0 ||
      page >=
        totalPages ||
      items.length >=
        safeMaximum
    ) {
      break;
    }

    page +=
      1;
  } while (
    true
  );

  return {
    items,

    totalItems,

    truncated:
      totalItems >
      items.length,
  };
}

/*
 * ============================================
 * Feedback Analytics
 * ============================================
 */

function buildFeedbackAnalytics(
  feedbackRecords:
    RecordModel[],

  assistantMessagesCount:
    number
): DashboardFeedbackAnalytics {
  let positive =
    0;

  let negative =
    0;

  const sourceMap =
    new Map<
      string,
      FeedbackSourceAccumulator
    >();

  for (
    const feedback of
    feedbackRecords
  ) {
    const isPositive =
      feedback.rating ===
      "up";

    if (
      isPositive
    ) {
      positive +=
        1;
    } else {
      negative +=
        1;
    }

    /*
     * ========================================
     * Assistant Message
     * ========================================
     */

    const message =
      getExpandedOne(
        feedback,
        "message"
      );

    if (
      !message
    ) {
      continue;
    }

    /*
     * ========================================
     * Sources
     * ========================================
     */

    const rawSources =
      getExpandedMany(
        message,
        "sources"
      );

    /*
     * Duplicate Source در یک Message
     * دوبار شمرده نشود.
     */

    const seenSources =
      new Set<
        string
      >();

    for (
      const source of
      rawSources
    ) {
      const id =
        String(
          source.id ||
            ""
        ).trim();

      const title =
        String(
          source.title ||
            ""
        ).trim();

      if (
        !id ||
        !title ||
        seenSources.has(
          id
        )
      ) {
        continue;
      }

      seenSources.add(
        id
      );

      const current =
        sourceMap.get(
          id
        ) || {
          id,

          title,

          totalFeedback:
            0,

          positive:
            0,

          negative:
            0,
        };

      current.totalFeedback +=
        1;

      if (
        isPositive
      ) {
        current.positive +=
          1;
      } else {
        current.negative +=
          1;
      }

      sourceMap.set(
        id,
        current
      );
    }
  }

  const total =
    positive +
    negative;

  const satisfactionRate =
    total >
    0
      ? (
          positive /
          total
        ) *
        100
      : 0;

  const coverageRate =
    assistantMessagesCount >
    0
      ? (
          total /
          assistantMessagesCount
        ) *
        100
      : 0;

  const thresholds =
    getFeedbackAlertThresholds();

  const problematicSources:
    ProblematicKnowledgeSource[] =
      [
        ...sourceMap.values(),
      ]
        .map(
          (
            source
          ) => {
            const satisfaction =
              source.totalFeedback >
              0
                ? (
                    source.positive /
                    source.totalFeedback
                  ) *
                  100
                : 0;

            const negativeRate =
              source.totalFeedback >
              0
                ? (
                    source.negative /
                    source.totalFeedback
                  ) *
                  100
                : 0;

            return {
              id:
                source.id,

              title:
                source.title,

              totalFeedback:
                source.totalFeedback,

              positive:
                source.positive,

              negative:
                source.negative,

              satisfactionRate:
                satisfaction,

              negativeRate,
            };
          }
        )
        .filter(
          (
            source
          ) =>
            source.totalFeedback >=
              thresholds.minTotal &&
            source.negativeRate >=
              thresholds.negativeRate
        )
        .sort(
          (
            left,
            right
          ) => {
            if (
              right.negativeRate !==
              left.negativeRate
            ) {
              return (
                right.negativeRate -
                left.negativeRate
              );
            }

            if (
              right.negative !==
              left.negative
            ) {
              return (
                right.negative -
                left.negative
              );
            }

            return (
              right.totalFeedback -
              left.totalFeedback
            );
          }
        )
        .slice(
          0,
          8
        );

  return {
    assistantMessages:
      assistantMessagesCount,

    total,

    positive,

    negative,

    satisfactionRate,

    coverageRate,

    alertThresholds:
      thresholds,

    problematicSources,
  };
}

/*
 * ============================================
 * Feedback Alert Thresholds
 * ============================================
 */

function getFeedbackAlertThresholds() {
  return {
    minTotal:
      environmentInteger(
        process.env
          .FEEDBACK_ALERT_MIN_TOTAL,
        1,
        1000,
        5
      ),

    negativeRate:
      environmentNumber(
        process.env
          .FEEDBACK_ALERT_NEGATIVE_RATE,
        0,
        100,
        40
      ),
  };
}

/*
 * ============================================
 * Series
 * ============================================
 */

function buildSeries(
  range:
    AnalyticsRange,

  questions:
    RecordModel[],

  usage:
    UsageRecord[]
) {
  const points =
    new Map<
      string,
      AnalyticsPoint
    >(
      range.bucketKeys.map(
        ({
          key,
          label,
        }) => [
          key,

          {
            key,

            label,

            questions:
              0,

            inputTokens:
              0,

            cachedInputTokens:
              0,

            outputTokens:
              0,

            reasoningTokens:
              0,

            totalTokens:
              0,

            cost:
              0,
          },
        ]
      )
    );

  for (
    const question of
    questions
  ) {
    const created =
      safeDate(
        question.created
      );

    if (
      !created
    ) {
      continue;
    }

    const point =
      points.get(
        getBucketKey(
          created,
          range.timezone,
          range.granularity
        )
      );

    if (
      point
    ) {
      point.questions +=
        1;
    }
  }

  for (
    const record of
    usage
  ) {
    const created =
      safeDate(
        record.created
      );

    if (
      !created
    ) {
      continue;
    }

    const point =
      points.get(
        getBucketKey(
          created,
          range.timezone,
          range.granularity
        )
      );

    if (
      !point
    ) {
      continue;
    }

    point.inputTokens +=
      number(
        record.input_tokens
      );

    point.cachedInputTokens +=
      number(
        record.cached_input_tokens
      );

    point.outputTokens +=
      number(
        record.output_tokens
      );

    point.reasoningTokens +=
      number(
        record.reasoning_tokens
      );

    point.totalTokens +=
      number(
        record.total_tokens
      );

    if (
      record.cost_available ===
      true
    ) {
      point.cost +=
        number(
          record.estimated_cost_usd
        );
    }
  }

  return [
    ...points.values(),
  ];
}

/*
 * ============================================
 * Usage Breakdown
 * ============================================
 */

function buildBreakdown(
  usage:
    UsageRecord[],

  keyFor: (
    record:
      UsageRecord
  ) => string,

  labelFor: (
    key:
      string
  ) => string
) {
  const result =
    new Map<
      string,
      BreakdownAccumulator
    >();

  for (
    const record of
    usage
  ) {
    const key =
      keyFor(
        record
      );

    const current =
      result.get(
        key
      ) || {
        key,

        label:
          labelFor(
            key
          ),

        requests:
          0,

        inputTokens:
          0,

        cachedInputTokens:
          0,

        outputTokens:
          0,

        totalTokens:
          0,

        cost:
          0,

        avgLatency:
          0,

        latencyTotal:
          0,

        latencyCount:
          0,
      };

    current.requests +=
      1;

    current.inputTokens +=
      number(
        record.input_tokens
      );

    current.cachedInputTokens +=
      number(
        record.cached_input_tokens
      );

    current.outputTokens +=
      number(
        record.output_tokens
      );

    current.totalTokens +=
      number(
        record.total_tokens
      );

    if (
      record.cost_available ===
      true
    ) {
      current.cost +=
        number(
          record.estimated_cost_usd
        );
    }

    if (
      record.success ===
      true
    ) {
      current.latencyTotal +=
        number(
          record.latency_ms
        );

      current.latencyCount +=
        1;
    }

    result.set(
      key,
      current
    );
  }

  return [
    ...result.values(),
  ]
    .map(
      (
        item
      ) => ({
        key:
          item.key,

        label:
          item.label,

        requests:
          item.requests,

        inputTokens:
          item.inputTokens,

        cachedInputTokens:
          item.cachedInputTokens,

        outputTokens:
          item.outputTokens,

        totalTokens:
          item.totalTokens,

        cost:
          item.cost,

        avgLatency:
          item.latencyCount >
          0
            ? item.latencyTotal /
              item.latencyCount
            : 0,
      })
    )
    .sort(
      (
        left,
        right
      ) =>
        right.totalTokens -
        left.totalTokens
    );
}

/*
 * ============================================
 * Employees
 * ============================================
 */

function buildEmployeeRows(
  questions:
    RecordModel[],

  conversations:
    RecordModel[],

  usage:
    UsageRecord[],

  accounts:
    Map<
      string,
      RecordModel
    >
) {
  const rows =
    new Map<
      string,
      EmployeeAccumulator
    >();

  const ensure = (
    userId:
      string
  ) => {
    if (
      !userId
    ) {
      return null;
    }

    const account =
      accounts.get(
        userId
      );

    const departmentValue =
      account?.expand
        ?.department;

    const department =
      Array.isArray(
        departmentValue
      )
        ? departmentValue[
            0
          ]
        : departmentValue;

    const existing =
      rows.get(
        userId
      ) || {
        id:
          userId,

        name:
          String(
            account?.name ||
              "کاربر نامشخص"
          ),

        email:
          String(
            account?.email ||
              ""
          ),

        employeeCode:
          String(
            account
              ?.employee_code ||
              ""
          ),

        department:
          String(
            department?.name ||
              ""
          ),

        questions:
          0,

        conversations:
          0,

        chatRequests:
          0,

        classificationRequests:
          0,

        totalTokens:
          0,

        cost:
          0,

        avgChatLatency:
          0,

        lastActivity:
          "",

        latencyTotal:
          0,

        latencyCount:
          0,
      };

    rows.set(
      userId,
      existing
    );

    return existing;
  };

  /*
   * ==========================================
   * Questions
   * ==========================================
   */

  for (
    const question of
    questions
  ) {
    const row =
      ensure(
        String(
          question.user ||
            ""
        )
      );

    if (
      !row
    ) {
      continue;
    }

    row.questions +=
      1;

    row.lastActivity =
      latest(
        row.lastActivity,

        String(
          question.created ||
            ""
        )
      );
  }

  /*
   * ==========================================
   * Conversations
   * ==========================================
   */

  for (
    const conversation of
    conversations
  ) {
    const row =
      ensure(
        String(
          conversation.user ||
            ""
        )
      );

    if (
      !row
    ) {
      continue;
    }

    row.conversations +=
      1;

    row.lastActivity =
      latest(
        row.lastActivity,

        String(
          conversation
            .last_message_at ||
            conversation.updated ||
            conversation.created ||
            ""
        )
      );
  }

  /*
   * ==========================================
   * AI Usage
   * ==========================================
   */

  for (
    const record of
    usage
  ) {
    const row =
      ensure(
        String(
          record.user ||
            ""
        )
      );

    if (
      !row
    ) {
      continue;
    }

    if (
      record.request_type ===
      "chat"
    ) {
      row.chatRequests +=
        1;

      if (
        record.success ===
        true
      ) {
        row.latencyTotal +=
          number(
            record.latency_ms
          );

        row.latencyCount +=
          1;
      }
    }

    if (
      record.request_type ===
      "classification"
    ) {
      row.classificationRequests +=
        1;
    }

    row.totalTokens +=
      number(
        record.total_tokens
      );

    if (
      record.cost_available ===
      true
    ) {
      row.cost +=
        number(
          record.estimated_cost_usd
        );
    }

    row.lastActivity =
      latest(
        row.lastActivity,

        String(
          record.created ||
            ""
        )
      );
  }

  return [
    ...rows.values(),
  ].map(
    (
      row
    ) => ({
      id:
        row.id,

      name:
        row.name,

      email:
        row.email,

      employeeCode:
        row.employeeCode,

      department:
        row.department,

      questions:
        row.questions,

      conversations:
        row.conversations,

      chatRequests:
        row.chatRequests,

      classificationRequests:
        row.classificationRequests,

      totalTokens:
        row.totalTokens,

      cost:
        row.cost,

      avgChatLatency:
        row.latencyCount >
        0
          ? row.latencyTotal /
            row.latencyCount
          : 0,

      lastActivity:
        row.lastActivity,
    })
  );
}

/*
 * ============================================
 * Employee Pagination
 * ============================================
 */

function paginateEmployees(
  rows:
    EmployeeUsageRow[],

  options:
    AnalyticsOptions
) {
  const search =
    String(
      options.employeeSearch ||
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
      .toLocaleLowerCase(
        "fa-IR"
      )
      .slice(
        0,
        MAX_EMPLOYEE_SEARCH_LENGTH
      );

  const requestedSort =
    String(
      options.employeeSort ||
        ""
    )
      .trim()
      .toLowerCase();

  const sort =
    EMPLOYEE_SORTS.has(
      requestedSort
    )
      ? requestedSort
      : "questions";

  const filtered =
    search
      ? rows.filter(
          (
            row
          ) =>
            [
              row.name,
              row.email,
              row.employeeCode,
            ]
              .join(
                " "
              )
              .toLocaleLowerCase(
                "fa-IR"
              )
              .includes(
                search
              )
        )
      : [
          ...rows,
        ];

  filtered.sort(
    (
      left,
      right
    ) => {
      if (
        sort ===
        "tokens"
      ) {
        return (
          right.totalTokens -
          left.totalTokens
        );
      }

      if (
        sort ===
        "cost"
      ) {
        return (
          right.cost -
          left.cost
        );
      }

      if (
        sort ===
        "activity"
      ) {
        return (
          dateNumber(
            right.lastActivity
          ) -
          dateNumber(
            left.lastActivity
          )
        );
      }

      if (
        sort ===
        "conversations"
      ) {
        return (
          right.conversations -
          left.conversations
        );
      }

      return (
        right.questions -
        left.questions
      );
    }
  );

  const perPage =
    integer(
      options.employeePerPage,
      1,
      MAX_EMPLOYEE_PER_PAGE,
      10
    );

  const totalItems =
    filtered.length;

  const totalPages =
    Math.max(
      1,
      Math.ceil(
        totalItems /
          perPage
      )
    );

  const requestedPage =
    integer(
      options.employeePage,
      1,
      MAX_EMPLOYEE_PAGE,
      1
    );

  const page =
    Math.min(
      requestedPage,
      totalPages
    );

  return {
    items:
      filtered.slice(
        (
          page -
          1
        ) *
          perPage,
        page *
          perPage
      ),

    page,

    perPage,

    totalItems,

    totalPages,

    sort,

    search,
  };
}

/*
 * ============================================
 * Accounts
 *
 * Chunked + limited concurrency.
 * ============================================
 */

async function loadAccounts(
  pb:
    PocketBase,

  ids:
    string[]
) {
  const map =
    new Map<
      string,
      RecordModel
    >();

  const safeIds =
    uniqueStrings(
      ids
    ).filter(
      isRecordId
    );

  if (
    safeIds.length ===
    0
  ) {
    return map;
  }

  const chunks =
    chunk(
      safeIds,
      ACCOUNT_LOOKUP_CHUNK_SIZE
    );

  const results =
    await mapWithConcurrency(
      chunks,
      ACCOUNT_LOOKUP_CONCURRENCY,
      async (
        idChunk,
        chunkIndex
      ) => {
        const values:
          Record<
            string,
            string
          > = {};

        const clauses =
          idChunk.map(
            (
              id,
              index
            ) => {
              const key =
                `id${chunkIndex}_${index}`;

              values[
                key
              ] =
                id;

              return `id = {:${key}}`;
            }
          );

        if (
          clauses.length ===
          0
        ) {
          return [] as RecordModel[];
        }

        /*
         * Chunk حداکثر 40 ID دارد.
         * getList به جای getFullList استفاده
         * می‌شود چون نتیجه ذاتاً محدود است.
         */
        const result =
          await pb
            .collection(
              "accounts"
            )
            .getList(
              1,
              ACCOUNT_LOOKUP_CHUNK_SIZE,
              {
                filter:
                  pb.filter(
                    clauses.join(
                      " || "
                    ),
                    values
                  ),

                fields:
                  "id,name,email,employee_code,department",

                expand:
                  "department",
              }
            );

        return result.items;
      }
    );

  for (
    const records of
    results
  ) {
    for (
      const record of
      records
    ) {
      map.set(
        record.id,
        record
      );
    }
  }

  return map;
}

/*
 * ============================================
 * Cost
 * ============================================
 */

function summarizeCost(
  records:
    UsageRecord[]
) {
  let total =
    0;

  let available =
    0;

  let unavailable =
    0;

  for (
    const record of
    records
  ) {
    if (
      record.cost_available ===
      true
    ) {
      total +=
        number(
          record.estimated_cost_usd
        );

      available +=
        1;
    } else {
      unavailable +=
        1;
    }
  }

  return {
    total,

    available,

    unavailable,
  };
}

/*
 * ============================================
 * Request Type Label
 * ============================================
 */

function requestTypeLabel(
  key:
    string
) {
  if (
    key ===
    "chat"
  ) {
    return "چت";
  }

  if (
    key ===
    "classification"
  ) {
    return "دسته‌بندی موضوع";
  }

  if (
    key ===
    "knowledge"
  ) {
    return "پایگاه دانش";
  }

  return key ===
    "other"
    ? "سایر"
    : key;
}

/*
 * ============================================
 * Promise Helpers
 * ============================================
 */

function settledBoundedValue<
  T extends RecordModel
>(
  result:
    PromiseSettledResult<
      BoundedListResult<T>
    >,

  message:
    string,

  errors:
    string[]
): BoundedListResult<T> {
  if (
    result.status ===
    "fulfilled"
  ) {
    return result.value;
  }

  errors.push(
    message
  );

  console.error(
    "Analytics widget query failed",
    {
      widget:
        message,

      error:
        errorMetadata(
          result.reason
        ),
    }
  );

  return {
    items:
      [],

    totalItems:
      0,

    truncated:
      false,
  };
}

/*
 * ============================================
 * Metric
 * ============================================
 */

function metric(
  value:
    number,

  previous:
    number
): AnalyticsMetric {
  return {
    value,

    previous,

    changePercent:
      previous ===
      0
        ? value ===
          0
          ? 0
          : null
        : (
            (
              value -
              previous
            ) /
            previous
          ) *
          100,
  };
}

/*
 * ============================================
 * Range
 * ============================================
 */

function isCurrent(
  value:
    unknown,

  range:
    AnalyticsRange
) {
  const timestamp =
    dateNumber(
      value
    );

  return (
    timestamp >=
      range.from
        .getTime() &&
    timestamp <
      range.to
        .getTime()
  );
}

function isPrevious(
  value:
    unknown,

  range:
    AnalyticsRange
) {
  const timestamp =
    dateNumber(
      value
    );

  return (
    timestamp >=
      range.previousFrom
        .getTime() &&
    timestamp <
      range.previousTo
        .getTime()
  );
}

/*
 * ============================================
 * Expand Helpers
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
  const value =
    record.expand?.[
      key
    ];

  if (
    !value ||
    Array.isArray(
      value
    )
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
): RecordModel[] {
  const value =
    record.expand?.[
      key
    ];

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
    return value as
      RecordModel[];
  }

  return [
    value as
      RecordModel,
  ];
}

/*
 * ============================================
 * Math
 * ============================================
 */

function average(
  values:
    number[]
) {
  return values.length >
    0
    ? values.reduce(
        (
          total,
          value
        ) =>
          total +
          value,
        0
      ) /
        values.length
    : 0;
}

function sum<T>(
  items:
    T[],

  getter: (
    item:
      T
  ) => number
) {
  return items.reduce(
    (
      total,
      item
    ) =>
      total +
      getter(
        item
      ),
    0
  );
}

function number(
  value:
    unknown
) {
  const parsed =
    Number(
      value
    );

  return Number.isFinite(
    parsed
  )
    ? Math.max(
        0,
        parsed
      )
    : 0;
}

function integer(
  value:
    unknown,

  min:
    number,

  max:
    number,

  fallback:
    number
) {
  const parsed =
    Number(
      value
    );

  return Number.isInteger(
    parsed
  )
    ? Math.min(
        Math.max(
          parsed,
          min
        ),
        max
      )
    : fallback;
}

function environmentInteger(
  value:
    string |
    undefined,

  min:
    number,

  max:
    number,

  fallback:
    number
) {
  const parsed =
    Number(
      value
    );

  if (
    !Number.isInteger(
      parsed
    )
  ) {
    return fallback;
  }

  return Math.min(
    Math.max(
      parsed,
      min
    ),
    max
  );
}

function environmentNumber(
  value:
    string |
    undefined,

  min:
    number,

  max:
    number,

  fallback:
    number
) {
  const parsed =
    Number(
      value
    );

  if (
    !Number.isFinite(
      parsed
    )
  ) {
    return fallback;
  }

  return Math.min(
    Math.max(
      parsed,
      min
    ),
    max
  );
}

/*
 * ============================================
 * String Helpers
 * ============================================
 */

function uniqueStrings(
  values:
    unknown[]
) {
  return [
    ...new Set(
      values
        .map(
          (
            value
          ) =>
            String(
              value ||
                ""
            )
              .trim()
        )
        .filter(
          Boolean
        )
    ),
  ];
}

function isRecordId(
  value:
    unknown
) {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(
    String(
      value ||
        ""
    )
  );
}

/*
 * ============================================
 * Dates
 * ============================================
 */

function latest(
  left:
    string,

  right:
    string
) {
  if (
    !left
  ) {
    return right;
  }

  if (
    !right
  ) {
    return left;
  }

  return dateNumber(
    right
  ) >
    dateNumber(
      left
    )
    ? right
    : left;
}

function dateNumber(
  value:
    unknown
) {
  const timestamp =
    Date.parse(
      String(
        value ||
          ""
      )
    );

  return Number.isFinite(
    timestamp
  )
    ? timestamp
    : 0;
}

function safeDate(
  value:
    unknown
) {
  const timestamp =
    dateNumber(
      value
    );

  if (
    timestamp <=
    0
  ) {
    return null;
  }

  return new Date(
    timestamp
  );
}

/*
 * ============================================
 * Array Helpers
 * ============================================
 */

function chunk<T>(
  items:
    T[],

  size:
    number
) {
  const chunks:
    T[][] = [];

  const safeSize =
    Math.max(
      1,
      Math.floor(
        size
      )
    );

  for (
    let index =
      0;

    index <
    items.length;

    index +=
      safeSize
  ) {
    chunks.push(
      items.slice(
        index,
        index +
          safeSize
      )
    );
  }

  return chunks;
}

/*
 * ============================================
 * Limited Concurrency
 * ============================================
 */

async function mapWithConcurrency<
  TItem,
  TResult
>(
  items:
    TItem[],

  concurrency:
    number,

  worker: (
    item:
      TItem,

    index:
      number
  ) => Promise<TResult>
) {
  const results =
    new Array<TResult>(
      items.length
    );

  if (
    items.length ===
    0
  ) {
    return results;
  }

  const workerCount =
    Math.min(
      Math.max(
        1,
        Math.floor(
          concurrency
        )
      ),
      items.length
    );

  let nextIndex =
    0;

  async function runWorker() {
    while (
      true
    ) {
      const currentIndex =
        nextIndex;

      if (
        currentIndex >=
        items.length
      ) {
        return;
      }

      nextIndex +=
        1;

      results[
        currentIndex
      ] =
        await worker(
          items[
            currentIndex
          ],
          currentIndex
        );
    }
  }

  await Promise.all(
    Array.from(
      {
        length:
          workerCount,
      },
      () =>
        runWorker()
    )
  );

  return results;
}

/*
 * ============================================
 * Error Metadata
 * ============================================
 */

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
      message?:
        unknown;

      status?:
        unknown;

      code?:
        unknown;
    };

  return {
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