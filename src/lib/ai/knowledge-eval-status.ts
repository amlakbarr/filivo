import "server-only";

import type PocketBase from "pocketbase";
import type {
  RecordModel,
} from "pocketbase";

import type {
  KnowledgeEvalStatusItem,
} from "@/types/knowledge-eval-status";

/*
 * ============================================
 * Limits
 * ============================================
 */

const MAX_KNOWLEDGE_IDS =
  50;

const MAX_AUTO_BATCH_SCAN =
  500;

const MAX_ACTIVE_CASE_SCAN =
  500;

const RECORD_ID_PATTERN =
  /^[a-zA-Z0-9_-]{1,64}$/;

/*
 * ============================================
 * Public
 * ============================================
 */

export function parseKnowledgeEvalStatusIds(
  value:
    unknown
) {
  if (
    !Array.isArray(
      value
    )
  ) {
    return [];
  }

  return [
    ...new Set(
      value
        .map(
          cleanRecordId
        )
        .filter(
          Boolean
        )
    ),
  ].slice(
    0,
    MAX_KNOWLEDGE_IDS
  );
}

export async function getKnowledgeEvalStatuses({
  pb,
  knowledgeIds,
}: {
  pb:
    PocketBase;

  knowledgeIds:
    string[];
}): Promise<
  Record<
    string,
    KnowledgeEvalStatusItem
  >
> {
  const ids =
    [
      ...new Set(
        knowledgeIds
          .map(
            cleanRecordId
          )
          .filter(
            Boolean
          )
      ),
    ].slice(
      0,
      MAX_KNOWLEDGE_IDS
    );

  if (
    ids.length ===
    0
  ) {
    return {};
  }

  const [
    knowledgeRecords,
    batchesResult,
    casesResult,
  ] =
    await Promise.all([
      loadKnowledgeItems(
        pb,
        ids
      ),

      pb
        .collection(
          "ai_eval_batches"
        )
        .getList(
          1,
          MAX_AUTO_BATCH_SCAN,
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
              "started_at",
              "completed_at",
              "created",
            ].join(
              ","
            ),
          }
        ),

      pb
        .collection(
          "ai_eval_cases"
        )
        .getList(
          1,
          MAX_ACTIVE_CASE_SCAN,
          {
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
          }
        ),
    ]);

  const latestBatchByKnowledge =
    new Map<
      string,
      {
        record:
          RecordModel;

        notes:
          AutoBatchNotes;
      }
    >();

  /*
   * Result از جدید به قدیم Sort شده است.
   * اولین Batch معتبر هر Knowledge، آخرین
   * Auto Test آن Knowledge است.
   */
  for (
    const batch of
    batchesResult.items
  ) {
    const notes =
      parseAutoBatchNotes(
        batch.notes
      );

    if (
      !notes ||
      !ids.includes(
        notes.knowledgeId
      ) ||
      latestBatchByKnowledge.has(
        notes.knowledgeId
      )
    ) {
      continue;
    }

    latestBatchByKnowledge.set(
      notes.knowledgeId,
      {
        record:
          batch,

        notes,
      }
    );
  }

  const activeCases =
    casesResult.items;

  const result:
    Record<
      string,
      KnowledgeEvalStatusItem
    > =
      {};

  for (
    const knowledge of
    knowledgeRecords
  ) {
    const knowledgeId =
      knowledge.id;

    const status =
      String(
        knowledge.status ||
          ""
      );

    const syncStatus =
      String(
        knowledge.sync_status ||
          ""
      );

    const topicId =
      cleanRecordId(
        knowledge.topic
      );

    const currentUpdated =
      String(
        knowledge.updated ||
          ""
      ).trim();

    const relatedCaseCount =
      activeCases.filter(
        (
          evalCase
        ) =>
          isCaseRelated({
            evalCase,

            knowledgeId,

            topicId,
          })
      ).length;

    /*
     * Draft / Archived یا Knowledge منتشرشده‌ای
     * که هنوز Sync نشده، Auto Eval قابل اتکا
     * ندارد.
     */
    if (
      status !==
        "published" ||
      syncStatus !==
        "synced"
    ) {
      result[
        knowledgeId
      ] =
        {
          knowledgeId,

          status:
            "not_applicable",

          relatedCaseCount,

          passed:
            0,

          failed:
            0,

          errors:
            0,

          total:
            0,

          knowledgeUpdated:
            currentUpdated ||
            undefined,

          message:
            status !==
              "published"
              ? "Auto Test فقط برای Knowledge منتشرشده اجرا می‌شود."
              : "Knowledge هنوز Sync موفق ندارد.",
        };

      continue;
    }

    if (
      relatedCaseCount ===
      0
    ) {
      result[
        knowledgeId
      ] =
        {
          knowledgeId,

          status:
            "no_cases",

          relatedCaseCount:
            0,

          passed:
            0,

          failed:
            0,

          errors:
            0,

          total:
            0,

          knowledgeUpdated:
            currentUpdated ||
            undefined,

          message:
            "Golden Question مرتبطی برای این Knowledge یا Topic تعریف نشده است.",
        };

      continue;
    }

    const latest =
      latestBatchByKnowledge.get(
        knowledgeId
      );

    if (
      !latest
    ) {
      result[
        knowledgeId
      ] =
        {
          knowledgeId,

          status:
            "never_run",

          relatedCaseCount,

          passed:
            0,

          failed:
            0,

          errors:
            0,

          total:
            0,

          knowledgeUpdated:
            currentUpdated ||
            undefined,

          message:
            "Golden Case مرتبط وجود دارد، اما برای Revision فعلی هنوز Auto Test ثبت نشده است.",
        };

      continue;
    }

    const batch =
      latest.record;

    const notes =
      latest.notes;

    const testedUpdated =
      String(
        notes.knowledgeUpdated ||
          ""
      ).trim();

    const batchStatus =
      String(
        batch.status ||
          ""
      );

    const passed =
      safeInteger(
        batch.passed_count
      );

    const failed =
      safeInteger(
        batch.failed_count
      );

    const errors =
      safeInteger(
        batch.error_count
      );

    const total =
      safeInteger(
        batch.total_cases
      );

    const base = {
      knowledgeId,

      relatedCaseCount,

      batchId:
        batch.id,

      batchLabel:
        String(
          batch.label ||
            ""
        ).trim() ||
        undefined,

      passed,

      failed,

      errors,

      total,

      knowledgeUpdated:
        currentUpdated ||
        undefined,

      testedKnowledgeUpdated:
        testedUpdated ||
        undefined,

      startedAt:
        String(
          batch.started_at ||
            ""
        ).trim() ||
        undefined,

      completedAt:
        String(
          batch.completed_at ||
            ""
        ).trim() ||
        undefined,
    };

    if (
      batchStatus ===
      "running"
    ) {
      result[
        knowledgeId
      ] =
        {
          ...base,

          status:
            "running",

          message:
            "Auto Golden Test در حال اجرا است.",
        };

      continue;
    }

    /*
     * اگر Knowledge بعد از آخرین Auto Test
     * دوباره تغییر کرده باشد، نتیجه قبلی
     * دیگر Evidence کافی برای Revision فعلی
     * نیست.
     */
    if (
      currentUpdated &&
      testedUpdated &&
      currentUpdated !==
        testedUpdated
    ) {
      result[
        knowledgeId
      ] =
        {
          ...base,

          status:
            "stale",

          message:
            "آخرین نتیجه تست مربوط به Revision قبلی Knowledge است.",
        };

      continue;
    }

    if (
      batchStatus ===
        "error" ||
      errors >
        0
    ) {
      result[
        knowledgeId
      ] =
        {
          ...base,

          status:
            "error",

          message:
            errors >
              0
              ? `${errors.toLocaleString(
                  "fa-IR"
                )} Case با ERROR تمام شده است.`
              : "Auto Golden Test با خطای اجرایی تمام شده است.",
        };

      continue;
    }

    if (
      failed >
      0
    ) {
      result[
        knowledgeId
      ] =
        {
          ...base,

          status:
            "failed",

          message:
            `${failed.toLocaleString(
              "fa-IR"
            )} Case از ${total.toLocaleString(
              "fa-IR"
            )} Case مرتبط FAIL شده است.`,
        };

      continue;
    }

    result[
      knowledgeId
    ] =
      {
        ...base,

        status:
          "passed",

        message:
          total >
          0
            ? `هر ${total.toLocaleString(
                "fa-IR"
              )} Case مرتبط PASS شده‌اند.`
            : "Auto Golden Test بدون Failure تمام شده است.",
      };
  }

  /*
   * اگر یکی از IDها بین درخواست Client و این
   * Query حذف شده باشد، Client همچنان پاسخ
   * deterministic می‌گیرد.
   */
  for (
    const id of
    ids
  ) {
    if (
      !result[
        id
      ]
    ) {
      result[
        id
      ] =
        {
          knowledgeId:
            id,

          status:
            "not_applicable",

          relatedCaseCount:
            0,

          passed:
            0,

          failed:
            0,

          errors:
            0,

          total:
            0,

          message:
            "Knowledge پیدا نشد.",
        };
    }
  }

  return result;
}

/*
 * ============================================
 * Knowledge Load
 * ============================================
 */

async function loadKnowledgeItems(
  pb:
    PocketBase,

  ids:
    string[]
) {
  const values:
    Record<
      string,
      string
    > =
      {};

  const clauses =
    ids.map(
      (
        id,
        index
      ) => {
        const key =
          `knowledge${index}`;

        values[
          key
        ] =
          id;

        return `id = {:${key}}`;
      }
    );

  return pb
    .collection(
      "knowledge_items"
    )
    .getFullList({
      filter:
        pb.filter(
          clauses.join(
            " || "
          ),
          values
        ),

      fields: [
        "id",
        "topic",
        "status",
        "sync_status",
        "updated",
      ].join(
        ","
      ),
    });
}

/*
 * ============================================
 * Related Cases
 * ============================================
 */

function isCaseRelated({
  evalCase,
  knowledgeId,
  topicId,
}: {
  evalCase:
    RecordModel;

  knowledgeId:
    string;

  topicId:
    string;
}) {
  const expectedTopicId =
    cleanRecordId(
      evalCase.expected_topic
    );

  const expectedKnowledgeIds =
    relationIds(
      evalCase
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

/*
 * ============================================
 * Auto Batch Notes
 * ============================================
 */

type AutoBatchNotes = {
  kind:
    "knowledge_auto_eval";

  revisionKey:
    string;

  knowledgeId:
    string;

  topicId?:
    string |
    null;

  trigger?:
    "publish" |
    "update";

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

      revisionKey:
        String(
          object.revisionKey ||
            ""
        ),

      knowledgeId,

      topicId:
        cleanRecordId(
          object.topicId
        ) ||
        null,

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
      null ||
    value ===
      undefined ||
    value ===
      ""
  ) {
    return undefined;
  }

  return safeInteger(
    value
  );
}
