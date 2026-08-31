import "server-only";

import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";

import type {
  GroundingAnalyticsAlert,
  GroundingAnalyticsBlockedItem,
  GroundingAnalyticsDashboard,
  GroundingAnalyticsRange,
  GroundingAnalyticsReasonRow,
  GroundingAnalyticsThresholds,
  GroundingAnalyticsTopicRow,
} from "@/types/grounding-analytics";

/*
 * ============================================
 * Constants
 * ============================================
 */

const RECENT_BLOCKED_LIMIT =
  50;

const TOPIC_ROWS_LIMIT =
  20;

const ALERT_LIMIT =
  12;

const RANGE_CONFIG:
  Record<
    GroundingAnalyticsRange,
    {
      milliseconds: number;
      label: string;
    }
  > = {
  "24h": {
    milliseconds:
      24 * 60 * 60 * 1000,
    label:
      "۲۴ ساعت اخیر",
  },

  "7d": {
    milliseconds:
      7 * 24 * 60 * 60 * 1000,
    label:
      "۷ روز اخیر",
  },

  "30d": {
    milliseconds:
      30 * 24 * 60 * 60 * 1000,
    label:
      "۳۰ روز اخیر",
  },

  "90d": {
    milliseconds:
      90 * 24 * 60 * 60 * 1000,
    label:
      "۹۰ روز اخیر",
  },
};

/*
 * ============================================
 * Public API
 * ============================================
 */

export function parseGroundingAnalyticsRange(
  value:
    string |
    null
): GroundingAnalyticsRange {
  if (
    value ===
      "24h" ||
    value ===
      "30d" ||
    value ===
      "90d"
  ) {
    return value;
  }

  return "7d";
}

export async function getGroundingAnalyticsDashboard(
  pb:
    PocketBase,

  preset:
    GroundingAnalyticsRange
): Promise<GroundingAnalyticsDashboard> {
  const now =
    new Date();

  const config =
    RANGE_CONFIG[
      preset
    ];

  const from =
    new Date(
      now.getTime() -
        config.milliseconds
    );

  const thresholds =
    getGroundingAnalyticsThresholds();

  /*
   * فقط پیام‌های Assistant که Grounding Metadata
   * دارند وارد Analytics می‌شوند.
   *
   * پیام‌های قدیمی قبل از اضافه شدن این قابلیت
   * عمداً از denominator حذف می‌شوند.
   */
  const records =
    await pb
      .collection(
        "messages"
      )
      .getFullList({
        filter:
          pb.filter(
            [
              "role = {:role}",
              "grounding_status != {:empty}",
              "created >= {:from}",
              "created < {:to}",
            ].join(
              " && "
            ),
            {
              role:
                "assistant",

              empty:
                "",

              from:
                from
                  .toISOString(),

              to:
                now
                  .toISOString(),
            }
          ),

        sort:
          "-created",

        expand: [
          "reply_to",
          "reply_to.topic",
          "user",
          "user.department",
          "sources",
        ].join(
          ","
        ),
      });

  const checked =
    records.length;

  const verified =
    records.filter(
      (
        record
      ) =>
        record.grounding_status ===
        "verified"
    ).length;

  const blocked =
    records.filter(
      (
        record
      ) =>
        record.grounding_status ===
        "blocked"
    ).length;

  const notRequired =
    records.filter(
      (
        record
      ) =>
        record.grounding_status ===
        "not_required"
    ).length;

  const required =
    verified +
    blocked;

  const requiredRecords =
    records.filter(
      (
        record
      ) =>
        record.grounding_status ===
          "verified" ||
        record.grounding_status ===
          "blocked"
    );

  const blockedRecords =
    requiredRecords.filter(
      (
        record
      ) =>
        record.grounding_status ===
        "blocked"
    );

  const blockRate =
    required >
    0
      ? (
          blocked /
          required
        ) *
        100
      : 0;

  const gateReasons =
    buildReasonRows(
      records,
      (
        record
      ) =>
        String(
          record.grounding_gate_reason ||
            ""
        ),
      gateReasonLabel
    );

  const verifierReasons =
    buildReasonRows(
      requiredRecords,
      (
        record
      ) =>
        String(
          record.grounding_verifier_status ||
            ""
        ),
      verifierStatusLabel
    );

  const topics =
    buildTopicRows(
      requiredRecords
    );

  const alerts =
    buildQualityAlerts({
      required,

      blocked,

      blockRate,

      records:
        requiredRecords,

      topics,

      thresholds,
    });

  return {
    range: {
      preset,

      label:
        config.label,

      from:
        from
          .toISOString(),

      to:
        now
          .toISOString(),
    },

    totals: {
      checked,

      verified,

      blocked,

      notRequired,

      required,

      verificationRate:
        required >
        0
          ? (
              verified /
              required
            ) *
            100
          : 0,

      blockRate,
    },

    evidence: {
      averageRetrievalCount:
        average(
          requiredRecords.map(
            (
              record
            ) =>
              safeNumber(
                record.grounding_retrieval_count
              )
          )
        ),

      averageRelevantCount:
        average(
          requiredRecords.map(
            (
              record
            ) =>
              safeNumber(
                record.grounding_relevant_count
              )
          )
        ),

      averageSourceCount:
        average(
          requiredRecords.map(
            (
              record
            ) =>
              safeNumber(
                record.grounding_source_count
              )
          )
        ),

      blockedWithoutRelevantEvidence:
        blockedRecords.filter(
          isBlockedWithoutEvidence
        ).length,

      blockedAfterVerifier:
        blockedRecords.filter(
          isBlockedAfterVerifier
        ).length,
    },

    thresholds,

    alerts,

    topics:
      topics.slice(
        0,
        TOPIC_ROWS_LIMIT
      ),

    gateReasons,

    verifierReasons,

    recentBlocked:
      blockedRecords
        .slice(
          0,
          RECENT_BLOCKED_LIMIT
        )
        .map(
          serializeBlockedItem
        ),
  };
}

/*
 * ============================================
 * Thresholds
 *
 * همه Thresholdها از ENV قابل تنظیم هستند.
 * در نبود ENV از Default محافظه‌کارانه استفاده
 * می‌شود.
 * ============================================
 */

function getGroundingAnalyticsThresholds():
  GroundingAnalyticsThresholds {
  const globalWarning =
    envInteger(
      "GROUNDING_ALERT_BLOCK_RATE_PERCENT",
      20,
      1,
      100
    );

  const globalCritical =
    Math.max(
      globalWarning,

      envInteger(
        "GROUNDING_ALERT_CRITICAL_BLOCK_RATE_PERCENT",
        35,
        1,
        100
      )
    );

  return {
    globalMinimumRequired:
      envInteger(
        "GROUNDING_ALERT_MIN_REQUIRED",
        10,
        1,
        100_000
      ),

    globalBlockRateWarningPercent:
      globalWarning,

    globalBlockRateCriticalPercent:
      globalCritical,

    topicMinimumRequired:
      envInteger(
        "GROUNDING_TOPIC_ALERT_MIN_REQUIRED",
        5,
        1,
        100_000
      ),

    topicBlockRateWarningPercent:
      envInteger(
        "GROUNDING_TOPIC_ALERT_BLOCK_RATE_PERCENT",
        30,
        1,
        100
      ),

    unsupportedClaimsWarningCount:
      envInteger(
        "GROUNDING_UNSUPPORTED_CLAIMS_ALERT_COUNT",
        3,
        1,
        100_000
      ),
  };
}

/*
 * ============================================
 * Automatic Quality Alerts
 * ============================================
 */

function buildQualityAlerts({
  required,
  blocked,
  blockRate,
  records,
  topics,
  thresholds,
}: {
  required:
    number;

  blocked:
    number;

  blockRate:
    number;

  records:
    RecordModel[];

  topics:
    GroundingAnalyticsTopicRow[];

  thresholds:
    GroundingAnalyticsThresholds;
}) {
  const alerts:
    GroundingAnalyticsAlert[] =
    [];

  /*
   * Global Block Rate
   *
   * Sample کوچک Alert ایجاد نمی‌کند تا با چند
   * پیام اول سیستم False Alarm نداشته باشیم.
   */
  if (
    required >=
    thresholds
      .globalMinimumRequired
  ) {
    if (
      blockRate >=
      thresholds
        .globalBlockRateCriticalPercent
    ) {
      alerts.push({
        id:
          "global-block-rate-critical",

        severity:
          "critical",

        title:
          "نرخ Block پاسخ‌های سازمانی بحرانی است",

        message:
          `از ${required.toLocaleString(
            "fa-IR"
          )} پاسخ نیازمند Knowledge، ${blocked.toLocaleString(
            "fa-IR"
          )} پاسخ قبل از نمایش مسدود شده است.`,

        currentValue:
          blockRate,

        thresholdValue:
          thresholds
            .globalBlockRateCriticalPercent,

        unit:
          "percent",
      });
    } else if (
      blockRate >=
      thresholds
        .globalBlockRateWarningPercent
    ) {
      alerts.push({
        id:
          "global-block-rate-warning",

        severity:
          "warning",

        title:
          "نرخ Block پاسخ‌ها از حد هشدار عبور کرده است",

        message:
          `نرخ فعلی Block برابر ${formatPercentForMessage(
            blockRate
          )} است. افزایش Knowledge Coverage یا بررسی Retrieval توصیه می‌شود.`,

        currentValue:
          blockRate,

        thresholdValue:
          thresholds
            .globalBlockRateWarningPercent,

        unit:
          "percent",
      });
    }
  }

  /*
   * Operational Verifier Problems
   *
   * Fail-closed بودن سیستم باعث می‌شود خرابی
   * Verifier هم پاسخ را Block کند؛ بنابراین
   * وجود حتی یک مورد باید برای Admin قابل دیدن
   * باشد.
   */
  const verifierUnavailable =
    records.filter(
      (
        record
      ) => {
        const status =
          String(
            record.grounding_verifier_status ||
              ""
          );

        return (
          status ===
            "verifier_unavailable" ||
          status ===
            "invalid_verifier_response" ||
          status ===
            "budget_blocked"
        );
      }
    ).length;

  if (
    verifierUnavailable >
    0
  ) {
    alerts.push({
      id:
        "verifier-operational-failures",

      severity:
        verifierUnavailable >=
        3
          ? "critical"
          : "warning",

      title:
        "اختلال عملیاتی در Semantic Verifier",

      message:
        `${verifierUnavailable.toLocaleString(
          "fa-IR"
        )} پاسخ به‌دلیل Budget، عدم دسترسی Verifier یا خروجی نامعتبر Block شده است.`,

      currentValue:
        verifierUnavailable,

      thresholdValue:
        1,

      unit:
        "count",
    });
  }

  /*
   * Unsupported Claims
   */
  const unsupportedClaimCount =
    records
      .filter(
        isBlockedAfterVerifier
      )
      .reduce(
        (
          total,
          record
        ) =>
          total +
          parseUnsupportedClaims(
            record.grounding_unsupported_claims
          ).length,
        0
      );

  if (
    unsupportedClaimCount >=
    thresholds
      .unsupportedClaimsWarningCount
  ) {
    alerts.push({
      id:
        "unsupported-claims",

      severity:
        unsupportedClaimCount >=
        thresholds
          .unsupportedClaimsWarningCount *
          2
          ? "critical"
          : "warning",

      title:
        "Claimهای بدون مدرک تکرار شده‌اند",

      message:
        `${unsupportedClaimCount.toLocaleString(
          "fa-IR"
        )} Claim بدون پشتیبانی Evidence توسط Verifier شناسایی شده است.`,

      currentValue:
        unsupportedClaimCount,

      thresholdValue:
        thresholds
          .unsupportedClaimsWarningCount,

      unit:
        "count",
    });
  }

  /*
   * Topic Hotspots
   */
  for (
    const topic of
    topics
  ) {
    if (
      topic.required <
        thresholds
          .topicMinimumRequired ||
      topic.blockRate <
        thresholds
          .topicBlockRateWarningPercent
    ) {
      continue;
    }

    alerts.push({
      id:
        `topic-block-rate-${topic.topicId || "unclassified"}`,

      severity:
        topic.blockRate >=
        Math.max(
          50,
          thresholds
            .topicBlockRateWarningPercent +
            15
        )
          ? "critical"
          : "warning",

      title:
        `ریسک کیفیت در موضوع «${topic.topicName}»`,

      message:
        `از ${topic.required.toLocaleString(
          "fa-IR"
        )} پاسخ سازمانی این موضوع، ${topic.blocked.toLocaleString(
          "fa-IR"
        )} مورد Block شده است.`,

      currentValue:
        topic.blockRate,

      thresholdValue:
        thresholds
          .topicBlockRateWarningPercent,

      unit:
        "percent",

      topicId:
        topic.topicId,

      topicName:
        topic.topicName,
    });

    if (
      alerts.length >=
      ALERT_LIMIT
    ) {
      break;
    }
  }

  return alerts
    .sort(
      (
        left,
        right
      ) => {
        if (
          left.severity !==
          right.severity
        ) {
          return left.severity ===
            "critical"
            ? -1
            : 1;
        }

        return (
          right.currentValue ||
          0
        ) -
          (
            left.currentValue ||
            0
          );
      }
    )
    .slice(
      0,
      ALERT_LIMIT
    );
}

/*
 * ============================================
 * Topic Health
 * ============================================
 */

function buildTopicRows(
  records:
    RecordModel[]
) {
  type Accumulator = {
    topicId?:
      string;

    topicName:
      string;

    required:
      number;

    verified:
      number;

    blocked:
      number;

    blockedWithoutEvidence:
      number;

    blockedAfterVerifier:
      number;

    unsupportedClaimCount:
      number;
  };

  const map =
    new Map<
      string,
      Accumulator
    >();

  for (
    const record of
    records
  ) {
    const userMessage =
      getExpandedOne(
        record,
        "reply_to"
      );

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
      ).trim() ||
      "بدون موضوع";

    const key =
      topicId ||
      "__unclassified";

    const current =
      map.get(
        key
      ) || {
        topicId:
          topicId ||
          undefined,

        topicName,

        required:
          0,

        verified:
          0,

        blocked:
          0,

        blockedWithoutEvidence:
          0,

        blockedAfterVerifier:
          0,

        unsupportedClaimCount:
          0,
      };

    current.required +=
      1;

    if (
      record.grounding_status ===
      "verified"
    ) {
      current.verified +=
        1;
    }

    if (
      record.grounding_status ===
      "blocked"
    ) {
      current.blocked +=
        1;

      if (
        isBlockedWithoutEvidence(
          record
        )
      ) {
        current.blockedWithoutEvidence +=
          1;
      }

      if (
        isBlockedAfterVerifier(
          record
        )
      ) {
        current.blockedAfterVerifier +=
          1;
      }

      current.unsupportedClaimCount +=
        parseUnsupportedClaims(
          record.grounding_unsupported_claims
        ).length;
    }

    map.set(
      key,
      current
    );
  }

  return [
    ...map.values(),
  ]
    .map(
      (
        row
      ): GroundingAnalyticsTopicRow => ({
        topicId:
          row.topicId,

        topicName:
          row.topicName,

        required:
          row.required,

        verified:
          row.verified,

        blocked:
          row.blocked,

        blockRate:
          row.required >
          0
            ? (
                row.blocked /
                row.required
              ) *
              100
            : 0,

        blockedWithoutEvidence:
          row.blockedWithoutEvidence,

        blockedAfterVerifier:
          row.blockedAfterVerifier,

        unsupportedClaimCount:
          row.unsupportedClaimCount,
      })
    )
    .sort(
      (
        left,
        right
      ) =>
        right.blockRate -
          left.blockRate ||
        right.required -
          left.required
    );
}

/*
 * ============================================
 * Blocked Item
 * ============================================
 */

function serializeBlockedItem(
  record:
    RecordModel
): GroundingAnalyticsBlockedItem {
  const userMessage =
    getExpandedOne(
      record,
      "reply_to"
    );

  const topic =
    userMessage
      ? getExpandedOne(
          userMessage,
          "topic"
        )
      : undefined;

  const user =
    getExpandedOne(
      record,
      "user"
    );

  const department =
    user
      ? getExpandedOne(
          user,
          "department"
        )
      : undefined;

  return {
    id:
      record.id,

    conversationId:
      String(
        record.conversation ||
          ""
      ),

    created:
      String(
        record.created ||
          ""
      ),

    question:
      String(
        userMessage?.content ||
          ""
      ),

    answer:
      String(
        record.content ||
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
        record.user ||
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

    gateReason:
      String(
        record.grounding_gate_reason ||
          ""
      ),

    verifierStatus:
      String(
        record.grounding_verifier_status ||
          ""
      ),

    verifierReason:
      String(
        record.grounding_verifier_reason ||
          ""
      ).trim() ||
      undefined,

    unsupportedClaims:
      parseUnsupportedClaims(
        record.grounding_unsupported_claims
      ),

    verifierModel:
      String(
        record.grounding_verifier_model ||
          ""
      ).trim() ||
      undefined,

    verifierRequestId:
      String(
        record.grounding_verifier_request_id ||
          ""
      ).trim() ||
      undefined,

    retrievalCount:
      safeNumber(
        record.grounding_retrieval_count
      ),

    relevantCount:
      safeNumber(
        record.grounding_relevant_count
      ),

    sourceCount:
      safeNumber(
        record.grounding_source_count
      ),
  };
}

/*
 * ============================================
 * Block Classification
 * ============================================
 */

function isBlockedWithoutEvidence(
  record:
    RecordModel
) {
  return (
    record.grounding_status ===
      "blocked" &&
    (
      safeNumber(
        record.grounding_relevant_count
      ) ===
        0 ||
      safeNumber(
        record.grounding_source_count
      ) ===
        0
    )
  );
}

function isBlockedAfterVerifier(
  record:
    RecordModel
) {
  return (
    record.grounding_status ===
      "blocked" &&
    String(
      record.grounding_verifier_status ||
        ""
    ) ===
      "unsupported_claims"
  );
}

/*
 * ============================================
 * Reason Breakdown
 * ============================================
 */

function buildReasonRows(
  records:
    RecordModel[],

  pick:
    (
      record:
        RecordModel
    ) => string,

  label:
    (
      key:
        string
    ) => string
): GroundingAnalyticsReasonRow[] {
  const counts =
    new Map<
      string,
      number
    >();

  for (
    const record of
    records
  ) {
    const key =
      pick(
        record
      )
        .trim() ||
      "unknown";

    counts.set(
      key,
      (
        counts.get(
          key
        ) ||
        0
      ) +
        1
    );
  }

  const total =
    records.length;

  return [
    ...counts.entries(),
  ]
    .map(
      (
        [
          key,
          count,
        ]
      ) => ({
        key,

        label:
          label(
            key
          ),

        count,

        percent:
          total >
          0
            ? (
                count /
                total
              ) *
              100
            : 0,
      })
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
 * Labels
 * ============================================
 */

function gateReasonLabel(
  key:
    string
) {
  switch (
    key
  ) {
    case "verified_knowledge":
      return "Knowledge معتبر";

    case "missing_verified_knowledge":
      return "بدون Evidence معتبر";

    case "model_declared_insufficient":
      return "اعلام کمبود دانش توسط مدل";

    case "safe_ungrounded_question":
      return "بدون نیاز به Knowledge";

    default:
      return key ||
        "نامشخص";
  }
}

function verifierStatusLabel(
  key:
    string
) {
  switch (
    key
  ) {
    case "supported":
      return "تمام Claimها تأیید شدند";

    case "unsupported_claims":
      return "Claim بدون مدرک";

    case "no_evidence":
      return "Evidence کافی نبود";

    case "budget_blocked":
      return "Verifier به‌دلیل Budget اجرا نشد";

    case "verifier_unavailable":
      return "Verifier در دسترس نبود";

    case "invalid_verifier_response":
      return "خروجی Verifier نامعتبر بود";

    case "not_run":
      return "Verifier اجرا نشد";

    case "not_required":
      return "Verifier لازم نبود";

    case "pending":
      return "در انتظار Verifier";

    default:
      return key ||
        "نامشخص";
  }
}

/*
 * ============================================
 * Unsupported Claims
 * ============================================
 */

function parseUnsupportedClaims(
  value:
    unknown
) {
  if (
    typeof value !==
    "string"
  ) {
    return [];
  }

  const text =
    value.trim();

  if (
    !text
  ) {
    return [];
  }

  try {
    const parsed:
      unknown =
        JSON.parse(
          text
        );

    if (
      !Array.isArray(
        parsed
      )
    ) {
      return [];
    }

    return parsed
      .filter(
        (
          item
        ): item is string =>
          typeof item ===
          "string"
      )
      .map(
        (
          item
        ) =>
          item
            .replace(
              /\s+/g,
              " "
            )
            .trim()
            .slice(
              0,
              500
            )
      )
      .filter(
        Boolean
      )
      .slice(
        0,
        8
      );
  } catch {
    return [];
  }
}

/*
 * ============================================
 * Expanded Record
 * ============================================
 */

function getExpandedOne(
  record:
    RecordModel,

  key:
    string
) {
  const value =
    record.expand?.[
      key
    ];

  if (
    !value
  ) {
    return undefined;
  }

  return Array.isArray(
    value
  )
    ? value[0]
    : value;
}

/*
 * ============================================
 * Numbers
 * ============================================
 */

function envInteger(
  name:
    string,

  fallback:
    number,

  minimum:
    number,

  maximum:
    number
) {
  const value =
    Number(
      process.env[
        name
      ]
    );

  if (
    !Number.isInteger(
      value
    )
  ) {
    return fallback;
  }

  return Math.min(
    maximum,
    Math.max(
      minimum,
      value
    )
  );
}

function safeNumber(
  value:
    unknown
) {
  const number =
    Number(
      value
    );

  return Number.isFinite(
    number
  )
    ? Math.max(
        0,
        number
      )
    : 0;
}

function average(
  values:
    number[]
) {
  if (
    values.length ===
    0
  ) {
    return 0;
  }

  return values.reduce(
    (
      total,
      value
    ) =>
      total +
      value,
    0
  ) /
    values.length;
}

function formatPercentForMessage(
  value:
    number
) {
  return `${value.toLocaleString(
    "fa-IR",
    {
      maximumFractionDigits:
        1,
    }
  )}٪`;
}
