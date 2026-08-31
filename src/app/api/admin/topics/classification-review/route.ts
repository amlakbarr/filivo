import type PocketBase from "pocketbase";

import {
  getTopicClassificationMinConfidence,
} from "@/lib/ai/classification";

import {
  getAdminSession,
} from "@/lib/pocketbase/admin";

import {
  getPocketBaseServiceClient,
} from "@/lib/pocketbase/service";

/*
 * ============================================
 * Limits
 * ============================================
 */

const DEFAULT_LIMIT =
  30;

const MAX_LIMIT =
  50;

/*
 * Quality Audit نباید فقط "آخرین پیام‌ها" باشد،
 * چون این کار به Topicهای پرترافیک و ساعات اخیر
 * وزن بیش از حد می‌دهد.
 *
 * ابتدا یک Pool بزرگ‌تر می‌گیریم و سپس نمونه
 * متوازن بین Topic و Confidence Band انتخاب می‌کنیم.
 */
const QUALITY_AUDIT_POOL_SIZE =
  200;

const MAX_CONTENT_LENGTH =
  1_500;

/*
 * ============================================
 * GET
 *
 * Recent real user questions that are useful
 * for Classification QA.
 *
 * No mutation is performed.
 * No user/account identity is returned.
 * ============================================
 */

export async function GET(
  request:
    Request
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

  let pb:
    PocketBase;

  try {
    pb =
      await getPocketBaseServiceClient();
  } catch (error) {
    console.error(
      "Classification review service unavailable",
      {
        requestId,

        adminId:
          admin.account.id,

        error:
          errorMetadata(
            error
          ),
      }
    );

    return apiError(
      requestId,
      503,
      "CLASSIFICATION_REVIEW_SERVICE_UNAVAILABLE",
      "سرویس بررسی Classification موقتاً در دسترس نیست."
    );
  }

  const url =
    new URL(
      request.url
    );

  const mode =
    parseMode(
      url.searchParams.get(
        "mode"
      )
    );

  const limit =
    clampInteger(
      url.searchParams.get(
        "limit"
      ),
      1,
      MAX_LIMIT,
      DEFAULT_LIMIT
    );

  const threshold =
    getTopicClassificationMinConfidence();

  const queryLimit =
    mode ===
      "quality_sample"
      ? QUALITY_AUDIT_POOL_SIZE
      : limit;

  try {
    const [
      result,
      topicRecords,
    ] =
      await Promise.all([
        pb
          .collection(
            "messages"
          )
          .getList(
            1,
            queryLimit,
            {
              filter:
                buildFilter(
                  pb,
                  mode,
                  threshold
                ),

              sort:
                "-created",

              fields:
                [
                  "id",
                  "content",
                  "topic",
                  "topic_confidence",
                  "classification_status",
                  "classification_reviewed",
                  "classification_reviewed_at",
                  "classification_review_note",
                  "classification_review_source",
                  "classification_original_topic",
                  "classification_original_status",
                  "classification_original_confidence",
                  "created",
                ].join(
                  ","
                ),
            }
          ),

        pb
          .collection(
            "topics"
          )
          .getFullList({
            fields:
              [
                "id",
                "name",
                "code",
                "active",
              ].join(
                ","
              ),

            sort:
              "name",
          }),
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
                String(
                  record.name ||
                    ""
                )
                  .trim()
                  .slice(
                    0,
                    160
                  ),

              code:
                String(
                  record.code ||
                    ""
                )
                  .trim()
                  .slice(
                    0,
                    80
                  ),

              active:
                record.active ===
                true,
            },
          ]
        )
      );

    const candidateItems =
      result.items
        .map(
          (
            record
          ) => {
            const content =
              String(
                record.content ||
                  ""
              )
                .trim()
                .slice(
                  0,
                  MAX_CONTENT_LENGTH
                );

            if (
              !content
            ) {
              return null;
            }

            const topicId =
              String(
                record.topic ||
                  ""
              ).trim();

            const topic =
              topicId
                ? topicById.get(
                    topicId
                  ) ||
                  null
                : null;

            return {
              id:
                record.id,

              content,

              classificationStatus:
                normalizeStatus(
                  record.classification_status
                ),

              confidence:
                clampConfidence(
                  record.topic_confidence
                ),

              topicId:
                topicId ||
                null,

              topicName:
                topic?.name ||
                null,

              topicCode:
                topic?.code ||
                null,

              topicActive:
                topic?.active ??
                null,

              originalTopicId:
                cleanId(
                  record.classification_original_topic
                ) ||
                null,

              originalTopicName:
                (() => {
                  const originalId =
                    cleanId(
                      record.classification_original_topic
                    );

                  return originalId
                    ? topicById.get(
                        originalId
                      )?.name ||
                      null
                    : null;
                })(),

              originalStatus:
                normalizeStatus(
                  record.classification_original_status
                ),

              originalConfidence:
                clampConfidence(
                  record.classification_original_confidence
                ),

              reviewed:
                record.classification_reviewed ===
                true,

              reviewedAt:
                String(
                  record.classification_reviewed_at ||
                    ""
                ),

              reviewNote:
                String(
                  record.classification_review_note ||
                    ""
                )
                  .trim()
                  .slice(
                    0,
                    1_000
                  ),

              reviewSource:
                record.classification_review_source ===
                "quality_sample"
                  ? "quality_sample"
                  : "needs_review",

              created:
                String(
                  record.created ||
                    ""
                ),

              reviewReason:
                reviewReason({
                  mode,

                  status:
                    normalizeStatus(
                      record.classification_status
                    ),

                  confidence:
                    clampConfidence(
                      record.topic_confidence
                    ),

                  threshold,
                }),
            };
          }
        )
        .filter(
          (
            item
          ): item is NonNullable<
            typeof item
          > =>
            item !==
            null
        );

    const selection =
      mode ===
        "quality_sample"
        ? selectBalancedQualitySample({
            items:
              candidateItems,

            limit,

            threshold,
          })
        : {
            items:
              candidateItems.slice(
                0,
                limit
              ),

            sampling:
              null,
          };

    const items =
      selection.items;

    return Response.json(
      {
        success:
          true,

        mode,

        threshold,

        count:
          items.length,

        items,

        sampling:
          selection.sampling,

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
    console.error(
      "Classification review load failed",
      {
        requestId,

        adminId:
          admin.account.id,

        mode,

        error:
          errorMetadata(
            error
          ),
      }
    );

    return apiError(
      requestId,
      503,
      "CLASSIFICATION_REVIEW_FAILED",
      "دریافت نمونه‌های واقعی Classification ناموفق بود."
    );
  }
}

/*
 * ============================================
 * Balanced Quality Audit Sampling
 *
 * Goal:
 * - جلوگیری از Bias ناشی از "آخرین 30 پیام"
 * - جلوگیری از تسلط Topicهای پرترافیک
 * - پوشش Confidence نزدیک Threshold، متوسط و بالا
 *
 * این Sampling تصادفی کریپتوگرافیک نیست.
 * Hash پایدار Record ID باعث می‌شود ترتیب داخل
 * هر Stratum قابل تکرار ولی از ترتیب زمانی مستقل باشد.
 * ============================================
 */

function selectBalancedQualitySample<
  T extends {
    id:
      string;

    topicId:
      string |
      null;

    confidence:
      number;
  }
>({
  items,
  limit,
  threshold,
}: {
  items:
    T[];

  limit:
    number;

  threshold:
    number;
}) {
  type Band =
    | "near_threshold"
    | "mid_confidence"
    | "high_confidence";

  const buckets =
    new Map<
      string,
      {
        topicId:
          string;

        band:
          Band;

        items:
          T[];
      }
    >();

  for (
    const item of
    items
  ) {
    const topicId =
      item.topicId ||
      "__no_topic__";

    const band =
      confidenceBand(
        item.confidence,
        threshold
      );

    const key =
      `${topicId}::${band}`;

    const existing =
      buckets.get(
        key
      );

    if (
      existing
    ) {
      existing.items.push(
        item
      );
    } else {
      buckets.set(
        key,
        {
          topicId,

          band,

          items: [
            item,
          ],
        }
      );
    }
  }

  const orderedBuckets =
    Array.from(
      buckets.values()
    )
      .map(
        (
          bucket
        ) => ({
          ...bucket,

          items:
            bucket.items
              .slice()
              .sort(
                (
                  first,
                  second
                ) =>
                  stableHash(
                    first.id
                  ) -
                  stableHash(
                    second.id
                  )
              ),
        })
      )
      .sort(
        (
          first,
          second
        ) => {
          const firstBand =
            bandOrder(
              first.band
            );

          const secondBand =
            bandOrder(
              second.band
            );

          if (
            firstBand !==
            secondBand
          ) {
            return firstBand -
              secondBand;
          }

          return first.topicId
            .localeCompare(
              second.topicId
            );
        }
      );

  const selected:
    T[] = [];

  /*
   * Round Robin:
   * از هر Topic/Confidence Band یک نمونه برداشته
   * می‌شود و سپس دور بعدی شروع می‌شود.
   */
  while (
    selected.length <
      limit &&
    orderedBuckets.some(
      (
        bucket
      ) =>
        bucket.items.length >
        0
    )
  ) {
    for (
      const bucket of
      orderedBuckets
    ) {
      const item =
        bucket.items.shift();

      if (
        !item
      ) {
        continue;
      }

      selected.push(
        item
      );

      if (
        selected.length >=
        limit
      ) {
        break;
      }
    }
  }

  const topicIds =
    new Set(
      selected
        .map(
          (
            item
          ) =>
            item.topicId
        )
        .filter(
          (
            value
          ): value is string =>
            Boolean(
              value
            )
        )
    );

  const bands = {
    near_threshold:
      0,

    mid_confidence:
      0,

    high_confidence:
      0,
  };

  for (
    const item of
    selected
  ) {
    bands[
      confidenceBand(
        item.confidence,
        threshold
      )
    ] +=
      1;
  }

  return {
    items:
      selected,

    sampling: {
      strategy:
        "topic_confidence_balanced" as const,

      poolSize:
        items.length,

      selected:
        selected.length,

      topicCount:
        topicIds.size,

      bucketCount:
        buckets.size,

      bands,
    },
  };
}

function confidenceBand(
  confidence:
    number,

  threshold:
    number
):
  | "near_threshold"
  | "mid_confidence"
  | "high_confidence" {
  if (
    confidence <
    Math.min(
      1,
      threshold +
        0.10
    )
  ) {
    return "near_threshold";
  }

  if (
    confidence <
    Math.min(
      1,
      threshold +
        0.25
    )
  ) {
    return "mid_confidence";
  }

  return "high_confidence";
}

function bandOrder(
  band:
    | "near_threshold"
    | "mid_confidence"
    | "high_confidence"
) {
  return band ===
      "near_threshold"
      ? 0
      : band ===
          "mid_confidence"
        ? 1
        : 2;
}

function stableHash(
  value:
    string
) {
  /*
   * FNV-1a 32-bit ساده برای Sort پایدار.
   * کاربرد امنیتی ندارد.
   */
  let hash =
    0x811c9dc5;

  for (
    let index =
      0;
    index <
    value.length;
    index +=
      1
  ) {
    hash ^=
      value.charCodeAt(
        index
      );

    hash =
      Math.imul(
        hash,
        0x01000193
      );
  }

  return hash >>>
    0;
}

/*
 * ============================================
 * Filter
 * ============================================
 */

function buildFilter(
  pb:
    PocketBase,

  mode:
    ReviewMode,

  threshold:
    number
) {
  if (
    mode ===
    "unclassified"
  ) {
    return "role = 'user' && classification_reviewed = false && classification_status = 'unclassified'";
  }

  if (
    mode ===
    "error"
  ) {
    return "role = 'user' && classification_reviewed = false && classification_status = 'error'";
  }

  if (
    mode ===
    "reviewed"
  ) {
    return "role = 'user' && classification_reviewed = true";
  }

  if (
    mode ===
    "quality_sample"
  ) {
    /*
     * کنترل کیفیت روی Classificationهایی که
     * سیستم واقعاً Accepted کرده است.
     *
     * این نمونه‌ها مستقل از صف خطا/Low Confidence
     * بررسی می‌شوند تا Precision واقعی Accepted
     * Predictions بهتر قابل تخمین باشد.
     */
    return pb.filter(
      "role = 'user' && classification_reviewed = false && classification_status = 'classified' && topic_confidence >= {:threshold}",
      {
        threshold,
      }
    );
  }

  if (
    mode ===
    "low_confidence"
  ) {
    return pb.filter(
      "role = 'user' && classification_reviewed = false && classification_status = 'classified' && topic_confidence < {:threshold}",
      {
        threshold,
      }
    );
  }

  return pb.filter(
    "role = 'user' && classification_reviewed = false && (classification_status = 'unclassified' || classification_status = 'error' || (classification_status = 'classified' && topic_confidence < {:threshold}))",
    {
      threshold,
    }
  );
}

type ReviewMode =
  | "needs_review"
  | "unclassified"
  | "low_confidence"
  | "error"
  | "quality_sample"
  | "reviewed";

function parseMode(
  value:
    string |
    null
): ReviewMode {
  return value ===
    "unclassified" ||
    value ===
      "low_confidence" ||
    value ===
      "error" ||
    value ===
      "quality_sample" ||
    value ===
      "reviewed"
    ? value
    : "needs_review";
}

function reviewReason({
  mode,
  status,
  confidence,
  threshold,
}: {
  mode:
    ReviewMode;

  status:
    string;

  confidence:
    number;

  threshold:
    number;
}) {
  if (
    mode ===
    "reviewed"
  ) {
    return "reviewed";
  }

  if (
    mode ===
    "quality_sample"
  ) {
    return "quality_sample";
  }

  if (
    status ===
    "unclassified"
  ) {
    return "unclassified";
  }

  if (
    status ===
    "error"
  ) {
    return "error";
  }

  if (
    status ===
      "classified" &&
    confidence <
      threshold
  ) {
    return "low_confidence";
  }

  return "other";
}

/*
 * ============================================
 * Helpers
 * ============================================
 */

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

function normalizeStatus(
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

function clampInteger(
  value:
    string |
    null,

  min:
    number,

  max:
    number,

  fallback:
    number
) {
  const parsed =
    Number(
      value
    );

  if (
    !Number.isFinite(
      parsed
    )
  ) {
    return fallback;
  }

  return Math.min(
    max,
    Math.max(
      min,
      Math.trunc(
        parsed
      )
    )
  );
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
