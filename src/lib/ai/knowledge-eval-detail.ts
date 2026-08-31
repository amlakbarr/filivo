import "server-only";

import type PocketBase from "pocketbase";
import type {
  RecordModel,
} from "pocketbase";

import {
  serializeEvalRun,
} from "@/lib/ai/evals";

import type {
  AIEvalComparisonOutcome,
  AIEvalRun,
} from "@/types/ai-evals";

import type {
  KnowledgeEvalDetail,
  KnowledgeEvalDetailBatch,
  KnowledgeEvalDetailRow,
} from "@/types/knowledge-eval-detail";

const AUTO_BATCH_SCAN_LIMIT =
  100;

const RUN_SCAN_LIMIT =
  500;

const RECORD_ID_PATTERN =
  /^[a-zA-Z0-9_-]{1,64}$/;

/*
 * ============================================
 * Public
 * ============================================
 */

export function isKnowledgeEvalRecordId(
  value:
    string
) {
  return RECORD_ID_PATTERN.test(
    String(
      value ||
        ""
    ).trim()
  );
}

export async function getKnowledgeEvalDetail({
  pb,
  knowledgeId,
}: {
  pb:
    PocketBase;

  knowledgeId:
    string;
}): Promise<KnowledgeEvalDetail> {
  if (
    !isKnowledgeEvalRecordId(
      knowledgeId
    )
  ) {
    throw new Error(
      "Invalid knowledge id"
    );
  }

  const knowledge =
    await pb
      .collection(
        "knowledge_items"
      )
      .getOne(
        knowledgeId,
        {
          expand:
            "topic",

          fields: [
            "id",
            "title",
            "topic",
            "status",
            "sync_status",
            "version",
            "updated",
            "expand.topic.id",
            "expand.topic.name",
          ].join(
            ","
          ),
        }
      );

  const topic =
    getExpandedOne(
      knowledge,
      "topic"
    );

  const autoBatches =
    await loadKnowledgeAutoBatches(
      pb,
      knowledgeId
    );

  const currentRecord =
    autoBatches[0];

  const previousRecord =
    autoBatches[1];

  const currentBatch =
    currentRecord
      ? serializeKnowledgeEvalBatch(
          currentRecord
        )
      : undefined;

  const previousBatch =
    previousRecord
      ? serializeKnowledgeEvalBatch(
          previousRecord
        )
      : undefined;

  const [
    currentRuns,
    previousRuns,
  ] =
    await Promise.all([
      currentRecord
        ? loadBatchRuns(
            pb,
            currentRecord.id
          )
        : Promise.resolve(
            []
          ),

      previousRecord
        ? loadBatchRuns(
            pb,
            previousRecord.id
          )
        : Promise.resolve(
            []
          ),
    ]);

  const rows =
    buildComparisonRows({
      previousRuns,

      currentRuns,
    });

  return {
    knowledge: {
      id:
        knowledge.id,

      title:
        String(
          knowledge.title ||
            ""
        ) ||
        "Knowledge",

      topicId:
        String(
          knowledge.topic ||
            ""
        ).trim() ||
        undefined,

      topicName:
        String(
          topic?.name ||
            ""
        ).trim() ||
        undefined,

      status:
        String(
          knowledge.status ||
            ""
        ),

      syncStatus:
        String(
          knowledge.sync_status ||
            ""
        ),

      version:
        safeInteger(
          knowledge.version
        ),

      updated:
        String(
          knowledge.updated ||
            ""
        ),
    },

    currentBatch,

    previousBatch,

    summary: {
      totalRows:
        rows.length,

      stablePass:
        countOutcome(
          rows,
          "stable_pass"
        ),

      regressions:
        countOutcome(
          rows,
          "regression"
        ),

      improvements:
        countOutcome(
          rows,
          "improvement"
        ),

      persistentFailures:
        countOutcome(
          rows,
          "persistent_failure"
        ),

      errors:
        countOutcome(
          rows,
          "error"
        ),

      newCases:
        countOutcome(
          rows,
          "new_case"
        ),

      removedCases:
        countOutcome(
          rows,
          "removed_case"
        ),
    },

    rows,
  };
}

/*
 * ============================================
 * Auto Batches
 * ============================================
 */

async function loadKnowledgeAutoBatches(
  pb:
    PocketBase,

  knowledgeId:
    string
) {
  /*
   * notes یک JSON String است. Query فقط Scan
   * را کوچک می‌کند؛ Exact validation پایین‌تر
   * انجام می‌شود تا Knowledge مشابه Match نشود.
   */
  const result =
    await pb
      .collection(
        "ai_eval_batches"
      )
      .getList(
        1,
        AUTO_BATCH_SCAN_LIMIT,
        {
          filter:
            pb.filter(
              "run_mode = {:mode} && notes ~ {:knowledgeId}",
              {
                mode:
                  "single",

                knowledgeId,
              }
            ),

          sort:
            "-created",

          fields: [
            "id",
            "label",
            "notes",
            "status",
            "total_cases",
            "passed_count",
            "failed_count",
            "error_count",
            "started_at",
            "completed_at",
            "created",
          ].join(
            ","
          ),
        }
      );

  return result.items
    .filter(
      (
        record
      ) => {
        const notes =
          parseAutoBatchNotes(
            record.notes
          );

        return (
          notes?.knowledgeId ===
          knowledgeId
        );
      }
    )
    .slice(
      0,
      2
    );
}

function serializeKnowledgeEvalBatch(
  record:
    RecordModel
): KnowledgeEvalDetailBatch {
  const notes =
    parseAutoBatchNotes(
      record.notes
    );

  return {
    id:
      record.id,

    label:
      String(
        record.label ||
          ""
      ) ||
      "Auto Knowledge Check",

    status:
      normalizeBatchStatus(
        record.status
      ),

    trigger:
      notes?.trigger,

    knowledgeUpdated:
      notes?.knowledgeUpdated,

    impactedCases:
      notes?.impactedCases,

    executedCases:
      notes?.executedCases,

    capped:
      notes?.capped ===
      true,

    passed:
      safeInteger(
        record.passed_count
      ),

    failed:
      safeInteger(
        record.failed_count
      ),

    errors:
      safeInteger(
        record.error_count
      ),

    total:
      safeInteger(
        record.total_cases
      ),

    startedAt:
      String(
        record.started_at ||
          ""
      ).trim() ||
      undefined,

    completedAt:
      String(
        record.completed_at ||
          ""
      ).trim() ||
      undefined,

    created:
      String(
        record.created ||
          ""
      ),
  };
}

/*
 * ============================================
 * Runs
 * ============================================
 */

async function loadBatchRuns(
  pb:
    PocketBase,

  batchId:
    string
) {
  const result =
    await pb
      .collection(
        "ai_eval_runs"
      )
      .getList(
        1,
        RUN_SCAN_LIMIT,
        {
          filter:
            pb.filter(
              "batch = {:batch}",
              {
                batch:
                  batchId,
              }
            ),

          sort:
            "created",

          expand:
            "actual_topic",
        }
      );

  return result.items.map(
    serializeEvalRun
  );
}

/*
 * ============================================
 * Comparison
 * ============================================
 */

function buildComparisonRows({
  previousRuns,
  currentRuns,
}: {
  previousRuns:
    AIEvalRun[];

  currentRuns:
    AIEvalRun[];
}) {
  const previousByKey =
    indexRuns(
      previousRuns
    );

  const currentByKey =
    indexRuns(
      currentRuns
    );

  const keys =
    [
      ...new Set([
        ...previousByKey.keys(),
        ...currentByKey.keys(),
      ]),
    ];

  return keys
    .map(
      (
        key
      ): KnowledgeEvalDetailRow => {
        const previousRun =
          previousByKey.get(
            key
          );

        const currentRun =
          currentByKey.get(
            key
          );

        const snapshot =
          currentRun
            ?.caseSnapshot ||
          previousRun
            ?.caseSnapshot;

        return {
          key,

          caseId:
            currentRun
              ?.caseId ||
            previousRun
              ?.caseId ||
            snapshot
              ?.caseId ||
            undefined,

          title:
            snapshot
              ?.title ||
            "Golden Question",

          question:
            snapshot
              ?.question ||
            "",

          outcome:
            compareRunOutcome(
              previousRun,
              currentRun
            ),

          previousRun,

          currentRun,
        };
      }
    )
    .sort(
      (
        left,
        right
      ) =>
        outcomeOrder(
          left.outcome
        ) -
          outcomeOrder(
            right.outcome
          ) ||
        left.title.localeCompare(
          right.title,
          "fa"
        )
    );
}

function indexRuns(
  runs:
    AIEvalRun[]
) {
  const map =
    new Map<
      string,
      AIEvalRun
    >();

  for (
    const run of
    runs
  ) {
    const key =
      run
        .caseSnapshot
        ?.caseId ||
      run.caseId ||
      fallbackRunKey(
        run
      );

    if (
      !map.has(
        key
      )
    ) {
      map.set(
        key,
        run
      );
    }
  }

  return map;
}

function fallbackRunKey(
  run:
    AIEvalRun
) {
  const title =
    run
      .caseSnapshot
      ?.title ||
    "";

  const question =
    run
      .caseSnapshot
      ?.question ||
    "";

  return [
    "snapshot",
    title,
    question,
  ].join(
    "::"
  );
}

function compareRunOutcome(
  previous:
    AIEvalRun |
    undefined,

  current:
    AIEvalRun |
    undefined
): AIEvalComparisonOutcome {
  if (
    !previous &&
    current
  ) {
    /*
     * اگر Auto Run قبلی نداریم، یک Case جاری
     * Regression محسوب نمی‌شود.
     */
    return "new_case";
  }

  if (
    previous &&
    !current
  ) {
    return "removed_case";
  }

  if (
    !previous ||
    !current
  ) {
    return "error";
  }

  if (
    previous.status ===
      "error" ||
    current.status ===
      "error" ||
    previous.status ===
      "pending" ||
    current.status ===
      "pending"
  ) {
    return "error";
  }

  if (
    previous.status ===
      "passed" &&
    current.status ===
      "passed"
  ) {
    return "stable_pass";
  }

  if (
    previous.status ===
      "passed" &&
    current.status ===
      "failed"
  ) {
    return "regression";
  }

  if (
    previous.status ===
      "failed" &&
    current.status ===
      "passed"
  ) {
    return "improvement";
  }

  return "persistent_failure";
}

function outcomeOrder(
  value:
    AIEvalComparisonOutcome
) {
  switch (
    value
  ) {
    case "regression":
      return 0;

    case "error":
      return 1;

    case "persistent_failure":
      return 2;

    case "improvement":
      return 3;

    case "new_case":
      return 4;

    case "removed_case":
      return 5;

    case "stable_pass":
    default:
      return 6;
  }
}

/*
 * ============================================
 * Auto Batch Notes
 * ============================================
 */

type AutoBatchNotes = {
  kind:
    "knowledge_auto_eval";

  knowledgeId:
    string;

  trigger?:
    | "publish"
    | "update";

  knowledgeUpdated?:
    string;

  impactedCases?:
    number;

  executedCases?:
    number;

  capped?:
    boolean;
};

function parseAutoBatchNotes(
  value:
    unknown
):
  | AutoBatchNotes
  | null {
  if (
    typeof value !==
      "string" ||
    !value.trim()
  ) {
    return null;
  }

  try {
    const parsed:
      unknown =
        JSON.parse(
          value
        );

    if (
      typeof parsed !==
        "object" ||
      parsed ===
        null ||
      Array.isArray(
        parsed
      )
    ) {
      return null;
    }

    const object =
      parsed as
        Record<
          string,
          unknown
        >;

    const knowledgeId =
      cleanRecordId(
        object.knowledgeId
      );

    if (
      object.kind !==
        "knowledge_auto_eval" ||
      !knowledgeId
    ) {
      return null;
    }

    return {
      kind:
        "knowledge_auto_eval",

      knowledgeId,

      trigger:
        object.trigger ===
          "publish" ||
        object.trigger ===
          "update"
          ? object.trigger
          : undefined,

      knowledgeUpdated:
        typeof object.knowledgeUpdated ===
        "string"
          ? object.knowledgeUpdated
          : undefined,

      impactedCases:
        safeOptionalInteger(
          object.impactedCases
        ),

      executedCases:
        safeOptionalInteger(
          object.executedCases
        ),

      capped:
        object.capped ===
        true,
    };
  } catch {
    return null;
  }
}

/*
 * ============================================
 * Helpers
 * ============================================
 */

function countOutcome(
  rows:
    KnowledgeEvalDetailRow[],

  outcome:
    AIEvalComparisonOutcome
) {
  return rows.filter(
    (
      row
    ) =>
      row.outcome ===
      outcome
  ).length;
}

function normalizeBatchStatus(
  value:
    unknown
):
  KnowledgeEvalDetailBatch[
    "status"
  ] {
  if (
    value ===
      "completed" ||
    value ===
      "completed_with_failures" ||
    value ===
      "error"
  ) {
    return value;
  }

  return "running";
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

function cleanRecordId(
  value:
    unknown
) {
  const id =
    String(
      value ||
        ""
    ).trim();

  return RECORD_ID_PATTERN.test(
    id
  )
    ? id
    : "";
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

function safeOptionalInteger(
  value:
    unknown
) {
  if (
    value ===
      undefined ||
    value ===
      null ||
    value ===
      ""
  ) {
    return undefined;
  }

  return safeInteger(
    value
  );
}
