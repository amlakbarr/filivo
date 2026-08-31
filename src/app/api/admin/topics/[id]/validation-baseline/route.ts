import type PocketBase from "pocketbase";

import {
  recordAuditLog,
} from "@/lib/audit/log";

import {
  consumeAdminRateLimit,
} from "@/lib/admin/rate-limit";

import {
  isSafeTopicId,
  safeTopicErrorMetadata,
} from "@/lib/topics/admin";

import {
  getAdminSession,
} from "@/lib/pocketbase/admin";

import {
  getPocketBaseServiceClient,
} from "@/lib/pocketbase/service";

const COLLECTION =
  "topic_validation_baselines";

const MAX_ENTRIES =
  8;

const RECORD_ID_PATTERN =
  /^[a-zA-Z0-9_-]{1,64}$/;

type Context = {
  params:
    Promise<{
      id:
        string;
    }>;
};

type BaselineEntry = {
  evidenceId:
    string;

  expectedTopicId:
    string |
    null;

  expectedStatus:
    "classified" |
    "unclassified";

  passed:
    boolean;

  resultStatus:
    "classified" |
    "unclassified";

  topicId:
    string |
    null;

  suggestedTopicId:
    string |
    null;

  confidence:
    number;
};

/*
 * ============================================
 * GET
 *
 * Shared baseline for one Topic.
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
    !isSafeTopicId(
      topicId
    )
  ) {
    return apiError(
      requestId,
      400,
      "TOPIC_VALIDATION_BASELINE_INVALID_TOPIC",
      "شناسه موضوع معتبر نیست."
    );
  }

  let pb:
    PocketBase;

  try {
    pb =
      await getPocketBaseServiceClient();
  } catch (error) {
    return serviceUnavailable(
      requestId,
      error
    );
  }

  try {
    const record =
      await findBaseline(
        pb,
        topicId
      );

    return Response.json(
      {
        success:
          true,

        baseline:
          record
            ? serializeBaseline(
                record
              )
            : null,

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
      "Topic validation baseline load failed",
      {
        requestId,

        adminId:
          admin.account.id,

        topicId,

        error:
          safeTopicErrorMetadata(
            error
          ),
      }
    );

    return apiError(
      requestId,
      503,
      "TOPIC_VALIDATION_BASELINE_LOAD_FAILED",
      "دریافت Baseline Validation ناموفق بود."
    );
  }
}

/*
 * ============================================
 * PUT
 *
 * Create or replace the shared baseline.
 * ============================================
 */

export async function PUT(
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
  } =
    await params;

  if (
    !isSafeTopicId(
      topicId
    )
  ) {
    return apiError(
      requestId,
      400,
      "TOPIC_VALIDATION_BASELINE_INVALID_TOPIC",
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
      "TOPIC_VALIDATION_BASELINE_INVALID_JSON",
      "بدنه JSON معتبر نیست."
    );
  }

  const parsed =
    parseBaselineBody(
      body
    );

  if (
    !parsed.ok
  ) {
    return apiError(
      requestId,
      400,
      parsed.code,
      parsed.message
    );
  }

  let pb:
    PocketBase;

  try {
    pb =
      await getPocketBaseServiceClient();
  } catch (error) {
    return serviceUnavailable(
      requestId,
      error
    );
  }

  /*
   * Topic باید واقعاً وجود داشته باشد.
   */
  try {
    await pb
      .collection(
        "topics"
      )
      .getOne(
        topicId,
        {
          fields:
            "id",
        }
      );
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
        "TOPIC_VALIDATION_BASELINE_TOPIC_NOT_FOUND",
        "موضوع موردنظر پیدا نشد."
      );
    }

    return apiError(
      requestId,
      503,
      "TOPIC_VALIDATION_BASELINE_TOPIC_LOOKUP_FAILED",
      "بررسی موضوع ناموفق بود."
    );
  }

  const savedAt =
    new Date()
      .toISOString();

  try {
    const existing =
      await findBaseline(
        pb,
        topicId
      );

    const payload = {
      topic:
        topicId,

      baseline:
        {
          version:
            1,

          entries:
            parsed.entries,
        },

      saved_by:
        admin.account.id,

      saved_at:
        savedAt,
    };

    const record =
      existing
        ? await pb
            .collection(
              COLLECTION
            )
            .update(
              existing.id,
              payload
            )
        : await pb
            .collection(
              COLLECTION
            )
            .create(
              payload
            );

    await recordAuditLog({
      action:
        "topic.validation_baseline.save",

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
        baseline_id:
          record.id,

        entry_count:
          parsed.entries.length,

        replaced:
          Boolean(
            existing
          ),

        saved_at:
          savedAt,
      },
    });

    return Response.json(
      {
        success:
          true,

        baseline:
          serializeBaseline(
            record
          ),

        requestId,
      },
      {
        status:
          existing
            ? 200
            : 201,

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
      "Topic validation baseline save failed",
      {
        requestId,

        adminId:
          admin.account.id,

        topicId,

        error:
          safeTopicErrorMetadata(
            error
          ),
      }
    );

    await recordAuditLog({
      action:
        "topic.validation_baseline.save",

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
        "TOPIC_VALIDATION_BASELINE_SAVE_FAILED",
    });

    return apiError(
      requestId,
      503,
      "TOPIC_VALIDATION_BASELINE_SAVE_FAILED",
      "ذخیره Baseline Validation ناموفق بود."
    );
  }
}

/*
 * ============================================
 * DELETE
 * ============================================
 */

export async function DELETE(
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
  } =
    await params;

  if (
    !isSafeTopicId(
      topicId
    )
  ) {
    return apiError(
      requestId,
      400,
      "TOPIC_VALIDATION_BASELINE_INVALID_TOPIC",
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

  let pb:
    PocketBase;

  try {
    pb =
      await getPocketBaseServiceClient();
  } catch (error) {
    return serviceUnavailable(
      requestId,
      error
    );
  }

  try {
    const existing =
      await findBaseline(
        pb,
        topicId
      );

    if (
      !existing
    ) {
      return Response.json(
        {
          success:
            true,

          deleted:
            false,

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

    await pb
      .collection(
        COLLECTION
      )
      .delete(
        existing.id
      );

    await recordAuditLog({
      action:
        "topic.validation_baseline.delete",

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
        baseline_id:
          existing.id,
      },
    });

    return Response.json(
      {
        success:
          true,

        deleted:
          true,

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
      "Topic validation baseline delete failed",
      {
        requestId,

        adminId:
          admin.account.id,

        topicId,

        error:
          safeTopicErrorMetadata(
            error
          ),
      }
    );

    return apiError(
      requestId,
      503,
      "TOPIC_VALIDATION_BASELINE_DELETE_FAILED",
      "حذف Baseline Validation ناموفق بود."
    );
  }
}

/*
 * ============================================
 * Database Helpers
 * ============================================
 */

async function findBaseline(
  pb:
    PocketBase,

  topicId:
    string
) {
  try {
    return await pb
      .collection(
        COLLECTION
      )
      .getFirstListItem(
        pb.filter(
          "topic = {:topicId}",
          {
            topicId,
          }
        ),
        {
          expand:
            "saved_by",
        }
      );
  } catch (error) {
    if (
      getStatus(
        error
      ) ===
      404
    ) {
      return null;
    }

    throw error;
  }
}

function serializeBaseline(
  record:
    Record<
      string,
      unknown
    > & {
      id:
        string;

      expand?:
        Record<
          string,
          unknown
        >;
    }
) {
  const baseline =
    record.baseline as
      | {
          version?:
            unknown;

          entries?:
            unknown;
        }
      | undefined;

  const entries =
    Array.isArray(
      baseline?.entries
    )
      ? baseline.entries
          .map(
            parseBaselineEntry
          )
          .filter(
            (
              item
            ): item is BaselineEntry =>
              item !==
              null
          )
          .slice(
            0,
            MAX_ENTRIES
          )
      : [];

  const savedBy =
    extractExpandedSavedBy(
      record
    );

  return {
    id:
      record.id,

    version:
      1 as const,

    topicId:
      cleanId(
        record.topic
      ),

    savedAt:
      String(
        record.saved_at ||
          record.updated ||
          ""
      ),

    savedBy: {
      id:
        cleanId(
          record.saved_by
        ),

      name:
        cleanText(
          savedBy?.name,
          160
        ),
    },

    entries,
  };
}

function extractExpandedSavedBy(
  record:
    Record<
      string,
      unknown
    > & {
      expand?:
        Record<
          string,
          unknown
        >;
    }
) {
  const value =
    record.expand?.[
      "saved_by"
    ];

  if (
    Array.isArray(
      value
    )
  ) {
    return (
      value[0] as
        | Record<
            string,
            unknown
          >
        | undefined
    );
  }

  return value as
    | Record<
        string,
        unknown
      >
    | undefined;
}

/*
 * ============================================
 * Validation
 * ============================================
 */

function parseBaselineBody(
  value:
    unknown
):
  | {
      ok:
        true;

      entries:
        BaselineEntry[];
    }
  | {
      ok:
        false;

      code:
        string;

      message:
        string;
    } {
  if (
    typeof value !==
      "object" ||
    value ===
      null ||
    Array.isArray(
      value
    )
  ) {
    return invalidBody();
  }

  const source =
    value as {
      entries?:
        unknown;
    };

  if (
    !Array.isArray(
      source.entries
    ) ||
    source.entries.length <
      1 ||
    source.entries.length >
      MAX_ENTRIES
  ) {
    return {
      ok:
        false,

      code:
        "TOPIC_VALIDATION_BASELINE_ENTRIES_INVALID",

      message:
        `Baseline باید بین ۱ تا ${MAX_ENTRIES} نتیجه معتبر داشته باشد.`,
    };
  }

  const entries:
    BaselineEntry[] = [];

  const seen =
    new Set<
      string
    >();

  for (
    const raw of
    source.entries
  ) {
    const entry =
      parseBaselineEntry(
        raw
      );

    if (
      !entry
    ) {
      return invalidBody();
    }

    if (
      seen.has(
        entry.evidenceId
      )
    ) {
      continue;
    }

    seen.add(
      entry.evidenceId
    );

    entries.push(
      entry
    );
  }

  if (
    entries.length ===
    0
  ) {
    return invalidBody();
  }

  return {
    ok:
      true,

    entries,
  };
}

function parseBaselineEntry(
  value:
    unknown
):
  | BaselineEntry
  | null {
  if (
    typeof value !==
      "object" ||
    value ===
      null ||
    Array.isArray(
      value
    )
  ) {
    return null;
  }

  const item =
    value as
      Record<
        string,
        unknown
      >;

  const evidenceId =
    cleanId(
      item.evidenceId
    );

  if (
    !evidenceId
  ) {
    return null;
  }

  const expectedStatus =
    item.expectedStatus ===
      "unclassified"
      ? "unclassified"
      : item.expectedStatus ===
          "classified"
        ? "classified"
        : null;

  const resultStatus =
    item.resultStatus ===
      "unclassified"
      ? "unclassified"
      : item.resultStatus ===
          "classified"
        ? "classified"
        : null;

  if (
    !expectedStatus ||
    !resultStatus ||
    typeof item.passed !==
      "boolean"
  ) {
    return null;
  }

  const expectedTopicId =
    nullableId(
      item.expectedTopicId
    );

  const topicId =
    nullableId(
      item.topicId
    );

  const suggestedTopicId =
    nullableId(
      item.suggestedTopicId
    );

  if (
    expectedStatus ===
      "classified" &&
    !expectedTopicId
  ) {
    return null;
  }

  return {
    evidenceId,

    expectedTopicId,

    expectedStatus,

    passed:
      item.passed,

    resultStatus,

    topicId,

    suggestedTopicId,

    confidence:
      clampConfidence(
        item.confidence
      ),
  };
}

function invalidBody() {
  return {
    ok:
      false as const,

    code:
      "TOPIC_VALIDATION_BASELINE_INVALID_BODY",

    message:
      "ساختار Baseline Validation معتبر نیست.",
  };
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

        /*
         * Baseline یک Mutation مرتبط با Topic است
         * و از Budget موجود topic.update استفاده می‌کند.
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

/*
 * ============================================
 * Generic Helpers
 * ============================================
 */

function nullableId(
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
    return null;
  }

  return cleanId(
    value
  ) ||
    null;
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

  return RECORD_ID_PATTERN.test(
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
    .trim()
    .slice(
      0,
      maxLength
    );
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

function serviceUnavailable(
  requestId:
    string,

  error:
    unknown
) {
  console.error(
    "Topic validation baseline service unavailable",
    {
      requestId,

      error:
        safeTopicErrorMetadata(
          error
        ),
    }
  );

  return apiError(
    requestId,
    503,
    "TOPIC_VALIDATION_BASELINE_SERVICE_UNAVAILABLE",
    "سرویس Baseline Validation موقتاً در دسترس نیست."
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

        "X-Request-Id":
          requestId,

        ...(headers ||
          {}),
      },
    }
  );
}
