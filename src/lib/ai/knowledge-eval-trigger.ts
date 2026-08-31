import "server-only";

import type {
  RecordModel,
} from "pocketbase";

import {
  completeAIEvalBatch,
  createAIEvalBatch,
  failAIEvalBatch,
} from "@/lib/ai/eval-batches";

import {
  isAutoEvalEnabled,
  releaseEvalExecutionLock,
  tryAcquireEvalExecutionLock,
} from "@/lib/ai/eval-execution-lock";

import {
  runAIEvalCase,
} from "@/lib/ai/evals";

import {
  getPocketBaseServiceClient,
} from "@/lib/pocketbase/service";

const DEFAULT_MAX_AUTO_CASES =
  8;

const ABSOLUTE_MAX_AUTO_CASES =
  30;

export type KnowledgeEvalTrigger =
  | "publish"
  | "update";

export type KnowledgeAutoEvalResult =
  | {
      scheduled:
        true;

      batchId:
        string;

      caseCount:
        number;

      passed:
        number;

      failed:
        number;

      errors:
        number;
    }
  | {
      scheduled:
        false;

      reason:
        string;
    };

export async function runKnowledgeTriggeredEvals({
  knowledgeId,
  adminId,
  trigger,
}: {
  knowledgeId:
    string;

  adminId:
    string;

  trigger:
    KnowledgeEvalTrigger;
}): Promise<KnowledgeAutoEvalResult> {
  /*
   * ==========================================
   * Emergency Kill Switch
   * ==========================================
   */

  if (
    !isAutoEvalEnabled()
  ) {
    return {
      scheduled:
        false,

      reason:
        "auto_eval_disabled",
    };
  }

  const pb =
    await getPocketBaseServiceClient();

  let knowledge:
    RecordModel;

  try {
    knowledge =
      await pb
        .collection(
          "knowledge_items"
        )
        .getOne(
          knowledgeId,
          {
            fields: [
              "id",
              "title",
              "topic",
              "status",
              "sync_status",
              "updated",
            ].join(
              ","
            ),
          }
        );
  } catch (
    error
  ) {
    console.error(
      "Automatic knowledge eval could not load knowledge item",
      {
        knowledgeId,

        trigger,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return {
      scheduled:
        false,

      reason:
        "knowledge_load_failed",
    };
  }

  if (
    knowledge.status !==
      "published" ||
    knowledge.sync_status !==
      "synced"
  ) {
    return {
      scheduled:
        false,

      reason:
        "knowledge_not_synced",
    };
  }

  /*
   * ==========================================
   * Distributed Subject Lock
   *
   * Retryهای after() یا چند Instance نمی‌توانند
   * همان Knowledge را همزمان Eval کنند.
   * ==========================================
   */

  const lease =
    await tryAcquireEvalExecutionLock({
      pb,

      key:
        `auto:knowledge:${knowledge.id}`,

      ttlSeconds:
        environmentInteger(
          process.env
            .AI_AUTO_EVAL_LOCK_TTL_SECONDS,
          60,
          2 *
            60 *
            60,
          30 *
            60
        ),
    });

  if (
    !lease
  ) {
    return {
      scheduled:
        false,

      reason:
        "evaluation_in_progress",
    };
  }

  try {
    const topicId =
      cleanRecordId(
        knowledge.topic
      );

    const revisionKey =
      createRevisionKey(
        knowledge
      );

    /*
     * Lock makes this check effectively
     * race-safe for the same Knowledge.
     */
    if (
      await hasExistingAutomaticBatch(
        revisionKey
      )
    ) {
      return {
        scheduled:
          false,

        reason:
          "revision_already_tested",
      };
    }

    const maximum =
      environmentInteger(
        process.env
          .KNOWLEDGE_AUTO_EVAL_MAX_CASES,
        1,
        ABSOLUTE_MAX_AUTO_CASES,
        DEFAULT_MAX_AUTO_CASES
      );

    const casesResult =
      await pb
        .collection(
          "ai_eval_cases"
        )
        .getList(
          1,
          100,
          {
            filter:
              "active = true",

            sort:
              "created",

            expand: [
              "expected_topic",
              "expected_knowledge_items",
            ].join(
              ","
            ),
          }
        );

    const allImpacted =
      casesResult
        .items
        .filter(
          (
            item
          ) =>
            isCaseImpacted({
              item,

              knowledgeId:
                knowledge.id,

              topicId,
            })
        );

    const impacted =
      allImpacted.slice(
        0,
        maximum
      );

    if (
      impacted.length ===
      0
    ) {
      return {
        scheduled:
          false,

        reason:
          "no_impacted_cases",
      };
    }

    const title =
      cleanText(
        knowledge.title,
        120
      ) ||
      "Knowledge";

    const batch =
      await createAIEvalBatch({
        pb,

        adminId,

        runMode:
          "single",

        totalCases:
          impacted.length,

        label:
          `Auto Knowledge Check · ${title}`,

        notes:
          JSON.stringify({
            kind:
              "knowledge_auto_eval",

            revisionKey,

            knowledgeId:
              knowledge.id,

            topicId:
              topicId ||
              null,

            trigger,

            knowledgeUpdated:
              String(
                knowledge.updated ||
                  ""
              ),

            impactedCases:
              allImpacted.length,

            executedCases:
              impacted.length,

            capped:
              allImpacted.length >
              impacted.length,
          }),
      });

    const runs = [];

    try {
      for (
        const item of
        impacted
      ) {
        runs.push(
          await runAIEvalCase({
            pb,

            caseRecord:
              item,

            adminId,

            batchId:
              batch.id,
          })
        );
      }

      await completeAIEvalBatch({
        pb,

        batchId:
          batch.id,

        runs,
      });
    } catch (
      error
    ) {
      await failAIEvalBatch(
        pb,
        batch.id
      );

      console.error(
        "Automatic knowledge eval batch failed",
        {
          batchId:
            batch.id,

          knowledgeId:
            knowledge.id,

          trigger,

          error:
            safeErrorMetadata(
              error
            ),
        }
      );

      return {
        scheduled:
          true,

        batchId:
          batch.id,

        caseCount:
          runs.length,

        passed:
          countRuns(
            runs,
            "passed"
          ),

        failed:
          countRuns(
            runs,
            "failed"
          ),

        errors:
          countRuns(
            runs,
            "error"
          ) +
          1,
      };
    }

    const passed =
      countRuns(
        runs,
        "passed"
      );

    const failed =
      countRuns(
        runs,
        "failed"
      );

    const errors =
      countRuns(
        runs,
        "error"
      );

    console.info(
      "Automatic knowledge eval completed",
      {
        batchId:
          batch.id,

        knowledgeId:
          knowledge.id,

        trigger,

        total:
          runs.length,

        passed,

        failed,

        errors,
      }
    );

    return {
      scheduled:
        true,

      batchId:
        batch.id,

      caseCount:
        runs.length,

      passed,

      failed,

      errors,
    };
  } finally {
    await releaseEvalExecutionLock({
      pb,

      lease,
    });
  }
}

function isCaseImpacted({
  item,
  knowledgeId,
  topicId,
}: {
  item:
    RecordModel;

  knowledgeId:
    string;

  topicId:
    string;
}) {
  const expectedTopicId =
    cleanRecordId(
      item.expected_topic
    );

  const expectedKnowledgeIds =
    relationIds(
      item
        .expected_knowledge_items
    );

  return (
    expectedKnowledgeIds.includes(
      knowledgeId
    ) ||
    Boolean(
      topicId &&
      expectedTopicId ===
        topicId
    )
  );
}

async function hasExistingAutomaticBatch(
  revisionKey:
    string
) {
  const pb =
    await getPocketBaseServiceClient();

  try {
    await pb
      .collection(
        "ai_eval_batches"
      )
      .getFirstListItem(
        pb.filter(
          "notes ~ {:revisionKey}",
          {
            revisionKey,
          }
        ),
        {
          fields:
            "id,notes",
        }
      );

    return true;
  } catch (
    error
  ) {
    if (
      getErrorStatus(
        error
      ) ===
      404
    ) {
      return false;
    }

    throw error;
  }
}

function createRevisionKey(
  knowledge:
    RecordModel
) {
  return [
    "knowledge-auto-eval",
    knowledge.id,
    String(
      knowledge.updated ||
        ""
    ),
  ].join(
    ":"
  );
}

function countRuns(
  runs:
    Array<{
      status:
        string;
    }>,

  status:
    string
) {
  return runs.filter(
    (
      run
    ) =>
      run.status ===
      status
  ).length;
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

function environmentInteger(
  value:
    unknown,

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

function getErrorStatus(
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
