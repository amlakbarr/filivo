import "server-only";

import {
  createHash,
} from "node:crypto";

import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";

import {
  getChatRetrievalSettings,
} from "@/lib/ai/chat-retrieval";

import {
  getAIEvalPromptMaterial,
  serializeEvalRun,
} from "@/lib/ai/evals";

import {
  getOpenAIModel,
  getOpenAIVectorStoreId,
} from "@/lib/ai/openai";

import type {
  AIEvalBatch,
  AIEvalBatchComparison,
  AIEvalBatchRunMode,
  AIEvalRun,
  AIEvalSystemSnapshot,
} from "@/types/ai-evals";

const BATCH_LIST_LIMIT =
  100;

const RUN_LIST_LIMIT =
  1000;

/*
 * ============================================
 * Create Batch
 * ============================================
 */

export async function createAIEvalBatch({
  pb,
  adminId,
  runMode,
  totalCases,
  label,
  notes,
}: {
  pb:
    PocketBase;

  adminId:
    string;

  runMode:
    AIEvalBatchRunMode;

  totalCases:
    number;

  label?:
    string;

  notes?:
    string;
}) {
  const snapshot =
    await createSystemSnapshot(
      pb
    );

  const configHash =
    createConfigHash(
      snapshot
    );

  const now =
    new Date();

  return pb
    .collection(
      "ai_eval_batches"
    )
    .create({
      label:
        cleanText(
          label,
          200
        ) ||
        createDefaultBatchLabel(
          runMode,
          now
        ),

      notes:
        cleanText(
          notes,
          4000
        ),

      run_mode:
        runMode,

      status:
        "running",

      total_cases:
        safeInteger(
          totalCases
        ),

      passed_count:
        0,

      failed_count:
        0,

      error_count:
        0,

      model:
        snapshot.chatModel ||
        "",

      verifier_model:
        snapshot.verifierModel ||
        "",

      config_hash:
        configHash,

      system_snapshot:
        JSON.stringify(
          snapshot
        ),

      is_baseline:
        false,

      created_by:
        adminId,

      started_at:
        now.toISOString(),
    });
}

/*
 * ============================================
 * Complete Batch
 * ============================================
 */

export async function completeAIEvalBatch({
  pb,
  batchId,
  runs,
}: {
  pb:
    PocketBase;

  batchId:
    string;

  runs:
    AIEvalRun[];
}) {
  const passed =
    runs.filter(
      (
        run
      ) =>
        run.status ===
        "passed"
    ).length;

  const failed =
    runs.filter(
      (
        run
      ) =>
        run.status ===
        "failed"
    ).length;

  const errors =
    runs.filter(
      (
        run
      ) =>
        run.status ===
        "error"
    ).length;

  const status =
    runs.length >
      0 &&
    errors ===
      runs.length
      ? "error"
      : failed >
          0 ||
        errors >
          0
        ? "completed_with_failures"
        : "completed";

  return pb
    .collection(
      "ai_eval_batches"
    )
    .update(
      batchId,
      {
        status,

        total_cases:
          runs.length,

        passed_count:
          passed,

        failed_count:
          failed,

        error_count:
          errors,

        completed_at:
          new Date()
            .toISOString(),
      },
      {
        expand:
          "created_by",
      }
    );
}

export async function failAIEvalBatch(
  pb:
    PocketBase,

  batchId:
    string
) {
  try {
    await pb
      .collection(
        "ai_eval_batches"
      )
      .update(
        batchId,
        {
          status:
            "error",

          completed_at:
            new Date()
              .toISOString(),
        }
      );
  } catch {
    // Preserve original error.
  }
}

/*
 * ============================================
 * Batch List
 * ============================================
 */

export async function getAIEvalBatches(
  pb:
    PocketBase
) {
  const result =
    await pb
      .collection(
        "ai_eval_batches"
      )
      .getList(
        1,
        BATCH_LIST_LIMIT,
        {
          sort:
            "-created",

          expand:
            "created_by",
        }
      );

  return result.items.map(
    serializeAIEvalBatch
  );
}

/*
 * ============================================
 * Baseline
 * ============================================
 */

export async function markAIEvalBatchAsBaseline(
  pb:
    PocketBase,

  batchId:
    string
) {
  const target =
    await pb
      .collection(
        "ai_eval_batches"
      )
      .getOne(
        batchId
      );

  if (
    target.status ===
      "running" ||
    target.status ===
      "error"
  ) {
    throw new Error(
      "فقط Batch کامل‌شده را می‌توان Baseline کرد."
    );
  }

  /*
   * Baseline حتماً باید اجرای کامل Suite باشد.
   * Auto / Single / Partial Run مجاز نیست.
   */
  if (
    target.run_mode !==
    "all"
  ) {
    throw new Error(
      "فقط Run کامل همه Golden Questions را می‌توان Baseline کرد."
    );
  }

  const existing =
    await pb
      .collection(
        "ai_eval_batches"
      )
      .getFullList({
        filter:
          "is_baseline = true",

        fields:
          "id,is_baseline",
      });

  for (
    const batch of
    existing
  ) {
    if (
      batch.id ===
      batchId
    ) {
      continue;
    }

    await pb
      .collection(
        "ai_eval_batches"
      )
      .update(
        batch.id,
        {
          is_baseline:
            false,
        }
      );
  }

  const updated =
    await pb
      .collection(
        "ai_eval_batches"
      )
      .update(
        batchId,
        {
          is_baseline:
            true,
        },
        {
          expand:
            "created_by",
        }
      );

  return serializeAIEvalBatch(
    updated
  );
}

/*
 * ============================================
 * Compare
 * ============================================
 */

export async function compareAIEvalBatches({
  pb,
  baselineId,
  currentId,
}: {
  pb:
    PocketBase;

  baselineId?:
    string;

  currentId?:
    string;
}): Promise<AIEvalBatchComparison> {
  const baselineRecord =
    baselineId
      ? await pb
          .collection(
            "ai_eval_batches"
          )
          .getOne(
            baselineId,
            {
              expand:
                "created_by",
            }
          )
      : await pb
          .collection(
            "ai_eval_batches"
          )
          .getFirstListItem(
            "is_baseline = true",
            {
              expand:
                "created_by",
            }
          );

  let currentRecord:
    RecordModel;

  if (
    currentId
  ) {
    currentRecord =
      await pb
        .collection(
          "ai_eval_batches"
        )
        .getOne(
          currentId,
          {
            expand:
              "created_by",
          }
        );
  } else {
    const result =
      await pb
        .collection(
          "ai_eval_batches"
        )
        .getList(
          1,
          10,
          {
            filter:
              "status != 'running'",

            sort:
              "-created",

            expand:
              "created_by",
          }
        );

    const found =
      result.items.find(
        (
          item
        ) =>
          item.id !==
          baselineRecord.id
      );

    if (
      !found
    ) {
      throw new Error(
        "Batch دیگری برای مقایسه با Baseline وجود ندارد."
      );
    }

    currentRecord =
      found;
  }

  if (
    baselineRecord.id ===
    currentRecord.id
  ) {
    throw new Error(
      "Baseline و Current Batch باید متفاوت باشند."
    );
  }

  const [
    baselineRuns,
    currentRuns,
  ] =
    await Promise.all([
      loadBatchRuns(
        pb,
        baselineRecord.id
      ),

      loadBatchRuns(
        pb,
        currentRecord.id
      ),
    ]);

  const baselineByCase =
    indexRunsByCase(
      baselineRuns
    );

  const currentByCase =
    indexRunsByCase(
      currentRuns
    );

  const keys =
    [
      ...new Set([
        ...baselineByCase.keys(),
        ...currentByCase.keys(),
      ]),
    ];

  const rows =
    keys
      .map(
        (
          key
        ) => {
          const baselineRun =
            baselineByCase.get(
              key
            );

          const currentRun =
            currentByCase.get(
              key
            );

          const snapshot =
            currentRun
              ?.caseSnapshot ||
            baselineRun
              ?.caseSnapshot;

          return {
            key,

            caseId:
              currentRun
                ?.caseId ||
              baselineRun
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
                baselineRun,
                currentRun
              ),

            baselineRun,

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

  const baseline =
    serializeAIEvalBatch(
      baselineRecord
    );

  const current =
    serializeAIEvalBatch(
      currentRecord
    );

  const baselineKnowledge =
    baseline
      .systemSnapshot
      .knowledgeFingerprint;

  const currentKnowledge =
    current
      .systemSnapshot
      .knowledgeFingerprint;

  return {
    baseline,

    current,

    environment: {
      configChanged:
        Boolean(
          baseline.configHash &&
          current.configHash &&
          baseline.configHash !==
            current.configHash
        ),

      knowledgeChanged:
        Boolean(
          baselineKnowledge &&
          currentKnowledge &&
          baselineKnowledge !==
            currentKnowledge
        ),

      baselineConfigHash:
        baseline.configHash,

      currentConfigHash:
        current.configHash,

      baselineKnowledgeFingerprint:
        baselineKnowledge,

      currentKnowledgeFingerprint:
        currentKnowledge,
    },

    summary: {
      totalRows:
        rows.length,

      stablePass:
        rows.filter(
          (
            row
          ) =>
            row.outcome ===
            "stable_pass"
        ).length,

      regressions:
        rows.filter(
          (
            row
          ) =>
            row.outcome ===
            "regression"
        ).length,

      improvements:
        rows.filter(
          (
            row
          ) =>
            row.outcome ===
            "improvement"
        ).length,

      persistentFailures:
        rows.filter(
          (
            row
          ) =>
            row.outcome ===
            "persistent_failure"
        ).length,

      errors:
        rows.filter(
          (
            row
          ) =>
            row.outcome ===
            "error"
        ).length,

      newCases:
        rows.filter(
          (
            row
          ) =>
            row.outcome ===
            "new_case"
        ).length,

      removedCases:
        rows.filter(
          (
            row
          ) =>
            row.outcome ===
            "removed_case"
        ).length,
    },

    rows,
  };
}

/*
 * ============================================
 * System Snapshot
 * ============================================
 */

async function createSystemSnapshot(
  pb:
    PocketBase
): Promise<AIEvalSystemSnapshot> {
  const retrieval =
    getChatRetrievalSettings();

  const prompts =
    getAIEvalPromptMaterial();

  const chatModel =
    getOpenAIModel();

  const verifierModel =
    process.env
      .OPENAI_GROUNDING_VERIFIER_MODEL
      ?.trim() ||
    chatModel;

  const vectorStoreId =
    getOpenAIVectorStoreId();

  const knowledge =
    await pb
      .collection(
        "knowledge_items"
      )
      .getFullList({
        filter:
          "status = 'published'",

        sort:
          "id",

        fields: [
          "id",
          "updated",
          "status",
          "sync_status",
          "openai_file_id",
          "topic",
        ].join(
          ","
        ),
      });

  const knowledgeMaterial =
    knowledge.map(
      (
        item
      ) => ({
        id:
          item.id,

        updated:
          String(
            item.updated ||
              ""
          ),

        status:
          String(
            item.status ||
              ""
          ),

        syncStatus:
          String(
            item.sync_status ||
              ""
          ),

        openAIFileId:
          String(
            item.openai_file_id ||
              ""
          ),

        topic:
          String(
            item.topic ||
              ""
          ),
      })
    );

  return {
    capturedAt:
      new Date()
        .toISOString(),

    chatModel,

    verifierModel,

    fileSearchMinScore:
      retrieval.minScore,

    fileSearchMaxResults:
      retrieval.maxResults,

    appTimezone:
      process.env
        .APP_TIMEZONE
        ?.trim() ||
      "Asia/Tehran",

    assistantPromptHash:
      sha256(
        prompts.assistant
      ),

    verifierPromptHash:
      sha256(
        prompts.verifier
      ),

    vectorStoreHash:
      sha256(
        vectorStoreId
      ),

    knowledgeFingerprint:
      sha256(
        JSON.stringify(
          knowledgeMaterial
        )
      ),

    publishedKnowledgeCount:
      knowledge.length,
  };
}

function createConfigHash(
  snapshot:
    AIEvalSystemSnapshot
) {
  return sha256(
    JSON.stringify({
      chatModel:
        snapshot.chatModel,

      verifierModel:
        snapshot.verifierModel,

      fileSearchMinScore:
        snapshot.fileSearchMinScore,

      fileSearchMaxResults:
        snapshot.fileSearchMaxResults,

      appTimezone:
        snapshot.appTimezone,

      assistantPromptHash:
        snapshot.assistantPromptHash,

      verifierPromptHash:
        snapshot.verifierPromptHash,

      vectorStoreHash:
        snapshot.vectorStoreHash,
    })
  );
}

/*
 * ============================================
 * Serialize Batch
 * ============================================
 */

export function serializeAIEvalBatch(
  record:
    RecordModel
): AIEvalBatch {
  const creator =
    getExpandedOne(
      record,
      "created_by"
    );

  return {
    id:
      record.id,

    label:
      String(
        record.label ||
          ""
      ) ||
      "Eval Batch",

    notes:
      String(
        record.notes ||
          ""
      ).trim() ||
      undefined,

    runMode:
      record.run_mode ===
      "single"
        ? "single"
        : "all",

    status:
      normalizeBatchStatus(
        record.status
      ),

    totalCases:
      safeInteger(
        record.total_cases
      ),

    passedCount:
      safeInteger(
        record.passed_count
      ),

    failedCount:
      safeInteger(
        record.failed_count
      ),

    errorCount:
      safeInteger(
        record.error_count
      ),

    model:
      String(
        record.model ||
          ""
      ).trim() ||
      undefined,

    verifierModel:
      String(
        record.verifier_model ||
          ""
      ).trim() ||
      undefined,

    configHash:
      String(
        record.config_hash ||
          ""
      ).trim() ||
      undefined,

    systemSnapshot:
      parseSystemSnapshot(
        record.system_snapshot
      ),

    isBaseline:
      record.is_baseline ===
      true,

    createdBy:
      record.created_by
        ? {
            id:
              String(
                record.created_by
              ),

            name:
              String(
                creator?.name ||
                  creator?.email ||
                  ""
              ) ||
              "مدیر",
          }
        : undefined,

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

    updated:
      String(
        record.updated ||
          ""
      ),
  };
}

/*
 * ============================================
 * Run Helpers
 * ============================================
 */

async function loadBatchRuns(
  pb:
    PocketBase,

  batchId:
    string
) {
  const records =
    await pb
      .collection(
        "ai_eval_runs"
      )
      .getList(
        1,
        RUN_LIST_LIMIT,
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

  return records.items.map(
    serializeEvalRun
  );
}

function indexRunsByCase(
  runs:
    AIEvalRun[]
) {
  const result =
    new Map<
      string,
      AIEvalRun
    >();

  for (
    const run of
    runs
  ) {
    const key =
      run.caseId ||
      run
        .caseSnapshot
        ?.caseId ||
      snapshotFallbackKey(
        run
      );

    if (
      !result.has(
        key
      )
    ) {
      result.set(
        key,
        run
      );
    }
  }

  return result;
}

function snapshotFallbackKey(
  run:
    AIEvalRun
) {
  return sha256(
    JSON.stringify({
      title:
        run
          .caseSnapshot
          ?.title ||
        "",

      question:
        run
          .caseSnapshot
          ?.question ||
        "",

      created:
        run.created,
    })
  );
}

function compareRunOutcome(
  baseline:
    AIEvalRun |
    undefined,

  current:
    AIEvalRun |
    undefined
):
  AIEvalBatchComparison[
    "rows"
  ][number]["outcome"] {
  if (
    !baseline &&
    current
  ) {
    return "new_case";
  }

  if (
    baseline &&
    !current
  ) {
    return "removed_case";
  }

  if (
    !baseline ||
    !current
  ) {
    return "error";
  }

  if (
    baseline.status ===
      "error" ||
    current.status ===
      "error" ||
    baseline.status ===
      "pending" ||
    current.status ===
      "pending"
  ) {
    return "error";
  }

  if (
    baseline.status ===
      "passed" &&
    current.status ===
      "passed"
  ) {
    return "stable_pass";
  }

  if (
    baseline.status ===
      "passed" &&
    current.status ===
      "failed"
  ) {
    return "regression";
  }

  if (
    baseline.status ===
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
    AIEvalBatchComparison[
      "rows"
    ][number]["outcome"]
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
 * Misc Helpers
 * ============================================
 */

function createDefaultBatchLabel(
  runMode:
    AIEvalBatchRunMode,

  date:
    Date
) {
  const timestamp =
    new Intl.DateTimeFormat(
      "fa-IR",
      {
        dateStyle:
          "short",

        timeStyle:
          "short",

        timeZone:
          process.env
            .APP_TIMEZONE
            ?.trim() ||
          "Asia/Tehran",
      }
    ).format(
      date
    );

  return runMode ===
    "single"
    ? `Single Test · ${timestamp}`
    : `Golden Run · ${timestamp}`;
}

function parseSystemSnapshot(
  value:
    unknown
): AIEvalSystemSnapshot {
  if (
    typeof value !==
    "string" ||
    !value.trim()
  ) {
    return {};
  }

  try {
    const parsed:
      unknown =
        JSON.parse(
          value
        );

    if (
      typeof parsed ===
        "object" &&
      parsed !==
        null &&
      !Array.isArray(
        parsed
      )
    ) {
      return parsed as
        AIEvalSystemSnapshot;
    }
  } catch {
    // Empty snapshot below.
  }

  return {};
}

function normalizeBatchStatus(
  value:
    unknown
):
  AIEvalBatch[
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

function sha256(
  value:
    string
) {
  return createHash(
    "sha256"
  )
    .update(
      value,
      "utf8"
    )
    .digest(
      "hex"
    );
}

function cleanText(
  value:
    unknown,

  maximum:
    number
) {
  return typeof value ===
    "string"
    ? value
        .replace(
          /[\u0000-\u001f\u007f]/g,
          " "
        )
        .replace(
          /\s+/g,
          " "
        )
        .trim()
        .slice(
          0,
          maximum
        )
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
