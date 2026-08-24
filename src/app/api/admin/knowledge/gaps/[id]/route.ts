import type PocketBase from "pocketbase";

import type {
  RecordModel,
} from "pocketbase";

import {
  NextResponse,
} from "next/server";

import {
  consumeAdminRateLimit,
} from "@/lib/admin/rate-limit";

import {
  recordAuditLog,
} from "@/lib/audit/log";

import {
  getAdminSession,
} from "@/lib/pocketbase/admin";

import {
  getPocketBaseServiceClient,
} from "@/lib/pocketbase/service";

/*
 * ============================================
 * Types
 * ============================================
 */

type Context = {
  params: Promise<{
    id: string;
  }>;
};

type AllowedStatus =
  | "open"
  | "in_progress"
  | "ignored";

type KnownGapStatus =
  | AllowedStatus
  | "resolved"
  | "unknown";

type ExistingGap =
  RecordModel & {
    title?:
      unknown;

    status?:
      unknown;

    ignore_note?:
      unknown;

    resolution_note?:
      unknown;

    resolved_knowledge_item?:
      unknown;

    resolved_by?:
      unknown;

    resolved_at?:
      unknown;
  };

type ParsedPayload =
  | {
      success:
        true;

      status:
        AllowedStatus;

      note:
        string;
    }
  | {
      success:
        false;

      code:
        string;

      message:
        string;

      fieldErrors?:
        Record<
          string,
          string
        >;
    };

type AllowedRateLimit = {
  allowed:
    true;

  limit:
    number;

  remaining:
    number;

  resetAt:
    string;
};

/*
 * ============================================
 * Limits
 * ============================================
 */

const MAX_REQUEST_BODY_BYTES =
  8 * 1024;

const MAX_NOTE_LENGTH =
  2000;

const RECORD_ID_PATTERN =
  /^[a-zA-Z0-9_-]{1,64}$/;

const ALLOWED_BODY_FIELDS =
  new Set([
    "status",
    "note",
  ]);

/*
 * ============================================
 * PATCH
 *
 * Knowledge Gap Status Update
 *
 * Rate Limit:
 *
 * knowledge_gap.update
 * 20 requests / minute / admin
 * ============================================
 */

export async function PATCH(
  request: Request,
  {
    params,
  }: Context
) {
  const requestId =
    crypto.randomUUID();

  /*
   * ==========================================
   * Admin Authorization
   * ==========================================
   */

  const admin =
    await getAdminSession();

  if (
    !admin.ok
  ) {
    return jsonResponse(
      {
        success:
          false,

        code:
          admin.code,

        message:
          admin.message,
      },
      admin.status,
      requestId
    );
  }

  /*
   * ==========================================
   * Gap ID
   * ==========================================
   */

  const {
    id: rawGapId,
  } = await params;

  const gapId =
    cleanRecordId(
      rawGapId
    );

  if (
    !gapId
  ) {
    return jsonResponse(
      {
        success:
          false,

        code:
          "INVALID_GAP_ID",

        message:
          "شناسه Knowledge Gap معتبر نیست.",
      },
      400,
      requestId
    );
  }

  /*
   * ==========================================
   * Admin Rate Limit
   *
   * knowledge_gap.update
   *
   * 20 requests / minute / admin
   *
   * Gap ID بخشی از Bucket نیست؛ بنابراین
   * تغییر Gap مقصد باعث دور زدن Limit نمی‌شود.
   *
   * Fail-closed:
   * اگر Rate Limiter در دسترس نباشد هیچ
   * Mutation انجام نمی‌شود.
   * ==========================================
   */

  let rateLimit:
    Awaited<
      ReturnType<
        typeof consumeAdminRateLimit
      >
    >;

  try {
    rateLimit =
      await consumeAdminRateLimit({
        adminId:
          admin.account.id,

        action:
          "knowledge_gap.update",

        requestId,
      });
  } catch (error) {
    console.error(
      "Admin knowledge gap update rate limit unavailable",
      {
        requestId,

        adminId:
          admin.account.id,

        gapId,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return jsonResponse(
      {
        success:
          false,

        code:
          "ADMIN_RATE_LIMIT_UNAVAILABLE",

        message:
          "سرویس کنترل تعداد درخواست‌ها موقتاً در دسترس نیست.",
      },
      503,
      requestId
    );
  }

  /*
   * ==========================================
   * Rate Limited
   * ==========================================
   */

  if (
    !rateLimit.allowed
  ) {
    return rateLimitedResponse(
      requestId,
      rateLimit
    );
  }

  const allowedRateLimit:
    AllowedRateLimit =
    rateLimit;

  /*
   * تمام Responseهای بعد از Consume باید
   * Headerهای Rate Limit را داشته باشند.
   */

  const respond =
    <TResponse extends Response>(
      response:
        TResponse
    ) =>
      withRateLimitHeaders(
        response,
        allowedRateLimit
      );

  /*
   * ==========================================
   * Content Type
   * ==========================================
   */

  const contentType =
    String(
      request.headers.get(
        "content-type"
      ) ||
        ""
    )
      .split(";")[0]
      .trim()
      .toLowerCase();

  if (
    contentType !==
    "application/json"
  ) {
    return respond(
      jsonResponse(
        {
          success:
            false,

          code:
            "UNSUPPORTED_MEDIA_TYPE",

          message:
            "نوع محتوای درخواست معتبر نیست.",
        },
        415,
        requestId
      )
    );
  }

  /*
   * ==========================================
   * Content-Length Fast Reject
   * ==========================================
   */

  const rawContentLength =
    request.headers.get(
      "content-length"
    );

  if (
    rawContentLength
  ) {
    const contentLength =
      Number(
        rawContentLength
      );

    if (
      !Number.isSafeInteger(
        contentLength
      ) ||
      contentLength <
        0
    ) {
      return respond(
        jsonResponse(
          {
            success:
              false,

            code:
              "INVALID_CONTENT_LENGTH",

            message:
              "حجم درخواست معتبر نیست.",
          },
          400,
          requestId
        )
      );
    }

    if (
      contentLength >
      MAX_REQUEST_BODY_BYTES
    ) {
      return respond(
        jsonResponse(
          {
            success:
              false,

            code:
              "REQUEST_BODY_TOO_LARGE",

            message:
              "حجم درخواست بیش از حد مجاز است.",
          },
          413,
          requestId
        )
      );
    }
  }

  /*
   * ==========================================
   * Bounded JSON Body
   * ==========================================
   */

  const bodyResult =
    await readJsonBodyWithLimit(
      request,
      MAX_REQUEST_BODY_BYTES
    );

  if (
    !bodyResult.ok
  ) {
    return respond(
      jsonResponse(
        {
          success:
            false,

          code:
            bodyResult.code,

          message:
            bodyResult.message,
        },
        bodyResult.status,
        requestId
      )
    );
  }

  /*
   * ==========================================
   * Strict Payload
   * ==========================================
   */

  const parsed =
    parsePayload(
      bodyResult.body
    );

  if (
    !parsed.success
  ) {
    return respond(
      jsonResponse(
        {
          success:
            false,

          code:
            parsed.code,

          message:
            parsed.message,

          ...(parsed.fieldErrors
            ? {
                fieldErrors:
                  parsed.fieldErrors,
              }
            : {}),
        },
        400,
        requestId
      )
    );
  }

  const {
    status,
    note,
  } = parsed;

  /*
   * ==========================================
   * Service Client
   * ==========================================
   */

  let pb:
    PocketBase;

  try {
    pb =
      await getPocketBaseServiceClient();
  } catch (error) {
    console.error(
      "Knowledge gap service unavailable",
      {
        requestId,

        adminId:
          admin.account.id,

        gapId,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return respond(
      jsonResponse(
        {
          success:
            false,

          code:
            "KNOWLEDGE_SERVICE_UNAVAILABLE",

          message:
            "سرویس پایگاه دانش موقتاً در دسترس نیست.",
        },
        503,
        requestId
      )
    );
  }

  /*
   * ==========================================
   * Load Existing Gap
   * ==========================================
   */

  let existing:
    ExistingGap;

  try {
    existing =
      await pb
        .collection(
          "knowledge_gaps"
        )
        .getOne<ExistingGap>(
          gapId,
          {
            fields:
              [
                "id",
                "title",
                "status",
                "ignore_note",
                "resolution_note",
                "resolved_knowledge_item",
                "resolved_by",
                "resolved_at",
              ].join(
                ","
              ),
          }
        );
  } catch (error) {
    const errorStatus =
      getErrorStatus(
        error
      );

    if (
      errorStatus ===
      404
    ) {
      return respond(
        jsonResponse(
          {
            success:
              false,

            code:
              "KNOWLEDGE_GAP_NOT_FOUND",

            message:
              "Knowledge Gap پیدا نشد.",
          },
          404,
          requestId
        )
      );
    }

    console.error(
      "Knowledge gap lookup failed",
      {
        requestId,

        adminId:
          admin.account.id,

        gapId,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return respond(
      jsonResponse(
        {
          success:
            false,

          code:
            "KNOWLEDGE_GAP_LOAD_FAILED",

          message:
            "در بررسی Knowledge Gap خطایی رخ داد.",
        },
        503,
        requestId
      )
    );
  }

  /*
   * ==========================================
   * Existing State
   * ==========================================
   */

  const previousStatus =
    normalizeExistingStatus(
      existing.status
    );

  const previousIgnoreNote =
    cleanStoredNote(
      existing.ignore_note
    );

  const gapTitle =
    cleanAuditText(
      existing.title,
      200
    );

  /*
   * ==========================================
   * Resolved State Guard
   *
   * Gap حل‌شده قبل از ignored/in_progress
   * باید دوباره Open شود.
   * ==========================================
   */

  if (
    previousStatus ===
      "resolved" &&
    status !==
      "open"
  ) {
    const auditAction =
      getAuditAction(
        status
      );

    await safeAudit({
      request,

      requestId,

      actorId:
        admin.account.id,

      gapId,

      action:
        auditAction,

      result:
        "blocked",

      errorCode:
        "RESOLVED_GAP_REOPEN_REQUIRED",

      metadata: {
        title:
          gapTitle,

        previous_status:
          previousStatus,

        requested_status:
          status,

        reason:
          "resolved_gap_must_be_reopened_first",
      },
    });

    return respond(
      jsonResponse(
        {
          success:
            false,

          code:
            "RESOLVED_GAP_REOPEN_REQUIRED",

          message:
            "Knowledge Gap حل‌شده باید ابتدا دوباره باز شود.",
        },
        409,
        requestId
      )
    );
  }

  /*
   * ==========================================
   * No-op
   *
   * Rate Limit همچنان Consume شده است.
   * ==========================================
   */

  const sameStatus =
    previousStatus ===
    status;

  const sameIgnoreNote =
    status !==
      "ignored" ||
    previousIgnoreNote ===
      note;

  if (
    sameStatus &&
    sameIgnoreNote
  ) {
    return respond(
      jsonResponse(
        {
          success:
            true,

          unchanged:
            true,

          gap: {
            id:
              existing.id,

            status:
              previousStatus,

            ignoreNote:
              previousIgnoreNote,
          },

          message:
            "وضعیت Knowledge Gap تغییری نکرد.",
        },
        200,
        requestId
      )
    );
  }

  /*
   * ==========================================
   * Audit Action
   * ==========================================
   */

  const auditAction =
    getAuditAction(
      status
    );

  /*
   * ==========================================
   * Update Data
   * ==========================================
   */

  const updateData:
    Record<
      string,
      unknown
    > = {
      status,
    };

  /*
   * ==========================================
   * Ignored
   * ==========================================
   */

  if (
    status ===
    "ignored"
  ) {
    updateData.ignore_note =
      note;

    updateData.resolution_note =
      "";
  }

  /*
   * ==========================================
   * In Progress
   * ==========================================
   */

  if (
    status ===
    "in_progress"
  ) {
    updateData.ignore_note =
      "";
  }

  /*
   * ==========================================
   * Open / Reopen
   * ==========================================
   */

  if (
    status ===
    "open"
  ) {
    updateData.ignore_note =
      "";

    /*
     * Reopen یک Gap حل‌شده باید Resolution
     * Metadata قبلی را پاک کند.
     */
    if (
      previousStatus ===
      "resolved"
    ) {
      updateData.resolution_note =
        "";

      updateData.resolved_knowledge_item =
        "";

      updateData.resolved_by =
        "";

      updateData.resolved_at =
        "";
    }
  }

  /*
   * ==========================================
   * Update
   * ==========================================
   */

  let updated:
    ExistingGap;

  try {
    updated =
      await pb
        .collection(
          "knowledge_gaps"
        )
        .update<ExistingGap>(
          gapId,
          updateData
        );
  } catch (error) {
    const errorStatus =
      getErrorStatus(
        error
      );

    await safeAudit({
      request,

      requestId,

      actorId:
        admin.account.id,

      gapId,

      action:
        auditAction,

      result:
        "failure",

      errorCode:
        errorStatus ===
        404
          ? "KNOWLEDGE_GAP_NOT_FOUND"
          : "KNOWLEDGE_GAP_UPDATE_FAILED",

      metadata: {
        title:
          gapTitle,

        previous_status:
          previousStatus,

        requested_status:
          status,

        ...(status ===
        "ignored"
          ? {
              ignore_note:
                note,
            }
          : {}),

        upstream_status:
          errorStatus ||
          null,
      },
    });

    console.error(
      "Knowledge gap update failed",
      {
        requestId,

        adminId:
          admin.account.id,

        gapId,

        requestedStatus:
          status,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    if (
      errorStatus ===
      404
    ) {
      return respond(
        jsonResponse(
          {
            success:
              false,

            code:
              "KNOWLEDGE_GAP_NOT_FOUND",

            message:
              "Knowledge Gap پیدا نشد.",
          },
          404,
          requestId
        )
      );
    }

    return respond(
      jsonResponse(
        {
          success:
            false,

          code:
            "KNOWLEDGE_GAP_UPDATE_FAILED",

          message:
            "تغییر وضعیت انجام نشد.",
        },
        503,
        requestId
      )
    );
  }

  /*
   * ==========================================
   * Audit Success
   * ==========================================
   */

  await safeAudit({
    request,

    requestId,

    actorId:
      admin.account.id,

    gapId,

    action:
      auditAction,

    result:
      "success",

    metadata: {
      title:
        gapTitle,

      previous_status:
        previousStatus,

      new_status:
        status,

      status_changed:
        previousStatus !==
        status,

      ...(status ===
      "ignored"
        ? {
            ignore_note:
              note,
          }
        : {}),

      ...(status ===
      "open"
        ? {
            reopened_from:
              previousStatus,

            resolution_cleared:
              previousStatus ===
              "resolved",
          }
        : {}),
    },
  });

  /*
   * ==========================================
   * Response
   * ==========================================
   */

  return respond(
    jsonResponse(
      {
        success:
          true,

        gap: {
          id:
            updated.id,

          status:
            String(
              updated.status ||
                status
            ),

          ignoreNote:
            String(
              updated.ignore_note ||
                ""
            ),
        },

        message:
          status ===
          "ignored"
            ? "Knowledge Gap نادیده گرفته شد."
            : status ===
                "in_progress"
              ? "Knowledge Gap در حال بررسی قرار گرفت."
              : previousStatus ===
                  "resolved"
                ? "Knowledge Gap دوباره باز شد."
                : "Knowledge Gap باز شد.",
      },
      200,
      requestId
    )
  );
}

/*
 * ============================================
 * Rate Limited Response
 * ============================================
 */

function rateLimitedResponse(
  requestId:
    string,

  rateLimit: {
    allowed:
      false;

    code:
      "ADMIN_RATE_LIMITED";

    limit:
      number;

    remaining:
      0;

    retryAfterSeconds:
      number;

    resetAt:
      string;
  }
) {
  const response =
    jsonResponse(
      {
        success:
          false,

        code:
          "ADMIN_RATE_LIMITED",

        message:
          "تعداد درخواست‌های تغییر وضعیت Knowledge Gap بیش از حد مجاز است.",

        retryAfterSeconds:
          rateLimit.retryAfterSeconds,

        limit:
          rateLimit.limit,

        remaining:
          rateLimit.remaining,

        resetAt:
          rateLimit.resetAt,
      },
      429,
      requestId
    );

  response.headers.set(
    "Retry-After",
    String(
      rateLimit.retryAfterSeconds
    )
  );

  response.headers.set(
    "X-RateLimit-Limit",
    String(
      rateLimit.limit
    )
  );

  response.headers.set(
    "X-RateLimit-Remaining",
    "0"
  );

  response.headers.set(
    "X-RateLimit-Reset",
    rateLimit.resetAt
  );

  return response;
}

/*
 * ============================================
 * Rate Limit Headers
 * ============================================
 */

function withRateLimitHeaders<
  TResponse extends Response,
>(
  response:
    TResponse,

  rateLimit: {
    limit:
      number;

    remaining:
      number;

    resetAt:
      string;
  }
) {
  response.headers.set(
    "X-RateLimit-Limit",
    String(
      rateLimit.limit
    )
  );

  response.headers.set(
    "X-RateLimit-Remaining",
    String(
      rateLimit.remaining
    )
  );

  response.headers.set(
    "X-RateLimit-Reset",
    rateLimit.resetAt
  );

  return response;
}

/*
 * ============================================
 * Strict Payload
 * ============================================
 */

function parsePayload(
  body:
    unknown
): ParsedPayload {
  if (
    typeof body !==
      "object" ||
    body ===
      null ||
    Array.isArray(
      body
    )
  ) {
    return {
      success:
        false,

      code:
        "INVALID_REQUEST",

      message:
        "ساختار درخواست معتبر نیست.",
    };
  }

  const value =
    body as Record<
      string,
      unknown
    >;

  /*
   * ==========================================
   * Unknown Fields
   * ==========================================
   */

  const unknownFields =
    Object.keys(
      value
    ).filter(
      (
        key
      ) =>
        !ALLOWED_BODY_FIELDS.has(
          key
        )
    );

  if (
    unknownFields.length >
    0
  ) {
    return {
      success:
        false,

      code:
        "UNEXPECTED_FIELDS",

      message:
        "فیلدهای ارسالی برای تغییر وضعیت Knowledge Gap معتبر نیستند.",
    };
  }

  /*
   * ==========================================
   * Status
   * ==========================================
   */

  if (
    typeof value.status !==
    "string"
  ) {
    return {
      success:
        false,

      code:
        "INVALID_GAP_STATUS",

      message:
        "وضعیت انتخاب‌شده معتبر نیست.",

      fieldErrors: {
        status:
          "وضعیت انتخاب‌شده معتبر نیست.",
      },
    };
  }

  const rawStatus =
    value.status.trim();

  if (
    rawStatus !==
      "open" &&
    rawStatus !==
      "in_progress" &&
    rawStatus !==
      "ignored"
  ) {
    return {
      success:
        false,

      code:
        "INVALID_GAP_STATUS",

      message:
        "وضعیت انتخاب‌شده معتبر نیست.",

      fieldErrors: {
        status:
          "وضعیت انتخاب‌شده معتبر نیست.",
      },
    };
  }

  const status =
    rawStatus as
      AllowedStatus;

  /*
   * ==========================================
   * Note
   * ==========================================
   */

  if (
    value.note !==
      undefined &&
    typeof value.note !==
      "string"
  ) {
    return {
      success:
        false,

      code:
        "INVALID_GAP_NOTE",

      message:
        "یادداشت واردشده معتبر نیست.",

      fieldErrors: {
        note:
          "یادداشت واردشده معتبر نیست.",
      },
    };
  }

  const rawNote =
    typeof value.note ===
    "string"
      ? value.note
      : "";

  if (
    rawNote.length >
    MAX_NOTE_LENGTH
  ) {
    return {
      success:
        false,

      code:
        "GAP_NOTE_TOO_LONG",

      message:
        "یادداشت نباید بیشتر از ۲۰۰۰ نویسه باشد.",

      fieldErrors: {
        note:
          "یادداشت نباید بیشتر از ۲۰۰۰ نویسه باشد.",
      },
    };
  }

  const note =
    cleanNote(
      rawNote
    );

  return {
    success:
      true,

    status,

    note,
  };
}

/*
 * ============================================
 * Limited JSON Body
 * ============================================
 */

async function readJsonBodyWithLimit(
  request:
    Request,

  maximumBytes:
    number
): Promise<
  | {
      ok:
        true;

      body:
        unknown;
    }
  | {
      ok:
        false;

      status:
        number;

      code:
        string;

      message:
        string;
    }
> {
  if (
    !request.body
  ) {
    return {
      ok:
        false,

      status:
        400,

      code:
        "INVALID_REQUEST",

      message:
        "ساختار درخواست معتبر نیست.",
    };
  }

  const reader =
    request.body
      .getReader();

  const decoder =
    new TextDecoder(
      "utf-8",
      {
        fatal:
          true,
      }
    );

  let totalBytes =
    0;

  let text =
    "";

  try {
    while (
      true
    ) {
      const {
        done,
        value,
      } =
        await reader.read();

      if (
        done
      ) {
        break;
      }

      if (
        !value
      ) {
        continue;
      }

      totalBytes +=
        value.byteLength;

      if (
        totalBytes >
        maximumBytes
      ) {
        try {
          await reader.cancel();
        } catch {
          // Ignore cancel failure.
        }

        return {
          ok:
            false,

          status:
            413,

          code:
            "REQUEST_BODY_TOO_LARGE",

          message:
            "حجم درخواست بیش از حد مجاز است.",
        };
      }

      text +=
        decoder.decode(
          value,
          {
            stream:
              true,
          }
        );
    }

    text +=
      decoder.decode();
  } catch {
    return {
      ok:
        false,

      status:
        400,

      code:
        "INVALID_REQUEST",

      message:
        "ساختار درخواست معتبر نیست.",
    };
  }

  if (
    !text.trim()
  ) {
    return {
      ok:
        false,

      status:
        400,

      code:
        "INVALID_REQUEST",

      message:
        "ساختار درخواست معتبر نیست.",
    };
  }

  try {
    return {
      ok:
        true,

      body:
        JSON.parse(
          text
        ),
    };
  } catch {
    return {
      ok:
        false,

      status:
        400,

      code:
        "INVALID_REQUEST",

      message:
        "ساختار درخواست معتبر نیست.",
    };
  }
}

/*
 * ============================================
 * Audit Action
 * ============================================
 */

function getAuditAction(
  status:
    AllowedStatus
) {
  if (
    status ===
    "in_progress"
  ) {
    return "gap.status.in_progress";
  }

  if (
    status ===
    "ignored"
  ) {
    return "gap.ignore";
  }

  return "gap.reopen";
}

/*
 * ============================================
 * Existing Status
 * ============================================
 */

function normalizeExistingStatus(
  value:
    unknown
): KnownGapStatus {
  if (
    value ===
      "open" ||
    value ===
      "in_progress" ||
    value ===
      "ignored" ||
    value ===
      "resolved"
  ) {
    return value;
  }

  return "unknown";
}

/*
 * ============================================
 * Record ID
 * ============================================
 */

function cleanRecordId(
  value:
    unknown
) {
  if (
    typeof value !==
    "string"
  ) {
    return "";
  }

  const id =
    value.trim();

  return RECORD_ID_PATTERN.test(
    id
  )
    ? id
    : "";
}

/*
 * ============================================
 * Note
 * ============================================
 */

function cleanNote(
  value:
    string
) {
  return value
    .replace(
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,
      ""
    )
    .trim();
}

function cleanStoredNote(
  value:
    unknown
) {
  return cleanNote(
    typeof value ===
    "string"
      ? value
      : ""
  ).slice(
    0,
    MAX_NOTE_LENGTH
  );
}

/*
 * ============================================
 * Audit Text
 * ============================================
 */

function cleanAuditText(
  value:
    unknown,

  maximumLength:
    number
) {
  return String(
    value ||
      ""
  )
    .replace(
      /[\u0000-\u001F\u007F]/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim()
    .slice(
      0,
      maximumLength
    );
}

/*
 * ============================================
 * Safe Audit
 * ============================================
 */

async function safeAudit({
  request,
  requestId,
  actorId,
  gapId,
  action,
  result,
  errorCode,
  metadata,
}: {
  request:
    Request;

  requestId:
    string;

  actorId:
    string;

  gapId:
    string;

  action:
    string;

  result:
    | "success"
    | "failure"
    | "blocked";

  errorCode?:
    string;

  metadata?:
    Record<
      string,
      unknown
    >;
}) {
  try {
    await recordAuditLog({
      request,

      requestId,

      actorId,

      actorRole:
        "admin",

      action,

      result,

      entityType:
        "knowledge_gap",

      entityId:
        gapId,

      ...(errorCode
        ? {
            errorCode,
          }
        : {}),

      ...(metadata
        ? {
            metadata,
          }
        : {}),
    });
  } catch (error) {
    console.error(
      "Knowledge gap audit failed",
      {
        requestId,

        actorId,

        gapId,

        action,

        result,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );
  }
}

/*
 * ============================================
 * JSON Response
 * ============================================
 */

function jsonResponse(
  body:
    Record<
      string,
      unknown
    >,

  status:
    number,

  requestId:
    string
) {
  return NextResponse.json(
    {
      ...body,

      requestId,
    },
    {
      status,

      headers: {
        "X-Request-Id":
          requestId,

        "Cache-Control":
          "private, no-store, no-cache, max-age=0, must-revalidate",

        "Pragma":
          "no-cache",

        "Expires":
          "0",

        "X-Content-Type-Options":
          "nosniff",
      },
    }
  );
}

/*
 * ============================================
 * Error Status
 * ============================================
 */

function getErrorStatus(
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

/*
 * ============================================
 * Safe Error
 * ============================================
 */

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