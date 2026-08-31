import "server-only";

import type PocketBase from "pocketbase";

import {
  compareAIEvalBatches,
  getAIEvalBatches,
} from "@/lib/ai/eval-batches";

import {
  getAIEvalCoverage,
} from "@/lib/ai/eval-coverage";

import type {
  AIEvalCoverageGateMode,
  AIEvalReleaseCoverageGate,
  AIEvalReleaseGate,
  AIEvalReleaseGateReason,
} from "@/types/ai-eval-release";

/*
 * ============================================
 * Release Gate
 *
 * Gateهای اصلی:
 *
 * 1) Baseline / Candidate
 * 2) Regression
 * 3) Eval ERROR
 * 4) Golden Test Coverage
 *
 * Coverage Policy:
 *
 * strict:
 * - Topic coverage below minimum => BLOCK
 * - Knowledge coverage below minimum => BLOCK
 * - Direct source coverage below minimum => WARNING
 *
 * warn:
 * - تمام Coverage deficitها فقط WARNING
 *
 * off:
 * - Coverage روی Release تصمیم نمی‌گیرد.
 *
 * Default:
 * AI_EVAL_COVERAGE_GATE_MODE=strict
 * ============================================
 */

const COVERAGE_GATE_MODE =
  environmentCoverageMode(
    process.env
      .AI_EVAL_COVERAGE_GATE_MODE
  );

const MIN_TOPIC_COVERAGE_PERCENT =
  environmentPercent(
    process.env
      .AI_EVAL_MIN_TOPIC_COVERAGE_PERCENT,
    100
  );

const MIN_KNOWLEDGE_COVERAGE_PERCENT =
  environmentPercent(
    process.env
      .AI_EVAL_MIN_KNOWLEDGE_COVERAGE_PERCENT,
    80
  );

const MIN_DIRECT_KNOWLEDGE_COVERAGE_PERCENT =
  environmentPercent(
    process.env
      .AI_EVAL_MIN_DIRECT_KNOWLEDGE_COVERAGE_PERCENT,
    50
  );

export async function getAIEvalReleaseGate(
  pb:
    PocketBase
): Promise<AIEvalReleaseGate> {
  /*
   * ==========================================
   * Coverage is independent of Batch history.
   * Load it first so even NOT READY screens can
   * show the current protection gap.
   * ==========================================
   */

  const coverageEvaluation =
    await evaluateCoverageGate(
      pb
    );

  const batches =
    await getAIEvalBatches(
      pb
    );

  const baseline =
    batches.find(
      (
        batch
      ) =>
        batch.isBaseline &&
        batch.runMode ===
          "all"
    );

  if (
    !baseline
  ) {
    const reasons = [
      {
        code:
          "NO_BASELINE",

        severity:
          "blocking" as const,

        title:
          "Baseline تعریف نشده است",

        message:
          "ابتدا یک Golden Test Batch پایدار را به‌عنوان Baseline ثبت کنید.",
      },

      ...coverageEvaluation
        .reasons,
    ];

    return {
      status:
        "not_ready",

      canRelease:
        false,

      coverage:
        coverageEvaluation
          .coverage,

      reasons,

      summary:
        emptySummary(
          coverageEvaluation
            .coverage
        ),
    };
  }

  /*
   * Only full-suite Batches can become Release
   * candidates. Auto/Single/Partial batches are
   * intentionally excluded.
   */
  const candidate =
    batches.find(
      (
        batch
      ) =>
        batch.id !==
          baseline.id &&
        batch.runMode ===
          "all" &&
        batch.status !==
          "running" &&
        Date.parse(
          batch.created
        ) >
          Date.parse(
            baseline.created
          )
    ) ||
    batches.find(
      (
        batch
      ) =>
        batch.id !==
          baseline.id &&
        batch.runMode ===
          "all" &&
        batch.status !==
          "running"
    );

  if (
    !candidate
  ) {
    const reasons = [
      {
        code:
          "NO_CANDIDATE",

        severity:
          "blocking" as const,

        title:
          "Candidate Run وجود ندارد",

        message:
          "بعد از Baseline یک Run کامل از Golden Questions اجرا کنید.",
      },

      ...coverageEvaluation
        .reasons,
    ];

    return {
      status:
        "not_ready",

      canRelease:
        false,

      baseline,

      coverage:
        coverageEvaluation
          .coverage,

      reasons,

      summary:
        emptySummary(
          coverageEvaluation
            .coverage
        ),
    };
  }

  if (
    candidate.status ===
    "error"
  ) {
    const reasons = [
      {
        code:
          "CANDIDATE_BATCH_ERROR",

        severity:
          "blocking" as const,

        title:
          "Candidate Batch با خطا تمام شده است",

        message:
          "قبل از انتشار، Golden Testها را دوباره اجرا و خطای Batch را برطرف کنید.",
      },

      ...coverageEvaluation
        .reasons,
    ];

    return {
      status:
        "blocked",

      canRelease:
        false,

      baseline,

      candidate,

      coverage:
        coverageEvaluation
          .coverage,

      reasons,

      summary:
        emptySummary(
          coverageEvaluation
            .coverage
        ),
    };
  }

  /*
   * ==========================================
   * Baseline vs Candidate
   * ==========================================
   */

  const comparison =
    await compareAIEvalBatches({
      pb,

      baselineId:
        baseline.id,

      currentId:
        candidate.id,
    });

  const reasons:
    AIEvalReleaseGateReason[] =
      [];

  const regressions =
    comparison
      .summary
      .regressions;

  const errors =
    comparison
      .summary
      .errors;

  const improvements =
    comparison
      .summary
      .improvements;

  const persistentFailures =
    comparison
      .summary
      .persistentFailures;

  /*
   * ==========================================
   * Regression Gate
   * ==========================================
   */

  if (
    regressions >
    0
  ) {
    reasons.push({
      code:
        "REGRESSION_DETECTED",

      severity:
        "blocking",

      title:
        "Regression شناسایی شده است",

      message:
        `${regressions.toLocaleString(
          "fa-IR"
        )} Golden Question از PASS در Baseline به FAIL در Candidate تبدیل شده است.`,
    });
  }

  /*
   * ==========================================
   * Eval Execution Gate
   * ==========================================
   */

  if (
    errors >
    0
  ) {
    reasons.push({
      code:
        "EVAL_ERRORS",

      severity:
        "blocking",

      title:
        "اجرای بعضی تست‌ها خطا داشته است",

      message:
        `${errors.toLocaleString(
          "fa-IR"
        )} Case قابل ارزیابی قطعی نبوده است. قبل از انتشار باید ERRORها صفر شوند.`,
    });
  }

  /*
   * ==========================================
   * Coverage Gate
   * ==========================================
   */

  reasons.push(
    ...coverageEvaluation
      .reasons
  );

  /*
   * ==========================================
   * Non-blocking Test Information
   * ==========================================
   */

  if (
    persistentFailures >
    0
  ) {
    reasons.push({
      code:
        "PERSISTENT_FAILURES",

      severity:
        "warning",

      title:
        "Failureهای قدیمی هنوز باقی مانده‌اند",

      message:
        `${persistentFailures.toLocaleString(
          "fa-IR"
        )} Case هم در Baseline و هم در Candidate FAIL است. این مورد Regression جدید نیست ولی بهتر است اصلاح شود.`,
    });
  }

  if (
    improvements >
    0
  ) {
    reasons.push({
      code:
        "IMPROVEMENTS",

      severity:
        "info",

      title:
        "بهبود نسبت به Baseline",

      message:
        `${improvements.toLocaleString(
          "fa-IR"
        )} Case از FAIL به PASS تبدیل شده است.`,
    });
  }

  if (
    comparison
      .environment
      .configChanged
  ) {
    reasons.push({
      code:
        "CONFIG_CHANGED",

      severity:
        "info",

      title:
        "Configuration تغییر کرده است",

      message:
        "Model، Prompt، Retrieval configuration یا Vector Store نسبت به Baseline تغییر کرده است.",
    });
  }

  if (
    comparison
      .environment
      .knowledgeChanged
  ) {
    reasons.push({
      code:
        "KNOWLEDGE_CHANGED",

      severity:
        "info",

      title:
        "Knowledge تغییر کرده است",

      message:
        "Fingerprint پایگاه دانش منتشرشده نسبت به Baseline تغییر کرده است.",
    });
  }

  const blocking =
    reasons.some(
      (
        reason
      ) =>
        reason.severity ===
        "blocking"
    );

  if (
    !blocking
  ) {
    reasons.unshift({
      code:
        "RELEASE_READY",

      severity:
        "info",

      title:
        "Release Gate عبور کرده است",

      message:
        coverageEvaluation
          .coverage
          .mode ===
          "off"
          ? "Regression یا ERROR جدید وجود ندارد. Coverage Gate در تنظیمات غیرفعال است."
          : "Regression یا ERROR جدید وجود ندارد و Coverage Policy نیز مانع Release نیست.",
    });
  }

  return {
    status:
      blocking
        ? "blocked"
        : "ready",

    canRelease:
      !blocking,

    baseline:
      comparison.baseline,

    candidate:
      comparison.current,

    comparison,

    coverage:
      coverageEvaluation
        .coverage,

    reasons,

    summary: {
      regressions,

      errors,

      improvements,

      persistentFailures,

      configChanged:
        comparison
          .environment
          .configChanged,

      knowledgeChanged:
        comparison
          .environment
          .knowledgeChanged,

      coverageBlockingIssues:
        coverageEvaluation
          .coverage
          .blockingIssues,

      coverageWarnings:
        coverageEvaluation
          .coverage
          .warnings,
    },
  };
}

/*
 * ============================================
 * Coverage Evaluation
 * ============================================
 */

async function evaluateCoverageGate(
  pb:
    PocketBase
): Promise<{
  coverage:
    AIEvalReleaseCoverageGate;

  reasons:
    AIEvalReleaseGateReason[];
}> {
  try {
    const report =
      await getAIEvalCoverage(
        pb
      );

    const summary =
      report.summary;

    const meetsTopicCoverage =
      summary
        .topicCoveragePercent >=
      MIN_TOPIC_COVERAGE_PERCENT;

    const meetsKnowledgeCoverage =
      summary
        .knowledgeCoveragePercent >=
      MIN_KNOWLEDGE_COVERAGE_PERCENT;

    const meetsDirectKnowledgeCoverage =
      summary
        .directKnowledgeCoveragePercent >=
      MIN_DIRECT_KNOWLEDGE_COVERAGE_PERCENT;

    const reasons:
      AIEvalReleaseGateReason[] =
      [];

    if (
      COVERAGE_GATE_MODE ===
      "off"
    ) {
      return {
        coverage: {
          available:
            true,

          mode:
            COVERAGE_GATE_MODE,

          activeCases:
            summary.activeCases,

          activeTopics:
            summary.activeTopics,

          coveredTopics:
            summary.coveredTopics,

          uncoveredTopics:
            summary.uncoveredTopics,

          topicCoveragePercent:
            summary.topicCoveragePercent,

          minimumTopicCoveragePercent:
            MIN_TOPIC_COVERAGE_PERCENT,

          publishedKnowledge:
            summary.publishedKnowledge,

          coveredKnowledge:
            summary.coveredKnowledge,

          uncoveredKnowledge:
            summary.uncoveredKnowledge,

          knowledgeCoveragePercent:
            summary.knowledgeCoveragePercent,

          minimumKnowledgeCoveragePercent:
            MIN_KNOWLEDGE_COVERAGE_PERCENT,

          directKnowledge:
            summary.directKnowledge,

          topicOnlyKnowledge:
            summary.topicOnlyKnowledge,

          directKnowledgeCoveragePercent:
            summary.directKnowledgeCoveragePercent,

          minimumDirectKnowledgeCoveragePercent:
            MIN_DIRECT_KNOWLEDGE_COVERAGE_PERCENT,

          meetsTopicCoverage,

          meetsKnowledgeCoverage,

          meetsDirectKnowledgeCoverage,

          blockingIssues:
            0,

          warnings:
            0,
        },

        reasons: [
          {
            code:
              "COVERAGE_GATE_DISABLED",

            severity:
              "info",

            title:
              "Coverage Gate غیرفعال است",

            message:
              `Coverage اندازه‌گیری شده است، اما در تصمیم Release دخالت ندارد. Topic ${formatPercent(
                summary.topicCoveragePercent
              )}٪، Knowledge ${formatPercent(
                summary.knowledgeCoveragePercent
              )}٪، Direct Source ${formatPercent(
                summary.directKnowledgeCoveragePercent
              )}٪.`,
          },
        ],
      };
    }

    /*
     * Topic Coverage:
     * In strict mode this blocks release.
     */
    if (
      !meetsTopicCoverage
    ) {
      reasons.push({
        code:
          "TOPIC_COVERAGE_BELOW_GATE",

        severity:
          COVERAGE_GATE_MODE ===
          "strict"
            ? "blocking"
            : "warning",

        title:
          "Topic Coverage کافی نیست",

        message:
          `${summary.uncoveredTopics.toLocaleString(
            "fa-IR"
          )} Topic فعال بدون Golden Test مرتبط است. Coverage فعلی ${formatPercent(
            summary.topicCoveragePercent
          )}٪ و حداقل موردنیاز ${formatPercent(
            MIN_TOPIC_COVERAGE_PERCENT
          )}٪ است.`,
      });
    }

    /*
     * Knowledge Coverage:
     * In strict mode this also blocks release.
     */
    if (
      !meetsKnowledgeCoverage
    ) {
      reasons.push({
        code:
          "KNOWLEDGE_COVERAGE_BELOW_GATE",

        severity:
          COVERAGE_GATE_MODE ===
          "strict"
            ? "blocking"
            : "warning",

        title:
          "Knowledge Coverage کافی نیست",

        message:
          `${summary.uncoveredKnowledge.toLocaleString(
            "fa-IR"
          )} Knowledge منتشرشده بدون Golden Test مرتبط است. Coverage فعلی ${formatPercent(
            summary.knowledgeCoveragePercent
          )}٪ و حداقل موردنیاز ${formatPercent(
            MIN_KNOWLEDGE_COVERAGE_PERCENT
          )}٪ است.`,
      });
    }

    /*
     * Direct Source Coverage is intentionally
     * warning-only. Topic-level cases still give
     * some regression protection, but Source
     * assertions should improve over time.
     */
    if (
      !meetsDirectKnowledgeCoverage
    ) {
      reasons.push({
        code:
          "DIRECT_KNOWLEDGE_COVERAGE_BELOW_TARGET",

        severity:
          "warning",

        title:
          "Source Coverage مستقیم پایین است",

        message:
          `فقط ${formatPercent(
            summary.directKnowledgeCoveragePercent
          )}٪ از Knowledgeهای منتشرشده حداقل یک Golden Case با Source assertion مستقیم دارند. هدف فعلی ${formatPercent(
            MIN_DIRECT_KNOWLEDGE_COVERAGE_PERCENT
          )}٪ است.`,
      });
    }

    if (
      meetsTopicCoverage &&
      meetsKnowledgeCoverage &&
      meetsDirectKnowledgeCoverage
    ) {
      reasons.push({
        code:
          "COVERAGE_GATE_PASSED",

        severity:
          "info",

        title:
          "Coverage Gate عبور کرده است",

        message:
          `Topic Coverage ${formatPercent(
            summary.topicCoveragePercent
          )}٪، Knowledge Coverage ${formatPercent(
            summary.knowledgeCoveragePercent
          )}٪ و Direct Source Coverage ${formatPercent(
            summary.directKnowledgeCoveragePercent
          )}٪ است.`,
      });
    }

    const blockingIssues =
      reasons.filter(
        (
          reason
        ) =>
          reason.severity ===
          "blocking"
      ).length;

    const warnings =
      reasons.filter(
        (
          reason
        ) =>
          reason.severity ===
          "warning"
      ).length;

    return {
      coverage: {
        available:
          true,

        mode:
          COVERAGE_GATE_MODE,

        activeCases:
          summary.activeCases,

        activeTopics:
          summary.activeTopics,

        coveredTopics:
          summary.coveredTopics,

        uncoveredTopics:
          summary.uncoveredTopics,

        topicCoveragePercent:
          summary.topicCoveragePercent,

        minimumTopicCoveragePercent:
          MIN_TOPIC_COVERAGE_PERCENT,

        publishedKnowledge:
          summary.publishedKnowledge,

        coveredKnowledge:
          summary.coveredKnowledge,

        uncoveredKnowledge:
          summary.uncoveredKnowledge,

        knowledgeCoveragePercent:
          summary.knowledgeCoveragePercent,

        minimumKnowledgeCoveragePercent:
          MIN_KNOWLEDGE_COVERAGE_PERCENT,

        directKnowledge:
          summary.directKnowledge,

        topicOnlyKnowledge:
          summary.topicOnlyKnowledge,

        directKnowledgeCoveragePercent:
          summary.directKnowledgeCoveragePercent,

        minimumDirectKnowledgeCoveragePercent:
          MIN_DIRECT_KNOWLEDGE_COVERAGE_PERCENT,

        meetsTopicCoverage,

        meetsKnowledgeCoverage,

        meetsDirectKnowledgeCoverage,

        blockingIssues,

        warnings,
      },

      reasons,
    };
  } catch (
    error
  ) {
    console.error(
      "Release coverage gate unavailable",
      {
        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    /*
     * Fail closed in strict mode:
     * if Coverage cannot be measured, Release
     * should not silently pass.
     */
    const severity:
      AIEvalReleaseGateReason[
        "severity"
      ] =
        COVERAGE_GATE_MODE ===
        "strict"
          ? "blocking"
          : "warning";

    return {
      coverage:
        emptyCoverage(
          false,
          severity ===
            "blocking"
            ? 1
            : 0,
          severity ===
            "warning"
            ? 1
            : 0
        ),

      reasons: [
        {
          code:
            "COVERAGE_GATE_UNAVAILABLE",

          severity,

          title:
            "Coverage Gate قابل ارزیابی نیست",

          message:
            COVERAGE_GATE_MODE ===
            "strict"
              ? "گزارش Coverage در دسترس نیست؛ در حالت strict، Release برای جلوگیری از عبور بدون Evidence مسدود می‌شود."
              : "گزارش Coverage در دسترس نیست؛ Release Gate با Warning ادامه می‌دهد.",
        },
      ],
    };
  }
}

/*
 * ============================================
 * Empty Values
 * ============================================
 */

function emptyCoverage(
  available:
    boolean,

  blockingIssues =
    0,

  warnings =
    0
): AIEvalReleaseCoverageGate {
  return {
    available,

    mode:
      COVERAGE_GATE_MODE,

    activeCases:
      0,

    activeTopics:
      0,

    coveredTopics:
      0,

    uncoveredTopics:
      0,

    topicCoveragePercent:
      0,

    minimumTopicCoveragePercent:
      MIN_TOPIC_COVERAGE_PERCENT,

    publishedKnowledge:
      0,

    coveredKnowledge:
      0,

    uncoveredKnowledge:
      0,

    knowledgeCoveragePercent:
      0,

    minimumKnowledgeCoveragePercent:
      MIN_KNOWLEDGE_COVERAGE_PERCENT,

    directKnowledge:
      0,

    topicOnlyKnowledge:
      0,

    directKnowledgeCoveragePercent:
      0,

    minimumDirectKnowledgeCoveragePercent:
      MIN_DIRECT_KNOWLEDGE_COVERAGE_PERCENT,

    meetsTopicCoverage:
      false,

    meetsKnowledgeCoverage:
      false,

    meetsDirectKnowledgeCoverage:
      false,

    blockingIssues,

    warnings,
  };
}

function emptySummary(
  coverage:
    AIEvalReleaseCoverageGate
) {
  return {
    regressions:
      0,

    errors:
      0,

    improvements:
      0,

    persistentFailures:
      0,

    configChanged:
      false,

    knowledgeChanged:
      false,

    coverageBlockingIssues:
      coverage.blockingIssues,

    coverageWarnings:
      coverage.warnings,
  };
}

/*
 * ============================================
 * ENV
 * ============================================
 */

function environmentCoverageMode(
  value:
    string |
    undefined
): AIEvalCoverageGateMode {
  const mode =
    String(
      value ||
        ""
    )
      .trim()
      .toLowerCase();

  if (
    mode ===
      "warn" ||
    mode ===
      "off"
  ) {
    return mode;
  }

  return "strict";
}

function environmentPercent(
  value:
    string |
    undefined,

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
    100,
    Math.max(
      0,
      Math.round(
        number *
          10
      ) /
        10
    )
  );
}

/*
 * ============================================
 * Misc
 * ============================================
 */

function formatPercent(
  value:
    number
) {
  return value.toLocaleString(
    "fa-IR",
    {
      maximumFractionDigits:
        1,
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
