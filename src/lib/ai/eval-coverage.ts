import "server-only";

import type PocketBase from "pocketbase";
import type {
  RecordModel,
} from "pocketbase";

import type {
  AIEvalCoverageDashboard,
  AIEvalKnowledgeCoverageItem,
  AIEvalTopicCoverageItem,
} from "@/types/ai-eval-coverage";

/*
 * ============================================
 * Golden Test Coverage
 *
 * Topic coverage:
 * - direct: expected_topic = topic
 * - knowledge-driven: Golden Case انتظار Knowledge
 *   متعلق به همان Topic را دارد.
 *
 * Knowledge coverage:
 * - strong: Case صریحاً همان Knowledge را در
 *   expected_knowledge_items دارد.
 * - topic_only: Case مرتبط با Topic وجود دارد
 *   ولی Source assertion مستقیم برای Knowledge
 *   نداریم.
 * - uncovered: هیچ Case مرتبطی وجود ندارد.
 *
 * این تعریف با Auto Eval Triggerها هماهنگ است:
 * تغییر Knowledge یا Topic باید حداقل یک Case
 * مرتبط برای اجرا داشته باشد.
 * ============================================
 */

export async function getAIEvalCoverage(
  pb:
    PocketBase
): Promise<AIEvalCoverageDashboard> {
  const [
    topicRecords,
    knowledgeRecords,
    caseRecords,
  ] =
    await Promise.all([
      pb
        .collection(
          "topics"
        )
        .getFullList({
          filter:
            "active = true",

          sort:
            "name",

          fields:
            "id,name,active",
        }),

      pb
        .collection(
          "knowledge_items"
        )
        .getFullList({
          filter:
            "status = 'published'",

          sort:
            "-updated",

          fields: [
            "id",
            "title",
            "topic",
            "status",
            "sync_status",
            "version",
            "updated",
          ].join(
            ","
          ),
        }),

      pb
        .collection(
          "ai_eval_cases"
        )
        .getFullList({
          filter:
            "active = true",

          sort:
            "created",

          fields: [
            "id",
            "expected_topic",
            "expected_knowledge_items",
            "active",
          ].join(
            ","
          ),
        }),
    ]);

  const topicNameById =
    new Map<
      string,
      string
    >();

  for (
    const topic of
    topicRecords
  ) {
    topicNameById.set(
      topic.id,
      String(
        topic.name ||
          ""
      ) ||
      "Topic"
    );
  }

  const knowledgeById =
    new Map<
      string,
      RecordModel
    >();

  for (
    const knowledge of
    knowledgeRecords
  ) {
    knowledgeById.set(
      knowledge.id,
      knowledge
    );
  }

  /*
   * ==========================================
   * Index Cases
   * ==========================================
   */

  const directTopicCases =
    new Map<
      string,
      Set<string>
    >();

  const knowledgeCases =
    new Map<
      string,
      Set<string>
    >();

  const topicKnowledgeCases =
    new Map<
      string,
      Set<string>
    >();

  for (
    const evalCase of
    caseRecords
  ) {
    const caseId =
      evalCase.id;

    const expectedTopicId =
      cleanRecordId(
        evalCase.expected_topic
      );

    if (
      expectedTopicId
    ) {
      addToSetMap(
        directTopicCases,
        expectedTopicId,
        caseId
      );
    }

    const expectedKnowledgeIds =
      relationIds(
        evalCase
          .expected_knowledge_items
      );

    for (
      const knowledgeId of
      expectedKnowledgeIds
    ) {
      addToSetMap(
        knowledgeCases,
        knowledgeId,
        caseId
      );

      const knowledge =
        knowledgeById.get(
          knowledgeId
        );

      const knowledgeTopicId =
        cleanRecordId(
          knowledge?.topic
        );

      if (
        knowledgeTopicId
      ) {
        addToSetMap(
          topicKnowledgeCases,
          knowledgeTopicId,
          caseId
        );
      }
    }
  }

  /*
   * ==========================================
   * Topic Coverage
   * ==========================================
   */

  const topics:
    AIEvalTopicCoverageItem[] =
      topicRecords.map(
        (
          topic
        ) => {
          const directCaseCount =
            setSize(
              directTopicCases.get(
                topic.id
              )
            );

          const knowledgeCaseCount =
            setSize(
              topicKnowledgeCases.get(
                topic.id
              )
            );

          return {
            id:
              topic.id,

            name:
              String(
                topic.name ||
                  ""
              ) ||
              "Topic",

            active:
              topic.active !==
              false,

            directCaseCount,

            knowledgeCaseCount,

            covered:
              directCaseCount >
                0 ||
              knowledgeCaseCount >
                0,
          };
        }
      );

  /*
   * ==========================================
   * Knowledge Coverage
   * ==========================================
   */

  const knowledge:
    AIEvalKnowledgeCoverageItem[] =
      knowledgeRecords.map(
        (
          item
        ) => {
          const topicId =
            cleanRecordId(
              item.topic
            );

          const directCaseCount =
            setSize(
              knowledgeCases.get(
                item.id
              )
            );

          const topicCaseCount =
            topicId
              ? setSize(
                  directTopicCases.get(
                    topicId
                  )
                )
              : 0;

          const level =
            directCaseCount >
            0
              ? "strong" as const
              : topicCaseCount >
                0
                ? "topic_only" as const
                : "uncovered" as const;

          return {
            id:
              item.id,

            title:
              String(
                item.title ||
                  ""
              ) ||
              "Knowledge",

            topicId:
              topicId ||
              undefined,

            topicName:
              topicId
                ? topicNameById.get(
                    topicId
                  )
                : undefined,

            version:
              safeInteger(
                item.version
              ),

            syncStatus:
              String(
                item.sync_status ||
                  ""
              ),

            directCaseCount,

            topicCaseCount,

            level,

            covered:
              level !==
              "uncovered",
          };
        }
      );

  /*
   * ==========================================
   * Summary
   * ==========================================
   */

  const coveredTopics =
    topics.filter(
      (
        item
      ) =>
        item.covered
    ).length;

  const uncoveredTopics =
    topics.length -
    coveredTopics;

  const directKnowledge =
    knowledge.filter(
      (
        item
      ) =>
        item.level ===
        "strong"
    ).length;

  const topicOnlyKnowledge =
    knowledge.filter(
      (
        item
      ) =>
        item.level ===
        "topic_only"
    ).length;

  const uncoveredKnowledge =
    knowledge.filter(
      (
        item
      ) =>
        item.level ===
        "uncovered"
    ).length;

  const coveredKnowledge =
    knowledge.length -
    uncoveredKnowledge;

  return {
    generatedAt:
      new Date()
        .toISOString(),

    summary: {
      activeCases:
        caseRecords.length,

      activeTopics:
        topics.length,

      coveredTopics,

      uncoveredTopics,

      topicCoveragePercent:
        percentage(
          coveredTopics,
          topics.length
        ),

      publishedKnowledge:
        knowledge.length,

      coveredKnowledge,

      directKnowledge,

      topicOnlyKnowledge,

      uncoveredKnowledge,

      knowledgeCoveragePercent:
        percentage(
          coveredKnowledge,
          knowledge.length
        ),

      directKnowledgeCoveragePercent:
        percentage(
          directKnowledge,
          knowledge.length
        ),
    },

    topics:
      topics.sort(
        (
          left,
          right
        ) =>
          Number(
            left.covered
          ) -
            Number(
              right.covered
            ) ||
          left.name.localeCompare(
            right.name,
            "fa"
          )
      ),

    knowledge:
      knowledge.sort(
        (
          left,
          right
        ) =>
          coverageOrder(
            left.level
          ) -
            coverageOrder(
              right.level
            ) ||
          left.title.localeCompare(
            right.title,
            "fa"
          )
      ),
  };
}

/*
 * ============================================
 * Helpers
 * ============================================
 */

function addToSetMap(
  map:
    Map<
      string,
      Set<string>
    >,

  key:
    string,

  value:
    string
) {
  let set =
    map.get(
      key
    );

  if (
    !set
  ) {
    set =
      new Set<string>();

    map.set(
      key,
      set
    );
  }

  set.add(
    value
  );
}

function relationIds(
  value:
    unknown
) {
  if (
    Array.isArray(
      value
    )
  ) {
    return value
      .map(
        cleanRecordId
      )
      .filter(
        Boolean
      );
  }

  const id =
    cleanRecordId(
      value
    );

  return id
    ? [
        id,
      ]
    : [];
}

function cleanRecordId(
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

function setSize(
  value:
    Set<string> |
    undefined
) {
  return value?.size ||
    0;
}

function safeInteger(
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
    Math.trunc(
      number
    )
  );
}

function percentage(
  numerator:
    number,

  denominator:
    number
) {
  if (
    denominator <=
    0
  ) {
    return 100;
  }

  return Math.round(
    (
      numerator /
      denominator
    ) *
      1000
  ) /
    10;
}

function coverageOrder(
  level:
    AIEvalKnowledgeCoverageItem[
      "level"
    ]
) {
  switch (
    level
  ) {
    case "uncovered":
      return 0;

    case "topic_only":
      return 1;

    case "strong":
    default:
      return 2;
  }
}
