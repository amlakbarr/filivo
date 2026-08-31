import type PocketBase from "pocketbase";
import type {
  RecordModel,
} from "pocketbase";

import type {
  TopicRecord,
} from "@/lib/topics/admin";

export const TOPIC_GUIDANCE_VERSION_COLLECTION =
  "topic_guidance_versions";

export type TopicGuidanceSnapshot = {
  keywords:
    string;

  examples:
    string;

  negativeExamples:
    string;

  classificationNote:
    string;
};

type GuidancePayload = {
  keywords?:
    string;

  examples?:
    string;

  negative_examples?:
    string;

  classification_note?:
    string;
};

export function topicGuidanceSnapshot(
  record:
    TopicRecord
): TopicGuidanceSnapshot {
  return {
    keywords:
      cleanText(
        record.keywords,
        1_000
      ),

    examples:
      cleanText(
        record.examples,
        4_000
      ),

    negativeExamples:
      cleanText(
        record.negative_examples,
        4_000
      ),

    classificationNote:
      cleanText(
        record.classification_note,
        2_000
      ),
  };
}

export function guidancePayloadFromSnapshot(
  snapshot:
    TopicGuidanceSnapshot
) {
  return {
    keywords:
      snapshot.keywords,

    examples:
      snapshot.examples,

    negative_examples:
      snapshot.negativeExamples,

    classification_note:
      snapshot.classificationNote,
  };
}

export function topicGuidanceChanged(
  existing:
    TopicRecord,

  payload:
    GuidancePayload
) {
  const before =
    topicGuidanceSnapshot(
      existing
    );

  if (
    Object.prototype.hasOwnProperty.call(
      payload,
      "keywords"
    ) &&
    cleanText(
      payload.keywords,
      1_000
    ) !==
      before.keywords
  ) {
    return true;
  }

  if (
    Object.prototype.hasOwnProperty.call(
      payload,
      "examples"
    ) &&
    cleanText(
      payload.examples,
      4_000
    ) !==
      before.examples
  ) {
    return true;
  }

  if (
    Object.prototype.hasOwnProperty.call(
      payload,
      "negative_examples"
    ) &&
    cleanText(
      payload.negative_examples,
      4_000
    ) !==
      before.negativeExamples
  ) {
    return true;
  }

  if (
    Object.prototype.hasOwnProperty.call(
      payload,
      "classification_note"
    ) &&
    cleanText(
      payload.classification_note,
      2_000
    ) !==
      before.classificationNote
  ) {
    return true;
  }

  return false;
}

export async function createTopicGuidanceVersion({
  pb,
  topic,
  actorId,
  source,
  note,
}: {
  pb:
    PocketBase;

  topic:
    TopicRecord;

  actorId:
    string;

  source:
    "before_update" |
    "before_restore";

  note?:
    string;
}) {
  const snapshot =
    topicGuidanceSnapshot(
      topic
    );

  return pb
    .collection(
      TOPIC_GUIDANCE_VERSION_COLLECTION
    )
    .create({
      topic:
        topic.id,

      keywords:
        snapshot.keywords,

      examples:
        snapshot.examples,

      negative_examples:
        snapshot.negativeExamples,

      classification_note:
        snapshot.classificationNote,

      created_by:
        actorId,

      source,

      note:
        cleanText(
          note,
          500
        ),
    });
}

export async function deleteTopicGuidanceVersionSafely({
  pb,
  id,
}: {
  pb:
    PocketBase;

  id:
    string;
}) {
  if (
    !id
  ) {
    return;
  }

  try {
    await pb
      .collection(
        TOPIC_GUIDANCE_VERSION_COLLECTION
      )
      .delete(
        id
      );
  } catch {
    /*
     * Cleanup best-effort است.
     * Failure این Cleanup نباید خطای اصلی را بپوشاند.
     */
  }
}

export function guidanceSnapshotFromVersion(
  record:
    RecordModel
): TopicGuidanceSnapshot {
  return {
    keywords:
      cleanText(
        record.keywords,
        1_000
      ),

    examples:
      cleanText(
        record.examples,
        4_000
      ),

    negativeExamples:
      cleanText(
        record.negative_examples,
        4_000
      ),

    classificationNote:
      cleanText(
        record.classification_note,
        2_000
      ),
  };
}

export function serializeTopicGuidanceVersion(
  record:
    RecordModel
) {
  const createdBy =
    expandedRecord(
      record,
      "created_by"
    );

  return {
    id:
      record.id,

    snapshot:
      guidanceSnapshotFromVersion(
        record
      ),

    source:
      record.source ===
      "before_restore"
        ? "before_restore"
        : "before_update",

    note:
      cleanText(
        record.note,
        500
      ),

    createdBy: {
      id:
        cleanId(
          record.created_by
        ),

      name:
        cleanText(
          createdBy?.name,
          160
        ),
    },

    created:
      cleanText(
        record.created,
        100
      ),
  };
}

function expandedRecord(
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
    Array.isArray(
      value
    )
  ) {
    return value[0];
  }

  return value;
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

function cleanText(
  value:
    unknown,

  maxLength:
    number
) {
  return String(
    value ||
      ""
  )
    .replace(
      /\r\n?/g,
      "\n"
    )
    .trim()
    .slice(
      0,
      maxLength
    );
}
