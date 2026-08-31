import "server-only";

import type PocketBase from "pocketbase";
import type {
  RecordModel,
} from "pocketbase";

import {
  getAdminEvalAlerts,
} from "@/lib/ai/admin-eval-alerts";

import {
  getAIEvalCoverage,
} from "@/lib/ai/eval-coverage";

import {
  getAIEvalReleaseGate,
} from "@/lib/ai/eval-release-gate";

import type {
  AdminAIHealthDashboard,
  AdminAIHealthGrounding,
  AdminAIHealthLevel,
} from "@/types/admin-ai-health";

/*
 * ============================================
 * AI Health Dashboard
 *
 * هدف این فایل یک نمای سریع Operational است.
 * Queryهای سنگین Analytics کامل را تکرار
 * نمی‌کند؛ برای KPIها از count query استفاده
 * می‌شود.
 *
 * هر بخش مستقل Fail-soft است تا خرابی یک
 * subsystem کل صفحه اصلی Admin را از کار
 * نیندازد.
 * ============================================
 */

const GROUNDING_RANGE_DAYS =
  7;

const GROUNDING_MIN_REQUIRED =
  environmentInteger(
    process.env
      .GROUNDING_ALERT_MIN_REQUIRED,
    1,
    100_000,
    10
  );

const GROUNDING_WARNING_PERCENT =
  environmentNumber(
    process.env
      .GROUNDING_ALERT_BLOCK_RATE_PERCENT,
    0,
    100,
    20
  );

const GROUNDING_CRITICAL_PERCENT =
  environmentNumber(
    process.env
      .GROUNDING_ALERT_CRITICAL_BLOCK_RATE_PERCENT,
    0,
    100,
    35
  );

const HIGH_PRIORITY_GAP_SCORE =
  environmentNumber(
    process.env
      .AI_HEALTH_HIGH_PRIORITY_GAP_SCORE,
    0,
    1_000_000,
    30
  );

export async function getAdminAIHealthDashboard(
  pb:
    PocketBase
): Promise<AdminAIHealthDashboard> {
  const generatedAt =
    new Date()
      .toISOString();

  const [
    releaseResult,
    regressionResult,
    coverageResult,
    groundingResult,
    gapsResult,
    feedbackResult,
    syncResult,
  ] =
    await Promise.allSettled([
      loadRelease(
        pb
      ),

      loadRegressions(
        pb
      ),

      loadCoverage(
        pb
      ),

      loadGrounding(
        pb
      ),

      loadGaps(
        pb
      ),

      loadFeedback(
        pb
      ),

      loadKnowledgeSync(
        pb
      ),
    ]);

  const release =
    releaseResult.status ===
    "fulfilled"
      ? releaseResult.value
      : {
          status:
            "unavailable" as const,

          canRelease:
            false,

          regressions:
            0,

          errors:
            0,

          improvements:
            0,

          persistentFailures:
            0,

          message:
            "وضعیت Release Gate در دسترس نیست.",
        };

  const regressions =
    regressionResult.status ===
    "fulfilled"
      ? regressionResult.value
      : {
          active:
            0,

          critical:
            0,

          warnings:
            0,

          running:
            0,

          knowledge:
            0,

          topics:
            0,

          items:
            [],
        };

  const coverage =
    coverageResult.status ===
    "fulfilled"
      ? coverageResult.value
      : {
          activeTopics:
            0,

          uncoveredTopics:
            0,

          topicCoveragePercent:
            0,

          publishedKnowledge:
            0,

          uncoveredKnowledge:
            0,

          topicOnlyKnowledge:
            0,

          directKnowledgeCoveragePercent:
            0,
        };

  const grounding =
    groundingResult.status ===
    "fulfilled"
      ? groundingResult.value
      : emptyGrounding();

  const gaps =
    gapsResult.status ===
    "fulfilled"
      ? gapsResult.value
      : {
          open:
            0,

          inProgress:
            0,

          highPriority:
            0,

          top:
            [],
        };

  const feedback =
    feedbackResult.status ===
    "fulfilled"
      ? feedbackResult.value
      : {
          negativeOpen:
            0,

          new:
            0,

          inProgress:
            0,
        };

  const knowledgeSync =
    syncResult.status ===
    "fulfilled"
      ? syncResult.value
      : {
          published:
            0,

          synced:
            0,

          pending:
            0,

          errors:
            0,
        };

  const availability = {
    release:
      releaseResult.status ===
      "fulfilled",

    regressions:
      regressionResult.status ===
      "fulfilled",

    coverage:
      coverageResult.status ===
      "fulfilled",

    grounding:
      groundingResult.status ===
      "fulfilled",

    gaps:
      gapsResult.status ===
      "fulfilled",

    feedback:
      feedbackResult.status ===
      "fulfilled",

    knowledgeSync:
      syncResult.status ===
      "fulfilled",
  };

  const overall =
    calculateOverallHealth({
      release,

      regressions,

      coverage,

      grounding,

      gaps,

      feedback,

      knowledgeSync,

      availability,
    });

  return {
    generatedAt,

    overall,

    release,

    regressions,

    coverage,

    grounding,

    gaps,

    feedback,

    knowledgeSync,

    availability,
  };
}

/*
 * ============================================
 * Release Gate
 * ============================================
 */

async function loadRelease(
  pb:
    PocketBase
) {
  const gate =
    await getAIEvalReleaseGate(
      pb
    );

  const blockingReason =
    gate.reasons.find(
      (
        reason
      ) =>
        reason.severity ===
        "blocking"
    );

  const primaryReason =
    blockingReason ||
    gate.reasons[0];

  return {
    status:
      gate.status,

    canRelease:
      gate.canRelease,

    baselineLabel:
      gate.baseline
        ?.label,

    candidateLabel:
      gate.candidate
        ?.label,

    regressions:
      gate.summary
        .regressions,

    errors:
      gate.summary
        .errors,

    improvements:
      gate.summary
        .improvements,

    persistentFailures:
      gate.summary
        .persistentFailures,

    message:
      primaryReason
        ?.message ||
      (
        gate.canRelease
          ? "Release Gate بدون Regression و ERROR عبور کرده است."
          : "Release Gate هنوز آماده تصمیم نهایی نیست."
      ),
  };
}

/*
 * ============================================
 * Active Auto Regression Alerts
 * ============================================
 */

async function loadRegressions(
  pb:
    PocketBase
) {
  const alerts =
    await getAdminEvalAlerts(
      pb
    );

  const activeAlerts =
    alerts.filter(
      (
        alert
      ) =>
        alert.kind !==
        "running"
    );

  return {
    active:
      activeAlerts.length,

    critical:
      alerts.filter(
        (
          alert
        ) =>
          alert.severity ===
          "critical"
      ).length,

    warnings:
      alerts.filter(
        (
          alert
        ) =>
          alert.severity ===
          "warning"
      ).length,

    running:
      alerts.filter(
        (
          alert
        ) =>
          alert.kind ===
          "running"
      ).length,

    knowledge:
      activeAlerts.filter(
        (
          alert
        ) =>
          alert.scope ===
          "knowledge"
      ).length,

    topics:
      activeAlerts.filter(
        (
          alert
        ) =>
          alert.scope ===
          "topic"
      ).length,

    items:
      alerts
        .slice(
          0,
          5
        )
        .map(
          (
            alert
          ) => ({
            id:
              alert.id,

            scope:
              alert.scope,

            kind:
              alert.kind,

            severity:
              alert.severity,

            entityId:
              alert.entityId,

            entityTitle:
              alert.entityTitle,

            trigger:
              alert.trigger,

            message:
              alert.message,

            detailHref:
              alert.detailHref,
          })
        ),
  };
}

/*
 * ============================================
 * Golden Test Coverage
 * ============================================
 */

async function loadCoverage(
  pb:
    PocketBase
) {
  const coverage =
    await getAIEvalCoverage(
      pb
    );

  return {
    activeTopics:
      coverage
        .summary
        .activeTopics,

    uncoveredTopics:
      coverage
        .summary
        .uncoveredTopics,

    topicCoveragePercent:
      coverage
        .summary
        .topicCoveragePercent,

    publishedKnowledge:
      coverage
        .summary
        .publishedKnowledge,

    uncoveredKnowledge:
      coverage
        .summary
        .uncoveredKnowledge,

    topicOnlyKnowledge:
      coverage
        .summary
        .topicOnlyKnowledge,

    directKnowledgeCoveragePercent:
      coverage
        .summary
        .directKnowledgeCoveragePercent,
  };
}

/*
 * ============================================
 * Grounding - last 7 days
 * ============================================
 */

async function loadGrounding(
  pb:
    PocketBase
): Promise<AdminAIHealthGrounding> {
  const from =
    new Date(
      Date.now() -
        GROUNDING_RANGE_DAYS *
          24 *
          60 *
          60 *
          1000
    ).toISOString();

  const [
    required,
    verified,
    blocked,
    unsupportedClaims,
    operationalErrors,
  ] =
    await Promise.all([
      countRecords(
        pb,
        "messages",
        pb.filter(
          [
            "role = {:role}",
            "created >= {:from}",
            "(grounding_status = {:verified} || grounding_status = {:blocked})",
          ].join(
            " && "
          ),
          {
            role:
              "assistant",

            from,

            verified:
              "verified",

            blocked:
              "blocked",
          }
        )
      ),

      countRecords(
        pb,
        "messages",
        pb.filter(
          "role = {:role} && created >= {:from} && grounding_status = {:status}",
          {
            role:
              "assistant",

            from,

            status:
              "verified",
          }
        )
      ),

      countRecords(
        pb,
        "messages",
        pb.filter(
          "role = {:role} && created >= {:from} && grounding_status = {:status}",
          {
            role:
              "assistant",

            from,

            status:
              "blocked",
          }
        )
      ),

      countRecords(
        pb,
        "messages",
        pb.filter(
          "role = {:role} && created >= {:from} && grounding_verifier_status = {:status}",
          {
            role:
              "assistant",

            from,

            status:
              "unsupported_claims",
          }
        )
      ),

      countRecords(
        pb,
        "messages",
        pb.filter(
          [
            "role = {:role}",
            "created >= {:from}",
            "(",
            "grounding_verifier_status = {:unavailable}",
            "|| grounding_verifier_status = {:budget}",
            "|| grounding_verifier_status = {:invalid}",
            ")",
          ].join(
            " "
          ),
          {
            role:
              "assistant",

            from,

            unavailable:
              "verifier_unavailable",

            budget:
              "budget_blocked",

            invalid:
              "invalid_verifier_response",
          }
        )
      ),
    ]);

  const blockRate =
    required >
      0
      ? roundOne(
          (
            blocked /
            required
          ) *
            100
        )
      : 0;

  let level:
    AdminAIHealthLevel =
      "healthy";

  if (
    required >=
      GROUNDING_MIN_REQUIRED &&
    blockRate >=
      GROUNDING_CRITICAL_PERCENT
  ) {
    level =
      "critical";
  } else if (
    (
      required >=
        GROUNDING_MIN_REQUIRED &&
      blockRate >=
        GROUNDING_WARNING_PERCENT
    ) ||
    operationalErrors >
      0 ||
    unsupportedClaims >
      0
  ) {
    level =
      "warning";
  }

  return {
    rangeLabel:
      "۷ روز اخیر",

    required,

    verified,

    blocked,

    unsupportedClaims,

    operationalErrors,

    blockRate,

    level,
  };
}

/*
 * ============================================
 * Knowledge Gaps
 * ============================================
 */

async function loadGaps(
  pb:
    PocketBase
) {
  const [
    open,
    inProgress,
    highPriority,
    topResult,
  ] =
    await Promise.all([
      countRecords(
        pb,
        "knowledge_gaps",
        "status = 'open'"
      ),

      countRecords(
        pb,
        "knowledge_gaps",
        "status = 'in_progress'"
      ),

      countRecords(
        pb,
        "knowledge_gaps",
        pb.filter(
          "(status = {:open} || status = {:progress}) && priority_score >= {:score}",
          {
            open:
              "open",

            progress:
              "in_progress",

            score:
              HIGH_PRIORITY_GAP_SCORE,
          }
        )
      ),

      pb
        .collection(
          "knowledge_gaps"
        )
        .getList(
          1,
          5,
          {
            filter:
              "status = 'open' || status = 'in_progress'",

            sort:
              "-priority_score,-last_seen_at,-updated",

            expand:
              "topic",
          }
        ),
    ]);

  return {
    open,

    inProgress,

    highPriority,

    top:
      topResult.items.map(
        (
          record
        ) => {
          const topic =
            getExpandedOne(
              record,
              "topic"
            );

          return {
            id:
              record.id,

            title:
              String(
                record.title ||
                  record.sample_question ||
                  ""
              ) ||
              "Knowledge Gap",

            status:
              String(
                record.status ||
                  ""
              ),

            priorityScore:
              safeNumber(
                record.priority_score
              ),

            occurrenceCount:
              safeInteger(
                record.occurrence_count
              ),

            topicName:
              String(
                topic?.name ||
                  ""
              ).trim() ||
              undefined,
          };
        }
      ),
  };
}

/*
 * ============================================
 * Negative Feedback Review Backlog
 * ============================================
 */

async function loadFeedback(
  pb:
    PocketBase
) {
  const [
    newCount,
    inProgress,
  ] =
    await Promise.all([
      countRecords(
        pb,
        "message_feedback",
        pb.filter(
          "rating = {:rating} && review_status = {:status}",
          {
            rating:
              "down",

            status:
              "new",
          }
        )
      ),

      countRecords(
        pb,
        "message_feedback",
        pb.filter(
          "rating = {:rating} && review_status = {:status}",
          {
            rating:
              "down",

            status:
              "in_progress",
          }
        )
      ),
    ]);

  return {
    negativeOpen:
      newCount +
      inProgress,

    new:
      newCount,

    inProgress,
  };
}

/*
 * ============================================
 * Knowledge Sync
 * ============================================
 */

async function loadKnowledgeSync(
  pb:
    PocketBase
) {
  const [
    published,
    synced,
    pending,
    errors,
  ] =
    await Promise.all([
      countRecords(
        pb,
        "knowledge_items",
        "status = 'published'"
      ),

      countRecords(
        pb,
        "knowledge_items",
        "status = 'published' && sync_status = 'synced'"
      ),

      countRecords(
        pb,
        "knowledge_items",
        "status = 'published' && sync_status = 'pending'"
      ),

      countRecords(
        pb,
        "knowledge_items",
        "status = 'published' && sync_status = 'error'"
      ),
    ]);

  return {
    published,

    synced,

    pending,

    errors,
  };
}

/*
 * ============================================
 * Overall
 * ============================================
 */

function calculateOverallHealth({
  release,
  regressions,
  coverage,
  grounding,
  gaps,
  feedback,
  knowledgeSync,
  availability,
}: {
  release:
    AdminAIHealthDashboard[
      "release"
    ];

  regressions:
    AdminAIHealthDashboard[
      "regressions"
    ];

  coverage:
    AdminAIHealthDashboard[
      "coverage"
    ];

  grounding:
    AdminAIHealthDashboard[
      "grounding"
    ];

  gaps:
    AdminAIHealthDashboard[
      "gaps"
    ];

  feedback:
    AdminAIHealthDashboard[
      "feedback"
    ];

  knowledgeSync:
    AdminAIHealthDashboard[
      "knowledgeSync"
    ];

  availability:
    AdminAIHealthDashboard[
      "availability"
    ];
}) {
  const unavailableCount =
    Object.values(
      availability
    ).filter(
      (
        value
      ) =>
        !value
    ).length;

  const critical =
    release.status ===
      "blocked" ||
    regressions.critical >
      0 ||
    grounding.level ===
      "critical" ||
    knowledgeSync.errors >
      0;

  if (
    critical
  ) {
    return {
      level:
        "critical" as const,

      title:
        "نیاز به اقدام فوری",

      message:
        "حداقل یک کنترل حیاتی AI در وضعیت نامطلوب است؛ Release، Regression، Grounding یا Sync را بررسی کنید.",
    };
  }

  const warning =
    release.status !==
      "ready" ||
    regressions.warnings >
      0 ||
    regressions.running >
      0 ||
    grounding.level ===
      "warning" ||
    coverage.uncoveredTopics >
      0 ||
    coverage.uncoveredKnowledge >
      0 ||
    gaps.highPriority >
      0 ||
    feedback.negativeOpen >
      0 ||
    knowledgeSync.pending >
      0 ||
    unavailableCount >
      0;

  if (
    warning
  ) {
    return {
      level:
        "warning" as const,

      title:
        "سیستم پایدار است، اما موارد قابل پیگیری وجود دارد",

      message:
        "کنترل حیاتی Block نشده، ولی حداقل یک Warning، صف بررسی یا عملیات در انتظار وجود دارد.",
    };
  }

  return {
    level:
      "healthy" as const,

    title:
      "سلامت AI مناسب است",

    message:
      "Regression فعال، خطای Sync یا هشدار مهم Grounding شناسایی نشده است.",
  };
}

/*
 * ============================================
 * Generic Count
 * ============================================
 */

async function countRecords(
  pb:
    PocketBase,

  collection:
    string,

  filter:
    string
) {
  const result =
    await pb
      .collection(
        collection
      )
      .getList(
        1,
        1,
        {
          filter,

          fields:
            "id",
        }
      );

  return result.totalItems;
}

/*
 * ============================================
 * Helpers
 * ============================================
 */

function emptyGrounding():
  AdminAIHealthGrounding {
  return {
    rangeLabel:
      "۷ روز اخیر",

    required:
      0,

    verified:
      0,

    blocked:
      0,

    unsupportedClaims:
      0,

    operationalErrors:
      0,

    blockRate:
      0,

    level:
      "warning",
  };
}

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

function safeInteger(
  value:
    unknown
) {
  return Math.trunc(
    safeNumber(
      value
    )
  );
}

function roundOne(
  value:
    number
) {
  return Math.round(
    value *
      10
  ) /
    10;
}

function environmentInteger(
  value:
    string |
    undefined,

  minimum:
    number,

  maximum:
    number,

  fallback:
    number
) {
  const number =
    Number(
      value
    );

  if (
    !Number.isInteger(
      number
    )
  ) {
    return fallback;
  }

  return Math.min(
    maximum,
    Math.max(
      minimum,
      number
    )
  );
}

function environmentNumber(
  value:
    string |
    undefined,

  minimum:
    number,

  maximum:
    number,

  fallback:
    number
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
    return fallback;
  }

  return Math.min(
    maximum,
    Math.max(
      minimum,
      number
    )
  );
}
