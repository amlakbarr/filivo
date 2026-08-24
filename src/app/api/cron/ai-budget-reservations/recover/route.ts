import "server-only";

import {
  timingSafeEqual,
} from "node:crypto";

import {
  NextResponse,
} from "next/server";

import {
  recoverAIBudgetReservations,
} from "@/lib/ai/budget-reservation-recovery";

/*
 * ============================================
 * Runtime
 * ============================================
 */

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

/*
 * ============================================
 * Limits
 * ============================================
 */

const DEFAULT_PENDING_LIMIT =
  100;

const DEFAULT_EXPIRED_LIMIT =
  100;

const MIN_BATCH_LIMIT =
  1;

const MAX_BATCH_LIMIT =
  500;

/*
 * ============================================
 * GET
 *
 * Internal / Vercel Cron endpoint.
 *
 * Vercel sends:
 *
 * Authorization: Bearer <CRON_SECRET>
 *
 * This route intentionally has no user/admin
 * session authentication. It is protected only
 * by the dedicated cron secret.
 * ============================================
 */

export async function GET(
  request:
    Request
) {
  const requestId =
    crypto.randomUUID();

  /*
   * ==========================================
   * Cron Authentication
   * ==========================================
   */

  const cronSecret =
    String(
      process.env
        .CRON_SECRET ||
        ""
    );

  if (
    !cronSecret
  ) {
    console.error(
      "AI budget reservation recovery cron secret is missing",
      {
        requestId,
      }
    );

    return apiResponse(
      {
        success:
          false,

        code:
          "CRON_SECRET_NOT_CONFIGURED",

        message:
          "Cron authentication is not configured.",
      },
      503,
      requestId
    );
  }

  const authorization =
    String(
      request.headers.get(
        "authorization"
      ) ||
        ""
    );

  const expected =
    `Bearer ${cronSecret}`;

  if (
    !safeStringEqual(
      authorization,
      expected
    )
  ) {
    return apiResponse(
      {
        success:
          false,

        code:
          "UNAUTHORIZED",

        message:
          "Unauthorized.",
      },
      401,
      requestId
    );
  }

  /*
   * ==========================================
   * Recovery
   * ==========================================
   */

  const pendingLimit =
    environmentInteger(
      process.env
        .AI_BUDGET_RECOVERY_PENDING_LIMIT,
      MIN_BATCH_LIMIT,
      MAX_BATCH_LIMIT,
      DEFAULT_PENDING_LIMIT
    );

  const expiredLimit =
    environmentInteger(
      process.env
        .AI_BUDGET_RECOVERY_EXPIRED_LIMIT,
      MIN_BATCH_LIMIT,
      MAX_BATCH_LIMIT,
      DEFAULT_EXPIRED_LIMIT
    );

  try {
    const result =
      await recoverAIBudgetReservations({
        pendingLimit,

        expiredLimit,
      });

    if (
      result.failed >
      0
    ) {
      console.error(
        "AI budget reservation recovery completed with failures",
        {
          requestId,

          scanned:
            result.scanned,

          completed:
            result.completed,

          expired:
            result.expired,

          unchanged:
            result.unchanged,

          failed:
            result.failed,

          /*
           * Request IDs are intentionally omitted
           * from this summary log.
           */
          failureMessages:
            result.failures
              .slice(
                0,
                10
              )
              .map(
                (
                  failure
                ) =>
                  String(
                    failure.message ||
                      ""
                  )
                    .trim()
                    .slice(
                      0,
                      200
                    )
              ),
        }
      );
    }

    return apiResponse(
      {
        success:
          result.failed ===
          0,

        partial:
          result.failed >
          0,

        recovery: {
          scanned:
            result.scanned,

          scannedPending:
            result.scannedPending,

          scannedExpired:
            result.scannedExpired,

          completed:
            result.completed,

          expired:
            result.expired,

          unchanged:
            result.unchanged,

          failed:
            result.failed,
        },
      },
      200,
      requestId
    );
  } catch (error) {
    console.error(
      "AI budget reservation recovery cron failed",
      {
        requestId,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return apiResponse(
      {
        success:
          false,

        code:
          "AI_BUDGET_RESERVATION_RECOVERY_FAILED",

        message:
          "AI budget reservation recovery failed.",
      },
      503,
      requestId
    );
  }
}

/*
 * ============================================
 * Response
 * ============================================
 */

function apiResponse(
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
        "Cache-Control":
          "no-store",

        "Pragma":
          "no-cache",

        "X-Request-Id":
          requestId,

        "X-Content-Type-Options":
          "nosniff",
      },
    }
  );
}

/*
 * ============================================
 * Constant-time Secret Comparison
 * ============================================
 */

function safeStringEqual(
  left:
    string,

  right:
    string
) {
  const leftBuffer =
    Buffer.from(
      left,
      "utf8"
    );

  const rightBuffer =
    Buffer.from(
      right,
      "utf8"
    );

  if (
    leftBuffer.length !==
    rightBuffer.length
  ) {
    return false;
  }

  return timingSafeEqual(
    leftBuffer,
    rightBuffer
  );
}

/*
 * ============================================
 * Environment Integer
 * ============================================
 */

function environmentInteger(
  value:
    string |
    undefined,

  minimum:
    number,

  maximum:
    number,

  fallback:
    number
) {
  const parsed =
    Number(
      value
    );

  if (
    !Number.isInteger(
      parsed
    )
  ) {
    return fallback;
  }

  return Math.min(
    maximum,
    Math.max(
      minimum,
      parsed
    )
  );
}

/*
 * ============================================
 * Safe Error Metadata
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
