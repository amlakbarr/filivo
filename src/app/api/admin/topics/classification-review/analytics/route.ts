import type PocketBase from "pocketbase";

import {
  getTopicClassificationMinConfidence,
} from "@/lib/ai/classification";

import {
  getAdminSession,
} from "@/lib/pocketbase/admin";

import {
  getPocketBaseServiceClient,
} from "@/lib/pocketbase/service";

const PAGE_SIZE =
  200;

const MAX_REVIEWED_MESSAGES =
  1_000;

type ReviewRange =
  | "7d"
  | "30d"
  | "90d"
  | "all";

type TopicInfo = {
  id:
    string;

  name:
    string;

  code:
    string;
};

type ReviewedMessage = {
  id:
    string;

  topic:
    string |
    null;

  status:
    string;

  originalTopic:
    string |
    null;

  originalStatus:
    string;

  originalConfidence:
    number;

  reviewedAt:
    string;

  reviewSource:
    string;
};

/*
 * ============================================
 * GET
 *
 * Human-review quality analytics:
 * - AI accuracy against reviewed ground truth
 * - correction rate
 * - confusion pairs
 * - missed topics from Unclassified
 * - false positives
 * - per-topic reviewed accuracy
 *
 * No user/message content is returned.
 * ============================================
 */

export async function GET(
  request:
    Request
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

  let pb:
    PocketBase;

  try {
    pb =
      await getPocketBaseServiceClient();
  } catch (error) {
    console.error(
      "Classification review analytics service unavailable",
      {
        requestId,

        adminId:
          admin.account.id,

        error:
          errorMetadata(
            error
          ),
      }
    );

    return apiError(
      requestId,
      503,
      "CLASSIFICATION_REVIEW_ANALYTICS_UNAVAILABLE",
      "سرویس تحلیل کیفیت Classification موقتاً در دسترس نیست."
    );
  }

  const url =
    new URL(
      request.url
    );

  const range =
    parseRange(
      url.searchParams.get(
        "range"
      )
    );

  const since =
    rangeStart(
      range
    );

  try {
    const [
      reviewed,
      topicRecords,
    ] =
      await Promise.all([
        loadReviewedMessages({
          pb,

          since,
        }),

        pb
          .collection(
            "topics"
          )
          .getFullList({
            fields:
              "id,name,code",

            sort:
              "name",
          }),
      ]);

    const topics =
      topicRecords.map(
        (
          record
        ) => ({
          id:
            record.id,

          name:
            String(
              record.name ||
                ""
            )
              .trim()
              .slice(
                0,
                160
              ),

          code:
            String(
              record.code ||
                ""
            )
              .trim()
              .slice(
                0,
                80
              ),
        } satisfies TopicInfo)
      );

    const topicById =
      new Map(
        topics.map(
          (
            topic
          ) => [
            topic.id,
            topic,
          ]
        )
      );

    const currentThreshold =
      getTopicClassificationMinConfidence();

    const dashboard =
      buildDashboard({
        reviewed,

        topicById,

        range,

        currentThreshold,
      });

    return Response.json(
      {
        success:
          true,

        dashboard,

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
  } catch (error) {
    console.error(
      "Classification review analytics failed",
      {
        requestId,

        adminId:
          admin.account.id,

        range,

        error:
          errorMetadata(
            error
          ),
      }
    );

    return apiError(
      requestId,
      503,
      "CLASSIFICATION_REVIEW_ANALYTICS_FAILED",
      "دریافت تحلیل کیفیت Classification ناموفق بود."
    );
  }
}

/*
 * ============================================
 * Load Reviewed Messages
 * ============================================
 */

async function loadReviewedMessages({
  pb,
  since,
}: {
  pb:
    PocketBase;

  since:
    string |
    null;
}) {
  const items:
    ReviewedMessage[] = [];

  let page =
    1;

  while (
    items.length <
    MAX_REVIEWED_MESSAGES
  ) {
    const filters = [
      "classification_reviewed = true",
    ];

    const params:
      Record<
        string,
        unknown
      > = {};

    if (
      since
    ) {
      filters.push(
        "classification_reviewed_at >= {:since}"
      );

      params.since =
        since;
    }

    const result =
      await pb
        .collection(
          "messages"
        )
        .getList(
          page,
          PAGE_SIZE,
          {
            filter:
              pb.filter(
                filters.join(
                  " && "
                ),
                params
              ),

            sort:
              "-classification_reviewed_at",

            fields:
              [
                "id",
                "topic",
                "classification_status",
                "classification_original_topic",
                "classification_original_status",
                "classification_original_confidence",
                "classification_reviewed_at",
                "classification_review_source",
              ].join(
                ","
              ),
          }
        );

    for (
      const record of
      result.items
    ) {
      items.push({
        id:
          record.id,

        topic:
          cleanId(
            record.topic
          ) ||
          null,

        status:
          cleanStatus(
            record.classification_status
          ),

        originalTopic:
          cleanId(
            record.classification_original_topic
          ) ||
          null,

        originalStatus:
          cleanStatus(
            record.classification_original_status
          ),

        originalConfidence:
          clampConfidence(
            record.classification_original_confidence
          ),

        reviewedAt:
          String(
            record.classification_reviewed_at ||
              ""
          ),

        reviewSource:
          normalizeReviewSource(
            record.classification_review_source
          ),
      });

      if (
        items.length >=
        MAX_REVIEWED_MESSAGES
      ) {
        break;
      }
    }

    if (
      page >=
        result.totalPages ||
      result.items.length ===
        0
    ) {
      break;
    }

    page +=
      1;
  }

  return items;
}

/*
 * ============================================
 * Dashboard
 * ============================================
 */

function buildDashboard({
  reviewed,
  topicById,
  range,
  currentThreshold,
}: {
  reviewed:
    ReviewedMessage[];

  topicById:
    Map<
      string,
      TopicInfo
    >;

  range:
    ReviewRange;

  currentThreshold:
    number;
}) {
  let correct =
    0;

  let changed =
    0;

  let qualitySampleReviewed =
    0;

  let qualitySampleCorrect =
    0;

  let focusedReviewed =
    0;

  let focusedCorrected =
    0;

  let missedFromUnclassified =
    0;

  let falsePositive =
    0;

  let topicToTopic =
    0;

  let originalConfidenceSum =
    0;

  let originalConfidenceCount =
    0;

  let correctConfidenceSum =
    0;

  let correctConfidenceCount =
    0;

  let correctedConfidenceSum =
    0;

  let correctedConfidenceCount =
    0;

  const confusionMap =
    new Map<
      string,
      {
        fromTopicId:
          string |
          null;

        fromLabel:
          string;

        toTopicId:
          string |
          null;

        toLabel:
          string;

        count:
          number;
      }
    >();

  const perTopicMap =
    new Map<
      string,
      {
        topicId:
          string;

        topicName:
          string;

        topicCode:
          string;

        reviewed:
          number;

        correct:
          number;

        corrected:
          number;

        missedFromUnclassified:
          number;
      }
    >();

  const diagnosticMap =
    new Map<
      string,
      {
        topicId:
          string;

        topicName:
          string;

        topicCode:
          string;

        predictedReviewed:
          number;

        predictedCorrect:
          number;

        predictedWrong:
          number;

        qualitySampleReviewed:
          number;

        qualitySampleCorrect:
          number;

        falsePositive:
          number;

        outgoingTopicConfusions:
          number;

        incomingTopicConfusions:
          number;

        missedFromUnclassified:
          number;

        outgoingTargets:
          Map<
            string,
            {
              label:
                string;

              count:
                number;
            }
          >;

        incomingSources:
          Map<
            string,
            {
              label:
                string;

              count:
                number;
            }
          >;
      }
    >();

  for (
    const item of
    reviewed
  ) {
    const same =
      sameClassification({
        currentStatus:
          item.status,

        currentTopic:
          item.topic,

        originalStatus:
          item.originalStatus,

        originalTopic:
          item.originalTopic,
      });

    if (
      same
    ) {
      correct +=
        1;
    } else {
      changed +=
        1;
    }

    if (
      item.reviewSource ===
      "quality_sample"
    ) {
      qualitySampleReviewed +=
        1;

      if (
        same
      ) {
        qualitySampleCorrect +=
          1;
      }
    } else {
      focusedReviewed +=
        1;

      if (
        !same
      ) {
        focusedCorrected +=
          1;
      }
    }

    originalConfidenceSum +=
      item.originalConfidence;

    originalConfidenceCount +=
      1;

    if (
      same
    ) {
      correctConfidenceSum +=
        item.originalConfidence;

      correctConfidenceCount +=
        1;
    } else {
      correctedConfidenceSum +=
        item.originalConfidence;

      correctedConfidenceCount +=
        1;
    }

    const originalClassified =
      item.originalStatus ===
        "classified" &&
      Boolean(
        item.originalTopic
      );

    const currentClassified =
      item.status ===
        "classified" &&
      Boolean(
        item.topic
      );

    /*
     * ========================================
     * Topic Diagnostics
     *
     * "Predicted" metrics به Topic اولیه AI
     * نسبت داده می‌شوند.
     *
     * "Incoming/Missed" metrics به Topic نهایی
     * Human Review نسبت داده می‌شوند.
     * ========================================
     */

    if (
      originalClassified &&
      item.originalTopic
    ) {
      const diagnostic =
        ensureTopicDiagnostic({
          map:
            diagnosticMap,

          topicId:
            item.originalTopic,

          topicById,
        });

      diagnostic.predictedReviewed +=
        1;

      if (
        same
      ) {
        diagnostic.predictedCorrect +=
          1;
      } else {
        diagnostic.predictedWrong +=
          1;
      }

      if (
        item.reviewSource ===
        "quality_sample"
      ) {
        diagnostic.qualitySampleReviewed +=
          1;

        if (
          same
        ) {
          diagnostic.qualitySampleCorrect +=
            1;
        }
      }

      if (
        !same
      ) {
        if (
          currentClassified &&
          item.topic &&
          item.topic !==
            item.originalTopic
        ) {
          diagnostic.outgoingTopicConfusions +=
            1;

          const targetLabel =
            classificationLabel({
              status:
                item.status,

              topicId:
                item.topic,

              topicById,
            });

          incrementDiagnosticLabel(
            diagnostic.outgoingTargets,
            item.topic,
            targetLabel
          );
        } else if (
          item.status ===
          "unclassified"
        ) {
          diagnostic.falsePositive +=
            1;

          incrementDiagnosticLabel(
            diagnostic.outgoingTargets,
            "__unclassified__",
            "Unclassified"
          );
        }
      }
    }

    if (
      currentClassified &&
      item.topic
    ) {
      const diagnostic =
        ensureTopicDiagnostic({
          map:
            diagnosticMap,

          topicId:
            item.topic,

          topicById,
        });

      if (
        !originalClassified
      ) {
        diagnostic.missedFromUnclassified +=
          1;

        incrementDiagnosticLabel(
          diagnostic.incomingSources,
          item.originalStatus ||
            "__unclassified__",
          classificationLabel({
            status:
              item.originalStatus,

            topicId:
              item.originalTopic,

            topicById,
          })
        );
      } else if (
        item.originalTopic !==
        item.topic
      ) {
        diagnostic.incomingTopicConfusions +=
          1;

        incrementDiagnosticLabel(
          diagnostic.incomingSources,
          item.originalTopic ||
            "__unknown__",
          classificationLabel({
            status:
              item.originalStatus,

            topicId:
              item.originalTopic,

            topicById,
          })
        );
      }
    }

    if (
      !originalClassified &&
      currentClassified
    ) {
      missedFromUnclassified +=
        1;
    } else if (
      originalClassified &&
      !currentClassified
    ) {
      falsePositive +=
        1;
    } else if (
      originalClassified &&
      currentClassified &&
      item.originalTopic !==
        item.topic
    ) {
      topicToTopic +=
        1;
    }

    if (
      !same
    ) {
      const fromLabel =
        classificationLabel({
          status:
            item.originalStatus,

          topicId:
            item.originalTopic,

          topicById,
        });

      const toLabel =
        classificationLabel({
          status:
            item.status,

          topicId:
            item.topic,

          topicById,
        });

      const key =
        `${item.originalTopic || item.originalStatus}=>${item.topic || item.status}`;

      const existing =
        confusionMap.get(
          key
        );

      if (
        existing
      ) {
        existing.count +=
          1;
      } else {
        confusionMap.set(
          key,
          {
            fromTopicId:
              item.originalTopic,

            fromLabel,

            toTopicId:
              item.topic,

            toLabel,

            count:
              1,
          }
        );
      }
    }

    if (
      currentClassified &&
      item.topic
    ) {
      const topic =
        topicById.get(
          item.topic
        );

      const existing =
        perTopicMap.get(
          item.topic
        ) || {
          topicId:
            item.topic,

          topicName:
            topic?.name ||
            "موضوع نامشخص",

          topicCode:
            topic?.code ||
            "",

          reviewed:
            0,

          correct:
            0,

          corrected:
            0,

          missedFromUnclassified:
            0,
        };

      existing.reviewed +=
        1;

      if (
        same
      ) {
        existing.correct +=
          1;
      } else {
        existing.corrected +=
          1;
      }

      if (
        !originalClassified
      ) {
        existing.missedFromUnclassified +=
          1;
      }

      perTopicMap.set(
        item.topic,
        existing
      );
    }
  }

  const total =
    reviewed.length;

  const accuracy =
    total >
    0
      ? correct /
        total
      : 0;

  const correctionRate =
    total >
    0
      ? changed /
        total
      : 0;

  const confusionPairs =
    Array.from(
      confusionMap.values()
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
        15
      );

  const perTopic =
    Array.from(
      perTopicMap.values()
    )
      .map(
        (
          item
        ) => ({
          ...item,

          accuracy:
            item.reviewed >
            0
              ? item.correct /
                item.reviewed
              : 0,
        })
      )
      .sort(
        (
          first,
          second
        ) =>
          second.reviewed -
          first.reviewed
      )
      .slice(
        0,
        30
      );

  const calibration =
    buildThresholdCalibration({
      reviewed,

      currentThreshold,
    });

  const guidancePriorities =
    buildGuidancePriorities(
      diagnosticMap
    );

  return {
    range: {
      value:
        range,

      label:
        rangeLabel(
          range
        ),
    },

    kpis: {
      reviewed:
        total,

      correct,

      corrected:
        changed,

      accuracy,

      correctionRate,

      missedFromUnclassified,

      falsePositive,

      topicToTopic,

      qualitySampleReviewed,

      qualitySampleCorrect,

      qualitySampleAccuracy:
        qualitySampleReviewed >
        0
          ? qualitySampleCorrect /
            qualitySampleReviewed
          : 0,

      focusedReviewed,

      focusedCorrectionRate:
        focusedReviewed >
        0
          ? focusedCorrected /
            focusedReviewed
          : 0,

      averageOriginalConfidence:
        average(
          originalConfidenceSum,
          originalConfidenceCount
        ),

      averageCorrectConfidence:
        average(
          correctConfidenceSum,
          correctConfidenceCount
        ),

      averageCorrectedConfidence:
        average(
          correctedConfidenceSum,
          correctedConfidenceCount
        ),
    },

    calibration,

    confusionPairs,

    guidancePriorities,

    perTopic,
  };
}

/*
 * ============================================
 * Guidance Improvement Priorities
 * ============================================
 */

function ensureTopicDiagnostic({
  map,
  topicId,
  topicById,
}: {
  map:
    Map<
      string,
      {
        topicId:
          string;

        topicName:
          string;

        topicCode:
          string;

        predictedReviewed:
          number;

        predictedCorrect:
          number;

        predictedWrong:
          number;

        qualitySampleReviewed:
          number;

        qualitySampleCorrect:
          number;

        falsePositive:
          number;

        outgoingTopicConfusions:
          number;

        incomingTopicConfusions:
          number;

        missedFromUnclassified:
          number;

        outgoingTargets:
          Map<
            string,
            {
              label:
                string;

              count:
                number;
            }
          >;

        incomingSources:
          Map<
            string,
            {
              label:
                string;

              count:
                number;
            }
          >;
      }
    >;

  topicId:
    string;

  topicById:
    Map<
      string,
      TopicInfo
    >;
}) {
  const existing =
    map.get(
      topicId
    );

  if (
    existing
  ) {
    return existing;
  }

  const topic =
    topicById.get(
      topicId
    );

  const created = {
    topicId,

    topicName:
      topic?.name ||
      "موضوع نامشخص",

    topicCode:
      topic?.code ||
      "",

    predictedReviewed:
      0,

    predictedCorrect:
      0,

    predictedWrong:
      0,

    qualitySampleReviewed:
      0,

    qualitySampleCorrect:
      0,

    falsePositive:
      0,

    outgoingTopicConfusions:
      0,

    incomingTopicConfusions:
      0,

    missedFromUnclassified:
      0,

    outgoingTargets:
      new Map<
        string,
        {
          label:
            string;

          count:
            number;
        }
      >(),

    incomingSources:
      new Map<
        string,
        {
          label:
            string;

          count:
            number;
        }
      >(),
  };

  map.set(
    topicId,
    created
  );

  return created;
}

function incrementDiagnosticLabel(
  map:
    Map<
      string,
      {
        label:
          string;

        count:
          number;
      }
    >,

  key:
    string,

  label:
    string
) {
  const existing =
    map.get(
      key
    );

  if (
    existing
  ) {
    existing.count +=
      1;

    return;
  }

  map.set(
    key,
    {
      label,

      count:
        1,
    }
  );
}

function buildGuidancePriorities(
  map:
    Map<
      string,
      {
        topicId:
          string;

        topicName:
          string;

        topicCode:
          string;

        predictedReviewed:
          number;

        predictedCorrect:
          number;

        predictedWrong:
          number;

        qualitySampleReviewed:
          number;

        qualitySampleCorrect:
          number;

        falsePositive:
          number;

        outgoingTopicConfusions:
          number;

        incomingTopicConfusions:
          number;

        missedFromUnclassified:
          number;

        outgoingTargets:
          Map<
            string,
            {
              label:
                string;

              count:
                number;
            }
          >;

        incomingSources:
          Map<
            string,
            {
              label:
                string;

              count:
                number;
            }
          >;
      }
    >
) {
  return Array.from(
    map.values()
  )
    .map(
      (
        item
      ) => {
        const qualityAuditAccuracy =
          item.qualitySampleReviewed >
          0
            ? item.qualitySampleCorrect /
              item.qualitySampleReviewed
            : null;

        const predictedAccuracy =
          item.predictedReviewed >
          0
            ? item.predictedCorrect /
              item.predictedReviewed
            : null;

        const issueCount =
          item.predictedWrong +
          item.missedFromUnclassified +
          item.incomingTopicConfusions;

        const priority =
          guidancePriority({
            qualitySampleReviewed:
              item.qualitySampleReviewed,

            qualityAuditAccuracy,

            predictedWrong:
              item.predictedWrong,

            missedFromUnclassified:
              item.missedFromUnclassified,

            issueCount,
          });

        const actions:
          string[] = [];

        if (
          item.missedFromUnclassified >=
            2 ||
          item.incomingTopicConfusions >=
            2
        ) {
          actions.push(
            "نمونه‌های مثبت و keywords را تقویت کن تا Intent این Topic بهتر شناسایی شود."
          );
        }

        if (
          item.falsePositive >=
            2 ||
          item.outgoingTopicConfusions >=
            2
        ) {
          actions.push(
            "negative_examples و classification_note را دقیق‌تر کن تا مرز این Topic محدودتر شود."
          );
        }

        const topOutgoing =
          topDiagnosticLabel(
            item.outgoingTargets
          );

        const topIncoming =
          topDiagnosticLabel(
            item.incomingSources
          );

        if (
          topOutgoing
        ) {
          actions.push(
            `مرزبندی با «${topOutgoing.label}» را بازبینی کن؛ ${topOutgoing.count} اصلاح به این مسیر ثبت شده است.`
          );
        }

        if (
          topIncoming &&
          topIncoming.label !==
          "Unclassified"
        ) {
          actions.push(
            `نمونه‌های «${topIncoming.label}» را با این Topic مقایسه کن؛ ${topIncoming.count} مورد به این Topic اصلاح شده است.`
          );
        }

        if (
          item.qualitySampleReviewed >=
            5 &&
          qualityAuditAccuracy !==
            null &&
          qualityAuditAccuracy <
            0.9
        ) {
          actions.push(
            "Quality Audit این Topic زیر ۹۰٪ است؛ قبل از تغییر Threshold، Guidance و مثال‌ها را بازبینی کن."
          );
        }

        if (
          actions.length ===
          0 &&
          issueCount >
            0
        ) {
          actions.push(
            "چند Human Review دیگر جمع‌آوری کن تا الگوی خطا روشن‌تر شود."
          );
        }

        return {
          topicId:
            item.topicId,

          topicName:
            item.topicName,

          topicCode:
            item.topicCode,

          priority,

          issueCount,

          predictedReviewed:
            item.predictedReviewed,

          predictedWrong:
            item.predictedWrong,

          predictedAccuracy,

          qualitySampleReviewed:
            item.qualitySampleReviewed,

          qualityAuditAccuracy,

          falsePositive:
            item.falsePositive,

          outgoingTopicConfusions:
            item.outgoingTopicConfusions,

          incomingTopicConfusions:
            item.incomingTopicConfusions,

          missedFromUnclassified:
            item.missedFromUnclassified,

          topOutgoing:
            topOutgoing
              ? {
                  label:
                    topOutgoing.label,

                  count:
                    topOutgoing.count,
                }
              : null,

          topIncoming:
            topIncoming
              ? {
                  label:
                    topIncoming.label,

                  count:
                    topIncoming.count,
                }
              : null,

          actions:
            actions.slice(
              0,
              4
            ),
        };
      }
    )
    .filter(
      (
        item
      ) =>
        item.issueCount >
          0 ||
        (
          item.qualitySampleReviewed >=
            5 &&
          item.qualityAuditAccuracy !==
            null &&
          item.qualityAuditAccuracy <
            0.9
        )
    )
    .sort(
      (
        first,
        second
      ) =>
        guidancePriorityRank(
          first.priority
        ) -
          guidancePriorityRank(
            second.priority
          ) ||
        second.issueCount -
          first.issueCount ||
        (
          first.qualityAuditAccuracy ??
          1
        ) -
          (
            second.qualityAuditAccuracy ??
            1
          )
    )
    .slice(
      0,
      12
    );
}

function guidancePriority({
  qualitySampleReviewed,
  qualityAuditAccuracy,
  predictedWrong,
  missedFromUnclassified,
  issueCount,
}: {
  qualitySampleReviewed:
    number;

  qualityAuditAccuracy:
    number |
    null;

  predictedWrong:
    number;

  missedFromUnclassified:
    number;

  issueCount:
    number;
}):
  | "critical"
  | "high"
  | "medium"
  | "low" {
  if (
    qualitySampleReviewed >=
      5 &&
    qualityAuditAccuracy !==
      null &&
    qualityAuditAccuracy <
      0.75
  ) {
    return "critical";
  }

  if (
    (
      qualitySampleReviewed >=
        5 &&
      qualityAuditAccuracy !==
        null &&
      qualityAuditAccuracy <
        0.9
    ) ||
    predictedWrong >=
      5 ||
    missedFromUnclassified >=
      5
  ) {
    return "high";
  }

  if (
    predictedWrong >=
      2 ||
    missedFromUnclassified >=
      2 ||
    issueCount >=
      3
  ) {
    return "medium";
  }

  return "low";
}

function guidancePriorityRank(
  priority:
    | "critical"
    | "high"
    | "medium"
    | "low"
) {
  return priority ===
      "critical"
      ? 0
      : priority ===
          "high"
        ? 1
        : priority ===
            "medium"
          ? 2
          : 3;
}

function topDiagnosticLabel(
  map:
    Map<
      string,
      {
        label:
          string;

        count:
          number;
      }
    >
) {
  return Array.from(
    map.values()
  )
    .sort(
      (
        first,
        second
      ) =>
        second.count -
        first.count
    )[0] ||
    null;
}

/*
 * ============================================
 * Threshold Calibration
 *
 * Important:
 * این تحلیل فقط روی پیام‌هایی انجام می‌شود که
 * AI در خروجی اصلی آنها را Classified کرده بود.
 *
 * بنابراین Calibration اینجا معیار
 * "Selective Precision vs Coverage" است و
 * Recall کامل Classification را تخمین نمی‌زند.
 * ============================================
 */

function buildThresholdCalibration({
  reviewed,
  currentThreshold,
}: {
  reviewed:
    ReviewedMessage[];

  currentThreshold:
    number;
}) {
  const eligible =
    reviewed.filter(
      (
        item
      ) =>
        item.originalStatus ===
          "classified" &&
        Boolean(
          item.originalTopic
        )
    );

  const thresholds =
    buildThresholdCandidates(
      currentThreshold
    );

  const points =
    thresholds.map(
      (
        threshold
      ) => {
        const accepted =
          eligible.filter(
            (
              item
            ) =>
              item.originalConfidence >=
              threshold
          );

        const correctAccepted =
          accepted.filter(
            (
              item
            ) =>
              sameClassification({
                currentStatus:
                  item.status,

                currentTopic:
                  item.topic,

                originalStatus:
                  item.originalStatus,

                originalTopic:
                  item.originalTopic,
              })
          ).length;

        const wrongAccepted =
          accepted.length -
          correctAccepted;

        return {
          threshold,

          accepted:
            accepted.length,

          correctAccepted,

          wrongAccepted,

          precision:
            accepted.length >
            0
              ? correctAccepted /
                accepted.length
              : 0,

          coverage:
            eligible.length >
            0
              ? accepted.length /
                eligible.length
              : 0,
        };
      }
    );

  const currentPoint =
    closestCalibrationPoint(
      points,
      currentThreshold
    );

  const recommendation =
    recommendThreshold(
      points
    );

  return {
    eligibleReviewedClassified:
      eligible.length,

    currentThreshold,

    current: {
      threshold:
        currentPoint?.threshold ??
        currentThreshold,

      accepted:
        currentPoint?.accepted ??
        0,

      correctAccepted:
        currentPoint?.correctAccepted ??
        0,

      wrongAccepted:
        currentPoint?.wrongAccepted ??
        0,

      precision:
        currentPoint?.precision ??
        0,

      coverage:
        currentPoint?.coverage ??
        0,
    },

    recommendation,

    points,
  };
}

function buildThresholdCandidates(
  currentThreshold:
    number
) {
  const values =
    new Set<
      number
    >();

  for (
    let value =
      0.3;
    value <=
    0.95001;
    value +=
      0.05
  ) {
    values.add(
      roundThreshold(
        value
      )
    );
  }

  values.add(
    roundThreshold(
      Math.min(
        1,
        Math.max(
          0,
          currentThreshold
        )
      )
    )
  );

  return Array.from(
    values
  ).sort(
    (
      first,
      second
    ) =>
      first -
      second
  );
}

function closestCalibrationPoint(
  points:
    Array<{
      threshold:
        number;

      accepted:
        number;

      correctAccepted:
        number;

      wrongAccepted:
        number;

      precision:
        number;

      coverage:
        number;
    }>,

  threshold:
    number
) {
  if (
    points.length ===
    0
  ) {
    return null;
  }

  return points.reduce(
    (
      best,
      point
    ) =>
      Math.abs(
        point.threshold -
        threshold
      ) <
      Math.abs(
        best.threshold -
        threshold
      )
        ? point
        : best
  );
}

/*
 * پیشنهاد محافظه‌کارانه:
 * 1) حداقل 90٪ Precision و بیشترین Coverage.
 * 2) اگر داده به 90٪ نرسید، بالاترین Precision
 *    و سپس Coverage بیشتر.
 *
 * حداقل 5 نمونه Accepted لازم است تا یک Threshold
 * به عنوان پیشنهاد عملی انتخاب شود.
 */
function recommendThreshold(
  points:
    Array<{
      threshold:
        number;

      accepted:
        number;

      correctAccepted:
        number;

      wrongAccepted:
        number;

      precision:
        number;

      coverage:
        number;
    }>
) {
  const supported =
    points.filter(
      (
        point
      ) =>
        point.accepted >=
        5
    );

  if (
    supported.length ===
    0
  ) {
    return {
      available:
        false,

      reason:
        "insufficient_data",

      threshold:
        null,

      precision:
        0,

      coverage:
        0,

      accepted:
        0,

      wrongAccepted:
        0,
    };
  }

  const highPrecision =
    supported
      .filter(
        (
          point
        ) =>
          point.precision >=
          0.9
      )
      .sort(
        (
          first,
          second
        ) =>
          second.coverage -
            first.coverage ||
          second.precision -
            first.precision ||
          first.threshold -
            second.threshold
      );

  const best =
    highPrecision[0] ||
    supported
      .slice()
      .sort(
        (
          first,
          second
        ) =>
          second.precision -
            first.precision ||
          second.coverage -
            first.coverage ||
          first.threshold -
            second.threshold
      )[0];

  return {
    available:
      true,

    reason:
      highPrecision.length >
      0
        ? "target_precision"
        : "best_available",

    threshold:
      best.threshold,

    precision:
      best.precision,

    coverage:
      best.coverage,

    accepted:
      best.accepted,

    wrongAccepted:
      best.wrongAccepted,
  };
}

function roundThreshold(
  value:
    number
) {
  return Math.round(
    value *
    100
  ) /
  100;
}

function sameClassification({
  currentStatus,
  currentTopic,
  originalStatus,
  originalTopic,
}: {
  currentStatus:
    string;

  currentTopic:
    string |
    null;

  originalStatus:
    string;

  originalTopic:
    string |
    null;
}) {
  if (
    currentStatus ===
      "classified"
  ) {
    return (
      originalStatus ===
        "classified" &&
      Boolean(
        currentTopic
      ) &&
      currentTopic ===
        originalTopic
    );
  }

  if (
    currentStatus ===
      "unclassified"
  ) {
    return originalStatus ===
      "unclassified";
  }

  return (
    currentStatus ===
      originalStatus &&
    currentTopic ===
      originalTopic
  );
}

function classificationLabel({
  status,
  topicId,
  topicById,
}: {
  status:
    string;

  topicId:
    string |
    null;

  topicById:
    Map<
      string,
      TopicInfo
    >;
}) {
  if (
    status ===
      "classified" &&
    topicId
  ) {
    return topicById.get(
      topicId
    )?.name ||
    "موضوع نامشخص";
  }

  if (
    status ===
    "unclassified"
  ) {
    return "Unclassified";
  }

  if (
    status ===
    "error"
  ) {
    return "Error";
  }

  return status ||
    "نامشخص";
}

/*
 * ============================================
 * Range
 * ============================================
 */

function parseRange(
  value:
    string |
    null
): ReviewRange {
  return value ===
      "7d" ||
    value ===
      "90d" ||
    value ===
      "all"
    ? value
    : "30d";
}

function rangeStart(
  range:
    ReviewRange
) {
  if (
    range ===
    "all"
  ) {
    return null;
  }

  const days =
    range ===
      "7d"
      ? 7
      : range ===
          "90d"
        ? 90
        : 30;

  const date =
    new Date();

  date.setUTCDate(
    date.getUTCDate() -
      days
  );

  return date.toISOString();
}

function rangeLabel(
  range:
    ReviewRange
) {
  return range ===
      "7d"
      ? "۷ روز اخیر"
      : range ===
          "90d"
        ? "۹۰ روز اخیر"
        : range ===
            "all"
          ? "همه بررسی‌ها"
          : "۳۰ روز اخیر";
}

/*
 * ============================================
 * Helpers
 * ============================================
 */

function average(
  sum:
    number,

  count:
    number
) {
  return count >
    0
    ? sum /
      count
    : 0;
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

function normalizeReviewSource(
  value:
    unknown
) {
  return value ===
    "quality_sample"
    ? "quality_sample"
    : "needs_review";
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

function clampConfidence(
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

  return Math.min(
    1,
    Math.max(
      0,
      number
    )
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
  return Response.json(
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
        "Cache-Control":
          "no-store",

        "X-Request-Id":
          requestId,
      },
    }
  );
}

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
