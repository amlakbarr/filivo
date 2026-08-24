import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";

import {
  getTopicClassificationMinConfidence,
} from "@/lib/ai/classification";

import {
  getBucketKey,
  type AnalyticsRange,
} from "@/lib/analytics/range";

import type {
  AccountTopicAnalytics,
  TopicAnalyticsDashboard,
  TopicAnalyticsMetric,
  TopicAnalyticsTopic,
  TopicCount,
  TopicDetailsAnalytics,
  TopicQuestion,
} from "@/types/topic-analytics";

/*
 * ============================================
 * Types
 * ============================================
 */

type TopicFilters = {
  department: string;
  account: string;
  parentTopic: string;
  topic: string;
  status: string;
  trendTopics: string[];
  employeePage: number;
  unclassifiedPage: number;
};

type MessageRecord = RecordModel & {
  user?: string;
  conversation?: string;
  content?: string;
  topic?: string;
  topic_confidence?: number;
  classification_status?: string;
};

type AccountInfo = {
  id: string;
  name: string;
  employeeCode: string;
  departmentId: string;
  departmentName: string;
  active: boolean;
};

type DepartmentInfo = {
  id: string;
  name: string;
  active: boolean;
};

type BoundedRecordsResult<
  T extends RecordModel
> = {
  items: T[];
  totalItems: number;
  truncated: boolean;
};

type BoundedQueryOptions = {
  filter?: string;
  sort?: string;
  fields?: string;
  expand?: string;
};

/*
 * ============================================
 * Constants
 * ============================================
 */

const MAX_EMPLOYEE_PAGE =
  10_000;

const MAX_UNCLASSIFIED_PAGE =
  10_000;

const EMPLOYEE_PER_PAGE =
  10;

const UNCLASSIFIED_PER_PAGE =
  20;

const MAX_TREND_TOPICS =
  5;

const MAX_TREND_QUERY_LENGTH =
  1024;

const QUERY_PAGE_SIZE =
  500;

/*
 * حداکثر Message برای هر Period.
 *
 * یعنی Current و Previous هرکدام سقف مستقل
 * دارند تا یک Period باعث حذف داده Period
 * دیگر نشود.
 */
const DEFAULT_MAX_MESSAGES_PER_PERIOD =
  20_000;

const MAX_MESSAGES_PER_PERIOD =
  100_000;

/*
 * Accounts یک Lookup نسبتاً بزرگ است ولی نباید
 * بدون سقف getFullList شود.
 */
const DEFAULT_MAX_ACCOUNT_ROWS =
  10_000;

const MAX_ACCOUNT_ROWS =
  50_000;

/*
 * ============================================
 * Parse Filters
 * ============================================
 */

export function parseTopicAnalyticsFilters(
  params: URLSearchParams
): TopicFilters {
  const status =
    String(
      params.get("status") ||
        ""
    )
      .trim()
      .toLowerCase();

  return {
    department:
      safeId(
        params.get(
          "department"
        )
      ),

    account:
      safeId(
        params.get(
          "account"
        )
      ),

    parentTopic:
      safeId(
        params.get(
          "parentTopic"
        )
      ),

    topic:
      safeId(
        params.get(
          "topic"
        )
      ),

    status: [
      "classified",
      "unclassified",
      "pending",
      "error",
    ].includes(
      status
    )
      ? status
      : "",

    trendTopics:
      parseTrendTopics(
        params.get(
          "trendTopics"
        )
      ),

    employeePage:
      pageInteger(
        params.get(
          "employeePage"
        ),
        MAX_EMPLOYEE_PAGE
      ),

    unclassifiedPage:
      pageInteger(
        params.get(
          "unclassifiedPage"
        ),
        MAX_UNCLASSIFIED_PAGE
      ),
  };
}

/*
 * ============================================
 * Dashboard
 * ============================================
 */

export async function getTopicAnalyticsDashboard(
  pb: PocketBase,
  range: AnalyticsRange,
  filters: TopicFilters
): Promise<TopicAnalyticsDashboard> {
  const errors: string[] =
    [];

  /*
   * ==========================================
   * Lookups
   *
   * topics/departments معمولاً Lookupهای کوچک
   * هستند.
   *
   * accounts می‌تواند بزرگ شود، بنابراین
   * bounded pagination دارد.
   * ==========================================
   */

  const [
    topicResult,
    accountResult,
    departmentResult,
  ] =
    await Promise.allSettled([
      pb
        .collection(
          "topics"
        )
        .getFullList({
          sort:
            "name",

          fields:
            "id,name,parent,description,active,expand.parent.id,expand.parent.name,expand.parent.active",

          expand:
            "parent",
        }),

      loadBoundedRecords<RecordModel>(
        pb,
        "accounts",
        {
          sort:
            "name",

          fields:
            "id,name,email,employee_code,department,active,expand.department.id,expand.department.name,expand.department.active",

          expand:
            "department",
        },
        getAccountRowLimit()
      ),

      pb
        .collection(
          "departments"
        )
        .getFullList({
          sort:
            "name",

          fields:
            "id,name,active",
        }),
    ]);

  const topicRecords =
    settledList(
      topicResult,
      "فهرست موضوعات در دسترس نیست.",
      errors
    );

  const accountData =
    settledBounded(
      accountResult,
      "فهرست کارشناسان در دسترس نیست.",
      errors
    );

  const departmentRecords =
    settledList(
      departmentResult,
      "فهرست واحدها در دسترس نیست.",
      errors
    );

  if (
    accountData.truncated
  ) {
    errors.push(
      `فهرست کارشناسان از سقف تحلیلی عبور کرده است؛ ${accountData.items.length.toLocaleString(
        "fa-IR"
      )} حساب از ${accountData.totalItems.toLocaleString(
        "fa-IR"
      )} حساب بارگذاری شد.`
    );
  }

  /*
   * ==========================================
   * Topic Lookup
   * ==========================================
   */

  const topics =
    buildTopics(
      topicRecords
    );

  const topicMap =
    new Map(
      topics.map(
        (
          item
        ) => [
          item.id,
          item,
        ]
      )
    );

  /*
   * ==========================================
   * Account Lookup
   * ==========================================
   */

  let accounts =
    buildAccounts(
      accountData.items
    );

  let accountMap =
    new Map(
      accounts.map(
        (
          item
        ) => [
          item.id,
          item,
        ]
      )
    );

  /*
   * اگر Account مشخصی Filter شده ولی به‌دلیل
   * Account cap داخل lookup عمومی نیامده است،
   * همان Account را مستقیم Load می‌کنیم.
   */
  if (
    filters.account &&
    !accountMap.has(
      filters.account
    )
  ) {
    try {
      const selectedAccount =
        await loadAccountInfo(
          pb,
          filters.account
        );

      if (
        selectedAccount
      ) {
        accounts = [
          ...accounts,
          selectedAccount,
        ];

        accountMap =
          new Map(
            accounts.map(
              (
                item
              ) => [
                item.id,
                item,
              ]
            )
          );
      }
    } catch (error) {
      errors.push(
        "مشخصات کارشناس انتخاب‌شده در دسترس نیست."
      );

      console.error(
        "Topic analytics selected account lookup failed",
        {
          accountId:
            filters.account,

          error:
            errorMetadata(
              error
            ),
        }
      );
    }
  }

  /*
   * ==========================================
   * Departments
   * ==========================================
   */

  const departments:
    DepartmentInfo[] =
    departmentRecords
      .map(
        (
          record
        ) => ({
          id:
            record.id,

          name:
            String(
              record.name ||
                ""
            ).trim(),

          active:
            record.active !==
            false,
        })
      )
      .filter(
        (
          item
        ) =>
          Boolean(
            item.name
          )
      );

  /*
   * ==========================================
   * Parent Topic Scope
   * ==========================================
   */

  const allowedTopicIds =
    filters.parentTopic
      ? descendantTopicIds(
          filters.parentTopic,
          topics
        )
      : [];

  /*
   * ==========================================
   * Current + Previous Queries
   *
   * دیگر getFullList(messages) نداریم.
   * هر Period مستقل و سقف‌دار است.
   * ==========================================
   */

  const [
    currentResult,
    previousResult,
  ] =
    await Promise.allSettled([
      loadBoundedRecords<MessageRecord>(
        pb,
        "messages",
        {
          filter:
            buildRangeMessageFilter(
              range.from,
              range.to,
              filters,
              allowedTopicIds,
              pb
            ),

          sort:
            "created",

          /*
           * content برای Aggregation لازم نیست
           * و می‌تواند بسیار حجیم باشد.
           */
          fields:
            "id,user,conversation,topic,topic_confidence,classification_status,created",
        },
        getMessageRowLimit()
      ),

      loadBoundedRecords<MessageRecord>(
        pb,
        "messages",
        {
          filter:
            buildRangeMessageFilter(
              range.previousFrom,
              range.previousTo,
              filters,
              allowedTopicIds,
              pb
            ),

          sort:
            "created",

          fields:
            "id,user,conversation,topic,topic_confidence,classification_status,created",
        },
        getMessageRowLimit()
      ),
    ]);

  const currentData =
    settledBounded(
      currentResult,
      "داده پیام‌های موضوعی بازه فعلی در دسترس نیست.",
      errors
    );

  const previousData =
    settledBounded(
      previousResult,
      "داده پیام‌های موضوعی بازه قبلی در دسترس نیست.",
      errors
    );

  if (
    currentData.truncated
  ) {
    errors.push(
      `داده موضوعی بازه فعلی از سقف تحلیلی عبور کرده است؛ ${currentData.items.length.toLocaleString(
        "fa-IR"
      )} پیام از ${currentData.totalItems.toLocaleString(
        "fa-IR"
      )} پیام تحلیل شد.`
    );
  }

  if (
    previousData.truncated
  ) {
    errors.push(
      `داده موضوعی بازه قبلی از سقف تحلیلی عبور کرده است؛ ${previousData.items.length.toLocaleString(
        "fa-IR"
      )} پیام از ${previousData.totalItems.toLocaleString(
        "fa-IR"
      )} پیام تحلیل شد.`
    );
  }

  const current =
    currentData.items;

  const previous =
    previousData.items;

  /*
   * ==========================================
   * Statistics
   * ==========================================
   */

  const currentStats =
    statusStats(
      current
    );

  const previousStats =
    statusStats(
      previous
    );

  const topicCounts =
    aggregateTopics(
      current,
      previous,
      topics,
      accountMap
    );

  const parentCounts =
    aggregateParents(
      current,
      previous,
      topics,
      accountMap
    );

  /*
   * ==========================================
   * Trend Topics
   * ==========================================
   */

  const selectedTrendIds =
    (
      filters.trendTopics.length >
      0
        ? filters.trendTopics
        : topicCounts
            .slice(
              0,
              3
            )
            .map(
              (
                item
              ) =>
                item.id
            )
    ).filter(
      (
        id
      ) =>
        topicMap.has(
          id
        )
    );

  /*
   * ==========================================
   * Employees
   * ==========================================
   */

  const employeeRows =
    aggregateEmployees(
      current,
      accountMap,
      topicMap
    );

  const employeePage =
    paginate(
      employeeRows,
      filters.employeePage,
      EMPLOYEE_PER_PAGE
    );

  /*
   * ==========================================
   * Departments
   * ==========================================
   */

  const departmentRows =
    aggregateDepartments(
      current,
      accounts,
      departments,
      topicMap
    );

  /*
   * ==========================================
   * Confidence
   * ==========================================
   */

  const confidence =
    confidenceStats(
      current,
      topicMap,
      getTopicClassificationMinConfidence()
    );

  /*
   * ==========================================
   * Top Topic
   * ==========================================
   */

  const topTopic =
    topicCounts[0] ||
    null;

  const topPrevious =
    topTopic
      ? topTopic.previousCount
      : 0;

  /*
   * ==========================================
   * Heatmap
   * ==========================================
   */

  const heatmapTopics =
    topicCounts.slice(
      0,
      8
    );

  const heatmapRows =
    departmentRows
      .slice(
        0,
        10
      )
      .map(
        (
          department
        ) => ({
          id:
            department.id,

          name:
            department.name,

          values:
            Object.fromEntries(
              heatmapTopics.map(
                (
                  topic
                ) => [
                  topic.id,

                  department
                    .topTopics
                    .find(
                      (
                        item
                      ) =>
                        item.id ===
                        topic.id
                    )
                    ?.count ||
                    0,
                ]
              )
            ),
        })
      );

  const heatmapMax =
    Math.max(
      0,
      ...heatmapRows.flatMap(
        (
          row
        ) =>
          Object.values(
            row.values
          )
      )
    );

  /*
   * ==========================================
   * Unclassified
   *
   * قبلاً content تمام Messageهای Analytics
   * Load می‌شد.
   *
   * حالا فقط همان Page موردنیاز مستقیماً از
   * PocketBase خوانده می‌شود.
   * ==========================================
   */

  let unclassified:
    TopicQuestion[] =
    [];

  let unclassifiedPageNumber =
    1;

  let unclassifiedTotalPages =
    1;

  try {
    const result =
      await loadUnclassifiedPage(
        pb,
        range,
        filters,
        allowedTopicIds,
        accountMap,
        topicMap
      );

    unclassified =
      result.items;

    unclassifiedPageNumber =
      result.page;

    unclassifiedTotalPages =
      result.totalPages;
  } catch (error) {
    errors.push(
      "فهرست پیام‌های دسته‌بندی‌نشده در دسترس نیست."
    );

    console.error(
      "Topic analytics unclassified page failed",
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
   * Response
   * ==========================================
   */

  return {
    range:
      rangeInfo(
        range
      ),

    filters: {
      department:
        filters.department,

      account:
        filters.account,

      parentTopic:
        filters.parentTopic,

      topic:
        filters.topic,

      status:
        filters.status,

      trendTopics:
        selectedTrendIds,

      unclassifiedPage:
        unclassifiedPageNumber,
    },

    lookups: {
      departments,

      accounts:
        accounts.map(
          (
            account
          ) => ({
            id:
              account.id,

            name:
              account.name,

            employeeCode:
              account.employeeCode,

            departmentId:
              account.departmentId,

            active:
              account.active,
          })
        ),

      topics,

      parentTopics:
        topics.filter(
          (
            topic
          ) =>
            !topic.parentId
        ),
    },

    kpis: {
      total:
        metric(
          current.length,
          previous.length
        ),

      classified:
        metric(
          currentStats.classified,
          previousStats.classified
        ),

      unclassified:
        metric(
          currentStats.unclassified,
          previousStats.unclassified
        ),

      error:
        currentStats.error,

      pending:
        currentStats.pending,

      usedTopics:
        new Set(
          current
            .map(
              (
                item
              ) =>
                String(
                  item.topic ||
                    ""
                )
            )
            .filter(
              (
                id
              ) =>
                topicMap.get(
                  id
                )?.active
            )
        ).size,

      classificationRate:
        current.length >
        0
          ? (
              currentStats.classified /
              current.length
            ) *
            100
          : 0,

      topTopic:
        topTopic ===
        null
          ? null
          : {
              ...topTopic,

              previousCount:
                topPrevious,
            },
    },

    topics:
      topicCounts.slice(
        0,
        50
      ),

    parents:
      parentCounts,

    trend:
      buildTrend(
        current,
        range,
        selectedTrendIds,
        topicMap
      ),

    employees:
      employeePage,

    departments:
      departmentRows,

    heatmap: {
      topics:
        heatmapTopics.map(
          (
            topic
          ) => ({
            id:
              topic.id,

            path:
              topic.path,
          })
        ),

      rows:
        heatmapRows,

      maxValue:
        heatmapMax,
    },

    confidence,

    unclassified,

    unclassifiedTotalPages,

    errors,
  };
}

/*
 * ============================================
 * Topic Details
 * ============================================
 */

export async function getTopicDetailsAnalytics(
  pb: PocketBase,
  range: AnalyticsRange,
  filters: TopicFilters,
  topicId: string
): Promise<TopicDetailsAnalytics | null> {
  const exactDashboard =
    await getTopicAnalyticsDashboard(
      pb,
      range,
      {
        ...filters,

        topic:
          topicId,

        parentTopic:
          "",

        trendTopics: [
          topicId,
        ],

        employeePage:
          1,
      }
    );

  const topic =
    exactDashboard
      .lookups
      .topics
      .find(
        (
          item
        ) =>
          item.id ===
          topicId
      );

  if (
    !topic
  ) {
    return null;
  }

  const children =
    exactDashboard
      .lookups
      .topics
      .filter(
        (
          item
        ) =>
          item.parentId ===
          topicId
      );

  const scopedDashboard =
    children.length >
    0
      ? await getTopicAnalyticsDashboard(
          pb,
          range,
          {
            ...filters,

            topic:
              "",

            parentTopic:
              topicId,

            trendTopics:
              children
                .slice(
                  0,
                  5
                )
                .map(
                  (
                    item
                  ) =>
                    item.id
                ),

            employeePage:
              1,
          }
        )
      : exactDashboard;

  const summary =
    scopedDashboard
      .topics
      .find(
        (
          item
        ) =>
          item.id ===
          topicId
      );

  const childBreakdown =
    children.length >
    0
      ? scopedDashboard
          .topics
          .filter(
            (
              item
            ) =>
              children.some(
                (
                  child
                ) =>
                  child.id ===
                  item.id
              )
          )
      : [];

  const recentQuestions =
    await loadRecentQuestions(
      pb,
      range,
      children.length >
      0
        ? {
            ...filters,

            topic:
              "",

            parentTopic:
              topicId,
          }
        : {
            ...filters,

            topic:
              topicId,

            parentTopic:
              "",
          },

      scopedDashboard.lookups,

      "classified",

      20
    );

  return {
    topic,

    range:
      scopedDashboard.range,

    total:
      children.length >
      0
        ? scopedDashboard
            .kpis
            .total
            .value
        : summary?.count ||
          0,

    uniqueUsers:
      children.length >
      0
        ? scopedDashboard
            .employees
            .totalItems
        : summary
            ?.uniqueUsers ||
          0,

    uniqueDepartments:
      children.length >
      0
        ? scopedDashboard
            .departments
            .length
        : summary
            ?.uniqueDepartments ||
          0,

    averageConfidence:
      children.length >
      0
        ? scopedDashboard
            .confidence
            .average
        : summary
            ?.averageConfidence ||
          0,

    trend:
      scopedDashboard.trend,

    topEmployees:
      scopedDashboard
        .employees
        .items,

    childBreakdown,

    recentQuestions,
  };
}

/*
 * ============================================
 * Account Topic Analytics
 * ============================================
 */

export async function getAccountTopicAnalytics(
  pb: PocketBase,
  range: AnalyticsRange,
  filters: TopicFilters,
  accountId: string
): Promise<AccountTopicAnalytics | null> {
  if (
    !isSafeId(
      accountId
    )
  ) {
    return null;
  }

  const dashboard =
    await getTopicAnalyticsDashboard(
      pb,
      range,
      {
        ...filters,

        account:
          accountId,

        employeePage:
          1,
      }
    );

  let account =
    dashboard
      .lookups
      .accounts
      .find(
        (
          item
        ) =>
          item.id ===
          accountId
      );

  /*
   * اگر Account به علت Account cap در Lookup
   * عمومی نبوده، مستقیم بررسی می‌کنیم.
   */
  let fullAccount:
    AccountInfo |
    null =
    null;

  if (
    !account
  ) {
    try {
      fullAccount =
        await loadAccountInfo(
          pb,
          accountId
        );
    } catch (error) {
      console.error(
        "Account topic analytics direct account lookup failed",
        {
          accountId,

          error:
            errorMetadata(
              error
            ),
        }
      );

      throw error;
    }

    if (
      !fullAccount
    ) {
      return null;
    }

    account = {
      id:
        fullAccount.id,

      name:
        fullAccount.name,

      employeeCode:
        fullAccount.employeeCode,

      departmentId:
        fullAccount.departmentId,

      active:
        fullAccount.active,
    };
  }

  const department =
    dashboard
      .lookups
      .departments
      .find(
        (
          item
        ) =>
          item.id ===
          account.departmentId
      );

  const recentClassified =
    await loadRecentQuestions(
      pb,
      range,
      {
        ...filters,

        account:
          accountId,
      },

      dashboard.lookups,

      "classified",

      20
    );

  return {
    account: {
      id:
        account.id,

      name:
        account.name,

      employeeCode:
        account.employeeCode,

      department:
        fullAccount
          ?.departmentName ||
        department?.name ||
        "",
    },

    dashboard,

    recentClassified,
  };
}

/*
 * ============================================
 * Range Message Filter
 * ============================================
 */

function buildRangeMessageFilter(
  from: Date,
  to: Date,
  filters: TopicFilters,
  parentTopicIds: string[],
  pb: PocketBase
) {
  const values:
    Record<
      string,
      string
    > = {
    from:
      from.toISOString(),

    to:
      to.toISOString(),
  };

  const clauses = [
    "role = 'user'",
    "created >= {:from}",
    "created < {:to}",
  ];

  /*
   * ==========================================
   * Account / Department
   * ==========================================
   */

  if (
    filters.account
  ) {
    values.account =
      filters.account;

    clauses.push(
      "user = {:account}"
    );
  } else if (
    filters.department
  ) {
    /*
     * PocketBase Relation Traversal.
     *
     * دیگر هزاران Account ID را با OR وارد
     * Filter نمی‌کنیم.
     */
    values.department =
      filters.department;

    clauses.push(
      "user.department = {:department}"
    );
  }

  /*
   * ==========================================
   * Topic
   * ==========================================
   */

  if (
    filters.topic
  ) {
    values.topic =
      filters.topic;

    clauses.push(
      "topic = {:topic}"
    );
  } else if (
    filters.parentTopic
  ) {
    if (
      parentTopicIds.length ===
      0
    ) {
      clauses.push(
        "id = '__no_topic_match__'"
      );
    } else {
      clauses.push(
        `(${relationClauses(
          "topic",
          parentTopicIds,
          values,
          "parentTopic"
        )})`
      );
    }
  }

  /*
   * ==========================================
   * Status
   * ==========================================
   */

  if (
    filters.status
  ) {
    values.status =
      filters.status;

    clauses.push(
      "classification_status = {:status}"
    );
  }

  return pb.filter(
    clauses.join(
      " && "
    ),
    values
  );
}

/*
 * ============================================
 * Current Filter
 * ============================================
 */

function buildCurrentOnlyFilter(
  range: AnalyticsRange,
  filters: TopicFilters,
  parentTopicIds: string[],
  pb: PocketBase
) {
  return buildRangeMessageFilter(
    range.from,
    range.to,
    filters,
    parentTopicIds,
    pb
  );
}

/*
 * ============================================
 * Recent Questions
 * ============================================
 */

async function loadRecentQuestions(
  pb: PocketBase,
  range: AnalyticsRange,
  filters: TopicFilters,
  lookups: TopicAnalyticsDashboard["lookups"],
  status: string,
  limit: number
) {
  const accounts =
    lookups.accounts.map(
      (
        item
      ) => ({
        id:
          item.id,

        name:
          item.name,

        employeeCode:
          item.employeeCode,

        departmentId:
          item.departmentId,

        departmentName:
          lookups.departments.find(
            (
              department
            ) =>
              department.id ===
              item.departmentId
          )?.name ||
          "",

        active:
          item.active,
      })
    );

  const accountMap =
    new Map(
      accounts.map(
        (
          item
        ) => [
          item.id,
          item,
        ]
      )
    );

  const topicMap =
    new Map(
      lookups.topics.map(
        (
          item
        ) => [
          item.id,
          item,
        ]
      )
    );

  const scoped: TopicFilters = {
    ...filters,

    status:
      [
        "classified",
        "unclassified",
        "pending",
        "error",
      ].includes(
        status
      )
        ? status
        : "",
  };

  const parentIds =
    scoped.parentTopic
      ? descendantTopicIds(
          scoped.parentTopic,
          lookups.topics
        )
      : [];

  const filter =
    buildCurrentOnlyFilter(
      range,
      scoped,
      parentIds,
      pb
    );

  const safeLimit =
    integer(
      limit,
      1,
      100,
      20
    );

  const result =
    await pb
      .collection(
        "messages"
      )
      .getList<MessageRecord>(
        1,
        safeLimit,
        {
          filter,

          sort:
            "-created",

          fields:
            "id,user,conversation,content,topic,topic_confidence,classification_status,created",
        }
      );

  /*
   * اگر Account خاصی خارج از Lookup عمومی
   * بوده باشد، برای Recent Questions نیز آن
   * را Load می‌کنیم.
   */
  const missingIds =
    [
      ...new Set(
        result.items
          .map(
            (
              item
            ) =>
              String(
                item.user ||
                  ""
              )
          )
          .filter(
            (
              id
            ) =>
              isSafeId(
                id
              ) &&
              !accountMap.has(
                id
              )
          )
      ),
    ].slice(
      0,
      100
    );

  if (
    missingIds.length >
    0
  ) {
    try {
      const extra =
        await loadAccountsByIds(
          pb,
          missingIds
        );

      for (
        const item of
        extra
      ) {
        accountMap.set(
          item.id,
          item
        );
      }
    } catch (error) {
      console.error(
        "Recent topic questions account lookup failed",
        {
          error:
            errorMetadata(
              error
            ),
        }
      );
    }
  }

  return result.items.map(
    (
      item
    ) =>
      serializeQuestion(
        item,
        accountMap,
        topicMap
      )
  );
}

/*
 * ============================================
 * Unclassified Page
 * ============================================
 */

async function loadUnclassifiedPage(
  pb: PocketBase,
  range: AnalyticsRange,
  filters: TopicFilters,
  parentTopicIds: string[],
  accountMap: Map<
    string,
    AccountInfo
  >,
  topicMap: Map<
    string,
    TopicAnalyticsTopic
  >
) {
  const scoped: TopicFilters = {
    ...filters,

    status:
      "unclassified",
  };

  let requestedPage =
    Math.min(
      Math.max(
        filters.unclassifiedPage,
        1
      ),
      MAX_UNCLASSIFIED_PAGE
    );

  const filter =
    buildCurrentOnlyFilter(
      range,
      scoped,
      parentTopicIds,
      pb
    );

  let result =
    await pb
      .collection(
        "messages"
      )
      .getList<MessageRecord>(
        requestedPage,
        UNCLASSIFIED_PER_PAGE,
        {
          filter,

          sort:
            "-created",

          fields:
            "id,user,conversation,content,topic,topic_confidence,classification_status,created",
        }
      );

  const totalPages =
    Math.max(
      1,
      result.totalPages
    );

  /*
   * رفتار قبلی Pagination:
   * Page خارج از Range به آخرین Page Clamp شود.
   */
  if (
    requestedPage >
    totalPages
  ) {
    requestedPage =
      totalPages;

    result =
      await pb
        .collection(
          "messages"
        )
        .getList<MessageRecord>(
          requestedPage,
          UNCLASSIFIED_PER_PAGE,
          {
            filter,

            sort:
              "-created",

            fields:
              "id,user,conversation,content,topic,topic_confidence,classification_status,created",
          }
        );
  }

  /*
   * Accountهای خارج از Lookup عمومی
   */
  const missingIds =
    [
      ...new Set(
        result.items
          .map(
            (
              item
            ) =>
              String(
                item.user ||
                  ""
              )
          )
          .filter(
            (
              id
            ) =>
              isSafeId(
                id
              ) &&
              !accountMap.has(
                id
              )
          )
      ),
    ];

  if (
    missingIds.length >
    0
  ) {
    try {
      const extraAccounts =
        await loadAccountsByIds(
          pb,
          missingIds
        );

      for (
        const account of
        extraAccounts
      ) {
        accountMap.set(
          account.id,
          account
        );
      }
    } catch (error) {
      console.error(
        "Unclassified account lookup failed",
        {
          error:
            errorMetadata(
              error
            ),
        }
      );
    }
  }

  return {
    items:
      result.items.map(
        (
          message
        ) =>
          serializeQuestion(
            message,
            accountMap,
            topicMap
          )
      ),

    page:
      requestedPage,

    totalPages:
      Math.max(
        1,
        result.totalPages
      ),

    totalItems:
      result.totalItems,
  };
}

/*
 * ============================================
 * Topics
 * ============================================
 */

function buildTopics(
  records: RecordModel[]
) {
  const raw =
    records
      .map(
        (
          record
        ) => ({
          id:
            record.id,

          name:
            String(
              record.name ||
                ""
            ).trim(),

          parentId:
            String(
              record.parent ||
                ""
            ),

          description:
            String(
              record.description ||
                ""
            ).trim(),

          active:
            record.active !==
            false,
        })
      )
      .filter(
        (
          item
        ) =>
          Boolean(
            item.name
          )
      );

  const rawMap =
    new Map(
      raw.map(
        (
          item
        ) => [
          item.id,
          item,
        ]
      )
    );

  const pathFor = (
    item: (typeof raw)[number]
  ) => {
    const parts = [
      item.name,
    ];

    const visited =
      new Set([
        item.id,
      ]);

    let parentId =
      item.parentId;

    while (
      parentId &&
      !visited.has(
        parentId
      )
    ) {
      visited.add(
        parentId
      );

      const parent =
        rawMap.get(
          parentId
        );

      if (
        !parent
      ) {
        break;
      }

      parts.unshift(
        parent.name
      );

      parentId =
        parent.parentId;
    }

    return parts.join(
      " > "
    );
  };

  return raw.map(
    (
      item
    ) => ({
      ...item,

      path:
        pathFor(
          item
        ),

      parentName:
        rawMap.get(
          item.parentId
        )?.name ||
        "",
    } satisfies TopicAnalyticsTopic)
  );
}

/*
 * ============================================
 * Accounts
 * ============================================
 */

function buildAccounts(
  records: RecordModel[]
) {
  return records.map(
    (
      record
    ) => {
      const department =
        expanded(
          record,
          "department"
        );

      return {
        id:
          record.id,

        name:
          String(
            record.name ||
              record.email ||
              "کاربر نامشخص"
          ),

        employeeCode:
          String(
            record.employee_code ||
              ""
          ),

        departmentId:
          String(
            record.department ||
              ""
          ),

        departmentName:
          String(
            department?.name ||
              ""
          ),

        active:
          record.active !==
          false,
      } satisfies AccountInfo;
    }
  );
}

/*
 * ============================================
 * Direct Account Lookup
 * ============================================
 */

async function loadAccountInfo(
  pb: PocketBase,
  id: string
): Promise<AccountInfo | null> {
  if (
    !isSafeId(
      id
    )
  ) {
    return null;
  }

  try {
    const record =
      await pb
        .collection(
          "accounts"
        )
        .getOne(
          id,
          {
            fields:
              "id,name,email,employee_code,department,active,expand.department.id,expand.department.name",

            expand:
              "department",
          }
        );

    return buildAccounts([
      record,
    ])[0] ||
      null;
  } catch (error) {
    if (
      errorMetadata(
        error
      ).status ===
      404
    ) {
      return null;
    }

    throw error;
  }
}

/*
 * ============================================
 * Accounts By IDs
 * ============================================
 */

async function loadAccountsByIds(
  pb: PocketBase,
  ids: string[]
) {
  const uniqueIds =
    [
      ...new Set(
        ids.filter(
          isSafeId
        )
      ),
    ].slice(
      0,
      100
    );

  if (
    uniqueIds.length ===
    0
  ) {
    return [];
  }

  const values:
    Record<
      string,
      string
    > = {};

  const clauses =
    uniqueIds.map(
      (
        id,
        index
      ) => {
        const key =
          `account${index}`;

        values[
          key
        ] =
          id;

        return `id = {:${key}}`;
      }
    );

  const result =
    await pb
      .collection(
        "accounts"
      )
      .getList(
        1,
        uniqueIds.length,
        {
          filter:
            pb.filter(
              clauses.join(
                " || "
              ),
              values
            ),

          fields:
            "id,name,email,employee_code,department,active,expand.department.id,expand.department.name",

          expand:
            "department",
        }
      );

  return buildAccounts(
    result.items
  );
}

/*
 * ============================================
 * Topic Aggregation
 * ============================================
 */

function aggregateTopics(
  current: MessageRecord[],
  previous: MessageRecord[],
  topics: TopicAnalyticsTopic[],
  accounts: Map<
    string,
    AccountInfo
  >
) {
  const currentMap =
    countByTopic(
      current,
      accounts
    );

  const previousMap =
    countByTopic(
      previous,
      accounts
    );

  const total =
    current.length;

  return topics
    .map(
      (
        topic
      ) => {
        const stats =
          currentMap.get(
            topic.id
          );

        const confidences =
          stats?.confidences ||
          [];

        return {
          ...topic,

          count:
            stats?.count ||
            0,

          previousCount:
            previousMap.get(
              topic.id
            )?.count ||
            0,

          percentage:
            total >
            0
              ? (
                  (
                    stats?.count ||
                    0
                  ) /
                  total
                ) *
                100
              : 0,

          averageConfidence:
            average(
              confidences
            ),

          uniqueUsers:
            stats?.users
              .size ||
            0,

          uniqueDepartments:
            stats
              ?.departments
              .size ||
            0,
        } satisfies TopicCount;
      }
    )
    .filter(
      (
        topic
      ) =>
        topic.count >
          0 ||
        topic.previousCount >
          0
    )
    .sort(
      (
        left,
        right
      ) =>
        right.count -
        left.count
    );
}

/*
 * ============================================
 * Parent Aggregation
 * ============================================
 */

function aggregateParents(
  current: MessageRecord[],
  previous: MessageRecord[],
  topics: TopicAnalyticsTopic[],
  accounts: Map<
    string,
    AccountInfo
  >
) {
  const topicMap =
    new Map(
      topics.map(
        (
          item
        ) => [
          item.id,
          item,
        ]
      )
    );

  const parents =
    topics.filter(
      (
        item
      ) =>
        !item.parentId
    );

  const mapMessage = (
    message:
      MessageRecord
  ) => {
    let topic =
      topicMap.get(
        String(
          message.topic ||
            ""
        )
      );

    if (
      !topic
    ) {
      return "";
    }

    const visited =
      new Set<
        string
      >();

    while (
      topic.parentId &&
      !visited.has(
        topic.id
      )
    ) {
      visited.add(
        topic.id
      );

      const parent =
        topicMap.get(
          topic.parentId
        );

      if (
        !parent
      ) {
        break;
      }

      topic =
        parent;
    }

    return topic.id;
  };

  const currentMap =
    countByKey(
      current,
      mapMessage,
      accounts
    );

  const previousMap =
    countByKey(
      previous,
      mapMessage,
      accounts
    );

  const total =
    current.length;

  return parents
    .map(
      (
        parent
      ) => {
        const stats =
          currentMap.get(
            parent.id
          );

        return {
          ...parent,

          count:
            stats?.count ||
            0,

          previousCount:
            previousMap.get(
              parent.id
            )?.count ||
            0,

          percentage:
            total >
            0
              ? (
                  (
                    stats?.count ||
                    0
                  ) /
                  total
                ) *
                100
              : 0,

          averageConfidence:
            average(
              stats
                ?.confidences ||
                []
            ),

          uniqueUsers:
            stats?.users
              .size ||
            0,

          uniqueDepartments:
            stats
              ?.departments
              .size ||
            0,
        } satisfies TopicCount;
      }
    )
    .filter(
      (
        item
      ) =>
        item.count >
          0 ||
        item.previousCount >
          0
    )
    .sort(
      (
        left,
        right
      ) =>
        right.count -
        left.count
    );
}

/*
 * ============================================
 * Count By Topic
 * ============================================
 */

function countByTopic(
  messages: MessageRecord[],
  accounts: Map<
    string,
    AccountInfo
  >
) {
  return countByKey(
    messages,
    (
      message
    ) =>
      String(
        message.topic ||
          ""
      ),
    accounts
  );
}

/*
 * ============================================
 * Count By Key
 * ============================================
 */

function countByKey(
  messages: MessageRecord[],
  keyFor: (
    message:
      MessageRecord
  ) => string,
  accounts: Map<
    string,
    AccountInfo
  >
) {
  const result =
    new Map<
      string,
      {
        count: number;
        users: Set<string>;
        departments: Set<string>;
        confidences: number[];
      }
    >();

  for (
    const message of
    messages
  ) {
    const key =
      keyFor(
        message
      );

    if (
      !key
    ) {
      continue;
    }

    const userId =
      String(
        message.user ||
          ""
      );

    const departmentId =
      accounts.get(
        userId
      )?.departmentId ||
      "";

    const current =
      result.get(
        key
      ) || {
        count:
          0,

        users:
          new Set<
            string
          >(),

        departments:
          new Set<
            string
          >(),

        confidences:
          [],
      };

    current.count +=
      1;

    if (
      userId
    ) {
      current.users.add(
        userId
      );
    }

    if (
      departmentId
    ) {
      current.departments.add(
        departmentId
      );
    }

    if (
      normalizeStatus(
        message.classification_status
      ) ===
      "classified"
    ) {
      current.confidences.push(
        confidence(
          message.topic_confidence
        )
      );
    }

    result.set(
      key,
      current
    );
  }

  return result;
}

/*
 * ============================================
 * Employee Aggregation
 * ============================================
 */

function aggregateEmployees(
  messages: MessageRecord[],
  accounts: Map<
    string,
    AccountInfo
  >,
  topics: Map<
    string,
    TopicAnalyticsTopic
  >
) {
  const grouped =
    new Map<
      string,
      MessageRecord[]
    >();

  for (
    const message of
    messages
  ) {
    const id =
      String(
        message.user ||
          ""
      );

    if (
      !id
    ) {
      continue;
    }

    const existing =
      grouped.get(
        id
      );

    if (
      existing
    ) {
      existing.push(
        message
      );
    } else {
      grouped.set(
        id,
        [
          message,
        ]
      );
    }
  }

  return [
    ...grouped.entries(),
  ]
    .map(
      ([
        id,
        items,
      ]) => {
        const account =
          accounts.get(
            id
          );

        const topicCounts =
          simpleTopicCounts(
            items,
            topics
          );

        const stats =
          statusStats(
            items
          );

        return {
          id,

          name:
            account?.name ||
            "کاربر نامشخص",

          employeeCode:
            account
              ?.employeeCode ||
            "",

          department:
            account
              ?.departmentName ||
            "",

          total:
            items.length,

          classified:
            stats.classified,

          unclassified:
            stats.unclassified,

          topTopics:
            topicCounts,
        };
      }
    )
    .sort(
      (
        left,
        right
      ) =>
        right.total -
        left.total
    );
}

/*
 * ============================================
 * Department Aggregation
 *
 * نسخه قبلی برای هر Department دوباره تمام
 * Accounts و Messages را Filter می‌کرد.
 *
 * این نسخه ابتدا Group می‌کند.
 * ============================================
 */

function aggregateDepartments(
  messages: MessageRecord[],
  accounts: AccountInfo[],
  departments: DepartmentInfo[],
  topics: Map<
    string,
    TopicAnalyticsTopic
  >
) {
  const accountMap =
    new Map(
      accounts.map(
        (
          account
        ) => [
          account.id,
          account,
        ]
      )
    );

  const activeUsers =
    new Map<
      string,
      number
    >();

  for (
    const account of
    accounts
  ) {
    if (
      !account.active ||
      !account.departmentId
    ) {
      continue;
    }

    activeUsers.set(
      account.departmentId,
      (
        activeUsers.get(
          account.departmentId
        ) ||
        0
      ) +
        1
    );
  }

  const groupedMessages =
    new Map<
      string,
      MessageRecord[]
    >();

  for (
    const message of
    messages
  ) {
    const account =
      accountMap.get(
        String(
          message.user ||
            ""
        )
      );

    const departmentId =
      account
        ?.departmentId ||
      "";

    if (
      !departmentId
    ) {
      continue;
    }

    const existing =
      groupedMessages.get(
        departmentId
      );

    if (
      existing
    ) {
      existing.push(
        message
      );
    } else {
      groupedMessages.set(
        departmentId,
        [
          message,
        ]
      );
    }
  }

  return departments
    .map(
      (
        department
      ) => {
        const items =
          groupedMessages.get(
            department.id
          ) ||
          [];

        const stats =
          statusStats(
            items
          );

        return {
          id:
            department.id,

          name:
            department.name,

          activeUsers:
            activeUsers.get(
              department.id
            ) ||
            0,

          total:
            items.length,

          classified:
            stats.classified,

          unclassified:
            stats.unclassified,

          topTopics:
            simpleTopicCounts(
              items,
              topics
            ),
        };
      }
    )
    .filter(
      (
        item
      ) =>
        item.total >
        0
    )
    .sort(
      (
        left,
        right
      ) =>
        right.total -
        left.total
    );
}

/*
 * ============================================
 * Simple Topic Counts
 * ============================================
 */

function simpleTopicCounts(
  messages: MessageRecord[],
  topics: Map<
    string,
    TopicAnalyticsTopic
  >
) {
  const counts =
    new Map<
      string,
      number
    >();

  for (
    const message of
    messages
  ) {
    const id =
      String(
        message.topic ||
          ""
      );

    if (
      id
    ) {
      counts.set(
        id,
        (
          counts.get(
            id
          ) ||
          0
        ) +
          1
      );
    }
  }

  return [
    ...counts.entries(),
  ]
    .map(
      ([
        id,
        count,
      ]) => ({
        id,

        path:
          topics.get(
            id
          )?.path ||
          "موضوع حذف‌شده",

        count,
      })
    )
    .sort(
      (
        left,
        right
      ) =>
        right.count -
        left.count
    )
    .slice(
      0,
      5
    );
}

/*
 * ============================================
 * Trend
 * ============================================
 */

function buildTrend(
  messages: MessageRecord[],
  range: AnalyticsRange,
  selectedIds: string[],
  topics: Map<
    string,
    TopicAnalyticsTopic
  >
) {
  const points =
    range.bucketKeys.map(
      ({
        key,
        label,
      }) => ({
        key,

        label,

        values:
          Object.fromEntries(
            selectedIds.map(
              (
                id
              ) => [
                id,
                0,
              ]
            )
          ),
      })
    );

  const pointMap =
    new Map(
      points.map(
        (
          point
        ) => [
          point.key,
          point,
        ]
      )
    );

  const selected =
    new Set(
      selectedIds
    );

  for (
    const message of
    messages
  ) {
    const topicId =
      String(
        message.topic ||
          ""
      );

    if (
      !selected.has(
        topicId
      )
    ) {
      continue;
    }

    const created =
      safeDate(
        message.created
      );

    if (
      !created
    ) {
      continue;
    }

    const key =
      getBucketKey(
        created,
        range.timezone,
        range.granularity
      );

    const point =
      pointMap.get(
        key
      );

    if (
      point
    ) {
      point.values[
        topicId
      ] =
        (
          point.values[
            topicId
          ] ||
          0
        ) +
        1;
    }
  }

  return {
    topics:
      selectedIds
        .map(
          (
            id
          ) =>
            topics.get(
              id
            )
        )
        .filter(
          (
            item
          ): item is TopicAnalyticsTopic =>
            Boolean(
              item
            )
        ),

    points,
  };
}

/*
 * ============================================
 * Confidence
 * ============================================
 */

function confidenceStats(
  messages: MessageRecord[],
  topics: Map<
    string,
    TopicAnalyticsTopic
  >,
  threshold: number
) {
  const classified =
    messages.filter(
      (
        message
      ) =>
        normalizeStatus(
          message.classification_status
        ) ===
        "classified"
    );

  const values =
    classified
      .map(
        (
          message
        ) =>
          confidence(
            message.topic_confidence
          )
      )
      .sort(
        (
          left,
          right
        ) =>
          left -
          right
      );

  const byTopic =
    new Map<
      string,
      number[]
    >();

  for (
    const message of
    classified
  ) {
    const id =
      String(
        message.topic ||
          ""
      );

    if (
      !id
    ) {
      continue;
    }

    const valuesForTopic =
      byTopic.get(
        id
      );

    const value =
      confidence(
        message.topic_confidence
      );

    if (
      valuesForTopic
    ) {
      valuesForTopic.push(
        value
      );
    } else {
      byTopic.set(
        id,
        [
          value,
        ]
      );
    }
  }

  return {
    average:
      average(
        values
      ),

    median:
      median(
        values
      ),

    belowThreshold:
      values.filter(
        (
          value
        ) =>
          value <
          threshold
      ).length,

    threshold,

    lowestTopics:
      [
        ...byTopic.entries(),
      ]
        .map(
          ([
            id,
            confidences,
          ]) => ({
            id,

            path:
              topics.get(
                id
              )?.path ||
              "موضوع حذف‌شده",

            average:
              average(
                confidences
              ),

            count:
              confidences.length,
          })
        )
        .sort(
          (
            left,
            right
          ) =>
            left.average -
            right.average
        )
        .slice(
          0,
          5
        ),
  };
}

/*
 * ============================================
 * Serialize Question
 * ============================================
 */

function serializeQuestion(
  message: MessageRecord,
  accounts: Map<
    string,
    AccountInfo
  >,
  topics: Map<
    string,
    TopicAnalyticsTopic
  >
): TopicQuestion {
  const userId =
    String(
      message.user ||
        ""
    );

  const account =
    accounts.get(
      userId
    );

  const topicId =
    String(
      message.topic ||
        ""
    );

  return {
    id:
      message.id,

    content:
      truncate(
        message.content,
        180
      ),

    userId,

    userName:
      account?.name ||
      "کاربر نامشخص",

    employeeCode:
      account
        ?.employeeCode ||
      "",

    departmentId:
      account
        ?.departmentId ||
      "",

    departmentName:
      account
        ?.departmentName ||
      "",

    conversationId:
      String(
        message.conversation ||
          ""
      ),

    topicId,

    topicPath:
      topics.get(
        topicId
      )?.path ||
      "",

    confidence:
      confidence(
        message.topic_confidence
      ),

    status:
      normalizeStatus(
        message.classification_status
      ),

    created:
      String(
        message.created ||
          ""
      ),
  };
}

/*
 * ============================================
 * Status Statistics
 * ============================================
 */

function statusStats(
  messages: MessageRecord[]
) {
  const result = {
    classified:
      0,

    unclassified:
      0,

    error:
      0,

    pending:
      0,
  };

  for (
    const message of
    messages
  ) {
    const status =
      normalizeStatus(
        message.classification_status
      );

    result[
      status
    ] +=
      1;
  }

  return result;
}

/*
 * ============================================
 * Normalize Classification Status
 * ============================================
 */

function normalizeStatus(
  value: unknown
) {
  const status =
    String(
      value ||
        "pending"
    );

  return [
    "classified",
    "unclassified",
    "error",
  ].includes(
    status
  )
    ? (
        status as
          | "classified"
          | "unclassified"
          | "error"
      )
    : "pending";
}

/*
 * ============================================
 * Descendant Topics
 * ============================================
 */

function descendantTopicIds(
  parentId: string,
  topics: TopicAnalyticsTopic[]
) {
  const result =
    new Set<
      string
    >([
      parentId,
    ]);

  let changed =
    true;

  while (
    changed
  ) {
    changed =
      false;

    for (
      const topic of
      topics
    ) {
      if (
        result.has(
          topic.parentId
        ) &&
        !result.has(
          topic.id
        )
      ) {
        result.add(
          topic.id
        );

        changed =
          true;
      }
    }
  }

  return [
    ...result,
  ];
}

/*
 * ============================================
 * Relation Clauses
 * ============================================
 */

function relationClauses(
  field: string,
  ids: string[],
  values: Record<
    string,
    string
  >,
  prefix: string
) {
  return ids
    .filter(
      isSafeId
    )
    .map(
      (
        id,
        index
      ) => {
        const key =
          `${prefix}${index}`;

        values[
          key
        ] =
          id;

        return `${field} = {:${key}}`;
      }
    )
    .join(
      " || "
    );
}

/*
 * ============================================
 * Range Info
 * ============================================
 */

function rangeInfo(
  range: AnalyticsRange
) {
  return {
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

    granularity:
      range.granularity,
  };
}

/*
 * ============================================
 * Metric
 * ============================================
 */

function metric(
  value: number,
  previous: number
): TopicAnalyticsMetric {
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
 * Pagination
 * ============================================
 */

function paginate<T>(
  items: T[],
  page: number,
  perPage: number
) {
  const safePerPage =
    integer(
      perPage,
      1,
      100,
      10
    );

  const totalItems =
    items.length;

  const totalPages =
    Math.max(
      1,
      Math.ceil(
        totalItems /
          safePerPage
      )
    );

  const safePage =
    Math.min(
      Math.max(
        page,
        1
      ),
      totalPages
    );

  return {
    items:
      items.slice(
        (
          safePage -
          1
        ) *
          safePerPage,

        safePage *
          safePerPage
      ),

    page:
      safePage,

    totalPages,

    totalItems,
  };
}

/*
 * ============================================
 * Bounded PocketBase Query
 * ============================================
 */

async function loadBoundedRecords<
  T extends RecordModel
>(
  pb: PocketBase,
  collectionName: string,
  options: BoundedQueryOptions,
  maximumRecords: number
): Promise<
  BoundedRecordsResult<T>
> {
  const safeMaximum =
    Math.max(
      1,
      Math.floor(
        maximumRecords
      )
    );

  /*
   * perPage در تمام صفحات ثابت می‌ماند تا
   * Offset Pagination دچار Skip/Duplicate نشود.
   */
  const perPage =
    Math.min(
      QUERY_PAGE_SIZE,
      safeMaximum
    );

  const items:
    T[] =
    [];

  let page =
    1;

  let totalItems =
    0;

  while (
    items.length <
    safeMaximum
  ) {
    const result =
      await pb
        .collection(
          collectionName
        )
        .getList<T>(
          page,
          perPage,
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

    totalItems =
      result.totalItems;

    if (
      result.items.length ===
      0
    ) {
      break;
    }

    const remaining =
      safeMaximum -
      items.length;

    items.push(
      ...result.items.slice(
        0,
        remaining
      )
    );

    if (
      page >=
        result.totalPages ||
      result.items.length <
        perPage
    ) {
      break;
    }

    page +=
      1;
  }

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
 * Promise Result - Array
 * ============================================
 */

function settledList<T>(
  result: PromiseSettledResult<
    T[]
  >,
  message: string,
  errors: string[]
) {
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
    "Topic analytics lookup failed",
    {
      widget:
        message,

      error:
        errorMetadata(
          result.reason
        ),
    }
  );

  return [];
}

/*
 * ============================================
 * Promise Result - Bounded
 * ============================================
 */

function settledBounded<
  T extends RecordModel
>(
  result:
    PromiseSettledResult<
      BoundedRecordsResult<T>
    >,
  message: string,
  errors: string[]
): BoundedRecordsResult<T> {
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
    "Topic analytics bounded query failed",
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
 * Expand
 * ============================================
 */

function expanded(
  record: RecordModel,
  key: string
) {
  const value =
    record.expand?.[
      key
    ];

  return Array.isArray(
    value
  )
    ? value[0]
    : value;
}

/*
 * ============================================
 * Confidence
 * ============================================
 */

function confidence(
  value: unknown
) {
  const parsed =
    Number(
      value
    );

  return Number.isFinite(
    parsed
  )
    ? Math.min(
        1,
        Math.max(
          0,
          parsed
        )
      )
    : 0;
}

/*
 * ============================================
 * Average
 * ============================================
 */

function average(
  values: number[]
) {
  return values.length
    ? values.reduce(
        (
          sum,
          value
        ) =>
          sum +
          value,
        0
      ) /
        values.length
    : 0;
}

/*
 * ============================================
 * Median
 * ============================================
 */

function median(
  values: number[]
) {
  if (
    !values.length
  ) {
    return 0;
  }

  const middle =
    Math.floor(
      values.length /
        2
    );

  return values.length %
    2
    ? values[
        middle
      ]
    : (
        values[
          middle -
            1
        ] +
        values[
          middle
        ]
      ) /
        2;
}

/*
 * ============================================
 * Truncate
 * ============================================
 */

function truncate(
  value: unknown,
  max: number
) {
  const text =
    String(
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
      .trim();

  return text.length <=
    max
    ? text
    : `${text
        .slice(
          0,
          max
        )
        .trim()}…`;
}

/*
 * ============================================
 * ID
 * ============================================
 */

function safeId(
  value: string | null
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

function isSafeId(
  value: string
) {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(
    value
  );
}

/*
 * ============================================
 * Page Integer
 * ============================================
 */

function pageInteger(
  value: string | null,
  maximum: number
) {
  if (
    !value
  ) {
    return 1;
  }

  /*
   * 1e5 و 1.5 و Infinity پذیرفته نمی‌شوند.
   */
  if (
    !/^\d+$/.test(
      value
    )
  ) {
    return 1;
  }

  const parsed =
    Number(
      value
    );

  if (
    !Number.isSafeInteger(
      parsed
    )
  ) {
    return 1;
  }

  return Math.min(
    Math.max(
      parsed,
      1
    ),
    maximum
  );
}

/*
 * ============================================
 * Integer
 * ============================================
 */

function integer(
  value: unknown,
  min: number,
  max: number,
  fallback: number
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

/*
 * ============================================
 * Trend Topics
 * ============================================
 */

function parseTrendTopics(
  value: string | null
) {
  const normalized =
    String(
      value ||
        ""
    ).slice(
      0,
      MAX_TREND_QUERY_LENGTH
    );

  return [
    ...new Set(
      normalized
        .split(
          ","
        )
        .map(
          (
            item
          ) =>
            safeId(
              item
            )
        )
        .filter(
          Boolean
        )
    ),
  ].slice(
    0,
    MAX_TREND_TOPICS
  );
}

/*
 * ============================================
 * Environment Limits
 * ============================================
 */

function getMessageRowLimit() {
  return environmentInteger(
    process.env
      .TOPIC_ANALYTICS_MAX_MESSAGE_ROWS_PER_PERIOD,
    1_000,
    MAX_MESSAGES_PER_PERIOD,
    DEFAULT_MAX_MESSAGES_PER_PERIOD
  );
}

function getAccountRowLimit() {
  return environmentInteger(
    process.env
      .TOPIC_ANALYTICS_MAX_ACCOUNT_ROWS,
    500,
    MAX_ACCOUNT_ROWS,
    DEFAULT_MAX_ACCOUNT_ROWS
  );
}

function environmentInteger(
  value: string | undefined,
  min: number,
  max: number,
  fallback: number
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

/*
 * ============================================
 * Dates
 * ============================================
 */

function safeDate(
  value: unknown
) {
  const timestamp =
    Date.parse(
      String(
        value ||
          ""
      )
    );

  if (
    !Number.isFinite(
      timestamp
    )
  ) {
    return null;
  }

  return new Date(
    timestamp
  );
}

/*
 * ============================================
 * Error Metadata
 * ============================================
 */

function errorMetadata(
  error: unknown
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
      message?: unknown;
      status?: unknown;
      code?: unknown;
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