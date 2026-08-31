import "server-only";

import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";

import {
  calculateKnowledgeGapPriorityBreakdown,
  summarizeKnowledgeGapGroundingRisk,
  type KnowledgeGapGroundingMessage,
  type KnowledgeGapPriorityBreakdown,
} from "@/lib/knowledge-gaps/priority";

import type {
  GroundingRemediationBlockedItem,
  GroundingRemediationGap,
  GroundingRemediationRange,
  GroundingTopicRemediationDashboard,
} from "@/types/grounding-remediation";

/*
 * ============================================
 * Constants
 * ============================================
 */

const BLOCKED_LIMIT =
  100;

const RANGE_CONFIG:
  Record<
    GroundingRemediationRange,
    {
      milliseconds:
        number;

      label:
        string;
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

/*
 * ============================================
 * Public
 * ============================================
 */

export function parseGroundingRemediationRange(
  value:
    string |
    null
): GroundingRemediationRange {
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

export function isGroundingRecordId(
  value:
    string
) {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(
    String(
      value ||
        ""
    ).trim()
  );
}

export async function getGroundingTopicRemediationDashboard(
  pb:
    PocketBase,

  topicId:
    string,

  preset:
    GroundingRemediationRange
): Promise<GroundingTopicRemediationDashboard> {
  if (
    !isGroundingRecordId(
      topicId
    )
  ) {
    throw new Error(
      "Invalid topic id"
    );
  }

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

  const topic =
    await pb
      .collection(
        "topics"
      )
      .getOne(
        topicId,
        {
          expand:
            "parent",
        }
      );

  const parent =
    getExpandedOne(
      topic,
      "parent"
    );

  const topicName =
    String(
      topic.name ||
        ""
    ).trim() ||
    "موضوع بدون نام";

  const parentName =
    String(
      parent?.name ||
        ""
    ).trim();

  const [
    gaps,
    blockedRecords,
  ] =
    await Promise.all([
      loadTopicGaps(
        pb,
        topicId
      ),

      loadTopicBlockedMessages({
        pb,

        topicId,

        from:
          from.toISOString(),

        to:
          now.toISOString(),
      }),
    ]);

  const priorityBreakdowns =
    await loadGapPriorityBreakdowns(
      pb,
      gaps
    );

  const userMessageIds =
    blockedRecords
      .map(
        (
          record
        ) =>
          String(
            record.reply_to ||
              ""
          ).trim()
      )
      .filter(
        isGroundingRecordId
      );

  const occurrenceByUserMessage =
    await loadGapOccurrencesByUserMessage(
      pb,
      userMessageIds
    );

  const blocked =
    blockedRecords
      .slice(
        0,
        BLOCKED_LIMIT
      )
      .map(
        (
          record
        ) =>
          serializeBlockedItem(
            record,
            occurrenceByUserMessage
          )
      );

  return {
    range: {
      preset,

      label:
        config.label,

      from:
        from.toISOString(),

      to:
        now.toISOString(),
    },

    topic: {
      id:
        topic.id,

      name:
        topicName,

      parentName:
        parentName ||
        undefined,

      label:
        parentName
          ? `${parentName} > ${topicName}`
          : topicName,
    },

    totals: {
      openGaps:
        gaps.length,

      blockedQuestions:
        blocked.length,

      verifierBlocked:
        blocked.filter(
          (
            item
          ) =>
            item.verifierStatus ===
            "unsupported_claims"
        ).length,

      withoutEvidence:
        blocked.filter(
          (
            item
          ) =>
            item.relevantCount ===
              0 ||
            item.sourceCount ===
              0
        ).length,

      linkedToGap:
        blocked.filter(
          (
            item
          ) =>
            Boolean(
              item.gapId
            )
        ).length,

      unlinkedToGap:
        blocked.filter(
          (
            item
          ) =>
            !item.gapId
        ).length,
    },

    gaps:
      gaps.map(
        (
          gap
        ) =>
          serializeGap(
            gap,
            priorityBreakdowns.get(
              gap.id
            )
          )
      ),

    blocked,
  };
}

/*
 * ============================================
 * Topic Gaps
 * ============================================
 */

async function loadTopicGaps(
  pb:
    PocketBase,

  topicId:
    string
) {
  return pb
    .collection(
      "knowledge_gaps"
    )
    .getFullList({
      filter:
        pb.filter(
          "topic = {:topicId} && (status = {:open} || status = {:progress})",
          {
            topicId,

            open:
              "open",

            progress:
              "in_progress",
          }
        ),

      sort:
        "-priority_score,-last_seen_at,-updated",

      expand:
        "topic",
    });
}

/*
 * ============================================
 * Blocked Messages
 *
 * ابتدا Nested relation filter را امتحان می‌کنیم.
 * اگر نسخه PocketBase آن را نپذیرد، fallback
 * امن اجرا می‌شود و Topic بعد از Expand فیلتر
 * خواهد شد.
 * ============================================
 */

async function loadTopicBlockedMessages({
  pb,
  topicId,
  from,
  to,
}: {
  pb:
    PocketBase;

  topicId:
    string;

  from:
    string;

  to:
    string;
}) {
  const commonOptions = {
    sort:
      "-created",

    expand: [
      "reply_to",
      "reply_to.topic",
      "user",
      "user.department",
    ].join(
      ","
    ),
  };

  try {
    return await pb
      .collection(
        "messages"
      )
      .getFullList({
        ...commonOptions,

        filter:
          pb.filter(
            [
              "role = {:role}",
              "grounding_status = {:blocked}",
              "reply_to.topic = {:topicId}",
              "created >= {:from}",
              "created < {:to}",
            ].join(
              " && "
            ),
            {
              role:
                "assistant",

              blocked:
                "blocked",

              topicId,

              from,

              to,
            }
          ),
      });
  } catch {
    const records =
      await pb
        .collection(
          "messages"
        )
        .getFullList({
          ...commonOptions,

          filter:
            pb.filter(
              [
                "role = {:role}",
                "grounding_status = {:blocked}",
                "created >= {:from}",
                "created < {:to}",
              ].join(
                " && "
              ),
              {
                role:
                  "assistant",

                blocked:
                  "blocked",

                from,

                to,
              }
            ),
        });

    return records.filter(
      (
        record
      ) => {
        const userMessage =
          getExpandedOne(
            record,
            "reply_to"
          );

        return (
          String(
            userMessage?.topic ||
              ""
          ).trim() ===
          topicId
        );
      }
    );
  }
}

/*
 * ============================================
 * Gap Occurrence Mapping
 * ============================================
 */

async function loadGapOccurrencesByUserMessage(
  pb:
    PocketBase,

  userMessageIds:
    string[]
) {
  const uniqueIds =
    [
      ...new Set(
        userMessageIds
      ),
    ]
      .filter(
        isGroundingRecordId
      );

  const result =
    new Map<
      string,
      {
        gapId:
          string;

        gapStatus?:
          string;
      }
    >();

  if (
    uniqueIds.length ===
    0
  ) {
    return result;
  }

  /*
   * برای جلوگیری از Query بسیار بزرگ، Batch
   * ثابت استفاده می‌کنیم.
   */
  const batchSize =
    30;

  for (
    let offset =
      0;
    offset <
      uniqueIds.length;
    offset +=
      batchSize
  ) {
    const batch =
      uniqueIds.slice(
        offset,
        offset +
          batchSize
      );

    const values:
      Record<
        string,
        string
      > = {};

    const clauses =
      batch.map(
        (
          id,
          index
        ) => {
          const key =
            `message${index}`;

          values[
            key
          ] =
            id;

          return `user_message = {:${key}}`;
        }
      );

    const records =
      await pb
        .collection(
          "knowledge_gap_occurrences"
        )
        .getFullList({
          filter:
            pb.filter(
              clauses.join(
                " || "
              ),
              values
            ),

          expand:
            "gap",

          sort:
            "-created",
        });

    for (
      const record of
      records
    ) {
      const userMessageId =
        String(
          record.user_message ||
            ""
        ).trim();

      const gap =
        getExpandedOne(
          record,
          "gap"
        );

      const gapId =
        String(
          record.gap ||
            gap?.id ||
            ""
        ).trim();

      if (
        !isGroundingRecordId(
          userMessageId
        ) ||
        !isGroundingRecordId(
          gapId
        ) ||
        result.has(
          userMessageId
        )
      ) {
        continue;
      }

      result.set(
        userMessageId,
        {
          gapId,

          gapStatus:
            String(
              gap?.status ||
                ""
            ).trim() ||
            undefined,
        }
      );
    }
  }

  return result;
}

/*
 * ============================================
 * Priority Breakdown
 *
 * همان Risk Metadata که Tracker استفاده می‌کند
 * دوباره برای Explainability UI محاسبه می‌شود.
 *
 * Occurrenceها یکجا Load می‌شوند و برای هر Gap
 * حداکثر 500 پیام جدید در نظر گرفته می‌شود تا
 * با Tracker هم‌راستا بماند.
 * ============================================
 */

async function loadGapPriorityBreakdowns(
  pb:
    PocketBase,

  gaps:
    RecordModel[]
) {
  const result =
    new Map<
      string,
      KnowledgeGapPriorityBreakdown
    >();

  if (
    gaps.length ===
    0
  ) {
    return result;
  }

  const messagesByGap =
    new Map<
      string,
      KnowledgeGapGroundingMessage[]
    >();

  const gapIds =
    gaps
      .map(
        (
          gap
        ) =>
          gap.id
      )
      .filter(
        isGroundingRecordId
      );

  const batchSize =
    30;

  for (
    let offset =
      0;
    offset <
      gapIds.length;
    offset +=
      batchSize
  ) {
    const batch =
      gapIds.slice(
        offset,
        offset +
          batchSize
      );

    const values:
      Record<
        string,
        string
      > =
        {};

    const clauses =
      batch.map(
        (
          gapId,
          index
        ) => {
          const key =
            `gapPriority${index}`;

          values[
            key
          ] =
            gapId;

          return `gap = {:${key}}`;
        }
      );

    const occurrences =
      await pb
        .collection(
          "knowledge_gap_occurrences"
        )
        .getFullList({
          filter:
            pb.filter(
              clauses.join(
                " || "
              ),
              values
            ),

          sort:
            "-created",

          expand:
            "assistant_message",
        });

    for (
      const occurrence of
      occurrences
    ) {
      const gapId =
        String(
          occurrence.gap ||
            ""
        ).trim();

      if (
        !isGroundingRecordId(
          gapId
        )
      ) {
        continue;
      }

      const messages =
        messagesByGap.get(
          gapId
        ) ||
        [];

      if (
        messages.length >=
        500
      ) {
        continue;
      }

      const assistant =
        getExpandedOne(
          occurrence,
          "assistant_message"
        );

      if (
        assistant
      ) {
        messages.push(
          assistant
        );

        messagesByGap.set(
          gapId,
          messages
        );
      }
    }
  }

  for (
    const gap of
    gaps
  ) {
    const risk =
      summarizeKnowledgeGapGroundingRisk(
        messagesByGap.get(
          gap.id
        ) ||
        []
      );

    result.set(
      gap.id,
      calculateKnowledgeGapPriorityBreakdown({
        occurrenceCount:
          safeNumber(
            gap.occurrence_count
          ),

        uniqueUsers:
          safeNumber(
            gap.unique_users_count
          ),

        uniqueDepartments:
          safeNumber(
            gap.unique_departments_count
          ),

        noEvidenceBlockedCount:
          risk
            .noEvidenceBlockedCount,

        verifierBlockedCount:
          risk
            .verifierBlockedCount,

        unsupportedClaimsCount:
          risk
            .unsupportedClaimsCount,
      })
    );
  }

  return result;
}

/*
 * ============================================
 * Serialize Gap
 * ============================================
 */

function serializeGap(
  record:
    RecordModel,

  priorityBreakdown?:
    KnowledgeGapPriorityBreakdown
): GroundingRemediationGap {
  return {
    id:
      record.id,

    title:
      String(
        record.title ||
          ""
      ).trim() ||
      "Knowledge Gap",

    sampleQuestion:
      String(
        record.sample_question ||
          ""
      ).trim(),

    status:
      normalizeGapStatus(
        record.status
      ),

    gapType:
      normalizeGapType(
        record.gap_type
      ),

    priorityScore:
      safeNumber(
        record.priority_score
      ),

    occurrenceCount:
      safeNumber(
        record.occurrence_count
      ),

    uniqueUsersCount:
      safeNumber(
        record.unique_users_count
      ),

    uniqueDepartmentsCount:
      safeNumber(
        record.unique_departments_count
      ),

    lastSeenAt:
      String(
        record.last_seen_at ||
          ""
      ).trim() ||
      undefined,

    priorityBreakdown:
      priorityBreakdown ||
      calculateKnowledgeGapPriorityBreakdown({
        occurrenceCount:
          safeNumber(
            record.occurrence_count
          ),

        uniqueUsers:
          safeNumber(
            record.unique_users_count
          ),

        uniqueDepartments:
          safeNumber(
            record.unique_departments_count
          ),

        noEvidenceBlockedCount:
          0,

        verifierBlockedCount:
          0,

        unsupportedClaimsCount:
          0,
      }),
  };
}

/*
 * ============================================
 * Serialize Blocked
 * ============================================
 */

function serializeBlockedItem(
  record:
    RecordModel,

  occurrenceByUserMessage:
    Map<
      string,
      {
        gapId:
          string;

        gapStatus?:
          string;
      }
    >
): GroundingRemediationBlockedItem {
  const userMessage =
    getExpandedOne(
      record,
      "reply_to"
    );

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

  const userMessageId =
    String(
      record.reply_to ||
        userMessage?.id ||
        ""
    ).trim();

  const occurrence =
    occurrenceByUserMessage.get(
      userMessageId
    );

  return {
    assistantMessageId:
      record.id,

    userMessageId,

    conversationId:
      String(
        record.conversation ||
          ""
      ).trim(),

    question:
      String(
        userMessage?.content ||
          ""
      ).trim(),

    created:
      String(
        record.created ||
          ""
      ),

    userName:
      String(
        user?.name ||
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

    gateReason:
      String(
        record.grounding_gate_reason ||
          ""
      ).trim(),

    verifierStatus:
      String(
        record.grounding_verifier_status ||
          ""
      ).trim(),

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

    gapId:
      occurrence
        ?.gapId,

    gapStatus:
      occurrence
        ?.gapStatus,
  };
}

/*
 * ============================================
 * Helpers
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

function normalizeGapStatus(
  value:
    unknown
):
  GroundingRemediationGap["status"] {
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

  return "open";
}

function normalizeGapType(
  value:
    unknown
):
  GroundingRemediationGap["gapType"] {
  if (
    value ===
      "unclassified" ||
    value ===
      "both"
  ) {
    return value;
  }

  return "no_answer";
}

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

  try {
    const parsed:
      unknown =
        JSON.parse(
          value
        );

    return Array.isArray(
      parsed
    )
      ? parsed
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
          )
      : [];
  } catch {
    return [];
  }
}
