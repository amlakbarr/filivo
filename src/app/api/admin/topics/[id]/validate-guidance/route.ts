import type PocketBase from "pocketbase";
import type {
  RecordModel,
} from "pocketbase";

import {
  recordAuditLog,
} from "@/lib/audit/log";

import {
  consumeAdminRateLimit,
} from "@/lib/admin/rate-limit";

import {
  previewTopicClassification,
  type TopicClassificationPreviewResult,
  type TopicClassificationPreviewTopicOverride,
} from "@/lib/ai/classification";

import {
  isSafeTopicId,
  parseTopicUpdateInput,
  safeTopicErrorMetadata,
  type TopicRecord,
} from "@/lib/topics/admin";

import {
  getTopicGuidanceEvidenceRevision,
  loadFreshTopicGuidanceValidationCases,
  type TopicGuidanceValidationEvidenceCase,
} from "@/lib/topics/guidance-validation-evidence";

import {
  issueGuidanceValidationToken,
  type GuidanceValidationDraft,
} from "@/lib/topics/guidance-validation-token";

import {
  getAdminSession,
} from "@/lib/pocketbase/admin";

import {
  getPocketBaseServiceClient,
} from "@/lib/pocketbase/service";

const BASELINE_COLLECTION =
  "topic_validation_baselines";

const QUERY_LIMIT =
  40;

const MAX_CASES =
  8;

const MAX_BASELINE_CASES_WITH_FRESH =
  6;

const MAX_FRESH_CASES =
  2;

const MAX_QUESTION_LENGTH =
  4_000;

type Context = {
  params:
    Promise<{
      id:
        string;
    }>;
};

type ValidationCase =
  TopicGuidanceValidationEvidenceCase;

type ValidationResultItem = {
  evidenceId:
    string;

  expectedTopicId:
    string |
    null;

  expectedStatus:
    "classified" |
    "unclassified";

  origin:
    "baseline" |
    "fresh" |
    "current";

  status:
    "passed" |
    "failed" |
    "error";

  result:
    TopicClassificationPreviewResult |
    null;

  error:
    string;
};

type BaselineEntry = {
  evidenceId:
    string;

  expectedTopicId:
    string |
    null;

  expectedStatus:
    "classified" |
    "unclassified";

  passed:
    boolean;

  resultStatus:
    "classified" |
    "unclassified";

  topicId:
    string |
    null;

  suggestedTopicId:
    string |
    null;

  confidence:
    number;
};

/*
 * ============================================
 * POST
 *
 * Security boundary:
 * - Server independently selects Human Reviewed evidence.
 * - Server independently runs previewTopicClassification.
 * - Client does NOT submit PASS/FAIL results.
 * - Approval token is signed and bound to:
 *   Admin + Topic + Topic.updated + exact Draft fingerprint.
 * ============================================
 */

export async function POST(
  request:
    Request,

  {
    params,
  }:
    Context
) {
  const requestId =
    crypto.randomUUID();

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

  const {
    id:
      topicId,
  } =
    await params;

  if (
    !isSafeTopicId(
      topicId
    )
  ) {
    return apiError(
      requestId,
      400,
      "TOPIC_GUIDANCE_VALIDATION_INVALID_TOPIC",
      "شناسه موضوع معتبر نیست."
    );
  }

  try {
    const rateLimit =
      await consumeAdminRateLimit({
        adminId:
          admin.account.id,

        action:
          "topic.guidance_validation",

        requestId,
      });

    if (
      !rateLimit.allowed
    ) {
      return apiError(
        requestId,
        429,
        rateLimit.code,
        "تعداد Validationهای Guidance بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.",
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
      "Guidance validation rate limit unavailable",
      {
        requestId,

        adminId:
          admin.account.id,

        topicId,

        error:
          safeTopicErrorMetadata(
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
      "TOPIC_GUIDANCE_VALIDATION_INVALID_JSON",
      "بدنه JSON معتبر نیست."
    );
  }

  const draftResult =
    parseDraft(
      body
    );

  if (
    !draftResult.ok
  ) {
    return apiError(
      requestId,
      400,
      draftResult.code,
      draftResult.message
    );
  }

  let pb:
    PocketBase;

  try {
    pb =
      await getPocketBaseServiceClient();
  } catch (error) {
    return apiError(
      requestId,
      503,
      "TOPIC_SERVICE_UNAVAILABLE",
      "سرویس مدیریت موضوعات موقتاً در دسترس نیست."
    );
  }

  let topic:
    TopicRecord;

  try {
    topic =
      await pb
        .collection(
          "topics"
        )
        .getOne<TopicRecord>(
          topicId
        );
  } catch (error) {
    if (
      getStatus(
        error
      ) ===
      404
    ) {
      return apiError(
        requestId,
        404,
        "TOPIC_NOT_FOUND",
        "موضوع موردنظر پیدا نشد."
      );
    }

    return apiError(
      requestId,
      503,
      "TOPIC_GUIDANCE_VALIDATION_TOPIC_LOOKUP_FAILED",
      "دریافت Topic برای Validation ناموفق بود."
    );
  }

  if (
    topic.active !==
    true
  ) {
    return apiError(
      requestId,
      409,
      "TOPIC_GUIDANCE_VALIDATION_TOPIC_INACTIVE",
      "برای Validation Draft، Topic باید فعال باشد."
    );
  }

  let baselineState = {
    id:
      "",

    updated:
      "",

    savedAt:
      "",

    entries:
      [] as
        BaselineEntry[],
  };

  try {
    baselineState =
      await loadBaseline(
        pb,
        topicId
      );
  } catch (error) {
    console.error(
      "Guidance validation baseline load failed",
      {
        requestId,

        topicId,

        error:
          safeTopicErrorMetadata(
            error
          ),
      }
    );

    return apiError(
      requestId,
      503,
      "TOPIC_GUIDANCE_VALIDATION_BASELINE_FAILED",
      "دریافت Shared Baseline ناموفق بود."
    );
  }

  let evidenceRevisionBefore =
    "";

  try {
    evidenceRevisionBefore =
      await getTopicGuidanceEvidenceRevision({
        pb,

        topicId,
      });
  } catch (error) {
    console.error(
      "Guidance validation evidence revision load failed",
      {
        requestId,

        topicId,

        error:
          safeTopicErrorMetadata(
            error
          ),
      }
    );

    return apiError(
      requestId,
      503,
      "TOPIC_GUIDANCE_VALIDATION_EVIDENCE_REVISION_FAILED",
      "بررسی Revision شواهد Human Review ناموفق بود."
    );
  }

  let cases:
    ValidationCase[];

  try {
    cases =
      await loadValidationCases({
        pb,

        topicId,

        baseline:
          baselineState.entries,

        baselineSavedAt:
          baselineState.savedAt,
      });
  } catch (error) {
    console.error(
      "Guidance validation evidence load failed",
      {
        requestId,

        topicId,

        error:
          safeTopicErrorMetadata(
            error
          ),
      }
    );

    return apiError(
      requestId,
      503,
      "TOPIC_GUIDANCE_VALIDATION_EVIDENCE_FAILED",
      "دریافت Evidenceهای Human Review ناموفق بود."
    );
  }

  if (
    cases.length ===
    0
  ) {
    return apiError(
      requestId,
      409,
      "TOPIC_GUIDANCE_VALIDATION_NO_EVIDENCE",
      "Evidence کافی برای Validation امن این Topic وجود ندارد."
    );
  }

  const override:
    TopicClassificationPreviewTopicOverride = {
      topicId,

      keywords:
        draftResult.draft.keywords,

      examples:
        draftResult.draft.examples,

      negativeExamples:
        draftResult.draft.negativeExamples,

      classificationNote:
        draftResult.draft.classificationNote,
    };

  const items:
    ValidationResultItem[] = [];

  for (
    const test of
    cases
  ) {
    try {
      const result =
        await previewTopicClassification({
          question:
            test.question,

          context:
            [],

          topicOverride:
            override,
        });

      const passed =
        test.expectedStatus ===
          "unclassified"
          ? result.status ===
            "unclassified"
          : result.status ===
              "classified" &&
            result.topicId ===
              test.expectedTopicId;

      items.push({
        evidenceId:
          test.evidenceId,

        expectedTopicId:
          test.expectedTopicId,

        expectedStatus:
          test.expectedStatus,

        origin:
          test.origin,

        status:
          passed
            ? "passed"
            : "failed",

        result,

        error:
          "",
      });
    } catch (error) {
      items.push({
        evidenceId:
          test.evidenceId,

        expectedTopicId:
          test.expectedTopicId,

        expectedStatus:
          test.expectedStatus,

        origin:
          test.origin,

        status:
          "error",

        result:
          null,

        error:
          publicValidationError(
            error
          ),
      });
    }
  }

  const summary =
    summarize(
      items
    );

  const comparison =
    compareBaseline({
      baseline:
        baselineState.entries,

      items,
    });

  const freshSummary =
    summarize(
      items.filter(
        (
          item
        ) =>
          item.origin ===
          "fresh"
      )
    );

  let evidenceRevisionAfter =
    "";

  try {
    evidenceRevisionAfter =
      await getTopicGuidanceEvidenceRevision({
        pb,

        topicId,
      });
  } catch (error) {
    console.error(
      "Guidance validation post-run evidence revision failed",
      {
        requestId,

        topicId,

        error:
          safeTopicErrorMetadata(
            error
          ),
      }
    );

    return apiError(
      requestId,
      503,
      "TOPIC_GUIDANCE_VALIDATION_EVIDENCE_REVISION_FAILED",
      "بررسی نهایی Revision شواهد Human Review ناموفق بود."
    );
  }

  const evidenceStable =
    evidenceRevisionBefore ===
    evidenceRevisionAfter;

  const gate =
    evaluateGate({
      baselineExists:
        baselineState.entries.length >
        0,

      summary,

      comparison,

      freshSummary,

      evidenceStable,
    });

  const validatedAt =
    new Date()
      .toISOString();

  let validationToken =
    "";

  let expiresAt =
    "";

  let validationId =
    "";

  if (
    gate.status ===
    "ready"
  ) {
    try {
      const issued =
        issueGuidanceValidationToken({
          adminId:
            admin.account.id,

          topicId,

          topicUpdated:
            String(
              topic.updated ||
                ""
            ),

          baselineId:
            baselineState.id,

          baselineUpdated:
            baselineState.updated,

          evidenceRevision:
            evidenceRevisionAfter,

          draft:
            draftResult.draft,

          metrics: {
            accuracy:
              summary.accuracy,

            failed:
              summary.failed,

            errors:
              summary.errors,

            regressed:
              comparison.regressed,

            improved:
              comparison.improved,

            compared:
              comparison.compared,
          },
        });

      validationToken =
        issued.token;

      validationId =
        issued.claims.jti;

      expiresAt =
        new Date(
          issued.claims.expiresAt *
            1000
        ).toISOString();
    } catch (error) {
      console.error(
        "Guidance validation certificate issue failed",
        {
          requestId,

          topicId,

          error:
            safeTopicErrorMetadata(
              error
            ),
        }
      );

      return apiError(
        requestId,
        503,
        "TOPIC_GUIDANCE_VALIDATION_CERTIFICATE_UNAVAILABLE",
        "صدور گواهی Validation موقتاً در دسترس نیست."
      );
    }
  }

  await recordAuditLog({
    action:
      "topic.guidance_validation",

    result:
      gate.status ===
        "ready"
        ? "success"
        : "blocked",

    actorId:
      admin.account.id,

    actorRole:
      "admin",

    entityType:
      "topic",

    entityId:
      topicId,

    requestId,

    request,

    metadata: {
      validation_id:
        validationId ||
        null,

      evidence_count:
        cases.length,

      baseline_exists:
        baselineState.entries.length >
        0,

      baseline_id:
        baselineState.id ||
        null,

      baseline_updated:
        baselineState.updated ||
        null,

      accuracy:
        summary.accuracy,

      failed:
        summary.failed,

      errors:
        summary.errors,

      compared:
        comparison.compared,

      improved:
        comparison.improved,

      regressed:
        comparison.regressed,

      fresh_evidence_count:
        freshSummary.total,

      fresh_evidence_failed:
        freshSummary.failed,

      evidence_revision:
        evidenceRevisionAfter ||
        null,

      evidence_stable:
        evidenceStable,

      gate_status:
        gate.status,

      token_expires_at:
        expiresAt ||
        null,
    },
  });

  return Response.json(
    {
      success:
        true,

      validation: {
        items,

        summary,

        comparison,

        freshEvidence: {
          tested:
            freshSummary.total,

          passed:
            freshSummary.passed,

          failed:
            freshSummary.failed,

          errors:
            freshSummary.errors,
        },

        evidence: {
          revision:
            evidenceRevisionAfter,

          stable:
            evidenceStable,
        },

        gate: {
          ...gate,

          validatedAt,

          validationToken:
            validationToken ||
            null,

          validationId:
            validationId ||
            null,

          expiresAt:
            expiresAt ||
            null,
        },
      },

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
}

/*
 * ============================================
 * Draft Parser
 * ============================================
 */

function parseDraft(
  value:
    unknown
):
  | {
      ok:
        true;

      draft:
        GuidanceValidationDraft;
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
        "TOPIC_GUIDANCE_VALIDATION_INVALID_BODY",

      message:
        "ساختار Guidance آزمایشی معتبر نیست.",
    };
  }

  const source =
    value as {
      guidance?:
        unknown;
    };

  if (
    typeof source.guidance !==
      "object" ||
    source.guidance ===
      null ||
    Array.isArray(
      source.guidance
    )
  ) {
    return {
      ok:
        false,

      code:
        "TOPIC_GUIDANCE_VALIDATION_GUIDANCE_REQUIRED",

      message:
        "Guidance آزمایشی ارسال نشده است.",
    };
  }

  const guidance =
    source.guidance as
      Record<
        string,
        unknown
      >;

  try {
    const parsed =
      parseTopicUpdateInput({
        keywords:
          guidance.keywords,

        examples:
          guidance.examples,

        negative_examples:
          guidance.negativeExamples,

        classification_note:
          guidance.classificationNote,
      });

    return {
      ok:
        true,

      draft: {
        keywords:
          parsed.keywords ||
          "",

        examples:
          parsed.examples ||
          "",

        negativeExamples:
          parsed.negative_examples ||
          "",

        classificationNote:
          parsed.classification_note ||
          "",
      },
    };
  } catch {
    return {
      ok:
        false,

      code:
        "TOPIC_GUIDANCE_VALIDATION_GUIDANCE_INVALID",

      message:
        "مقادیر Guidance آزمایشی معتبر نیست.",
    };
  }
}

/*
 * ============================================
 * Evidence Cases
 *
 * If a Shared Baseline exists, its exact Evidence
 * IDs are preferred so comparison remains stable.
 * Otherwise current Human Review evidence is used:
 * 3 positive corrections + 3 negative corrections
 * + 2 confirmed Quality Audit positives.
 * ============================================
 */

async function loadValidationCases({
  pb,
  topicId,
  baseline,
  baselineSavedAt,
}: {
  pb:
    PocketBase;

  topicId:
    string;

  baseline:
    BaselineEntry[];

  baselineSavedAt:
    string;
}) {
  if (
    baseline.length >
    0
  ) {
    const cases:
      ValidationCase[] = [];

    for (
      const entry of
      baseline.slice(
        0,
        MAX_BASELINE_CASES_WITH_FRESH
      )
    ) {
      try {
        const record =
          await pb
            .collection(
              "messages"
            )
            .getOne(
              entry.evidenceId,
              {
                fields:
                  "id,role,content,classification_reviewed",
              }
            );

        const question =
          cleanQuestion(
            record.content
          );

        if (
          record.role !==
            "user" ||
          record.classification_reviewed !==
            true ||
          !question
        ) {
          continue;
        }

        cases.push({
          evidenceId:
            record.id,

          question,

          expectedTopicId:
            entry.expectedTopicId,

          expectedStatus:
            entry.expectedStatus,

          origin:
            "baseline",
        });
      } catch (error) {
        if (
          getStatus(
            error
          ) !==
          404
        ) {
          throw error;
        }
      }
    }

    const fresh =
      await loadFreshTopicGuidanceValidationCases({
        pb,

        topicId,

        since:
          baselineSavedAt,

        excludeEvidenceIds:
          new Set(
            baseline.map(
              (
                entry
              ) =>
                entry.evidenceId
            )
          ),

        limit:
          MAX_FRESH_CASES,
      });

    return [
      ...cases,
      ...fresh,
    ].slice(
      0,
      MAX_CASES
    );
  }

  const [
    finalTopicResult,
    originalTopicResult,
  ] =
    await Promise.all([
      pb
        .collection(
          "messages"
        )
        .getList(
          1,
          QUERY_LIMIT,
          {
            filter:
              pb.filter(
                "role = 'user' && classification_reviewed = true && classification_status = 'classified' && topic = {:topicId}",
                {
                  topicId,
                }
              ),

            sort:
              "-classification_reviewed_at",

            fields:
              evidenceFields(),
          }
        ),

      pb
        .collection(
          "messages"
        )
        .getList(
          1,
          QUERY_LIMIT,
          {
            filter:
              pb.filter(
                "role = 'user' && classification_reviewed = true && classification_original_status = 'classified' && classification_original_topic = {:topicId}",
                {
                  topicId,
                }
              ),

            sort:
              "-classification_reviewed_at",

            fields:
              evidenceFields(),
          }
        ),
    ]);

  const positive:
    ValidationCase[] = [];

  const negative:
    ValidationCase[] = [];

  const confirmed:
    ValidationCase[] = [];

  const seen =
    new Set<
      string
    >();

  for (
    const record of
    finalTopicResult.items
  ) {
    const question =
      cleanQuestion(
        record.content
      );

    if (
      !question
    ) {
      continue;
    }

    const originalTopicId =
      cleanId(
        record.classification_original_topic
      );

    const originalStatus =
      cleanStatus(
        record.classification_original_status
      );

    const originalWasSame =
      originalStatus ===
        "classified" &&
      originalTopicId ===
        topicId;

    if (
      originalWasSame
    ) {
      if (
        record.classification_review_source ===
          "quality_sample" &&
        confirmed.length <
          2 &&
        !seen.has(
          record.id
        )
      ) {
        confirmed.push({
          evidenceId:
            record.id,

          question,

          expectedTopicId:
            topicId,

          expectedStatus:
            "classified",

          origin:
            "current",
        });

        seen.add(
          record.id
        );
      }

      continue;
    }

    if (
      positive.length <
        3 &&
      !seen.has(
        record.id
      )
    ) {
      positive.push({
        evidenceId:
          record.id,

        question,

        expectedTopicId:
          topicId,

        expectedStatus:
          "classified",

        origin:
          "current",
      });

      seen.add(
        record.id
      );
    }
  }

  for (
    const record of
    originalTopicResult.items
  ) {
    if (
      negative.length >=
      3
    ) {
      break;
    }

    if (
      seen.has(
        record.id
      )
    ) {
      continue;
    }

    const question =
      cleanQuestion(
        record.content
      );

    if (
      !question
    ) {
      continue;
    }

    const finalStatus =
      cleanStatus(
        record.classification_status
      );

    const finalTopicId =
      cleanId(
        record.topic
      );

    const finalWasSame =
      finalStatus ===
        "classified" &&
      finalTopicId ===
        topicId;

    if (
      finalWasSame
    ) {
      continue;
    }

    if (
      finalStatus ===
        "classified" &&
      !finalTopicId
    ) {
      continue;
    }

    negative.push({
      evidenceId:
        record.id,

      question,

      expectedTopicId:
        finalStatus ===
          "classified"
          ? finalTopicId
          : null,

      expectedStatus:
        finalStatus ===
          "classified"
          ? "classified"
          : "unclassified",

      origin:
        "current",
    });

    seen.add(
      record.id
    );
  }

  return [
    ...positive,
    ...negative,
    ...confirmed,
  ].slice(
    0,
    MAX_CASES
  );
}

function evidenceFields() {
  return [
    "id",
    "content",
    "topic",
    "classification_status",
    "classification_reviewed",
    "classification_review_source",
    "classification_original_topic",
    "classification_original_status",
    "classification_reviewed_at",
  ].join(
    ","
  );
}

/*
 * ============================================
 * Shared Baseline
 * ============================================
 */

async function loadBaseline(
  pb:
    PocketBase,

  topicId:
    string
) {
  let record:
    RecordModel;

  try {
    record =
      await pb
        .collection(
          BASELINE_COLLECTION
        )
        .getFirstListItem(
          pb.filter(
            "topic = {:topicId}",
            {
              topicId,
            }
          )
        );
  } catch (error) {
    if (
      getStatus(
        error
      ) ===
      404
    ) {
      return {
        id:
          "",

        updated:
          "",

        savedAt:
          "",

        entries:
          [] as
            BaselineEntry[],
      };
    }

    throw error;
  }

  const baseline =
    record.baseline as
      | {
          entries?:
            unknown;
        }
      | undefined;

  if (
    !Array.isArray(
      baseline?.entries
    )
  ) {
    return {
      id:
        record.id,

      updated:
        String(
          record.updated ||
            ""
        ),

      savedAt:
        String(
          record.saved_at ||
            ""
        ),

      entries:
        [] as
          BaselineEntry[],
    };
  }

  return {
    id:
      record.id,

    updated:
      String(
        record.updated ||
          ""
      ),

    savedAt:
      String(
        record.saved_at ||
          ""
      ),

    entries:
      baseline.entries
        .map(
          parseBaselineEntry
        )
        .filter(
          (
            entry
          ): entry is BaselineEntry =>
            entry !==
            null
        )
        .slice(
          0,
          MAX_CASES
        ),
  };
}

function parseBaselineEntry(
  value:
    unknown
):
  | BaselineEntry
  | null {
  if (
    typeof value !==
      "object" ||
    value ===
      null ||
    Array.isArray(
      value
    )
  ) {
    return null;
  }

  const item =
    value as
      Record<
        string,
        unknown
      >;

  const evidenceId =
    cleanId(
      item.evidenceId
    );

  const expectedStatus =
    item.expectedStatus ===
      "classified"
      ? "classified"
      : item.expectedStatus ===
          "unclassified"
        ? "unclassified"
        : null;

  const resultStatus =
    item.resultStatus ===
      "classified"
      ? "classified"
      : item.resultStatus ===
          "unclassified"
        ? "unclassified"
        : null;

  if (
    !evidenceId ||
    !expectedStatus ||
    !resultStatus ||
    typeof item.passed !==
      "boolean"
  ) {
    return null;
  }

  const expectedTopicId =
    nullableId(
      item.expectedTopicId
    );

  if (
    expectedStatus ===
      "classified" &&
    !expectedTopicId
  ) {
    return null;
  }

  return {
    evidenceId,

    expectedTopicId,

    expectedStatus,

    passed:
      item.passed,

    resultStatus,

    topicId:
      nullableId(
        item.topicId
      ),

    suggestedTopicId:
      nullableId(
        item.suggestedTopicId
      ),

    confidence:
      clampRatio(
        item.confidence
      ),
  };
}

/*
 * ============================================
 * Metrics / Gate
 * ============================================
 */

function summarize(
  items:
    ValidationResultItem[]
) {
  const completed =
    items.filter(
      (
        item
      ) =>
        item.status ===
          "passed" ||
        item.status ===
          "failed"
    );

  const passed =
    completed.filter(
      (
        item
      ) =>
        item.status ===
        "passed"
    ).length;

  const failed =
    completed.length -
    passed;

  const errors =
    items.filter(
      (
        item
      ) =>
        item.status ===
        "error"
    ).length;

  return {
    total:
      items.length,

    completed:
      completed.length,

    passed,

    failed,

    errors,

    accuracy:
      completed.length >
      0
        ? passed /
          completed.length
        : 0,
  };
}

function compareBaseline({
  baseline,
  items,
}: {
  baseline:
    BaselineEntry[];

  items:
    ValidationResultItem[];
}) {
  if (
    baseline.length ===
    0
  ) {
    return {
      compared:
        0,

      baselineAccuracy:
        0,

      currentAccuracy:
        0,

      delta:
        0,

      improved:
        0,

      regressed:
        0,

      changedPrediction:
        0,
    };
  }

  const baselineById =
    new Map(
      baseline.map(
        (
          entry
        ) => [
          entry.evidenceId,
          entry,
        ]
      )
    );

  let compared =
    0;

  let baselinePassed =
    0;

  let currentPassed =
    0;

  let improved =
    0;

  let regressed =
    0;

  let changedPrediction =
    0;

  for (
    const current of
    items
  ) {
    if (
      !current.result ||
      (
        current.status !==
          "passed" &&
        current.status !==
          "failed"
      )
    ) {
      continue;
    }

    const base =
      baselineById.get(
        current.evidenceId
      );

    if (
      !base
    ) {
      continue;
    }

    compared +=
      1;

    if (
      base.passed
    ) {
      baselinePassed +=
        1;
    }

    if (
      current.status ===
      "passed"
    ) {
      currentPassed +=
        1;
    }

    if (
      !base.passed &&
      current.status ===
        "passed"
    ) {
      improved +=
        1;
    }

    if (
      base.passed &&
      current.status ===
        "failed"
    ) {
      regressed +=
        1;
    }

    const baseTopic =
      base.topicId ||
      base.suggestedTopicId ||
      null;

    const currentTopic =
      current.result.topicId ||
      current.result.suggestedTopicId ||
      null;

    if (
      base.resultStatus !==
        current.result.status ||
      baseTopic !==
        currentTopic
    ) {
      changedPrediction +=
        1;
    }
  }

  const baselineAccuracy =
    compared >
    0
      ? baselinePassed /
        compared
      : 0;

  const currentAccuracy =
    compared >
    0
      ? currentPassed /
        compared
      : 0;

  return {
    compared,

    baselineAccuracy,

    currentAccuracy,

    delta:
      currentAccuracy -
      baselineAccuracy,

    improved,

    regressed,

    changedPrediction,
  };
}

function evaluateGate({
  baselineExists,
  summary,
  comparison,
  freshSummary,
  evidenceStable,
}: {
  baselineExists:
    boolean;

  summary:
    ReturnType<
      typeof summarize
    >;

  comparison:
    ReturnType<
      typeof compareBaseline
    >;

  freshSummary:
    ReturnType<
      typeof summarize
    >;

  evidenceStable:
    boolean;
}) {
  if (
    !evidenceStable
  ) {
    return {
      status:
        "blocked" as const,

      reason:
        "Human Review هنگام Validation تغییر کرد؛ برای جلوگیری از انتشار بر اساس Evidence ناقص، Validation را دوباره اجرا کنید.",
    };
  }

  if (
    summary.completed ===
    0
  ) {
    return {
      status:
        "blocked" as const,

      reason:
        "هیچ Validation قابل ارزیابی با موفقیت اجرا نشد.",
    };
  }

  if (
    summary.errors >
    0
  ) {
    return {
      status:
        "blocked" as const,

      reason:
        "حداقل یک تست Validation با Error مواجه شد.",
    };
  }

  if (
    baselineExists
  ) {
    if (
      comparison.compared ===
      0
    ) {
      return {
        status:
          "blocked" as const,

        reason:
          "Evidenceهای فعلی با Shared Baseline قابل مقایسه نیستند.",
      };
    }

    if (
      comparison.regressed >
      0
    ) {
      return {
        status:
          "blocked" as const,

        reason:
          "Draft نسبت به Shared Baseline حداقل یک Regression دارد.",
      };
    }

    if (
      freshSummary.failed >
      0
    ) {
      return {
        status:
          "blocked" as const,

        reason:
          "حداقل یک Human Review جدید که بعد از Shared Baseline ثبت شده در Draft فعلی FAIL شده است.",
      };
    }

    return {
      status:
        "ready" as const,

      reason:
        "Validation سرور کامل شد و Regression جدیدی نسبت به Shared Baseline دیده نشد.",
    };
  }

  if (
    summary.failed >
    0
  ) {
    return {
      status:
        "blocked" as const,

      reason:
        "Shared Baseline وجود ندارد و حداقل یک Evidence در Draft فعلی FAIL شده است.",
    };
  }

  return {
    status:
      "ready" as const,

    reason:
      "تمام Evidenceهای Validation روی سرور PASS شدند.",
  };
}

/*
 * ============================================
 * Helpers
 * ============================================
 */

function cleanQuestion(
  value:
    unknown
) {
  return String(
    value ||
      ""
  )
    .trim()
    .slice(
      0,
      MAX_QUESTION_LENGTH
    );
}

function cleanId(
  value:
    unknown
) {
  const id =
    String(
      value ||
        ""
    ).trim();

  return /^[a-zA-Z0-9_-]{1,64}$/.test(
    id
  )
    ? id
    : "";
}

function nullableId(
  value:
    unknown
) {
  return cleanId(
    value
  ) ||
    null;
}

function cleanStatus(
  value:
    unknown
) {
  const status =
    String(
      value ||
        ""
    );

  return status ===
      "classified" ||
    status ===
      "unclassified" ||
    status ===
      "error" ||
    status ===
      "pending"
    ? status
    : "unknown";
}

function clampRatio(
  value:
    unknown
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
    return 0;
  }

  return Math.max(
    0,
    Math.min(
      1,
      number
    )
  );
}

function publicValidationError(
  error:
    unknown
) {
  const status =
    getStatus(
      error
    );

  if (
    status ===
    429
  ) {
    return "سرویس AI موقتاً Rate Limited است.";
  }

  return "اجرای Classification برای این Evidence ناموفق بود.";
}

function getStatus(
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
