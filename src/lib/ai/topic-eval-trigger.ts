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
  10;

const ABSOLUTE_MAX_AUTO_CASES =
  30;

const CASE_SCAN_LIMIT =
  200;

const RECORD_ID_PATTERN =
  /^[a-zA-Z0-9_-]{1,64}$/;

export type TopicEvalTrigger =
  | "update"
  | "guidance_update"
  | "guidance_restore"
  | "status_change";

export type TopicAutoEvalResult =
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

      capped:
        boolean;
    }
  | {
      scheduled:
        false;

      reason:
        string;
    };

export async function runTopicTriggeredEvals({
  topicId,
  adminId,
  trigger,
}: {
  topicId:
    string;

  adminId:
    string;

  trigger:
    TopicEvalTrigger;
}): Promise<TopicAutoEvalResult> {
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

  const cleanTopicId =
    cleanRecordId(
      topicId
    );

  const cleanAdminId =
    cleanRecordId(
      adminId
    );

  if (
    !cleanTopicId ||
    !cleanAdminId
  ) {
    return {
      scheduled:
        false,

      reason:
        "invalid_input",
    };
  }

  const pb =
    await getPocketBaseServiceClient();

  let topic:
    RecordModel;

  try {
    topic =
      await pb
        .collection(
          "topics"
        )
        .getOne(
          cleanTopicId,
          {
            fields: [
              "id",
              "name",
              "active",
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
      "Automatic topic eval could not load topic",
      {
        topicId:
          cleanTopicId,

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
        "topic_load_failed",
    };
  }

  const lease =
    await tryAcquireEvalExecutionLock({
      pb,

      key:
        `auto:topic:${cleanTopicId}`,

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
    const revisionKey =
      createRevisionKey(
        topic
      );

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
          .TOPIC_AUTO_EVAL_MAX_CASES,
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
          CASE_SCAN_LIMIT,
          {
            filter:
              "active = true",

            sort:
              "created",

            expand:
              "expected_knowledge_items",
          }
        );

    const allImpacted =
      casesResult.items.filter(
        (
          evalCase
        ) =>
          isCaseImpacted({
            evalCase,

            topicId:
              cleanTopicId,
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

    const capped =
      allImpacted.length >
      impacted.length;

    const topicName =
      cleanText(
        topic.name,
        120
      ) ||
      "Topic";

    const batch =
      await createAIEvalBatch({
        pb,

        adminId:
          cleanAdminId,

        runMode:
          "single",

        totalCases:
          impacted.length,

        label:
          `Auto Topic Check · ${topicName}`,

        notes:
          JSON.stringify({
            kind:
              "topic_auto_eval",

            revisionKey,

            topicId:
              cleanTopicId,

            trigger,

            topicUpdated:
              String(
                topic.updated ||
                  ""
              ),

            topicActive:
              topic.active !==
              false,

            impactedCases:
              allImpacted.length,

            executedCases:
              impacted.length,

            capped,
          }),
      });

    const runs = [];

    try {
      for (
        const evalCase of
        impacted
      ) {
        runs.push(
          await runAIEvalCase({
            pb,

            caseRecord:
              evalCase,

            adminId:
              cleanAdminId,

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
        "Automatic topic eval batch failed",
        {
          batchId:
            batch.id,

          topicId:
            cleanTopicId,

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

        capped,
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
      "Automatic topic eval completed",
      {
        batchId:
          batch.id,

        topicId:
          cleanTopicId,

        trigger,

        total:
          runs.length,

        passed,

        failed,

        errors,

        capped,
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

      capped,
    };
  } finally {
    await releaseEvalExecutionLock({
      pb,

      lease,
    });
  }
}

function isCaseImpacted({
  evalCase,
  topicId,
}: {
  evalCase:
    RecordModel;

  topicId:
    string;
}) {
  const expectedTopicId =
    cleanRecordId(
      evalCase.expected_topic
    );

  if (
    expectedTopicId ===
    topicId
  ) {
    return true;
  }

  const expandedKnowledge =
    getExpandedMany(
      evalCase,
      "expected_knowledge_items"
    );

  return expandedKnowledge.some(
    (
      knowledge
    ) =>
      cleanRecordId(
        knowledge.topic
      ) ===
      topicId
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
  topic:
    RecordModel
) {
  return [
    "topic-auto-eval",
    topic.id,
    String(
      topic.updated ||
        ""
    ),
  ].join(
    ":"
  );
}

function getExpandedMany(
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
    return [];
  }

  return Array.isArray(
    value
  )
    ? value
    : [
        value,
      ];
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
