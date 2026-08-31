import type PocketBase from "pocketbase";

const QUERY_LIMIT =
  40;

const MAX_QUESTION_LENGTH =
  4_000;

export type TopicGuidanceValidationEvidenceCase = {
  evidenceId:
    string;

  question:
    string;

  expectedTopicId:
    string |
    null;

  expectedStatus:
    "classified" |
    "unclassified";

  origin:
    "baseline" |
    "fresh" |
    "current";
};

export async function getTopicGuidanceEvidenceRevision({
  pb,
  topicId,
}: {
  pb:
    PocketBase;

  topicId:
    string;
}) {
  const [
    finalTopic,
    originalTopic,
  ] =
    await Promise.all([
      latestReviewedAt({
        pb,

        filter:
          pb.filter(
            "role = 'user' && classification_reviewed = true && classification_status = 'classified' && topic = {:topicId}",
            {
              topicId,
            }
          ),
      }),

      latestReviewedAt({
        pb,

        filter:
          pb.filter(
            "role = 'user' && classification_reviewed = true && classification_original_status = 'classified' && classification_original_topic = {:topicId}",
            {
              topicId,
            }
          ),
      }),
    ]);

  return newestDateString(
    finalTopic,
    originalTopic
  );
}

export async function loadFreshTopicGuidanceValidationCases({
  pb,
  topicId,
  since,
  excludeEvidenceIds,
  limit =
    2,
}: {
  pb:
    PocketBase;

  topicId:
    string;

  since:
    string;

  excludeEvidenceIds:
    Set<
      string
    >;

  limit?:
    number;
}):
  Promise<
    TopicGuidanceValidationEvidenceCase[]
  > {
  const safeLimit =
    Math.max(
      0,
      Math.min(
        4,
        Math.trunc(
          limit
        ) ||
          0
      )
    );

  if (
    safeLimit ===
      0 ||
    !since
  ) {
    return [];
  }

  const [
    finalTopicResult,
    originalTopicResult,
  ] =
    await Promise.all([
      pb
        .collection(
          "messages"
        )
        .getList(
          1,
          QUERY_LIMIT,
          {
            filter:
              pb.filter(
                "role = 'user' && classification_reviewed = true && classification_reviewed_at > {:since} && classification_status = 'classified' && topic = {:topicId}",
                {
                  since,

                  topicId,
                }
              ),

            sort:
              "-classification_reviewed_at",

            fields:
              evidenceFields(),
          }
        ),

      pb
        .collection(
          "messages"
        )
        .getList(
          1,
          QUERY_LIMIT,
          {
            filter:
              pb.filter(
                "role = 'user' && classification_reviewed = true && classification_reviewed_at > {:since} && classification_original_status = 'classified' && classification_original_topic = {:topicId}",
                {
                  since,

                  topicId,
                }
              ),

            sort:
              "-classification_reviewed_at",

            fields:
              evidenceFields(),
          }
        ),
    ]);

  const positive:
    FreshCandidate[] = [];

  const negative:
    FreshCandidate[] = [];

  const confirmed:
    FreshCandidate[] = [];

  const seen =
    new Set(
      excludeEvidenceIds
    );

  for (
    const record of
    finalTopicResult.items
  ) {
    if (
      seen.has(
        record.id
      )
    ) {
      continue;
    }

    const question =
      cleanQuestion(
        record.content
      );

    if (
      !question
    ) {
      continue;
    }

    const originalTopicId =
      cleanId(
        record.classification_original_topic
      );

    const originalStatus =
      cleanStatus(
        record.classification_original_status
      );

    const originalWasSame =
      originalStatus ===
        "classified" &&
      originalTopicId ===
        topicId;

    const candidate:
      FreshCandidate = {
        evidenceId:
          record.id,

        question,

        expectedTopicId:
          topicId,

        expectedStatus:
          "classified",

        origin:
          "fresh",

        reviewedAt:
          String(
            record.classification_reviewed_at ||
              ""
          ),
      };

    if (
      originalWasSame
    ) {
      if (
        record.classification_review_source ===
        "quality_sample"
      ) {
        confirmed.push(
          candidate
        );

        seen.add(
          record.id
        );
      }

      continue;
    }

    positive.push(
      candidate
    );

    seen.add(
      record.id
    );
  }

  for (
    const record of
    originalTopicResult.items
  ) {
    if (
      seen.has(
        record.id
      )
    ) {
      continue;
    }

    const question =
      cleanQuestion(
        record.content
      );

    if (
      !question
    ) {
      continue;
    }

    const finalStatus =
      cleanStatus(
        record.classification_status
      );

    const finalTopicId =
      cleanId(
        record.topic
      );

    const finalWasSame =
      finalStatus ===
        "classified" &&
      finalTopicId ===
        topicId;

    if (
      finalWasSame
    ) {
      continue;
    }

    if (
      finalStatus ===
        "classified" &&
      !finalTopicId
    ) {
      continue;
    }

    negative.push({
      evidenceId:
        record.id,

      question,

      expectedTopicId:
        finalStatus ===
          "classified"
          ? finalTopicId
          : null,

      expectedStatus:
        finalStatus ===
          "classified"
          ? "classified"
          : "unclassified",

      origin:
        "fresh",

      reviewedAt:
        String(
          record.classification_reviewed_at ||
            ""
        ),
    });

    seen.add(
      record.id
    );
  }

  const selected:
    FreshCandidate[] = [];

  if (
    positive[0]
  ) {
    selected.push(
      positive[0]
    );
  }

  if (
    selected.length <
      safeLimit &&
    negative[0]
  ) {
    selected.push(
      negative[0]
    );
  }

  const selectedIds =
    new Set(
      selected.map(
        (
          item
        ) =>
          item.evidenceId
      )
    );

  const remaining =
    [
      ...positive,
      ...negative,
      ...confirmed,
    ]
      .filter(
        (
          item
        ) =>
          !selectedIds.has(
            item.evidenceId
          )
      )
      .sort(
        (
          first,
          second
        ) =>
          dateTimestamp(
            second.reviewedAt
          ) -
          dateTimestamp(
            first.reviewedAt
          )
      );

  for (
    const item of
    remaining
  ) {
    if (
      selected.length >=
      safeLimit
    ) {
      break;
    }

    selected.push(
      item
    );
  }

  return selected.map(
    (
      {
        reviewedAt:
          _reviewedAt,

        ...item
      }
    ) =>
      item
  );
}

type FreshCandidate =
  TopicGuidanceValidationEvidenceCase & {
    reviewedAt:
      string;
  };

async function latestReviewedAt({
  pb,
  filter,
}: {
  pb:
    PocketBase;

  filter:
    string;
}) {
  const result =
    await pb
      .collection(
        "messages"
      )
      .getList(
        1,
        1,
        {
          filter,

          sort:
            "-classification_reviewed_at",

          fields:
            "id,classification_reviewed_at",
        }
      );

  return String(
    result.items[0]
      ?.classification_reviewed_at ||
      ""
  );
}

function evidenceFields() {
  return [
    "id",
    "content",
    "topic",
    "classification_status",
    "classification_reviewed",
    "classification_review_source",
    "classification_original_topic",
    "classification_original_status",
    "classification_reviewed_at",
  ].join(
    ","
  );
}

function newestDateString(
  first:
    string,

  second:
    string
) {
  if (
    !first
  ) {
    return second;
  }

  if (
    !second
  ) {
    return first;
  }

  return dateTimestamp(
    first
  ) >=
    dateTimestamp(
      second
    )
    ? first
    : second;
}

function dateTimestamp(
  value:
    string
) {
  const timestamp =
    new Date(
      value
    ).getTime();

  return Number.isFinite(
    timestamp
  )
    ? timestamp
    : 0;
}

function cleanQuestion(
  value:
    unknown
) {
  return String(
    value ||
      ""
  )
    .trim()
    .slice(
      0,
      MAX_QUESTION_LENGTH
    );
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

function cleanStatus(
  value:
    unknown
) {
  const status =
    String(
      value ||
        ""
    );

  return status ===
      "classified" ||
    status ===
      "unclassified" ||
    status ===
      "error" ||
    status ===
      "pending"
    ? status
    : "unknown";
}
