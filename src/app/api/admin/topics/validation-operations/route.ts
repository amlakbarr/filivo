import type PocketBase from "pocketbase";

import {
  getAdminSession,
} from "@/lib/pocketbase/admin";

import {
  getPocketBaseServiceClient,
} from "@/lib/pocketbase/service";

const COLLECTIONS = {
  topics:
    "topics",

  baselines:
    "topic_validation_baselines",

  validationUses:
    "topic_guidance_validation_uses",

  guidanceVersions:
    "topic_guidance_versions",
} as const;

type CollectionCheck = {
  available:
    boolean;

  total:
    number;

  errorCode:
    string |
    null;
};

/*
 * ============================================
 * GET
 *
 * Read-only operational health for the Topic
 * Guidance validation infrastructure.
 *
 * Secrets are NEVER returned; only boolean
 * configuration state is exposed.
 * ============================================
 */

export async function GET() {
  const requestId =
    crypto.randomUUID();

  const admin =
    await getAdminSession();

  if (
    !admin.ok
  ) {
    return Response.json(
      {
        success:
          false,

        code:
          admin.code,

        message:
          admin.message,

        requestId,
      },
      {
        status:
          admin.status,

        headers: {
          "Cache-Control":
            "no-store",

          "X-Request-Id":
            requestId,
        },
      }
    );
  }

  let pb:
    PocketBase;

  try {
    pb =
      await getPocketBaseServiceClient();
  } catch (error) {
    console.error(
      "Validation operations health service unavailable",
      {
        requestId,

        adminId:
          admin.account.id,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return apiError(
      requestId,
      503,
      "VALIDATION_OPERATIONS_SERVICE_UNAVAILABLE",
      "سرویس بررسی سلامت Validation موقتاً در دسترس نیست."
    );
  }

  const now =
    new Date();

  const nowIso =
    now.toISOString();

  const [
    topics,
    activeTopics,
    baselines,
    validationUses,
    activeUses,
    expiredUses,
    guidanceVersions,
    latestUse,
    latestBaseline,
    oldestExpiredUse,
  ] =
    await Promise.all([
      collectionCount({
        pb,

        collection:
          COLLECTIONS.topics,
      }),

      collectionCount({
        pb,

        collection:
          COLLECTIONS.topics,

        filter:
          "active = true",
      }),

      collectionCount({
        pb,

        collection:
          COLLECTIONS.baselines,
      }),

      collectionCount({
        pb,

        collection:
          COLLECTIONS.validationUses,
      }),

      collectionCount({
        pb,

        collection:
          COLLECTIONS.validationUses,

        filter:
          pb.filter(
            "expires_at > {:now}",
            {
              now:
                nowIso,
            }
          ),
      }),

      collectionCount({
        pb,

        collection:
          COLLECTIONS.validationUses,

        filter:
          pb.filter(
            "expires_at <= {:now}",
            {
              now:
                nowIso,
            }
          ),
      }),

      collectionCount({
        pb,

        collection:
          COLLECTIONS.guidanceVersions,
      }),

      latestRecordDate({
        pb,

        collection:
          COLLECTIONS.validationUses,

        sort:
          "-used_at",

        dateField:
          "used_at",
      }),

      latestRecordDate({
        pb,

        collection:
          COLLECTIONS.baselines,

        sort:
          "-saved_at",

        dateField:
          "saved_at",
      }),

      latestRecordDate({
        pb,

        collection:
          COLLECTIONS.validationUses,

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

        dateField:
          "expires_at",
      }),
    ]);

  const guidanceSecretConfigured =
    String(
      process.env
        .GUIDANCE_VALIDATION_TOKEN_SECRET ||
        ""
    ).trim().length >=
      32;

  const cronSecretConfigured =
    String(
      process.env
        .CRON_SECRET ||
        ""
    ).trim().length >=
      24;

  const activeTopicCount =
    activeTopics.available
      ? activeTopics.total
      : 0;

  const baselineCount =
    baselines.available
      ? baselines.total
      : 0;

  const baselineCoverage =
    activeTopicCount >
    0
      ? Math.min(
          1,
          baselineCount /
            activeTopicCount
        )
      : 0;

  const expiredCount =
    expiredUses.available
      ? expiredUses.total
      : 0;

  const oldestExpiredAgeHours =
    oldestExpiredUse.value
      ? ageHours(
          oldestExpiredUse.value,
          now
        )
      : null;

  const missingCollections =
    [
      [
        COLLECTIONS.baselines,
        baselines,
      ] as const,

      [
        COLLECTIONS.validationUses,
        validationUses,
      ] as const,

      [
        COLLECTIONS.guidanceVersions,
        guidanceVersions,
      ] as const,
    ]
      .filter(
        (
          [
            ,
            state,
          ]
        ) =>
          !state.available
      )
      .map(
        (
          [
            name,
          ]
        ) =>
          name
      );

  const health =
    buildHealth({
      guidanceSecretConfigured,

      cronSecretConfigured,

      missingCollections,

      expiredCount,

      oldestExpiredAgeHours,
    });

  return Response.json(
    {
      success:
        true,

      health,

      config: {
        guidanceValidationTokenSecret:
          guidanceSecretConfigured,

        cronSecret:
          cronSecretConfigured,

        cleanupPath:
          "/api/cron/topic-guidance-validation-cleanup",

        expectedCleanupSchedule:
          "0 3 * * *",

        expectedCleanupTimezone:
          "UTC",
      },

      collections: {
        topics,

        baselines,

        validationUses,

        guidanceVersions,
      },

      metrics: {
        totalTopics:
          topics.available
            ? topics.total
            : 0,

        activeTopics:
          activeTopicCount,

        sharedBaselines:
          baselineCount,

        baselineCoverage,

        validationUseLocks:
          validationUses.available
            ? validationUses.total
            : 0,

        activeValidationUseLocks:
          activeUses.available
            ? activeUses.total
            : 0,

        expiredValidationUseLocks:
          expiredCount,

        guidanceVersions:
          guidanceVersions.available
            ? guidanceVersions.total
            : 0,

        latestValidationUseAt:
          latestUse.value,

        latestBaselineSavedAt:
          latestBaseline.value,

        oldestExpiredUseAt:
          oldestExpiredUse.value,

        oldestExpiredAgeHours,
      },

      generatedAt:
        nowIso,

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

/*
 * ============================================
 * Health
 * ============================================
 */

function buildHealth({
  guidanceSecretConfigured,
  cronSecretConfigured,
  missingCollections,
  expiredCount,
  oldestExpiredAgeHours,
}: {
  guidanceSecretConfigured:
    boolean;

  cronSecretConfigured:
    boolean;

  missingCollections:
    string[];

  expiredCount:
    number;

  oldestExpiredAgeHours:
    number |
    null;
}) {
  const issues:
    Array<{
      severity:
        "critical" |
        "warning";

      code:
        string;

      message:
        string;
    }> = [];

  if (
    !guidanceSecretConfigured
  ) {
    issues.push({
      severity:
        "critical",

      code:
        "GUIDANCE_VALIDATION_SECRET_MISSING",

      message:
        "GUIDANCE_VALIDATION_TOKEN_SECRET تنظیم نشده یا کوتاه‌تر از حد امن است.",
    });
  }

  if (
    missingCollections.length >
    0
  ) {
    issues.push({
      severity:
        "critical",

      code:
        "VALIDATION_COLLECTION_MISSING",

      message:
        `Collectionهای موردنیاز در دسترس نیستند: ${missingCollections.join(
          ", "
        )}`,
    });
  }

  if (
    !cronSecretConfigured
  ) {
    issues.push({
      severity:
        "warning",

      code:
        "CRON_SECRET_MISSING",

      message:
        "CRON_SECRET تنظیم نشده یا طول آن کافی نیست؛ Cleanup خودکار قابل احراز هویت نخواهد بود.",
    });
  }

  if (
    expiredCount >
      500 ||
    (
      oldestExpiredAgeHours !==
        null &&
      oldestExpiredAgeHours >
        48
    )
  ) {
    issues.push({
      severity:
        "warning",

      code:
        "VALIDATION_CLEANUP_BACKLOG",

      message:
        "رکوردهای منقضی‌شده Validation برای مدت غیرعادی در صف Cleanup باقی مانده‌اند.",
    });
  }

  const critical =
    issues.some(
      (
        issue
      ) =>
        issue.severity ===
        "critical"
    );

  const warning =
    issues.some(
      (
        issue
      ) =>
        issue.severity ===
        "warning"
    );

  return {
    status:
      critical
        ? "critical" as const
        : warning
          ? "warning" as const
          : "healthy" as const,

    issues,
  };
}

/*
 * ============================================
 * PocketBase Inspection Helpers
 * ============================================
 */

async function collectionCount({
  pb,
  collection,
  filter,
}: {
  pb:
    PocketBase;

  collection:
    string;

  filter?:
    string;
}):
  Promise<
    CollectionCheck
  > {
  try {
    const result =
      await pb
        .collection(
          collection
        )
        .getList(
          1,
          1,
          {
            ...(filter
              ? {
                  filter,
                }
              : {}),

            fields:
              "id",
          }
        );

    return {
      available:
        true,

      total:
        result.totalItems,

      errorCode:
        null,
    };
  } catch (error) {
    return {
      available:
        false,

      total:
        0,

      errorCode:
        errorCode(
          error
        ),
    };
  }
}

async function latestRecordDate({
  pb,
  collection,
  sort,
  dateField,
  filter,
}: {
  pb:
    PocketBase;

  collection:
    string;

  sort:
    string;

  dateField:
    string;

  filter?:
    string;
}) {
  try {
    const result =
      await pb
        .collection(
          collection
        )
        .getList(
          1,
          1,
          {
            ...(filter
              ? {
                  filter,
                }
              : {}),

            sort,

            fields:
              [
                "id",
                dateField,
              ].join(
                ","
              ),
          }
        );

    const record =
      result.items[0];

    return {
      available:
        true,

      value:
        record
          ? String(
              record[
                dateField
              ] ||
                ""
            )
          : "",
    };
  } catch {
    return {
      available:
        false,

      value:
        "",
    };
  }
}

/*
 * ============================================
 * Generic Helpers
 * ============================================
 */

function ageHours(
  value:
    string,

  now:
    Date
) {
  const date =
    new Date(
      value
    );

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return null;
  }

  return Math.max(
    0,
    (
      now.getTime() -
      date.getTime()
    ) /
      (
        60 *
        60 *
        1_000
      )
  );
}

function errorCode(
  error:
    unknown
) {
  if (
    typeof error !==
      "object" ||
    error ===
      null
  ) {
    return "UNKNOWN";
  }

  const value =
    error as {
      status?:
        unknown;

      code?:
        unknown;
    };

  if (
    typeof value.code ===
      "string" ||
    typeof value.code ===
      "number"
  ) {
    return String(
      value.code
    );
  }

  if (
    typeof value.status ===
      "number"
  ) {
    return String(
      value.status
    );
  }

  return "UNKNOWN";
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
      name:
        "UnknownError",
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
