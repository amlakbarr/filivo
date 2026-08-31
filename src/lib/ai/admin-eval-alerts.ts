import "server-only";

import type PocketBase from "pocketbase";
import type {
  RecordModel,
} from "pocketbase";

import {
  getKnowledgeEvalDetail,
} from "@/lib/ai/knowledge-eval-detail";

import {
  getTopicEvalDetail,
} from "@/lib/ai/topic-eval-detail";

import type {
  AdminEvalAlert,
  AdminEvalAlertScope,
} from "@/types/admin-eval-alerts";

const BATCH_SCAN_LIMIT =
  300;

const MAX_ALERTS =
  8;

export async function getAdminEvalAlerts(
  pb:
    PocketBase
): Promise<AdminEvalAlert[]> {
  const result =
    await pb
      .collection(
        "ai_eval_batches"
      )
      .getList(
        1,
        BATCH_SCAN_LIMIT,
        {
          filter:
            "run_mode = 'single'",

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
            "created",
          ].join(
            ","
          ),
        }
      );

  /*
   * آخرین Auto Batch هر Subject:
   *
   * knowledge:<id>
   * topic:<id>
   */
  const latestBySubject =
    new Map<
      string,
      {
        record:
          RecordModel;

        notes:
          ParsedAutoBatchNotes;
      }
    >();

  for (
    const record of
    result.items
  ) {
    const notes =
      parseAutoBatchNotes(
        record.notes
      );

    if (
      !notes
    ) {
      continue;
    }

    const key =
      `${notes.scope}:${notes.entityId}`;

    if (
      latestBySubject.has(
        key
      )
    ) {
      continue;
    }

    latestBySubject.set(
      key,
      {
        record,
        notes,
      }
    );
  }

  const candidates =
    [
      ...latestBySubject.values(),
    ]
      .filter(
        ({
          record,
        }) => {
          const status =
            String(
              record.status ||
                ""
            );

          return (
            status ===
              "running" ||
            status ===
              "error" ||
            safeInteger(
              record.failed_count
            ) >
              0 ||
            safeInteger(
              record.error_count
            ) >
              0
          );
        }
      )
      .slice(
        0,
        MAX_ALERTS
      );

  const alerts:
    AdminEvalAlert[] =
      [];

  for (
    const candidate of
    candidates
  ) {
    const alert =
      candidate.notes.scope ===
      "knowledge"
        ? await buildKnowledgeAlert(
            pb,
            candidate.record,
            candidate.notes
          )
        : await buildTopicAlert(
            pb,
            candidate.record,
            candidate.notes
          );

    if (
      alert
    ) {
      alerts.push(
        alert
      );
    }
  }

  return alerts.sort(
    (
      left,
      right
    ) =>
      severityOrder(
        left.severity
      ) -
        severityOrder(
          right.severity
        ) ||
      Date.parse(
        right.created
      ) -
        Date.parse(
          left.created
        )
  );
}

/*
 * ============================================
 * Knowledge
 * ============================================
 */

async function buildKnowledgeAlert(
  pb:
    PocketBase,

  record:
    RecordModel,

  notes:
    ParsedAutoBatchNotes
):
  Promise<
    AdminEvalAlert |
    null
  > {
  if (
    notes.scope !==
    "knowledge"
  ) {
    return null;
  }

  const batchStatus =
    String(
      record.status ||
        ""
    );

  if (
    batchStatus ===
    "running"
  ) {
    const knowledge =
      await loadKnowledgeTitle(
        pb,
        notes.entityId
      );

    if (
      !knowledge
    ) {
      return null;
    }

    return createRunningAlert({
      scope:
        "knowledge",

      entityId:
        notes.entityId,

      entityTitle:
        knowledge.title,

      topicName:
        knowledge.topicName,

      trigger:
        notes.trigger,

      record,

      message:
        "تغییر جدید Knowledge در حال بررسی با Golden Tests است.",

      detailHref:
        `/admin/knowledge/${notes.entityId}/evals`,
    });
  }

  try {
    const detail =
      await getKnowledgeEvalDetail({
        pb,

        knowledgeId:
          notes.entityId,
      });

    if (
      detail.currentBatch?.id !==
      record.id
    ) {
      return null;
    }

    return createCompletedAlert({
      scope:
        "knowledge",

      entityId:
        notes.entityId,

      entityTitle:
        detail.knowledge.title,

      topicName:
        detail.knowledge.topicName,

      trigger:
        notes.trigger,

      record,

      currentBatch:
        detail.currentBatch,

      regressions:
        detail.summary.regressions,

      detailHref:
        `/admin/knowledge/${notes.entityId}/evals`,

      regressionMessage:
        (
          count
        ) =>
          `${count.toLocaleString(
            "fa-IR"
          )} Golden Question بعد از تغییر Knowledge از PASS به FAIL تبدیل شده است.`,
    });
  } catch (
    error
  ) {
    console.error(
      "Knowledge eval alert detail failed",
      {
        knowledgeId:
          notes.entityId,

        batchId:
          record.id,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return null;
  }
}

/*
 * ============================================
 * Topic / Guidance
 * ============================================
 */

async function buildTopicAlert(
  pb:
    PocketBase,

  record:
    RecordModel,

  notes:
    ParsedAutoBatchNotes
):
  Promise<
    AdminEvalAlert |
    null
  > {
  if (
    notes.scope !==
    "topic"
  ) {
    return null;
  }

  const batchStatus =
    String(
      record.status ||
        ""
    );

  if (
    batchStatus ===
    "running"
  ) {
    const topic =
      await loadTopicTitle(
        pb,
        notes.entityId
      );

    if (
      !topic
    ) {
      return null;
    }

    return createRunningAlert({
      scope:
        "topic",

      entityId:
        notes.entityId,

      entityTitle:
        topic.name,

      topicName:
        topic.name,

      trigger:
        notes.trigger,

      record,

      message:
        `${triggerLabel(
          notes.trigger
        )} در حال بررسی با Golden Tests است.`,

      detailHref:
        `/admin/topics/${notes.entityId}/evals`,
    });
  }

  try {
    const detail =
      await getTopicEvalDetail({
        pb,

        topicId:
          notes.entityId,
      });

    if (
      detail.currentBatch?.id !==
      record.id
    ) {
      return null;
    }

    return createCompletedAlert({
      scope:
        "topic",

      entityId:
        notes.entityId,

      entityTitle:
        detail.topic.name,

      topicName:
        detail.topic.name,

      trigger:
        notes.trigger,

      record,

      currentBatch:
        detail.currentBatch,

      regressions:
        detail.summary.regressions,

      detailHref:
        `/admin/topics/${notes.entityId}/evals`,

      regressionMessage:
        (
          count
        ) =>
          `${count.toLocaleString(
            "fa-IR"
          )} Golden Question بعد از ${triggerLabel(
            notes.trigger
          )} از PASS به FAIL تبدیل شده است.`,
    });
  } catch (
    error
  ) {
    console.error(
      "Topic eval alert detail failed",
      {
        topicId:
          notes.entityId,

        batchId:
          record.id,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return null;
  }
}

/*
 * ============================================
 * Alert Builders
 * ============================================
 */

function createRunningAlert({
  scope,
  entityId,
  entityTitle,
  topicName,
  trigger,
  record,
  message,
  detailHref,
}: {
  scope:
    AdminEvalAlertScope;

  entityId:
    string;

  entityTitle:
    string;

  topicName?:
    string;

  trigger?:
    string;

  record:
    RecordModel;

  message:
    string;

  detailHref:
    string;
}): AdminEvalAlert {
  return {
    id:
      `running:${record.id}`,

    scope,

    kind:
      "running",

    severity:
      "info",

    entityId,

    entityTitle,

    topicName,

    trigger,

    batchId:
      record.id,

    batchLabel:
      String(
        record.label ||
          ""
      ) ||
      "Auto Check",

    regressions:
      0,

    failed:
      0,

    errors:
      0,

    total:
      safeInteger(
        record.total_cases
      ),

    message,

    detailHref,

    created:
      String(
        record.created ||
          ""
      ),
  };
}

function createCompletedAlert({
  scope,
  entityId,
  entityTitle,
  topicName,
  trigger,
  record,
  currentBatch,
  regressions,
  detailHref,
  regressionMessage,
}: {
  scope:
    AdminEvalAlertScope;

  entityId:
    string;

  entityTitle:
    string;

  topicName?:
    string;

  trigger?:
    string;

  record:
    RecordModel;

  currentBatch: {
    label:
      string;

    status:
      string;

    failed:
      number;

    errors:
      number;

    total:
      number;
  };

  regressions:
    number;

  detailHref:
    string;

  regressionMessage:
    (
      count:
        number
    ) =>
      string;
}):
  AdminEvalAlert |
  null {
  const failed =
    currentBatch.failed;

  const errors =
    currentBatch.errors;

  const total =
    currentBatch.total;

  if (
    errors >
      0 ||
    currentBatch.status ===
      "error"
  ) {
    return {
      id:
        `error:${record.id}`,

      scope,

      kind:
        "error",

      severity:
        "critical",

      entityId,

      entityTitle,

      topicName,

      trigger,

      batchId:
        record.id,

      batchLabel:
        currentBatch.label,

      regressions,

      failed,

      errors,

      total,

      message:
        errors >
          0
          ? `${errors.toLocaleString(
              "fa-IR"
            )} Golden Case با ERROR تمام شده است.`
          : "Auto Golden Test با خطای اجرایی تمام شده است.",

      detailHref,

      created:
        String(
          record.created ||
            ""
        ),
    };
  }

  if (
    regressions >
    0
  ) {
    return {
      id:
        `regression:${record.id}`,

      scope,

      kind:
        "regression",

      severity:
        "critical",

      entityId,

      entityTitle,

      topicName,

      trigger,

      batchId:
        record.id,

      batchLabel:
        currentBatch.label,

      regressions,

      failed,

      errors,

      total,

      message:
        regressionMessage(
          regressions
        ),

      detailHref,

      created:
        String(
          record.created ||
            ""
        ),
    };
  }

  if (
    failed >
    0
  ) {
    return {
      id:
        `failed:${record.id}`,

      scope,

      kind:
        "failed",

      severity:
        "warning",

      entityId,

      entityTitle,

      topicName,

      trigger,

      batchId:
        record.id,

      batchLabel:
        currentBatch.label,

      regressions:
        0,

      failed,

      errors:
        0,

      total,

      message:
        `${failed.toLocaleString(
          "fa-IR"
        )} Golden Case در آخرین Auto Test FAIL شده است؛ Regression جدید قطعی نیست.`,

      detailHref,

      created:
        String(
          record.created ||
            ""
        ),
    };
  }

  return null;
}

/*
 * ============================================
 * Subject Loaders
 * ============================================
 */

async function loadKnowledgeTitle(
  pb:
    PocketBase,

  knowledgeId:
    string
) {
  try {
    const record =
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
              "expand.topic.id",
              "expand.topic.name",
            ].join(
              ","
            ),
          }
        );

    const topic =
      getExpandedOne(
        record,
        "topic"
      );

    return {
      title:
        String(
          record.title ||
            ""
        ) ||
        "Knowledge",

      topicName:
        String(
          topic?.name ||
            ""
        ).trim() ||
        undefined,
    };
  } catch {
    return null;
  }
}

async function loadTopicTitle(
  pb:
    PocketBase,

  topicId:
    string
) {
  try {
    const record =
      await pb
        .collection(
          "topics"
        )
        .getOne(
          topicId,
          {
            fields:
              "id,name",
          }
        );

    return {
      name:
        String(
          record.name ||
            ""
        ) ||
        "Topic",
    };
  } catch {
    return null;
  }
}

/*
 * ============================================
 * Notes Parser
 * ============================================
 */

type ParsedAutoBatchNotes =
  | {
      scope:
        "knowledge";

      entityId:
        string;

      trigger?:
        string;
    }
  | {
      scope:
        "topic";

      entityId:
        string;

      trigger?:
        string;
    };

function parseAutoBatchNotes(
  value:
    unknown
):
  | ParsedAutoBatchNotes
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

    if (
      object.kind ===
      "knowledge_auto_eval"
    ) {
      const knowledgeId =
        cleanRecordId(
          object.knowledgeId
        );

      if (
        !knowledgeId
      ) {
        return null;
      }

      return {
        scope:
          "knowledge",

        entityId:
          knowledgeId,

        trigger:
          typeof object.trigger ===
          "string"
            ? object.trigger
            : undefined,
      };
    }

    if (
      object.kind ===
      "topic_auto_eval"
    ) {
      const topicId =
        cleanRecordId(
          object.topicId
        );

      if (
        !topicId
      ) {
        return null;
      }

      return {
        scope:
          "topic",

        entityId:
          topicId,

        trigger:
          typeof object.trigger ===
          "string"
            ? object.trigger
            : undefined,
      };
    }

    return null;
  } catch {
    return null;
  }
}

/*
 * ============================================
 * Helpers
 * ============================================
 */

function triggerLabel(
  trigger:
    string |
    undefined
) {
  switch (
    trigger
  ) {
    case "guidance_update":
      return "ویرایش Guidance";

    case "guidance_restore":
      return "Restore Guidance";

    case "status_change":
      return "تغییر وضعیت Topic";

    case "update":
      return "ویرایش Topic";

    case "publish":
      return "انتشار Knowledge";

    default:
      return "تغییر Topic/Guidance";
  }
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

  return /^[a-zA-Z0-9_-]{1,64}$/.test(
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

function severityOrder(
  value:
    AdminEvalAlert[
      "severity"
    ]
) {
  switch (
    value
  ) {
    case "critical":
      return 0;

    case "warning":
      return 1;

    case "info":
    default:
      return 2;
  }
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
