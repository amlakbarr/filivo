import type PocketBase from "pocketbase";

import {
  getAdminSession,
} from "@/lib/pocketbase/admin";

import {
  getPocketBaseServiceClient,
} from "@/lib/pocketbase/service";

const RECORD_ID_PATTERN =
  /^[a-zA-Z0-9_-]{1,64}$/;

const QUERY_LIMIT =
  40;

const GROUP_LIMIT =
  8;

const MAX_CONTENT_LENGTH =
  600;

const MAX_GUIDANCE_TEXT_LENGTH =
  160;

type Context = {
  params:
    Promise<{
      id:
        string;
    }>;
};

type TopicInfo = {
  id:
    string;

  name:
    string;

  code:
    string;
};

type EvidenceRecord = {
  id:
    string;

  content:
    string;

  guidanceText:
    string;

  originalTopicId:
    string |
    null;

  originalTopicName:
    string |
    null;

  originalStatus:
    string;

  originalConfidence:
    number;

  finalTopicId:
    string |
    null;

  finalTopicName:
    string |
    null;

  finalStatus:
    string;

  reviewedAt:
    string;

  reviewSource:
    "needs_review" |
    "quality_sample";
};

/*
 * ============================================
 * GET
 *
 * Human-reviewed examples for improving one
 * Topic's AI Guidance.
 *
 * Positive correction:
 * Human final Topic = this Topic, while original
 * AI output was another Topic / Unclassified.
 *
 * Negative correction:
 * Original AI Topic = this Topic, while Human
 * final result is another Topic / Unclassified.
 *
 * Confirmed positive:
 * Quality Audit where AI correctly selected
 * this Topic and Human confirmed it.
 *
 * No mutation is performed.
 * No user/account identity is returned.
 * ============================================
 */

export async function GET(
  _request:
    Request,

  {
    params,
  }:
    Context
) {
  const requestId =
    crypto.randomUUID();

  const admin =
    await getAdminSession();

  if (
    !admin.ok
  ) {
    return apiError(
      requestId,
      admin.status,
      admin.code,
      admin.message
    );
  }

  const {
    id:
      topicId,
  } =
    await params;

  if (
    !isSafeId(
      topicId
    )
  ) {
    return apiError(
      requestId,
      400,
      "TOPIC_GUIDANCE_EVIDENCE_INVALID_ID",
      "شناسه موضوع معتبر نیست."
    );
  }

  let pb:
    PocketBase;

  try {
    pb =
      await getPocketBaseServiceClient();
  } catch (error) {
    console.error(
      "Topic guidance evidence service unavailable",
      {
        requestId,

        adminId:
          admin.account.id,

        topicId,

        error:
          errorMetadata(
            error
          ),
      }
    );

    return apiError(
      requestId,
      503,
      "TOPIC_GUIDANCE_EVIDENCE_SERVICE_UNAVAILABLE",
      "سرویس شواهد Guidance موقتاً در دسترس نیست."
    );
  }

  try {
    const [
      topicRecord,
      topicRecords,
      finalTopicRecords,
      originalTopicRecords,
    ] =
      await Promise.all([
        pb
          .collection(
            "topics"
          )
          .getOne(
            topicId,
            {
              fields:
                "id,name,code,active",
            }
          ),

        pb
          .collection(
            "topics"
          )
          .getFullList({
            fields:
              "id,name,code",

            sort:
              "name",
          }),

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
                  "role = 'user' && classification_reviewed = true && classification_status = 'classified' && topic = {:topicId}",
                  {
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
                  "role = 'user' && classification_reviewed = true && classification_original_status = 'classified' && classification_original_topic = {:topicId}",
                  {
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

    const topicById =
      new Map(
        topicRecords.map(
          (
            record
          ) => [
            record.id,
            {
              id:
                record.id,

              name:
                cleanText(
                  record.name,
                  160
                ),

              code:
                cleanText(
                  record.code,
                  80
                ),
            } satisfies TopicInfo,
          ]
        )
      );

    const positiveCorrections:
      EvidenceRecord[] = [];

    const confirmedPositive:
      EvidenceRecord[] = [];

    const negativeCorrections:
      EvidenceRecord[] = [];

    const positiveSeen =
      new Set<
        string
      >();

    const negativeSeen =
      new Set<
        string
      >();

    for (
      const record of
      finalTopicRecords.items
    ) {
      const item =
        serializeEvidence(
          record,
          topicById
        );

      if (
        !item
      ) {
        continue;
      }

      const originalWasSame =
        item.originalStatus ===
          "classified" &&
        item.originalTopicId ===
          topicId;

      if (
        originalWasSame
      ) {
        if (
          item.reviewSource ===
            "quality_sample" &&
          confirmedPositive.length <
            GROUP_LIMIT &&
          !positiveSeen.has(
            normalizeEvidenceKey(
              item.guidanceText
            )
          )
        ) {
          confirmedPositive.push(
            item
          );

          positiveSeen.add(
            normalizeEvidenceKey(
              item.guidanceText
            )
          );
        }

        continue;
      }

      if (
        positiveCorrections.length >=
          GROUP_LIMIT
      ) {
        continue;
      }

      const key =
        normalizeEvidenceKey(
          item.guidanceText
        );

      if (
        !key ||
        positiveSeen.has(
          key
        )
      ) {
        continue;
      }

      positiveCorrections.push(
        item
      );

      positiveSeen.add(
        key
      );
    }

    for (
      const record of
      originalTopicRecords.items
    ) {
      const item =
        serializeEvidence(
          record,
          topicById
        );

      if (
        !item
      ) {
        continue;
      }

      const finalWasSame =
        item.finalStatus ===
          "classified" &&
        item.finalTopicId ===
          topicId;

      if (
        finalWasSame
      ) {
        continue;
      }

      if (
        negativeCorrections.length >=
          GROUP_LIMIT
      ) {
        continue;
      }

      const key =
        normalizeEvidenceKey(
          item.guidanceText
        );

      if (
        !key ||
        negativeSeen.has(
          key
        )
      ) {
        continue;
      }

      negativeCorrections.push(
        item
      );

      negativeSeen.add(
        key
      );
    }

    return Response.json(
      {
        success:
          true,

        topic: {
          id:
            topicRecord.id,

          name:
            cleanText(
              topicRecord.name,
              160
            ),

          code:
            cleanText(
              topicRecord.code,
              80
            ),

          active:
            topicRecord.active ===
            true,
        },

        summary: {
          positiveCorrections:
            positiveCorrections.length,

          negativeCorrections:
            negativeCorrections.length,

          confirmedPositive:
            confirmedPositive.length,

          totalEvidence:
            positiveCorrections.length +
            negativeCorrections.length +
            confirmedPositive.length,
        },

        evidence: {
          positiveCorrections,

          negativeCorrections,

          confirmedPositive,
        },

        requestId,
      },
      {
        status:
          200,

        headers: {
          "Cache-Control":
            "no-store",

          "X-Request-Id":
            requestId,
        },
      }
    );
  } catch (error) {
    const status =
      getStatus(
        error
      );

    if (
      status ===
      404
    ) {
      return apiError(
        requestId,
        404,
        "TOPIC_GUIDANCE_EVIDENCE_TOPIC_NOT_FOUND",
        "موضوع موردنظر پیدا نشد."
      );
    }

    console.error(
      "Topic guidance evidence load failed",
      {
        requestId,

        adminId:
          admin.account.id,

        topicId,

        error:
          errorMetadata(
            error
          ),
      }
    );

    return apiError(
      requestId,
      503,
      "TOPIC_GUIDANCE_EVIDENCE_FAILED",
      "دریافت شواهد Human Review برای Guidance ناموفق بود."
    );
  }
}

/*
 * ============================================
 * Evidence Serialization
 * ============================================
 */

function evidenceFields() {
  return [
    "id",
    "content",
    "topic",
    "classification_status",
    "classification_reviewed_at",
    "classification_review_source",
    "classification_original_topic",
    "classification_original_status",
    "classification_original_confidence",
  ].join(
    ","
  );
}

function serializeEvidence(
  record:
    Record<
      string,
      unknown
    > & {
      id:
        string;
    },

  topicById:
    Map<
      string,
      TopicInfo
    >
):
  | EvidenceRecord
  | null {
  const content =
    cleanText(
      record.content,
      MAX_CONTENT_LENGTH
    );

  if (
    !content
  ) {
    return null;
  }

  const guidanceText =
    cleanGuidanceText(
      content
    );

  if (
    !guidanceText
  ) {
    return null;
  }

  const originalTopicId =
    cleanId(
      record.classification_original_topic
    ) ||
    null;

  const finalTopicId =
    cleanId(
      record.topic
    ) ||
    null;

  return {
    id:
      record.id,

    content,

    guidanceText,

    originalTopicId,

    originalTopicName:
      originalTopicId
        ? topicById.get(
            originalTopicId
          )?.name ||
          null
        : null,

    originalStatus:
      cleanStatus(
        record.classification_original_status
      ),

    originalConfidence:
      clampConfidence(
        record.classification_original_confidence
      ),

    finalTopicId,

    finalTopicName:
      finalTopicId
        ? topicById.get(
            finalTopicId
          )?.name ||
          null
        : null,

    finalStatus:
      cleanStatus(
        record.classification_status
      ),

    reviewedAt:
      String(
        record.classification_reviewed_at ||
          ""
      ),

    reviewSource:
      record.classification_review_source ===
        "quality_sample"
        ? "quality_sample"
        : "needs_review",
  };
}

function cleanGuidanceText(
  value:
    string
) {
  return value
    .replace(
      /\s+/g,
      " "
    )
    .trim()
    .slice(
      0,
      MAX_GUIDANCE_TEXT_LENGTH
    );
}

function normalizeEvidenceKey(
  value:
    string
) {
  return value
    .trim()
    .replace(
      /\s+/g,
      " "
    )
    .toLocaleLowerCase(
      "fa"
    );
}

/*
 * ============================================
 * Helpers
 * ============================================
 */

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
    .trim()
    .slice(
      0,
      maxLength
    );
}

function isSafeId(
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

function cleanId(
  value:
    unknown
) {
  const id =
    String(
      value ||
        ""
    ).trim();

  return isSafeId(
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

function clampConfidence(
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

  return Math.min(
    1,
    Math.max(
      0,
      number
    )
  );
}

function getStatus(
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

function apiError(
  requestId:
    string,

  status:
    number,

  code:
    string,

  message:
    string
) {
  return Response.json(
    {
      success:
        false,

      code,

      message,

      requestId,
    },
    {
      status,

      headers: {
        "Cache-Control":
          "no-store",

        "X-Request-Id":
          requestId,
      },
    }
  );
}

function errorMetadata(
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
