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
  TopicEvalDetail,
  TopicEvalDetailBatch,
  TopicEvalDetailRow,
} from "@/types/topic-eval-detail";

const AUTO_BATCH_SCAN_LIMIT =
  100;

const RUN_SCAN_LIMIT =
  500;

const RECORD_ID_PATTERN =
  /^[a-zA-Z0-9_-]{1,64}$/;

export function isTopicEvalRecordId(
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

export async function getTopicEvalDetail({
  pb,
  topicId,
}: {
  pb:
    PocketBase;

  topicId:
    string;
}): Promise<TopicEvalDetail> {
  if (
    !isTopicEvalRecordId(
      topicId
    )
  ) {
    throw new Error(
      "Invalid topic id"
    );
  }

  const topic =
    await pb
      .collection(
        "topics"
      )
      .getOne(
        topicId,
        {
          fields:
            "id,name,active,updated",
        }
      );

  const autoBatches =
    await loadTopicAutoBatches(
      pb,
      topicId
    );

  const currentRecord =
    autoBatches[0];

  const previousRecord =
    autoBatches[1];

  const currentBatch =
    currentRecord
      ? serializeTopicEvalBatch(
          currentRecord
        )
      : undefined;

  const previousBatch =
    previousRecord
      ? serializeTopicEvalBatch(
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
    topic: {
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

      updated:
        String(
          topic.updated ||
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

async function loadTopicAutoBatches(
  pb:
    PocketBase,

  topicId:
    string
) {
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
              "run_mode = {:mode} && notes ~ {:topicId}",
              {
                mode:
                  "single",

                topicId,
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
          parseTopicAutoBatchNotes(
            record.notes
          );

        return (
          notes?.topicId ===
          topicId
        );
      }
    )
    .slice(
      0,
      2
    );
}

function serializeTopicEvalBatch(
  record:
    RecordModel
): TopicEvalDetailBatch {
  const notes =
    parseTopicAutoBatchNotes(
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
      "Auto Topic Check",

    status:
      normalizeBatchStatus(
        record.status
      ),

    trigger:
      notes?.trigger,

    topicUpdated:
      notes?.topicUpdated,

    topicActive:
      notes?.topicActive,

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
      ): TopicEvalDetailRow => {
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
  return [
    "snapshot",
    run
      .caseSnapshot
      ?.title ||
      "",
    run
      .caseSnapshot
      ?.question ||
      "",
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
 * Notes
 * ============================================
 */

type TopicAutoBatchNotes = {
  kind:
    "topic_auto_eval";

  topicId:
    string;

  trigger?:
    | "update"
    | "guidance_update"
    | "guidance_restore"
    | "status_change";

  topicUpdated?:
    string;

  topicActive?:
    boolean;

  impactedCases?:
    number;

  executedCases?:
    number;

  capped?:
    boolean;
};

function parseTopicAutoBatchNotes(
  value:
    unknown
):
  | TopicAutoBatchNotes
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

    const topicId =
      cleanRecordId(
        object.topicId
      );

    if (
      object.kind !==
        "topic_auto_eval" ||
      !topicId
    ) {
      return null;
    }

    return {
      kind:
        "topic_auto_eval",

      topicId,

      trigger:
        object.trigger ===
          "update" ||
        object.trigger ===
          "guidance_update" ||
        object.trigger ===
          "guidance_restore" ||
        object.trigger ===
          "status_change"
          ? object.trigger
          : undefined,

      topicUpdated:
        typeof object.topicUpdated ===
        "string"
          ? object.topicUpdated
          : undefined,

      topicActive:
        typeof object.topicActive ===
        "boolean"
          ? object.topicActive
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
    TopicEvalDetailRow[],

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
  TopicEvalDetailBatch[
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
