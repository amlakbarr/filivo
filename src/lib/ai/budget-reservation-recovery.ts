import "server-only";

import type PocketBase from "pocketbase";

import type {
  RecordModel,
} from "pocketbase";

import {
  completeAIBudgetReservation,
  expireAIBudgetReservation,
} from "@/lib/ai/budget-reservation";

import {
  getPocketBaseServiceClient,
} from "@/lib/pocketbase/service";

/*
 * ============================================
 * Purpose
 *
 * Recovery برای دو Failure Window:
 *
 * 1) ai_usage ثبت شده ولی Reservation هنوز
 *    pending/expired است.
 *    → Reservation به completed تبدیل می‌شود.
 *
 * 2) Reservation هنوز pending است، TTL گذشته
 *    و ai_usage متناظر وجود ندارد.
 *    → Reservation به expired تبدیل می‌شود.
 *
 * completed/cancelled هرگز دستکاری نمی‌شوند.
 * ============================================
 */

/*
 * ============================================
 * Types
 * ============================================
 */

type RecoverableReservationRecord =
  RecordModel & {
    user?:
      string;

    conversation?:
      string;

    request_id?:
      string;

    request_type?:
      string;

    status?:
      string;

    expires_at?:
      string;
  };

type AIUsageRecoveryRecord =
  RecordModel & {
    user?:
      string;

    conversation?:
      string;

    request_type?:
      string;

    reservation_request_id?:
      string;

    total_tokens?:
      number;

    estimated_cost_usd?:
      number;

    cost_available?:
      boolean;
  };

export type AIBudgetReservationRecoveryFailure = {
  reservationId:
    string;

  requestId:
    string;

  message:
    string;
};

export type AIBudgetReservationRecoveryResult = {
  scanned:
    number;

  scannedPending:
    number;

  scannedExpired:
    number;

  completed:
    number;

  expired:
    number;

  unchanged:
    number;

  failed:
    number;

  failures:
    AIBudgetReservationRecoveryFailure[];
};

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
 * Main Recovery
 * ============================================
 */

export async function recoverAIBudgetReservations({
  pendingLimit,
  expiredLimit,
}: {
  pendingLimit?:
    number;

  expiredLimit?:
    number;
} = {}): Promise<AIBudgetReservationRecoveryResult> {
  const pb =
    await getPocketBaseServiceClient();

  const safePendingLimit =
    normalizeBatchLimit(
      pendingLimit,
      DEFAULT_PENDING_LIMIT
    );

  const safeExpiredLimit =
    normalizeBatchLimit(
      expiredLimit,
      DEFAULT_EXPIRED_LIMIT
    );

  /*
   * Snapshot هر دو Queue قبل از Mutation گرفته
   * می‌شود تا یک pending که در همین Run expired
   * شد دوباره در expired batch همان Run پردازش
   * نشود.
   */

  const [
    pendingResult,
    expiredResult,
  ] =
    await Promise.all([
      pb
        .collection(
          "ai_usage_reservations"
        )
        .getList<RecoverableReservationRecord>(
          1,
          safePendingLimit,
          {
            filter:
              'status = "pending"',

            /*
             * نزدیک‌ترین Expiry اول.
             */
            sort:
              "expires_at,created",

            fields:
              [
                "id",
                "user",
                "conversation",
                "request_id",
                "request_type",
                "status",
                "expires_at",
                "created",
                "updated",
              ].join(
                ","
              ),
          }
        ),

      pb
        .collection(
          "ai_usage_reservations"
        )
        .getList<RecoverableReservationRecord>(
          1,
          safeExpiredLimit,
          {
            filter:
              'status = "expired"',

            /*
             * Late Accounting معمولاً برای
             * Reservationهای تازه‌تر رخ می‌دهد.
             */
            sort:
              "-updated",

            fields:
              [
                "id",
                "user",
                "conversation",
                "request_id",
                "request_type",
                "status",
                "expires_at",
                "created",
                "updated",
              ].join(
                ","
              ),
          }
        ),
    ]);

  const pendingRecords =
    pendingResult.items;

  const expiredRecords =
    expiredResult.items;

  const result:
    AIBudgetReservationRecoveryResult = {
    scanned:
      pendingRecords.length +
      expiredRecords.length,

    scannedPending:
      pendingRecords.length,

    scannedExpired:
      expiredRecords.length,

    completed:
      0,

    expired:
      0,

    unchanged:
      0,

    failed:
      0,

    failures:
      [],
  };

  /*
   * ==========================================
   * Pending
   * ==========================================
   */

  for (
    const reservation of
    pendingRecords
  ) {
    try {
      const outcome =
        await recoverOneReservation({
          pb,

          reservation,

          allowExpiry:
            true,
        });

      incrementOutcome(
        result,
        outcome
      );
    } catch (error) {
      addFailure(
        result,
        reservation,
        error
      );
    }
  }

  /*
   * ==========================================
   * Expired
   *
   * فقط Late Usage Recovery انجام می‌شود.
   * Expired بدون Usage دست‌نخورده می‌ماند.
   * ==========================================
   */

  for (
    const reservation of
    expiredRecords
  ) {
    try {
      const outcome =
        await recoverOneReservation({
          pb,

          reservation,

          allowExpiry:
            false,
        });

      incrementOutcome(
        result,
        outcome
      );
    } catch (error) {
      addFailure(
        result,
        reservation,
        error
      );
    }
  }

  return result;
}

/*
 * ============================================
 * One Reservation
 * ============================================
 */

async function recoverOneReservation({
  pb,
  reservation,
  allowExpiry,
}: {
  pb:
    PocketBase;

  reservation:
    RecoverableReservationRecord;

  allowExpiry:
    boolean;
}): Promise<
  | "completed"
  | "expired"
  | "unchanged"
> {
  const reservationId =
    String(
      reservation.id ||
        ""
    ).trim();

  const userId =
    String(
      reservation.user ||
        ""
    ).trim();

  const conversationId =
    String(
      reservation.conversation ||
        ""
    ).trim();

  const requestId =
    String(
      reservation.request_id ||
        ""
    ).trim();

  const requestType =
    normalizeRequestType(
      reservation.request_type
    );

  if (
    !reservationId ||
    !userId ||
    !conversationId ||
    !requestId ||
    !requestType
  ) {
    throw new Error(
      "Recoverable AI budget reservation has invalid identity fields"
    );
  }

  /*
   * ==========================================
   * Usage Lookup
   * ==========================================
   */

  const usage =
    await findUsageByReservationRequestId(
      pb,
      requestId
    );

  if (
    usage
  ) {
    validateUsageMatchesReservation({
      usage,

      userId,

      conversationId,

      requestId,

      requestType,
    });

    const actualTokens =
      readNonNegativeInteger(
        usage.total_tokens,
        "AI usage total_tokens is invalid"
      );

    const actualCostUsd =
      readActualCost(
        usage
      );

    await completeAIBudgetReservation({
      userId,

      requestId,

      actualTokens,

      actualCostUsd,

      usageRecordId:
        usage.id,
    });

    return "completed";
  }

  /*
   * ==========================================
   * No Usage
   * ==========================================
   */

  if (
    !allowExpiry
  ) {
    return "unchanged";
  }

  /*
   * فقط pendingی که TTL آن واقعاً گذشته باشد
   * Expire می‌شود. خود API نیز این شرط را دوباره
   * enforce می‌کند.
   */

  const expiresAt =
    parseDate(
      reservation.expires_at
    );

  if (
    expiresAt &&
    expiresAt.getTime() >
      Date.now()
  ) {
    return "unchanged";
  }

  const expired =
    await expireAIBudgetReservation({
      userId,

      requestId,

      errorCode:
        "RESERVATION_EXPIRED_RECOVERY",
    });

  return expired.expired
    ? "expired"
    : "unchanged";
}

/*
 * ============================================
 * AI Usage Lookup
 *
 * حداکثر دو Record می‌گیریم تا Duplicate
 * reservation_request_id را تشخیص دهیم.
 * ============================================
 */

async function findUsageByReservationRequestId(
  pb:
    PocketBase,

  requestId:
    string
): Promise<
  AIUsageRecoveryRecord |
  null
> {
  const result =
    await pb
      .collection(
        "ai_usage"
      )
      .getList<AIUsageRecoveryRecord>(
        1,
        2,
        {
          filter:
            pb.filter(
              "reservation_request_id = {:requestId}",
              {
                requestId,
              }
            ),

          sort:
            "created",

          fields:
            [
              "id",
              "user",
              "conversation",
              "request_type",
              "reservation_request_id",
              "total_tokens",
              "estimated_cost_usd",
              "cost_available",
              "created",
            ].join(
              ","
            ),
        }
      );

  if (
    result.items.length >
    1
  ) {
    throw new Error(
      "Multiple AI usage records reference the same reservation request id"
    );
  }

  return (
    result.items[0] ||
    null
  );
}

/*
 * ============================================
 * Cross-record Validation
 *
 * reservation_request_id به‌تنهایی کافی نیست.
 * User / Conversation / Request Type نیز باید
 * با Reservation تطبیق داشته باشند.
 * ============================================
 */

function validateUsageMatchesReservation({
  usage,
  userId,
  conversationId,
  requestId,
  requestType,
}: {
  usage:
    AIUsageRecoveryRecord;

  userId:
    string;

  conversationId:
    string;

  requestId:
    string;

  requestType:
    "chat" |
    "classification";
}) {
  if (
    String(
      usage.reservation_request_id ||
        ""
    ) !==
    requestId
  ) {
    throw new Error(
      "AI usage reservation request id mismatch"
    );
  }

  if (
    String(
      usage.user ||
        ""
    ) !==
    userId
  ) {
    throw new Error(
      "AI usage user does not match budget reservation"
    );
  }

  if (
    String(
      usage.conversation ||
        ""
    ) !==
    conversationId
  ) {
    throw new Error(
      "AI usage conversation does not match budget reservation"
    );
  }

  if (
    String(
      usage.request_type ||
        ""
    ) !==
    requestType
  ) {
    throw new Error(
      "AI usage request type does not match budget reservation"
    );
  }
}

/*
 * ============================================
 * Cost
 * ============================================
 */

function readActualCost(
  usage:
    AIUsageRecoveryRecord
): number |
  null {
  if (
    usage.cost_available !==
    true
  ) {
    return null;
  }

  const value =
    Number(
      usage.estimated_cost_usd
    );

  if (
    !Number.isFinite(
      value
    ) ||
    value <
      0
  ) {
    throw new Error(
      "AI usage cost is marked available but estimated_cost_usd is invalid"
    );
  }

  return value;
}

/*
 * ============================================
 * Outcome
 * ============================================
 */

function incrementOutcome(
  result:
    AIBudgetReservationRecoveryResult,

  outcome:
    | "completed"
    | "expired"
    | "unchanged"
) {
  if (
    outcome ===
    "completed"
  ) {
    result.completed +=
      1;

    return;
  }

  if (
    outcome ===
    "expired"
  ) {
    result.expired +=
      1;

    return;
  }

  result.unchanged +=
    1;
}

/*
 * ============================================
 * Failure
 * ============================================
 */

function addFailure(
  result:
    AIBudgetReservationRecoveryResult,

  reservation:
    RecoverableReservationRecord,

  error:
    unknown
) {
  result.failed +=
    1;

  result.failures.push({
    reservationId:
      String(
        reservation.id ||
          ""
      ),

    requestId:
      String(
        reservation.request_id ||
          ""
      ),

    message:
      getErrorMessage(
        error
      ),
  });
}

/*
 * ============================================
 * Request Type
 * ============================================
 */

function normalizeRequestType(
  value:
    unknown
) {
  if (
    value ===
    "chat" ||
    value ===
    "classification"
  ) {
    return value;
  }

  return null;
}

/*
 * ============================================
 * Batch Limit
 * ============================================
 */

function normalizeBatchLimit(
  value:
    number |
    undefined,

  fallback:
    number
) {
  if (
    !Number.isInteger(
      value
    )
  ) {
    return fallback;
  }

  return Math.min(
    MAX_BATCH_LIMIT,
    Math.max(
      MIN_BATCH_LIMIT,
      Number(
        value
      )
    )
  );
}

/*
 * ============================================
 * Number
 * ============================================
 */

function readNonNegativeInteger(
  value:
    unknown,

  errorMessage:
    string
) {
  const number =
    Number(
      value
    );

  if (
    !Number.isFinite(
      number
    ) ||
    number <
      0 ||
    !Number.isInteger(
      number
    )
  ) {
    throw new Error(
      errorMessage
    );
  }

  return number;
}

/*
 * ============================================
 * Date
 * ============================================
 */

function parseDate(
  value:
    unknown
) {
  if (
    typeof value !==
      "string" ||
    !value
  ) {
    return null;
  }

  const date =
    new Date(
      value
    );

  return Number.isNaN(
    date.getTime()
  )
    ? null
    : date;
}

/*
 * ============================================
 * Error
 * ============================================
 */

function getErrorMessage(
  error:
    unknown
) {
  if (
    typeof error ===
      "object" &&
    error !==
      null &&
    "message" in
      error &&
    typeof (
      error as {
        message?:
          unknown;
      }
    ).message ===
      "string"
  ) {
    return String(
      (
        error as {
          message:
            string;
        }
      ).message
    )
      .trim()
      .slice(
        0,
        300
      );
  }

  return String(
    error
  )
    .trim()
    .slice(
      0,
      300
    );
}
