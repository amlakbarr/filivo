import type PocketBase from "pocketbase";

const COLLECTION =
  "topic_guidance_validation_uses";

const RECORD_ID_PATTERN =
  /^[a-zA-Z0-9_-]{1,64}$/;

export type GuidanceValidationConsumeResult =
  | {
      ok:
        true;

      useId:
        string;
    }
  | {
      ok:
        false;

      code:
        "TOPIC_GUIDANCE_VALIDATION_REPLAYED";

      message:
        string;
    };

/*
 * ============================================
 * Atomic one-time consumption
 *
 * PocketBase Unique Index on validation_id is
 * the concurrency boundary. Two simultaneous
 * PATCH requests cannot both consume the same
 * certificate.
 * ============================================
 */

export async function consumeGuidanceValidationCertificate({
  pb,
  validationId,
  topicId,
  adminId,
  requestId,
  expiresAt,
}: {
  pb:
    PocketBase;

  validationId:
    string;

  topicId:
    string;

  adminId:
    string;

  requestId:
    string;

  expiresAt:
    string;
}):
  Promise<
    GuidanceValidationConsumeResult
  > {
  const safeValidationId =
    cleanValidationId(
      validationId
    );

  if (
    !safeValidationId
  ) {
    return {
      ok:
        false,

      code:
        "TOPIC_GUIDANCE_VALIDATION_REPLAYED",

      message:
        "شناسه گواهی Validation معتبر نیست.",
    };
  }

  try {
    const created =
      await pb
        .collection(
          COLLECTION
        )
        .create({
          validation_id:
            safeValidationId,

          topic:
            topicId,

          used_by:
            adminId,

          used_at:
            new Date()
              .toISOString(),

          request_id:
            String(
              requestId ||
                ""
            )
              .trim()
              .slice(
                0,
                150
              ),

          expires_at:
            String(
              expiresAt ||
                ""
            ).trim(),
        });

    return {
      ok:
        true,

      useId:
        created.id,
    };
  } catch (error) {
    /*
     * A 400 can be the unique-index collision.
     * Confirm by looking up validation_id; this keeps
     * unrelated schema failures distinguishable.
     */
    if (
      getStatus(
        error
      ) ===
      400
    ) {
      try {
        const existing =
          await pb
            .collection(
              COLLECTION
            )
            .getFirstListItem(
              pb.filter(
                "validation_id = {:validationId}",
                {
                  validationId:
                    safeValidationId,
                }
              ),
              {
                fields:
                  "id",
              }
            );

        if (
          existing?.id
        ) {
          return {
            ok:
              false,

            code:
              "TOPIC_GUIDANCE_VALIDATION_REPLAYED",

            message:
              "این گواهی Validation قبلاً مصرف شده است؛ Draft را دوباره Validation کنید.",
          };
        }
      } catch (lookupError) {
        if (
          getStatus(
            lookupError
          ) !==
          404
        ) {
          throw lookupError;
        }
      }
    }

    throw error;
  }
}

/*
 * Update failure before publication can safely
 * release the consumed certificate so the same
 * validated Draft may be retried.
 */
export async function releaseGuidanceValidationCertificateSafely({
  pb,
  useId,
}: {
  pb:
    PocketBase;

  useId:
    string;
}) {
  if (
    !useId
  ) {
    return;
  }

  try {
    await pb
      .collection(
        COLLECTION
      )
      .delete(
        useId
      );
  } catch {
    // Best-effort cleanup only.
  }
}

/*
 * ============================================
 * Cleanup expired certificate-use records
 *
 * These rows are only needed while the signed
 * certificate could still be replayed.
 *
 * Audit history is kept separately in audit_logs,
 * so expired replay-lock rows can be removed.
 * ============================================
 */

export async function cleanupExpiredGuidanceValidationUses({
  pb,
  now =
    new Date(),
  limit =
    200,
}: {
  pb:
    PocketBase;

  now?:
    Date;

  limit?:
    number;
}) {
  const safeLimit =
    Math.max(
      1,
      Math.min(
        500,
        Math.trunc(
          limit
        ) ||
          200
      )
    );

  const nowIso =
    now.toISOString();

  const result =
    await pb
      .collection(
        COLLECTION
      )
      .getList(
        1,
        safeLimit,
        {
          filter:
            pb.filter(
              "expires_at <= {:now}",
              {
                now:
                  nowIso,
              }
            ),

          sort:
            "expires_at",

          fields:
            [
              "id",
              "validation_id",
              "expires_at",
            ].join(
              ","
            ),
        }
      );

  let deleted =
    0;

  let alreadyGone =
    0;

  let failed =
    0;

  for (
    const record of
    result.items
  ) {
    try {
      await pb
        .collection(
          COLLECTION
        )
        .delete(
          record.id
        );

      deleted +=
        1;
    } catch (error) {
      if (
        getStatus(
          error
        ) ===
        404
      ) {
        alreadyGone +=
          1;

        continue;
      }

      failed +=
        1;
    }
  }

  return {
    matched:
      result.items.length,

    deleted,

    alreadyGone,

    failed,

    hasMore:
      result.totalItems >
      result.items.length,

    cutoff:
      nowIso,
  };
}

function cleanValidationId(
  value:
    unknown
) {
  const id =
    String(
      value ||
        ""
    ).trim();

  /*
   * randomUUID format, while remaining forward-compatible.
   */
  return /^[a-zA-Z0-9_-]{8,100}$/.test(
    id
  )
    ? id
    : "";
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
