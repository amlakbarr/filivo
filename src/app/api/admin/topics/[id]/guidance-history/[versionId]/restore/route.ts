import type PocketBase from "pocketbase";

import {
  recordAuditLog,
} from "@/lib/audit/log";

import {
  consumeAdminRateLimit,
} from "@/lib/admin/rate-limit";

import {
  getTopicMessageCount,
  isSafeTopicId,
  safeTopicErrorMetadata,
  serializeTopic,
  type TopicRecord,
} from "@/lib/topics/admin";

import {
  TOPIC_GUIDANCE_VERSION_COLLECTION,
  createTopicGuidanceVersion,
  deleteTopicGuidanceVersionSafely,
  guidancePayloadFromSnapshot,
  guidanceSnapshotFromVersion,
} from "@/lib/topics/guidance-history";

import {
  getAdminSession,
} from "@/lib/pocketbase/admin";

import {
  getPocketBaseServiceClient,
} from "@/lib/pocketbase/service";

const RECORD_ID_PATTERN =
  /^[a-zA-Z0-9_-]{1,64}$/;

type Context = {
  params:
    Promise<{
      id:
        string;

      versionId:
        string;
    }>;
};

/*
 * ============================================
 * POST
 *
 * Restore one previous Guidance snapshot.
 *
 * Before Restore, current Guidance is itself
 * snapshotted, so Rollback is reversible.
 * ============================================
 */

export async function POST(
  request:
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

    versionId,
  } =
    await params;

  if (
    !isSafeTopicId(
      topicId
    ) ||
    !RECORD_ID_PATTERN.test(
      versionId
    )
  ) {
    return apiError(
      requestId,
      400,
      "TOPIC_GUIDANCE_RESTORE_INVALID_ID",
      "شناسه موضوع یا نسخه معتبر نیست."
    );
  }

  const rateLimit =
    await consumeRestoreRateLimit({
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

  let pb:
    PocketBase;

  try {
    pb =
      await getPocketBaseServiceClient();
  } catch (error) {
    return apiError(
      requestId,
      503,
      "TOPIC_SERVICE_UNAVAILABLE",
      "سرویس مدیریت موضوعات موقتاً در دسترس نیست."
    );
  }

  let current:
    TopicRecord;

  let version;

  try {
    [
      current,
      version,
    ] =
      await Promise.all([
        pb
          .collection(
            "topics"
          )
          .getOne<TopicRecord>(
            topicId
          ),

        pb
          .collection(
            TOPIC_GUIDANCE_VERSION_COLLECTION
          )
          .getOne(
            versionId
          ),
      ]);
  } catch (error) {
    if (
      getStatus(
        error
      ) ===
      404
    ) {
      return apiError(
        requestId,
        404,
        "TOPIC_GUIDANCE_VERSION_NOT_FOUND",
        "موضوع یا نسخه Guidance پیدا نشد."
      );
    }

    console.error(
      "Topic guidance restore lookup failed",
      {
        requestId,

        adminId:
          admin.account.id,

        topicId,

        versionId,

        error:
          safeTopicErrorMetadata(
            error
          ),
      }
    );

    return apiError(
      requestId,
      503,
      "TOPIC_GUIDANCE_RESTORE_LOOKUP_FAILED",
      "دریافت نسخه Guidance ناموفق بود."
    );
  }

  if (
    String(
      version.topic ||
        ""
    ) !==
    topicId
  ) {
    return apiError(
      requestId,
      409,
      "TOPIC_GUIDANCE_VERSION_MISMATCH",
      "این نسخه متعلق به موضوع دیگری است."
    );
  }

  let backupId =
    "";

  try {
    const backup =
      await createTopicGuidanceVersion({
        pb,

        topic:
          current,

        actorId:
          admin.account.id,

        source:
          "before_restore",

        note:
          `Automatic backup before restore ${versionId}`,
      });

    backupId =
      backup.id;
  } catch (error) {
    console.error(
      "Topic guidance pre-restore backup failed",
      {
        requestId,

        adminId:
          admin.account.id,

        topicId,

        versionId,

        error:
          safeTopicErrorMetadata(
            error
          ),
      }
    );

    return apiError(
      requestId,
      503,
      "TOPIC_GUIDANCE_RESTORE_BACKUP_FAILED",
      "قبل از Rollback امکان ساخت نسخه پشتیبان وجود نداشت؛ تغییری اعمال نشد."
    );
  }

  const snapshot =
    guidanceSnapshotFromVersion(
      version
    );

  let updated:
    TopicRecord;

  try {
    updated =
      await pb
        .collection(
          "topics"
        )
        .update<TopicRecord>(
          topicId,
          guidancePayloadFromSnapshot(
            snapshot
          )
        );
  } catch (error) {
    await deleteTopicGuidanceVersionSafely({
      pb,

      id:
        backupId,
    });

    console.error(
      "Topic guidance restore failed",
      {
        requestId,

        adminId:
          admin.account.id,

        topicId,

        versionId,

        error:
          safeTopicErrorMetadata(
            error
          ),
      }
    );

    await recordAuditLog({
      action:
        "topic.guidance_restore",

      result:
        "failure",

      actorId:
        admin.account.id,

      actorRole:
        "admin",

      entityType:
        "topic",

      entityId:
        topicId,

      requestId,

      request,

      errorCode:
        "TOPIC_GUIDANCE_RESTORE_FAILED",

      metadata: {
        version_id:
          versionId,
      },
    });

    return apiError(
      requestId,
      503,
      "TOPIC_GUIDANCE_RESTORE_FAILED",
      "بازگردانی نسخه Guidance ناموفق بود."
    );
  }

  const classifiedMessages =
    await getTopicMessageCount({
      pb,

      topicId,
    });

  await recordAuditLog({
    action:
      "topic.guidance_restore",

    result:
      "success",

    actorId:
      admin.account.id,

    actorRole:
      "admin",

    entityType:
      "topic",

    entityId:
      topicId,

    requestId,

    request,

    metadata: {
      restored_version_id:
        versionId,

      backup_version_id:
        backupId,

      restored_created:
        String(
          version.created ||
            ""
        ),
    },
  });

  return Response.json(
    {
      success:
        true,

      item:
        serializeTopic(
          updated,
          classifiedMessages
        ),

      restoredVersionId:
        versionId,

      backupVersionId:
        backupId,

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
}

async function consumeRestoreRateLimit({
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

        /*
         * Restore از همان Budget عملیات Update
         * استفاده می‌کند و Action جدید لازم ندارد.
         */
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
    return apiError(
      requestId,
      503,
      "ADMIN_RATE_LIMIT_UNAVAILABLE",
      "کنترل محدودیت درخواست‌های مدیریتی موقتاً در دسترس نیست."
    );
  }
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

        "X-Request-Id":
          requestId,

        ...(headers ||
          {}),
      },
    }
  );
}
