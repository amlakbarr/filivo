import type PocketBase from "pocketbase";

import {
  recordAuditLog,
} from "@/lib/audit/log";

import {
  consumeAdminRateLimit,
} from "@/lib/admin/rate-limit";

import {
  TopicValidationError,
  getPocketBaseErrorStatus,
  getTopicMessageCount,
  isSafeTopicId,
  parseTopicUpdateInput,
  safeTopicErrorMetadata,
  serializeTopic,
  topicCodeExists,
  type TopicRecord,
} from "@/lib/topics/admin";

import {
  createTopicGuidanceVersion,
  deleteTopicGuidanceVersionSafely,
  topicGuidanceChanged,
} from "@/lib/topics/guidance-history";

import {
  getTopicGuidanceEvidenceRevision,
} from "@/lib/topics/guidance-validation-evidence";

import {
  verifyGuidanceValidationToken,
  type GuidanceValidationClaims,
  type GuidanceValidationDraft,
} from "@/lib/topics/guidance-validation-token";

import {
  consumeGuidanceValidationCertificate,
  releaseGuidanceValidationCertificateSafely,
} from "@/lib/topics/guidance-validation-use";

import {
  getAdminSession,
} from "@/lib/pocketbase/admin";

import {
  getPocketBaseServiceClient,
} from "@/lib/pocketbase/service";

/*
 * ============================================
 * GET
 *
 * Topic Details
 * ============================================
 */

export async function GET(
  _request:
    Request,

  context: {
    params:
      Promise<{
        id:
          string;
      }>;
  }
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
    id,
  } =
    await context.params;

  if (
    !isSafeTopicId(
      id
    )
  ) {
    return apiError(
      requestId,
      400,
      "TOPIC_ID_INVALID",
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
      "Topic service unavailable during details",
      {
        requestId,

        adminId:
          admin.account.id,

        topicId:
          id,

        error:
          safeTopicErrorMetadata(
            error
          ),
      }
    );

    return apiError(
      requestId,
      503,
      "TOPIC_SERVICE_UNAVAILABLE",
      "سرویس مدیریت موضوعات موقتاً در دسترس نیست."
    );
  }

  try {
    const topic =
      await pb
        .collection(
          "topics"
        )
        .getOne<TopicRecord>(
          id
        );

    const classifiedMessages =
      await getTopicMessageCount({
        pb,

        topicId:
          id,
      });

    return apiSuccess({
      success:
        true,

      item:
        serializeTopic(
          topic,
          classifiedMessages
        ),

      requestId,
    });
  } catch (error) {
    if (
      getPocketBaseErrorStatus(
        error
      ) ===
      404
    ) {
      return apiError(
        requestId,
        404,
        "TOPIC_NOT_FOUND",
        "موضوع موردنظر پیدا نشد."
      );
    }

    console.error(
      "Topic details failed",
      {
        requestId,

        adminId:
          admin.account.id,

        topicId:
          id,

        error:
          safeTopicErrorMetadata(
            error
          ),
      }
    );

    return apiError(
      requestId,
      500,
      "TOPIC_DETAILS_FAILED",
      "دریافت اطلاعات موضوع ناموفق بود."
    );
  }
}

/*
 * ============================================
 * PATCH
 *
 * Update / Activate / Deactivate
 * ============================================
 */

export async function PATCH(
  request:
    Request,

  context: {
    params:
      Promise<{
        id:
          string;
      }>;
  }
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
    id,
  } =
    await context.params;

  if (
    !isSafeTopicId(
      id
    )
  ) {
    return apiError(
      requestId,
      400,
      "TOPIC_ID_INVALID",
      "شناسه موضوع معتبر نیست."
    );
  }

  const rateLimit =
    await consumeMutationRateLimit({
      adminId:
        admin.account.id,

      requestId,
    });

  if (
    rateLimit instanceof
      Response
  ) {
    return rateLimit;
  }

  let body:
    unknown;

  try {
    body =
      await request.json();
  } catch {
    return apiError(
      requestId,
      400,
      "TOPIC_INVALID_JSON",
      "بدنه JSON درخواست معتبر نیست."
    );
  }

  const {
    topicInput,
    guidanceChangeNote,
    guidanceValidationToken,
  } =
    splitTopicUpdateBody(
      body
    );

  let payload;

  try {
    payload =
      parseTopicUpdateInput(
        topicInput
      );
  } catch (error) {
    if (
      error instanceof
      TopicValidationError
    ) {
      return validationError(
        requestId,
        error
      );
    }

    throw error;
  }

  let pb:
    PocketBase;

  try {
    pb =
      await getPocketBaseServiceClient();
  } catch (error) {
    console.error(
      "Topic service unavailable during update",
      {
        requestId,

        adminId:
          admin.account.id,

        topicId:
          id,

        error:
          safeTopicErrorMetadata(
            error
          ),
      }
    );

    return apiError(
      requestId,
      503,
      "TOPIC_SERVICE_UNAVAILABLE",
      "سرویس مدیریت موضوعات موقتاً در دسترس نیست."
    );
  }

  let existing:
    TopicRecord;

  try {
    existing =
      await pb
        .collection(
          "topics"
        )
        .getOne<TopicRecord>(
          id
        );
  } catch (error) {
    if (
      getPocketBaseErrorStatus(
        error
      ) ===
      404
    ) {
      return apiError(
        requestId,
        404,
        "TOPIC_NOT_FOUND",
        "موضوع موردنظر پیدا نشد."
      );
    }

    console.error(
      "Topic lookup before update failed",
      {
        requestId,

        adminId:
          admin.account.id,

        topicId:
          id,

        error:
          safeTopicErrorMetadata(
            error
          ),
      }
    );

    return apiError(
      requestId,
      500,
      "TOPIC_LOOKUP_FAILED",
      "بررسی موضوع قبل از ویرایش ناموفق بود."
    );
  }

  const guidanceChanged =
    topicGuidanceChanged(
      existing,
      payload
    );

  let guidanceValidationClaims:
    GuidanceValidationClaims |
    null =
      null;

  if (
    guidanceChanged
  ) {
    if (
      !guidanceChangeNote
    ) {
      return apiError(
        requestId,
        400,
        "TOPIC_GUIDANCE_CHANGE_NOTE_REQUIRED",
        "برای تغییر Guidance ثبت دلیل تغییر الزامی است.",
        {
          field:
            "guidance_change_note",
        }
      );
    }

    const finalGuidance =
      buildFinalGuidanceDraft({
        existing,

        payload,
      });

    let baselineState;

    try {
      baselineState =
        await getGuidanceValidationBaselineState({
          pb,

          topicId:
            id,
        });
    } catch (error) {
      console.error(
        "Guidance validation baseline freshness lookup failed",
        {
          requestId,

          adminId:
            admin.account.id,

          topicId:
            id,

          error:
            safeTopicErrorMetadata(
              error
            ),
        }
      );

      return apiError(
        requestId,
        503,
        "TOPIC_GUIDANCE_VALIDATION_BASELINE_UNAVAILABLE",
        "بررسی نسخه Shared Baseline موقتاً در دسترس نیست."
      );
    }

    let evidenceRevision;

    try {
      evidenceRevision =
        await getTopicGuidanceEvidenceRevision({
          pb,

          topicId:
            id,
        });
    } catch (error) {
      console.error(
        "Guidance validation evidence freshness lookup failed",
        {
          requestId,

          adminId:
            admin.account.id,

          topicId:
            id,

          error:
            safeTopicErrorMetadata(
              error
            ),
        }
      );

      return apiError(
        requestId,
        503,
        "TOPIC_GUIDANCE_VALIDATION_EVIDENCE_UNAVAILABLE",
        "بررسی تازگی Human Review موقتاً در دسترس نیست."
      );
    }

    let verification;

    try {
      verification =
        verifyGuidanceValidationToken({
          token:
            guidanceValidationToken,

          adminId:
            admin.account.id,

          topicId:
            id,

          topicUpdated:
            String(
              existing.updated ||
                ""
            ),

          baselineId:
            baselineState.id,

          baselineUpdated:
            baselineState.updated,

          evidenceRevision,

          draft:
            finalGuidance,
        });
    } catch (error) {
      console.error(
        "Guidance validation certificate verification unavailable",
        {
          requestId,

          adminId:
            admin.account.id,

          topicId:
            id,

          error:
            safeTopicErrorMetadata(
              error
            ),
        }
      );

      return apiError(
        requestId,
        503,
        "TOPIC_GUIDANCE_VALIDATION_SERVICE_UNAVAILABLE",
        "بررسی گواهی Validation موقتاً در دسترس نیست."
      );
    }

    if (
      !verification.ok
    ) {
      await recordAuditLog({
        action:
          "topic.update",

        result:
          "blocked",

        actorId:
          admin.account.id,

        actorRole:
          "admin",

        entityType:
          "topic",

        entityId:
          id,

        requestId,

        request,

        errorCode:
          verification.code,

        metadata: {
          guidance_change:
            true,

          validation_present:
            Boolean(
              guidanceValidationToken
            ),
        },
      });

      return apiError(
        requestId,
        409,
        verification.code,
        verification.message,
        {
          field:
            "guidance_validation",
        }
      );
    }

    guidanceValidationClaims =
      verification.claims;
  }

  let guidanceBackupId =
    "";

  let guidanceValidationUseId =
    "";

  try {
    if (
      payload.code &&
      payload.code !==
        String(
          existing.code ||
            ""
        )
          .trim()
          .toLowerCase() &&
      await topicCodeExists({
        pb,

        code:
          payload.code,

        excludeId:
          id,
      })
    ) {
      return apiError(
        requestId,
        409,
        "TOPIC_CODE_EXISTS",
        "موضوع دیگری با این کد وجود دارد.",
        {
          field:
            "code",
        }
      );
    }

    if (
      guidanceChanged &&
      guidanceValidationClaims
    ) {
      let consumed;

      try {
        consumed =
          await consumeGuidanceValidationCertificate({
            pb,

            validationId:
              guidanceValidationClaims.jti,

            topicId:
              id,

            adminId:
              admin.account.id,

            requestId,

            expiresAt:
              new Date(
                guidanceValidationClaims
                  .expiresAt *
                  1000
              ).toISOString(),
          });
      } catch (error) {
        console.error(
          "Guidance validation certificate consumption failed",
          {
            requestId,

            adminId:
              admin.account.id,

            topicId:
              id,

            validationId:
              guidanceValidationClaims.jti,

            error:
              safeTopicErrorMetadata(
                error
              ),
          }
        );

        return apiError(
          requestId,
          503,
          "TOPIC_GUIDANCE_VALIDATION_CONSUMPTION_UNAVAILABLE",
          "ثبت مصرف گواهی Validation موقتاً در دسترس نیست."
        );
      }

      if (
        !consumed.ok
      ) {
        await recordAuditLog({
          action:
            "topic.update",

          result:
            "blocked",

          actorId:
            admin.account.id,

          actorRole:
            "admin",

          entityType:
            "topic",

          entityId:
            id,

          requestId,

          request,

          errorCode:
            consumed.code,

          metadata: {
            guidance_change:
              true,

            validation_id:
              guidanceValidationClaims.jti,
          },
        });

        return apiError(
          requestId,
          409,
          consumed.code,
          consumed.message,
          {
            field:
              "guidance_validation",
          }
        );
      }

      guidanceValidationUseId =
        consumed.useId;
    }

    if (
      guidanceChanged
    ) {
      try {
        const backup =
          await createTopicGuidanceVersion({
            pb,

            topic:
              existing,

            actorId:
              admin.account.id,

            source:
              "before_update",

            note:
              guidanceChangeNote ||
              "Automatic backup before guidance update",
          });

        guidanceBackupId =
          backup.id;
      } catch (error) {
        console.error(
          "Topic guidance backup failed",
          {
            requestId,

            adminId:
              admin.account.id,

            topicId:
              id,

            error:
              safeTopicErrorMetadata(
                error
              ),
          }
        );

        if (
          guidanceValidationUseId
        ) {
          await releaseGuidanceValidationCertificateSafely({
            pb,

            useId:
              guidanceValidationUseId,
          });

          guidanceValidationUseId =
            "";
        }

        return apiError(
          requestId,
          503,
          "TOPIC_GUIDANCE_BACKUP_FAILED",
          "پیش از تغییر Guidance امکان ساخت نسخه پشتیبان وجود نداشت؛ تغییرات اعمال نشد."
        );
      }
    }

    const updated =
      await pb
        .collection(
          "topics"
        )
        .update<TopicRecord>(
          id,
          payload
        );

    const classifiedMessages =
      await getTopicMessageCount({
        pb,

        topicId:
          id,
      });

    const changedFields =
      Object.keys(
        payload
      );

    await recordAuditLog({
      action:
        "topic.update",

      result:
        "success",

      actorId:
        admin.account.id,

      actorRole:
        "admin",

      entityType:
        "topic",

      entityId:
        id,

      requestId,

      request,

      metadata: {
        changed_fields:
          changedFields,

        active_before:
          existing.active ===
          true,

        active_after:
          updated.active ===
          true,

        code_before:
          String(
            existing.code ||
              ""
          )
            .trim()
            .slice(
              0,
              80
            ),

        code_after:
          String(
            updated.code ||
              ""
          )
            .trim()
            .slice(
              0,
              80
            ),

        guidance_backup_id:
          guidanceBackupId ||
          null,

        guidance_change_note_length:
          guidanceChangeNote.length,

        guidance_validation_id:
          guidanceValidationClaims
            ?.jti ||
          null,

        guidance_validation_use_id:
          guidanceValidationUseId ||
          null,

        guidance_validation_issued_at:
          guidanceValidationClaims
            ? new Date(
                guidanceValidationClaims
                  .issuedAt *
                  1000
              ).toISOString()
            : null,

        guidance_validation_accuracy:
          guidanceValidationClaims
            ?.metrics
            .accuracy ??
          null,

        guidance_validation_regressed:
          guidanceValidationClaims
            ?.metrics
            .regressed ??
          null,

        guidance_validation_compared:
          guidanceValidationClaims
            ?.metrics
            .compared ??
          null,

        guidance_validation_evidence_revision:
          guidanceValidationClaims
            ?.evidenceRevision ||
          null,
      },
    });

    return apiSuccess({
      success:
        true,

      item:
        serializeTopic(
          updated,
          classifiedMessages
        ),

      requestId,
    });
  } catch (error) {
    if (
      guidanceBackupId
    ) {
      await deleteTopicGuidanceVersionSafely({
        pb,

        id:
          guidanceBackupId,
      });
    }

    if (
      guidanceValidationUseId
    ) {
      await releaseGuidanceValidationCertificateSafely({
        pb,

        useId:
          guidanceValidationUseId,
      });
    }

    console.error(
      "Topic update failed",
      {
        requestId,

        adminId:
          admin.account.id,

        topicId:
          id,

        error:
          safeTopicErrorMetadata(
            error
          ),
      }
    );

    await recordAuditLog({
      action:
        "topic.update",

      result:
        "failure",

      actorId:
        admin.account.id,

      actorRole:
        "admin",

      entityType:
        "topic",

      entityId:
        id,

      requestId,

      request,

      errorCode:
        "TOPIC_UPDATE_FAILED",
    });

    return apiError(
      requestId,
      500,
      "TOPIC_UPDATE_FAILED",
      "ویرایش موضوع ناموفق بود."
    );
  }
}

/*
 * ============================================
 * Rate Limit
 * ============================================
 */

async function consumeMutationRateLimit({
  adminId,
  requestId,
}: {
  adminId:
    string;

  requestId:
    string;
}): Promise<
  true |
  Response
> {
  try {
    const result =
      await consumeAdminRateLimit({
        adminId,

        action:
          "topic.update",

        requestId,
      });

    if (
      !result.allowed
    ) {
      return apiError(
        requestId,
        429,
        result.code,
        "تعداد درخواست‌های مدیریتی بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.",
        {
          retryAfterSeconds:
            result.retryAfterSeconds,
        },
        {
          "Retry-After":
            String(
              result.retryAfterSeconds
            ),
        }
      );
    }

    return true;
  } catch (error) {
    console.error(
      "Topic update rate limit unavailable",
      {
        requestId,

        adminId,

        error:
          safeTopicErrorMetadata(
            error
          ),
      }
    );

    return apiError(
      requestId,
      503,
      "ADMIN_RATE_LIMIT_UNAVAILABLE",
      "کنترل محدودیت درخواست‌های مدیریتی موقتاً در دسترس نیست."
    );
  }
}

/*
 * ============================================
 * Responses
 * ============================================
 */

/*
 * ============================================
 * Guidance Change Note
 *
 * guidance_change_note بخشی از Schema اصلی Topic
 * نیست. قبل از parseTopicUpdateInput جدا می‌شود
 * تا Parser فعلی و Compatibility آن دست‌نخورده
 * بماند.
 * ============================================
 */

async function getGuidanceValidationBaselineState({
  pb,
  topicId,
}: {
  pb:
    PocketBase;

  topicId:
    string;
}) {
  try {
    const record =
      await pb
        .collection(
          "topic_validation_baselines"
        )
        .getFirstListItem(
          pb.filter(
            "topic = {:topicId}",
            {
              topicId,
            }
          ),
          {
            fields:
              "id,updated",
          }
        );

    return {
      id:
        record.id,

      updated:
        String(
          record.updated ||
            ""
        ),
    };
  } catch (error) {
    if (
      typeof error ===
        "object" &&
      error !==
        null &&
      "status" in
        error &&
      (
        error as {
          status?:
            unknown;
        }
      ).status ===
        404
    ) {
      return {
        id:
          "",

        updated:
          "",
      };
    }

    throw error;
  }
}

function buildFinalGuidanceDraft({
  existing,
  payload,
}: {
  existing:
    TopicRecord;

  payload: {
    keywords?:
      string;

    examples?:
      string;

    negative_examples?:
      string;

    classification_note?:
      string;
  };
}):
  GuidanceValidationDraft {
  return {
    keywords:
      payload.keywords !==
      undefined
        ? payload.keywords
        : String(
            existing.keywords ||
              ""
          ),

    examples:
      payload.examples !==
      undefined
        ? payload.examples
        : String(
            existing.examples ||
              ""
          ),

    negativeExamples:
      payload.negative_examples !==
      undefined
        ? payload.negative_examples
        : String(
            existing.negative_examples ||
              ""
          ),

    classificationNote:
      payload.classification_note !==
      undefined
        ? payload.classification_note
        : String(
            existing.classification_note ||
              ""
          ),
  };
}

function splitTopicUpdateBody(
  value:
    unknown
) {
  if (
    typeof value !==
      "object" ||
    value ===
      null ||
    Array.isArray(
      value
    )
  ) {
    return {
      topicInput:
        value,

      guidanceChangeNote:
        "",

      guidanceValidationToken:
        "",
    };
  }

  const source =
    value as
      Record<
        string,
        unknown
      >;

  const {
    guidance_change_note:
      rawGuidanceChangeNote,

    guidance_validation_token:
      rawGuidanceValidationToken,

    ...topicInput
  } =
    source;

  return {
    topicInput,

    guidanceChangeNote:
      typeof rawGuidanceChangeNote ===
        "string"
        ? rawGuidanceChangeNote
            .replace(
              /\r\n?/g,
              "\n"
            )
            .trim()
            .slice(
              0,
              500
            )
        : "",

    guidanceValidationToken:
      typeof rawGuidanceValidationToken ===
        "string"
        ? rawGuidanceValidationToken
            .trim()
            .slice(
              0,
              8_000
            )
        : "",
  };
}

function validationError(
  requestId:
    string,

  error:
    TopicValidationError
) {
  return apiError(
    requestId,
    400,
    error.code,
    error.message,
    error.field
      ? {
          field:
            error.field,
        }
      : undefined
  );
}

function apiSuccess(
  body:
    unknown,

  status =
    200
) {
  return Response.json(
    body,
    {
      status,

      headers: {
        "Cache-Control":
          "no-store",
      },
    }
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
    string,

  extra?:
    Record<
      string,
      unknown
    >,

  headers?:
    Record<
      string,
      string
    >
) {
  return Response.json(
    {
      success:
        false,

      code,

      message,

      requestId,

      ...(extra ||
        {}),
    },
    {
      status,

      headers: {
        "Cache-Control":
          "no-store",

        ...(headers ||
          {}),
      },
    }
  );
}
