import "server-only";

import {
  createHash,
} from "node:crypto";

import type PocketBase from "pocketbase";

import type {
  RecordModel,
} from "pocketbase";

import {
  getPocketBaseServiceClient,
} from "@/lib/pocketbase/service";

/*
 * ============================================
 * Types
 * ============================================
 */

export type AIBudgetReservationRequestType =
  | "chat"
  | "classification";

export type AIBudgetReservationStatus =
  | "pending"
  | "completed"
  | "cancelled"
  | "expired";

export type AIBudgetReservation = {
  id:
    string;

  userId:
    string;

  conversationId:
    string;

  requestId:
    string;

  requestType:
    AIBudgetReservationRequestType;

  model:
    string;

  reservedTokens:
    number;

  reservedCostUsd:
    number;

  status:
    AIBudgetReservationStatus;

  expiresAt:
    string;

  actualTokens:
    number;

  actualCostUsd:
    number |
    null;

  usageRecordId:
    string |
    null;

  errorCode:
    string |
    null;

  created:
    string;

  updated:
    string;
};

export type CreateAIBudgetReservationResult = {
  created:
    boolean;

  reservation:
    AIBudgetReservation;
};

export type CompleteAIBudgetReservationResult = {
  completed:
    boolean;

  duplicate:
    boolean;

  reservation:
    AIBudgetReservation;
};

export type CancelAIBudgetReservationResult = {
  cancelled:
    boolean;

  reservation:
    AIBudgetReservation |
    null;
};

export type ExpireAIBudgetReservationResult = {
  expired:
    boolean;

  reservation:
    AIBudgetReservation |
    null;
};

/*
 * ============================================
 * PocketBase Record
 * ============================================
 */

type AIBudgetReservationRecord =
  RecordModel & {
    user?:
      string;

    conversation?:
      string;

    request_id?:
      string;

    request_type?:
      string;

    model?:
      string;

    reserved_tokens?:
      number;

    reserved_cost_usd?:
      number;

    status?:
      string;

    expires_at?:
      string;

    actual_tokens?:
      number;

    actual_cost_usd?:
      number;

    usage_record?:
      string;

    error_code?:
      string;
  };

/*
 * ============================================
 * Validation
 * ============================================
 */

const RECORD_ID_PATTERN =
  /^[a-zA-Z0-9_-]{1,64}$/;

const REQUEST_ID_PATTERN =
  /^[a-zA-Z0-9_-]{1,128}$/;

const MAX_MODEL_LENGTH =
  200;

const MAX_ERROR_CODE_LENGTH =
  120;

/*
 * ============================================
 * Reservation TTL
 *
 * باید از Chat Request Lock کمتر یا مساوی
 * نباشد.
 *
 * Default = 10 minutes
 * ============================================
 */

const DEFAULT_RESERVATION_SECONDS =
  10 *
  60;

const MIN_RESERVATION_SECONDS =
  60;

const MAX_RESERVATION_SECONDS =
  60 *
  60;

/*
 * ============================================
 * Create Reservation
 *
 * Idempotent by request_id.
 *
 * اگر همان Request قبلاً Reservation فعال یا
 * Completed داشته باشد، Record جدید ساخته
 * نمی‌شود.
 *
 * Reservation منقضی یا Cancelled با همان
 * request_id دوباره فعال نمی‌شود؛ Caller باید
 * Request ID جدید بسازد.
 * ============================================
 */

export async function createAIBudgetReservation({
  userId,
  conversationId,
  requestId,
  requestType,
  model,
  reservedTokens,
  reservedCostUsd,
  expiresInSeconds,
}: {
  userId:
    string;

  conversationId:
    string;

  requestId:
    string;

  requestType:
    AIBudgetReservationRequestType;

  model:
    string;

  reservedTokens:
    number;

  reservedCostUsd:
    number;

  expiresInSeconds?:
    number;
}): Promise<CreateAIBudgetReservationResult> {
  /*
   * ==========================================
   * Validate
   * ==========================================
   */

  validateReservationIdentity({
    userId,

    conversationId,

    requestId,

    requestType,

    model,
  });

  const cleanModel =
    normalizeModel(
      model
    );

  const cleanReservedTokens =
    toNonNegativeInteger(
      reservedTokens
    );

  const cleanReservedCostUsd =
    toNonNegativeNumber(
      reservedCostUsd
    );

  /*
   * ==========================================
   * Service Client
   * ==========================================
   */

  const pb =
    await getPocketBaseServiceClient();

  /*
   * ==========================================
   * Deterministic Record ID
   * ==========================================
   */

  const reservationId =
    createReservationRecordId(
      requestId
    );

  /*
   * ==========================================
   * Existing Reservation
   * ==========================================
   */

  const existing =
    await findReservationById(
      pb,
      reservationId,
      requestId
    );

  if (
    existing
  ) {
    validateExistingReservation({
      record:
        existing,

      userId,

      conversationId,

      requestId,

      requestType,

      model:
        cleanModel,

      reservedTokens:
        cleanReservedTokens,

      reservedCostUsd:
        cleanReservedCostUsd,
    });

    const status =
      normalizeStatus(
        existing.status
      );

    /*
     * ========================================
     * Pending
     * ========================================
     */

    if (
      status ===
      "pending"
    ) {
      const expiresAt =
        parseDate(
          existing.expires_at
        );

      if (
        expiresAt &&
        expiresAt.getTime() >
          Date.now()
      ) {
        return {
          created:
            false,

          reservation:
            toReservation(
              existing
            ),
        };
      }

      /*
       * Pending ولی TTL گذشته.
       *
       * آن را Expired می‌کنیم و اجازه Reuse
       * همان request_id را نمی‌دهیم.
       */

      const expired =
        await markReservationExpired(
          pb,
          existing
        );

      throw new AIBudgetReservationStateError(
        "AI budget reservation has expired",
        expired.status
      );
    }

    /*
     * ========================================
     * Completed
     *
     * Idempotent retry.
     * ========================================
     */

    if (
      status ===
      "completed"
    ) {
      return {
        created:
          false,

        reservation:
          toReservation(
            existing
          ),
      };
    }

    /*
     * ========================================
     * Cancelled / Expired
     *
     * همان Request ID دوباره نباید AI Call
     * جدید ایجاد کند.
     * ========================================
     */

    throw new AIBudgetReservationStateError(
      `AI budget reservation cannot be reused from status ${status}`,
      status
    );
  }

  /*
   * ==========================================
   * Expiry
   * ==========================================
   */

  const now =
    new Date();

  const ttlSeconds =
    resolveReservationSeconds(
      expiresInSeconds
    );

  const expiresAt =
    new Date(
      now.getTime() +
        ttlSeconds *
          1000
    );

  /*
   * ==========================================
   * Create
   * ==========================================
   */

  try {
    const record =
      await pb
        .collection(
          "ai_usage_reservations"
        )
        .create<AIBudgetReservationRecord>({
          id:
            reservationId,

          user:
            userId,

          conversation:
            conversationId,

          request_id:
            requestId,

          request_type:
            requestType,

          model:
            cleanModel,

          reserved_tokens:
            cleanReservedTokens,

          reserved_cost_usd:
            cleanReservedCostUsd,

          status:
            "pending",

          expires_at:
            expiresAt.toISOString(),

          actual_tokens:
            0,

          actual_cost_usd:
            0,

          error_code:
            "",
        });

    return {
      created:
        true,

      reservation:
        toReservation(
          record
        ),
    };
  } catch (error) {
    /*
     * ========================================
     * Race Recovery
     *
     * Request دیگری ممکن است همان request_id
     * را چند میلی‌ثانیه زودتر ساخته باشد.
     * ========================================
     */

    const raced =
      await findReservationById(
        pb,
        reservationId,
        requestId
      );

    if (
      !raced
    ) {
      throw error;
    }

    validateExistingReservation({
      record:
        raced,

      userId,

      conversationId,

      requestId,

      requestType,

      model:
        cleanModel,

      reservedTokens:
        cleanReservedTokens,

      reservedCostUsd:
        cleanReservedCostUsd,
    });

    const status =
      normalizeStatus(
        raced.status
      );

    if (
      status !==
        "pending" &&
      status !==
        "completed"
    ) {
      throw new AIBudgetReservationStateError(
        `AI budget reservation race ended in status ${status}`,
        status
      );
    }

    return {
      created:
        false,

      reservation:
        toReservation(
          raced
        ),
    };
  }
}

/*
 * ============================================
 * Complete Reservation
 *
 * Actual Usage حقیقت نهایی است.
 *
 * حتی اگر Reservation به‌علت TTL به expired
 * رسیده باشد ولی OpenAI واقعاً مصرف کرده باشد،
 * Actual Usage باید ثبت شود.
 *
 * Completed دوباره → idempotent.
 * ============================================
 */

export async function completeAIBudgetReservation({
  userId,
  requestId,
  actualTokens,
  actualCostUsd,
  usageRecordId,
}: {
  userId:
    string;

  requestId:
    string;

  actualTokens:
    number;

  actualCostUsd?:
    number |
    null;

  usageRecordId?:
    string |
    null;
}): Promise<CompleteAIBudgetReservationResult> {
  validateUserAndRequest({
    userId,

    requestId,
  });

  const cleanActualTokens =
    toNonNegativeInteger(
      actualTokens
    );

  const cleanActualCostUsd =
    actualCostUsd ===
      null ||
    actualCostUsd ===
      undefined
      ? null
      : toNonNegativeNumber(
          actualCostUsd
        );

  const cleanUsageRecordId =
    usageRecordId
      ? String(
          usageRecordId
        ).trim()
      : "";

  if (
    cleanUsageRecordId &&
    !isSafeRecordId(
      cleanUsageRecordId
    )
  ) {
    throw new Error(
      "Invalid AI usage record id for reservation completion"
    );
  }

  const pb =
    await getPocketBaseServiceClient();

  const reservationId =
    createReservationRecordId(
      requestId
    );

  const existing =
    await findReservationById(
      pb,
      reservationId,
      requestId
    );

  if (
    !existing
  ) {
    throw new Error(
      "AI budget reservation not found"
    );
  }

  if (
    String(
      existing.user ||
        ""
    ) !==
    userId
  ) {
    throw new Error(
      "AI budget reservation ownership mismatch"
    );
  }

  const currentStatus =
    normalizeStatus(
      existing.status
    );

  /*
   * ==========================================
   * Already Completed
   * ==========================================
   */

  if (
    currentStatus ===
    "completed"
  ) {
    const storedTokens =
      toNonNegativeInteger(
        existing.actual_tokens
      );

    const storedCost =
      existing.actual_cost_usd ===
        undefined ||
      existing.actual_cost_usd ===
        null
        ? null
        : toNonNegativeNumber(
            existing.actual_cost_usd
          );

    /*
     * اگر Retry همان اطلاعات را دارد،
     * کاملاً Idempotent است.
     */

    if (
      storedTokens !==
      cleanActualTokens
    ) {
      throw new Error(
        "Completed AI budget reservation has different token usage"
      );
    }

    /*
     * اگر Caller هزینه قطعی ندارد (مثلاً
     * cost_available=false)، مقایسه Cost انجام
     * نمی‌شود. Usage Record منبع حقیقت است.
     */
    if (
      cleanActualCostUsd !==
        null &&
      !nullableNumbersEqual(
        storedCost,
        cleanActualCostUsd
      )
    ) {
      throw new Error(
        "Completed AI budget reservation has different cost usage"
      );
    }

    return {
      completed:
        true,

      duplicate:
        true,

      reservation:
        toReservation(
          existing
        ),
    };
  }

  /*
   * ==========================================
   * Complete
   *
   * Accounting truth بر status قبلی اولویت
   * دارد.
   *
   * pending / expired / cancelled هم اگر Actual
   * Usage داریم Completed می‌شوند.
   * ==========================================
   */

  const data:
    Record<
      string,
      unknown
    > = {
    status:
      "completed",

    actual_tokens:
      cleanActualTokens,

    ...(cleanActualCostUsd ===
    null
      ? {}
      : {
          actual_cost_usd:
            cleanActualCostUsd,
        }),

    ...(cleanUsageRecordId
      ? {
          usage_record:
            cleanUsageRecordId,
        }
      : {}),

    error_code:
      "",
  };

  const updated =
    await pb
      .collection(
        "ai_usage_reservations"
      )
      .update<AIBudgetReservationRecord>(
        existing.id,
        data
      );

  return {
    completed:
      true,

    duplicate:
      false,

    reservation:
      toReservation(
        updated
      ),
  };
}

/*
 * ============================================
 * Cancel Reservation
 *
 * فقط وقتی AI Call نباید/نتوانست ادامه پیدا کند.
 *
 * Completed هرگز Cancel نمی‌شود.
 * ============================================
 */

export async function cancelAIBudgetReservation({
  userId,
  requestId,
  errorCode,
}: {
  userId:
    string;

  requestId:
    string;

  errorCode?:
    string;
}): Promise<CancelAIBudgetReservationResult> {
  validateUserAndRequest({
    userId,

    requestId,
  });

  const cleanErrorCode =
    cleanErrorCodeValue(
      errorCode
    );

  const pb =
    await getPocketBaseServiceClient();

  const reservationId =
    createReservationRecordId(
      requestId
    );

  const existing =
    await findReservationById(
      pb,
      reservationId,
      requestId
    );

  /*
   * Cancel idempotent است.
   */

  if (
    !existing
  ) {
    return {
      cancelled:
        false,

      reservation:
        null,
    };
  }

  if (
    String(
      existing.user ||
        ""
    ) !==
    userId
  ) {
    throw new Error(
      "AI budget reservation ownership mismatch"
    );
  }

  const status =
    normalizeStatus(
      existing.status
    );

  /*
   * ==========================================
   * Completed
   *
   * مصرف واقعی وجود دارد؛ Cancel ممنوع.
   * ==========================================
   */

  if (
    status ===
    "completed"
  ) {
    return {
      cancelled:
        false,

      reservation:
        toReservation(
          existing
        ),
    };
  }

  /*
   * ==========================================
   * Already Cancelled
   * ==========================================
   */

  if (
    status ===
    "cancelled"
  ) {
    return {
      cancelled:
        true,

      reservation:
        toReservation(
          existing
        ),
    };
  }

  /*
   * ==========================================
   * Cancel Pending / Expired
   * ==========================================
   */

  const updated =
    await pb
      .collection(
        "ai_usage_reservations"
      )
      .update<AIBudgetReservationRecord>(
        existing.id,
        {
          status:
            "cancelled",

          error_code:
            cleanErrorCode,
        }
      );

  return {
    cancelled:
      true,

    reservation:
      toReservation(
        updated
      ),
  };
}

/*
 * ============================================
 * Expire Reservation
 *
 * فقط pendingی که TTL آن گذشته باشد Expire
 * می‌شود.
 *
 * completed / cancelled دست‌نخورده می‌مانند.
 * expired نیز idempotent است.
 *
 * Recovery Job از این API استفاده می‌کند تا
 * مستقیم Collection را mutate نکند.
 * ============================================
 */

export async function expireAIBudgetReservation({
  userId,
  requestId,
  errorCode,
}: {
  userId:
    string;

  requestId:
    string;

  errorCode?:
    string;
}): Promise<ExpireAIBudgetReservationResult> {
  validateUserAndRequest({
    userId,

    requestId,
  });

  const pb =
    await getPocketBaseServiceClient();

  const reservationId =
    createReservationRecordId(
      requestId
    );

  const existing =
    await findReservationById(
      pb,
      reservationId,
      requestId
    );

  if (
    !existing
  ) {
    return {
      expired:
        false,

      reservation:
        null,
    };
  }

  if (
    String(
      existing.user ||
        ""
    ) !==
    userId
  ) {
    throw new Error(
      "AI budget reservation ownership mismatch"
    );
  }

  const status =
    normalizeStatus(
      existing.status
    );

  /*
   * ==========================================
   * Already Expired
   * ==========================================
   */

  if (
    status ===
    "expired"
  ) {
    return {
      expired:
        true,

      reservation:
        toReservation(
          existing
        ),
    };
  }

  /*
   * ==========================================
   * Terminal States
   * ==========================================
   */

  if (
    status ===
      "completed" ||
    status ===
      "cancelled"
  ) {
    return {
      expired:
        false,

      reservation:
        toReservation(
          existing
        ),
    };
  }

  /*
   * ==========================================
   * Pending Still Active
   *
   * Recovery حق ندارد Reservation فعال را
   * زودتر آزاد کند.
   * ==========================================
   */

  const expiresAt =
    parseDate(
      existing.expires_at
    );

  if (
    expiresAt &&
    expiresAt.getTime() >
      Date.now()
  ) {
    return {
      expired:
        false,

      reservation:
        toReservation(
          existing
        ),
    };
  }

  /*
   * ==========================================
   * Expire Pending
   * ==========================================
   */

  const updated =
    await pb
      .collection(
        "ai_usage_reservations"
      )
      .update<AIBudgetReservationRecord>(
        existing.id,
        {
          status:
            "expired",

          error_code:
            cleanErrorCodeValue(
              errorCode ||
                "RESERVATION_EXPIRED"
            ),
        }
      );

  return {
    expired:
      true,

    reservation:
      toReservation(
        updated
      ),
  };
}

/*
 * ============================================
 * Active Reservations
 *
 * فقط pendingهایی که expires_at هنوز نگذشته
 * است در Budget لحاظ می‌شوند.
 *
 * Completed Usage داخل ai_usage حساب می‌شود
 * و اینجا دوباره شمرده نمی‌شود.
 * ============================================
 */

export async function getActiveAIBudgetReservations({
  userId,
}: {
  userId:
    string;
}): Promise<
  AIBudgetReservation[]
> {
  if (
    !isSafeRecordId(
      userId
    )
  ) {
    throw new Error(
      "Invalid user id for AI budget reservations"
    );
  }

  const pb =
    await getPocketBaseServiceClient();

  const now =
    new Date();

  const records =
    await pb
      .collection(
        "ai_usage_reservations"
      )
      .getFullList<AIBudgetReservationRecord>({
        filter:
          pb.filter(
            "user = {:userId} && status = {:status} && expires_at > {:now}",
            {
              userId,

              status:
                "pending",

              now:
                now.toISOString(),
            }
          ),

        sort:
          "expires_at",

        fields:
          [
            "id",
            "user",
            "conversation",
            "request_id",
            "request_type",
            "model",
            "reserved_tokens",
            "reserved_cost_usd",
            "status",
            "expires_at",
            "actual_tokens",
            "actual_cost_usd",
            "usage_record",
            "error_code",
            "created",
            "updated",
          ].join(
            ","
          ),

        batch:
          200,
      });

  return records.map(
    toReservation
  );
}

/*
 * ============================================
 * Active Reservation Summary
 *
 * Budget Guard می‌تواند مستقیم از این Helper
 * استفاده کند.
 * ============================================
 */

export async function getActiveAIBudgetReservationTotals({
  userId,
  excludeRequestId,
}: {
  userId:
    string;

  excludeRequestId?:
    string;
}) {
  const reservations =
    await getActiveAIBudgetReservations({
      userId,
    });

  const cleanExcludeRequestId =
    excludeRequestId &&
    isSafeRequestId(
      excludeRequestId
    )
      ? excludeRequestId
      : "";

  let reservedTokens =
    0;

  let reservedCostUsd =
    0;

  let count =
    0;

  for (
    const reservation of
    reservations
  ) {
    /*
     * Current request را می‌توان Exclude کرد
     * تا هنگام Retry دوبار Reserve نشود.
     */

    if (
      cleanExcludeRequestId &&
      reservation.requestId ===
        cleanExcludeRequestId
    ) {
      continue;
    }

    reservedTokens +=
      toNonNegativeInteger(
        reservation.reservedTokens
      );

    reservedCostUsd +=
      toNonNegativeNumber(
        reservation.reservedCostUsd
      );

    count +=
      1;
  }

  return {
    reservedTokens,

    reservedCostUsd,

    count,
  };
}

/*
 * ============================================
 * Mark Expired
 * ============================================
 */

async function markReservationExpired(
  pb:
    PocketBase,

  record:
    AIBudgetReservationRecord
) {
  const currentStatus =
    normalizeStatus(
      record.status
    );

  if (
    currentStatus !==
    "pending"
  ) {
    return toReservation(
      record
    );
  }

  try {
    const updated =
      await pb
        .collection(
          "ai_usage_reservations"
        )
        .update<AIBudgetReservationRecord>(
          record.id,
          {
            status:
              "expired",

            error_code:
              "RESERVATION_EXPIRED",
          }
        );

    return toReservation(
      updated
    );
  } catch (error) {
    /*
     * اگر Request دیگری همزمان آن را تغییر داده
     * باشد، وضعیت جدید را دوباره می‌خوانیم.
     */

    const latest =
      await findReservationById(
        pb,
        record.id,
        String(
          record.request_id ||
            ""
        )
      );

    if (
      latest
    ) {
      return toReservation(
        latest
      );
    }

    throw error;
  }
}

/*
 * ============================================
 * Find Reservation
 * ============================================
 */

async function findReservationById(
  pb:
    PocketBase,

  reservationId:
    string,

  requestId:
    string
): Promise<
  AIBudgetReservationRecord |
  null
> {
  try {
    const record =
      await pb
        .collection(
          "ai_usage_reservations"
        )
        .getOne<AIBudgetReservationRecord>(
          reservationId
        );

    if (
      String(
        record.request_id ||
          ""
      ) !==
      requestId
    ) {
      throw new Error(
        "AI budget reservation id collision detected"
      );
    }

    return record;
  } catch (error) {
    if (
      getErrorStatus(
        error
      ) ===
      404
    ) {
      return null;
    }

    throw error;
  }
}

/*
 * ============================================
 * Existing Reservation Validation
 *
 * یک request_id نباید برای User/Conversation/
 * Model/Reservation دیگری reuse شود.
 * ============================================
 */

function validateExistingReservation({
  record,
  userId,
  conversationId,
  requestId,
  requestType,
  model,
  reservedTokens,
  reservedCostUsd,
}: {
  record:
    AIBudgetReservationRecord;

  userId:
    string;

  conversationId:
    string;

  requestId:
    string;

  requestType:
    AIBudgetReservationRequestType;

  model:
    string;

  reservedTokens:
    number;

  reservedCostUsd:
    number;
}) {
  if (
    String(
      record.user ||
        ""
    ) !==
    userId
  ) {
    throw new Error(
      "AI budget reservation user mismatch"
    );
  }

  if (
    String(
      record.conversation ||
        ""
    ) !==
    conversationId
  ) {
    throw new Error(
      "AI budget reservation conversation mismatch"
    );
  }

  if (
    String(
      record.request_id ||
        ""
    ) !==
    requestId
  ) {
    throw new Error(
      "AI budget reservation request id mismatch"
    );
  }

  if (
    String(
      record.request_type ||
        ""
    ) !==
    requestType
  ) {
    throw new Error(
      "AI budget reservation request type mismatch"
    );
  }

  if (
    String(
      record.model ||
        ""
    ) !==
    model
  ) {
    throw new Error(
      "AI budget reservation model mismatch"
    );
  }

  if (
    toNonNegativeInteger(
      record.reserved_tokens
    ) !==
    reservedTokens
  ) {
    throw new Error(
      "AI budget reservation token amount mismatch"
    );
  }

  if (
    !numbersApproximatelyEqual(
      toNonNegativeNumber(
        record.reserved_cost_usd
      ),
      reservedCostUsd
    )
  ) {
    throw new Error(
      "AI budget reservation cost amount mismatch"
    );
  }
}

/*
 * ============================================
 * Mapping
 * ============================================
 */

function toReservation(
  record:
    AIBudgetReservationRecord
): AIBudgetReservation {
  const rawActualCost =
    record.actual_cost_usd;

  return {
    id:
      record.id,

    userId:
      String(
        record.user ||
          ""
      ),

    conversationId:
      String(
        record.conversation ||
          ""
      ),

    requestId:
      String(
        record.request_id ||
          ""
      ),

    requestType:
      normalizeRequestType(
        record.request_type
      ),

    model:
      String(
        record.model ||
          ""
      ),

    reservedTokens:
      toNonNegativeInteger(
        record.reserved_tokens
      ),

    reservedCostUsd:
      toNonNegativeNumber(
        record.reserved_cost_usd
      ),

    status:
      normalizeStatus(
        record.status
      ),

    expiresAt:
      String(
        record.expires_at ||
          ""
      ),

    actualTokens:
      toNonNegativeInteger(
        record.actual_tokens
      ),

    actualCostUsd:
      rawActualCost ===
        undefined ||
      rawActualCost ===
        null
        ? null
        : toNonNegativeNumber(
            rawActualCost
          ),

    usageRecordId:
      String(
        record.usage_record ||
          ""
      ) ||
      null,

    errorCode:
      String(
        record.error_code ||
          ""
      ) ||
      null,

    created:
      String(
        record.created ||
          ""
      ),

    updated:
      String(
        record.updated ||
          ""
      ),
  };
}

/*
 * ============================================
 * Deterministic Record ID
 * ============================================
 */

function createReservationRecordId(
  requestId:
    string
) {
  const digest =
    createHash(
      "sha256"
    )
      .update(
        `ai-budget-reservation:${requestId}`
      )
      .digest(
        "hex"
      );

  /*
   * PocketBase Record ID = 15 chars.
   */
  return `r${digest.slice(
    0,
    14
  )}`;
}

/*
 * ============================================
 * Validation
 * ============================================
 */

function validateReservationIdentity({
  userId,
  conversationId,
  requestId,
  requestType,
  model,
}: {
  userId:
    string;

  conversationId:
    string;

  requestId:
    string;

  requestType:
    AIBudgetReservationRequestType;

  model:
    string;
}) {
  if (
    !isSafeRecordId(
      userId
    )
  ) {
    throw new Error(
      "Invalid AI budget reservation user id"
    );
  }

  if (
    !isSafeRecordId(
      conversationId
    )
  ) {
    throw new Error(
      "Invalid AI budget reservation conversation id"
    );
  }

  if (
    !isSafeRequestId(
      requestId
    )
  ) {
    throw new Error(
      "Invalid AI budget reservation request id"
    );
  }

  if (
    requestType !==
      "chat" &&
    requestType !==
      "classification"
  ) {
    throw new Error(
      "Invalid AI budget reservation request type"
    );
  }

  if (
    !normalizeModel(
      model
    )
  ) {
    throw new Error(
      "Invalid AI budget reservation model"
    );
  }
}

function validateUserAndRequest({
  userId,
  requestId,
}: {
  userId:
    string;

  requestId:
    string;
}) {
  if (
    !isSafeRecordId(
      userId
    )
  ) {
    throw new Error(
      "Invalid AI budget reservation user id"
    );
  }

  if (
    !isSafeRequestId(
      requestId
    )
  ) {
    throw new Error(
      "Invalid AI budget reservation request id"
    );
  }
}

function isSafeRecordId(
  value:
    string
) {
  return RECORD_ID_PATTERN.test(
    String(
      value ||
        ""
    ).trim()
  );
}

function isSafeRequestId(
  value:
    string
) {
  return REQUEST_ID_PATTERN.test(
    String(
      value ||
        ""
    ).trim()
  );
}

function normalizeModel(
  value:
    unknown
) {
  const model =
    String(
      value ||
        ""
    )
      .trim()
      .slice(
        0,
        MAX_MODEL_LENGTH +
          1
      );

  if (
    !model ||
    model.length >
      MAX_MODEL_LENGTH
  ) {
    return "";
  }

  return model;
}

function normalizeRequestType(
  value:
    unknown
): AIBudgetReservationRequestType {
  return value ===
    "classification"
    ? "classification"
    : "chat";
}

function normalizeStatus(
  value:
    unknown
): AIBudgetReservationStatus {
  switch (
    value
  ) {
    case "completed":
      return "completed";

    case "cancelled":
      return "cancelled";

    case "expired":
      return "expired";

    default:
      return "pending";
  }
}

/*
 * ============================================
 * TTL
 * ============================================
 */

function resolveReservationSeconds(
  value:
    number |
    undefined
) {
  if (
    value !==
    undefined &&
    Number.isInteger(
      value
    )
  ) {
    return Math.min(
      MAX_RESERVATION_SECONDS,
      Math.max(
        MIN_RESERVATION_SECONDS,
        value
      )
    );
  }

  return environmentInteger(
    process.env
      .AI_BUDGET_RESERVATION_SECONDS,
    MIN_RESERVATION_SECONDS,
    MAX_RESERVATION_SECONDS,
    DEFAULT_RESERVATION_SECONDS
  );
}

/*
 * ============================================
 * Numbers
 * ============================================
 */

function toNonNegativeInteger(
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

  return Math.max(
    0,
    Math.trunc(
      number
    )
  );
}

function toNonNegativeNumber(
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

  return Math.max(
    0,
    number
  );
}

function nullableNumbersEqual(
  left:
    number |
    null,

  right:
    number |
    null
) {
  if (
    left ===
      null ||
    right ===
      null
  ) {
    return (
      left ===
      null &&
      right ===
        null
    );
  }

  return numbersApproximatelyEqual(
    left,
    right
  );
}

function numbersApproximatelyEqual(
  left:
    number,

  right:
    number
) {
  return (
    Math.abs(
      left -
        right
    ) <=
    1e-9
  );
}

/*
 * ============================================
 * Dates
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
 * Error Code
 * ============================================
 */

function cleanErrorCodeValue(
  value:
    unknown
) {
  return String(
    value ||
      ""
  )
    .replace(
      /[^A-Za-z0-9_.:-]/g,
      "_"
    )
    .slice(
      0,
      MAX_ERROR_CODE_LENGTH
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
 * PocketBase Error
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
 * State Error
 * ============================================
 */

export class AIBudgetReservationStateError
  extends Error {
  readonly status:
    AIBudgetReservationStatus;

  constructor(
    message:
      string,

    status:
      AIBudgetReservationStatus
  ) {
    super(
      message
    );

    this.name =
      "AIBudgetReservationStateError";

    this.status =
      status;
  }
}