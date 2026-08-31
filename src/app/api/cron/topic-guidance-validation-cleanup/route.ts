import {
  timingSafeEqual,
} from "node:crypto";

import type PocketBase from "pocketbase";

import {
  recordAuditLog,
} from "@/lib/audit/log";

import {
  cleanupExpiredGuidanceValidationUses,
} from "@/lib/topics/guidance-validation-use";

import {
  getPocketBaseServiceClient,
} from "@/lib/pocketbase/service";

const DEFAULT_LIMIT =
  200;

const MAX_LIMIT =
  500;

/*
 * ============================================
 * GET / POST
 *
 * Protected maintenance endpoint.
 *
 * Authorization:
 * Authorization: Bearer <CRON_SECRET>
 *
 * It only removes expired replay-lock rows from
 * topic_guidance_validation_uses.
 *
 * Audit logs are not deleted.
 * ============================================
 */

export async function GET(
  request:
    Request
) {
  return cleanup(
    request
  );
}

export async function POST(
  request:
    Request
) {
  return cleanup(
    request
  );
}

async function cleanup(
  request:
    Request
) {
  const requestId =
    crypto.randomUUID();

  if (
    !isAuthorized(
      request
    )
  ) {
    return Response.json(
      {
        success:
          false,

        code:
          "UNAUTHORIZED",

        message:
          "Unauthorized.",

        requestId,
      },
      {
        status:
          401,

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
      "Guidance validation cleanup service unavailable",
      {
        requestId,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return Response.json(
      {
        success:
          false,

        code:
          "GUIDANCE_VALIDATION_CLEANUP_SERVICE_UNAVAILABLE",

        message:
          "Cleanup service unavailable.",

        requestId,
      },
      {
        status:
          503,

        headers: {
          "Cache-Control":
            "no-store",

          "X-Request-Id":
            requestId,
        },
      }
    );
  }

  const url =
    new URL(
      request.url
    );

  const limit =
    parseLimit(
      url.searchParams.get(
        "limit"
      )
    );

  try {
    const result =
      await cleanupExpiredGuidanceValidationUses({
        pb,

        limit,
      });

    await recordAuditLog({
      action:
        "system.topic_guidance_validation_uses_cleanup",

      result:
        result.failed >
        0
          ? "failure"
          : "success",

      actorRole:
        "system",

      entityType:
        "topic_guidance_validation_uses",

      requestId,

      request,

      metadata: {
        matched:
          result.matched,

        deleted:
          result.deleted,

        already_gone:
          result.alreadyGone,

        failed:
          result.failed,

        has_more:
          result.hasMore,

        cutoff:
          result.cutoff,
      },
    });

    return Response.json(
      {
        success:
          true,

        status:
          result.failed >
            0
            ? "partial"
            : "complete",

        ...result,

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
      "Guidance validation cleanup failed",
      {
        requestId,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    await recordAuditLog({
      action:
        "system.topic_guidance_validation_uses_cleanup",

      result:
        "failure",

      actorRole:
        "system",

      entityType:
        "topic_guidance_validation_uses",

      requestId,

      request,

      errorCode:
        "GUIDANCE_VALIDATION_CLEANUP_FAILED",
    });

    return Response.json(
      {
        success:
          false,

        code:
          "GUIDANCE_VALIDATION_CLEANUP_FAILED",

        message:
          "Cleanup failed.",

        requestId,
      },
      {
        status:
          503,

        headers: {
          "Cache-Control":
            "no-store",

          "X-Request-Id":
            requestId,
        },
      }
    );
  }
}

/*
 * ============================================
 * Authorization
 * ============================================
 */

function isAuthorized(
  request:
    Request
) {
  const expected =
    String(
      process.env
        .CRON_SECRET ||
        ""
    ).trim();

  if (
    expected.length <
    24
  ) {
    return false;
  }

  const authorization =
    String(
      request.headers.get(
        "authorization"
      ) ||
        ""
    ).trim();

  const prefix =
    "Bearer ";

  if (
    !authorization.startsWith(
      prefix
    )
  ) {
    return false;
  }

  const provided =
    authorization
      .slice(
        prefix.length
      )
      .trim();

  return safeEqual(
    provided,
    expected
  );
}

function safeEqual(
  first:
    string,

  second:
    string
) {
  const firstBuffer =
    Buffer.from(
      first,
      "utf8"
    );

  const secondBuffer =
    Buffer.from(
      second,
      "utf8"
    );

  if (
    firstBuffer.length !==
    secondBuffer.length
  ) {
    return false;
  }

  try {
    return timingSafeEqual(
      firstBuffer,
      secondBuffer
    );
  } catch {
    return false;
  }
}

/*
 * ============================================
 * Helpers
 * ============================================
 */

function parseLimit(
  value:
    string |
    null
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
    return DEFAULT_LIMIT;
  }

  return Math.max(
    1,
    Math.min(
      MAX_LIMIT,
      Math.trunc(
        number
      )
    )
  );
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
