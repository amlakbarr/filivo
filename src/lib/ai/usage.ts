import {
  createHash,
} from "node:crypto";

import type OpenAI from "openai";

import type PocketBase from "pocketbase";

import type {
  RecordModel,
} from "pocketbase";

import {
  calculateReservedTokenCost,
  calculateTokenCost,
  estimateUtf8TokenUpperBound,
  extractAIUsage,
  getUsageErrorMessage,
  toNonNegativeInteger,
  type AIUsageSnapshot,
  type UsagePricing,
} from "@/lib/ai/usage-metrics";

import {
  getPocketBaseServiceClient,
} from "@/lib/pocketbase/service";

/*
 * ============================================
 * Re-exports
 * ============================================
 */

export {
  calculateReservedTokenCost,
  calculateTokenCost,
  estimateUtf8TokenUpperBound,
  extractAIUsage,
};

export type {
  UsagePricing,
} from "@/lib/ai/usage-metrics";

/*
 * ============================================
 * Types
 * ============================================
 */

type RecordAIUsageParams = {
  userId:
    string;

  conversationId:
    string;

  messageId?:
    string;

  /*
   * Internal Budget Reservation Request ID.
   *
   * این مقدار OpenAI request_id نیست.
   * برای اتصال ai_usage به
   * ai_usage_reservations استفاده می‌شود.
   */
  reservationRequestId?:
    string;

  requestType:
    | "chat"
    | "classification";

  model:
    string;

  latencyMs:
    number;

  success:
    boolean;

  response?:
    OpenAI.Responses.Response;

  /*
   * OpenAI Request ID fallback.
   */
  requestId?:
    string;

  error?:
    unknown;

  errorMessage?:
    string;
};

export type RecordAIUsageResult =
  | {
      ok:
        true;

      recordId:
        string;

      duplicate:
        boolean;

      estimatedCostUsd:
        number |
        null;

      pricingAvailable:
        boolean;

      snapshot:
        AIUsageSnapshot;
    }
  | {
      ok:
        false;

      error:
        unknown;
    };

/*
 * ============================================
 * Constants
 * ============================================
 */

const RECORD_ID_PATTERN =
  /^[a-zA-Z0-9_-]{1,64}$/;

const REQUEST_ID_PATTERN =
  /^[a-zA-Z0-9_-]{1,128}$/;

const MAX_MODEL_LENGTH =
  200;

const MAX_PERSIST_ATTEMPTS =
  3;

const RETRY_BASE_MILLISECONDS =
  100;

const RETRY_MAX_MILLISECONDS =
  500;

/*
 * ============================================
 * Public Model Pricing
 *
 * Hard Budget Guard از همین تابع استفاده
 * می‌کند تا Pricing دقیقاً با AI Usage
 * Accounting یکسان باشد.
 *
 * null یعنی:
 *
 * - Pricing فعال وجود ندارد
 * - Pricing معتبر نیست
 * - Model معتبر نیست
 *
 * Infrastructure errors throw می‌شوند تا
 * Caller بتواند fail-closed عمل کند.
 * ============================================
 */

export async function getActiveModelPricing(
  model:
    string
): Promise<
  UsagePricing |
  null
> {
  const cleanModel =
    normalizeModel(
      model
    );

  if (
    !cleanModel
  ) {
    return null;
  }

  const pb =
    await getPocketBaseServiceClient();

  return findActivePricing({
    pb,

    model:
      cleanModel,
  });
}

/*
 * ============================================
 * Record AI Usage
 * ============================================
 */

export async function recordAIUsage(
  params:
    RecordAIUsageParams
): Promise<RecordAIUsageResult> {
  try {
    /*
     * ========================================
     * Defensive Validation
     * ========================================
     */

    validateParams(
      params
    );

    /*
     * ========================================
     * Usage Snapshot
     * ========================================
     */

    const snapshot =
      extractAIUsage(
        params.response,
        params.model,
        params.requestId
      );

    /*
     * وقتی OpenAI Request ID داریم، ID رکورد
     * deterministic است.
     *
     * Retry نمی‌تواند Usage تکراری بسازد.
     */

    const recordId =
      snapshot.requestId
        ? createUsageRecordId(
            snapshot.requestId
          )
        : undefined;

    /*
     * ========================================
     * Service Client
     * ========================================
     */

    const pb =
      await getPocketBaseServiceClient();

    /*
     * ========================================
     * Existing Usage
     * ========================================
     */

    if (
      recordId &&
      snapshot.requestId
    ) {
      const existing =
        await findExistingUsage(
          pb,
          recordId,
          snapshot.requestId
        );

      if (
        existing
      ) {
        /*
         * اگر رکورد قدیمی قبل از اضافه‌شدن
         * reservation_request_id ساخته شده باشد
         * ولی اکنون Reservation ID داریم،
         * ارتباط را در صورت خالی بودن Repair
         * می‌کنیم.
         */
        const repaired =
          await repairReservationRequestIdIfNeeded({
            pb,

            record:
              existing,

            reservationRequestId:
              params.reservationRequestId,
          });

        return duplicateResult(
          repaired,
          snapshot
        );
      }
    }

    /*
     * ========================================
     * Pricing
     *
     * از همان تابع داخلی استفاده می‌شود که
     * getActiveModelPricing نیز استفاده می‌کند.
     *
     * بنابراین Budget Guard و Accounting
     * Pricing متفاوت نخواهند داشت.
     * ========================================
     */

    const pricing =
      await findActivePricing({
        pb,

        model:
          snapshot.model,
      });

    const estimatedCostUsd =
      pricing
        ? calculateTokenCost(
            snapshot,
            pricing
          )
        : null;

    /*
     * ========================================
     * Payload
     * ========================================
     */

    const data:
      Record<
        string,
        unknown
      > = {
      ...(recordId
        ? {
            id:
              recordId,
          }
        : {}),

      user:
        params.userId,

      conversation:
        params.conversationId,

      ...(params.messageId
        ? {
            message:
              params.messageId,
          }
        : {}),

      request_type:
        params.requestType,

      model:
        snapshot.model,

      input_tokens:
        snapshot.inputTokens,

      cached_input_tokens:
        snapshot.cachedInputTokens,

      output_tokens:
        snapshot.outputTokens,

      reasoning_tokens:
        snapshot.reasoningTokens,

      total_tokens:
        snapshot.totalTokens,

      file_search_calls:
        snapshot.fileSearchCalls,

      ...(estimatedCostUsd ===
      null
        ? {}
        : {
            estimated_cost_usd:
              estimatedCostUsd,
          }),

      cost_available:
        estimatedCostUsd !==
        null,

      latency_ms:
        toNonNegativeInteger(
          params.latencyMs
        ),

      success:
        params.success,

      /*
       * OpenAI Response / Request ID.
       */
      request_id:
        snapshot.requestId,

      /*
       * Internal Budget Reservation ID.
       */
      ...(params.reservationRequestId
        ? {
            reservation_request_id:
              params.reservationRequestId,
          }
        : {}),

      error_message:
        params.success
          ? ""
          : getUsageErrorMessage(
              params.errorMessage ||
                params.error
            ),
    };

    /*
     * ========================================
     * Durable-ish Persistence
     *
     * PocketBase / Network transient failure
     * چند بار Retry می‌شود.
     *
     * Duplicate بعد از هر failure دوباره
     * بررسی می‌شود.
     * ========================================
     */

    let lastError:
      unknown;

    for (
      let attempt =
        1;

      attempt <=
      MAX_PERSIST_ATTEMPTS;

      attempt +=
        1
    ) {
      try {
        const record =
          await pb
            .collection(
              "ai_usage"
            )
            .create(
              data
            );

        return {
          ok:
            true,

          recordId:
            record.id,

          duplicate:
            false,

          estimatedCostUsd,

          pricingAvailable:
            pricing !==
            null,

          snapshot,
        };
      } catch (error) {
        lastError =
          error;

        /*
         * ====================================
         * Race / Retry Recovery
         * ====================================
         */

        if (
          recordId &&
          snapshot.requestId
        ) {
          const existing =
            await safeFindExistingUsage(
              pb,
              recordId,
              snapshot.requestId
            );

          if (
            existing
          ) {
            const repaired =
              await repairReservationRequestIdIfNeeded({
                pb,

                record:
                  existing,

                reservationRequestId:
                  params.reservationRequestId,
              });

            return duplicateResult(
              repaired,
              snapshot
            );
          }
        }

        /*
         * ====================================
         * Permanent Error
         *
         * بیشتر 4xxها با Retry حل نمی‌شوند.
         * ====================================
         */

        if (
          !shouldRetryPersistence(
            error
          )
        ) {
          throw error;
        }

        /*
         * ====================================
         * Last Attempt
         * ====================================
         */

        if (
          attempt >=
          MAX_PERSIST_ATTEMPTS
        ) {
          break;
        }

        await sleep(
          retryDelay(
            attempt
          )
        );
      }
    }

    throw (
      lastError ||
      new Error(
        "AI usage persistence failed after retries"
      )
    );
  } catch (error) {
    /*
     * Prompt، Response Content و OpenAI
     * Request ID خام داخل Log قرار نمی‌گیرند.
     */

    console.error(
      "AI usage persistence failed",
      {
        requestType:
          params.requestType,

        model:
          cleanLogText(
            params.model,
            120
          ),

        success:
          params.success,

        userId:
          safeRecordIdForLog(
            params.userId
          ),

        conversationId:
          safeRecordIdForLog(
            params.conversationId
          ),

        hasReservation:
          Boolean(
            params.reservationRequestId
          ),

        error:
          getErrorMetadata(
            error
          ),
      }
    );

    return {
      ok:
        false,

      error,
    };
  }
}

/*
 * ============================================
 * Duplicate Result
 * ============================================
 */

function duplicateResult(
  existing:
    RecordModel,

  snapshot:
    AIUsageSnapshot
): RecordAIUsageResult {
  return {
    ok:
      true,

    recordId:
      existing.id,

    duplicate:
      true,

    estimatedCostUsd:
      getStoredEstimatedCost(
        existing
      ),

    pricingAvailable:
      existing.cost_available !==
      false,

    snapshot,
  };
}

/*
 * ============================================
 * Reservation Request ID Repair
 *
 * برای Compatibility با ai_usageهایی که قبل
 * از اضافه‌شدن reservation_request_id ساخته
 * شده‌اند.
 *
 * اگر existing value با Reservation جدید
 * متفاوت باشد، Fail می‌کنیم تا یک Usage به دو
 * Reservation مختلف متصل نشود.
 * ============================================
 */

async function repairReservationRequestIdIfNeeded({
  pb,
  record,
  reservationRequestId,
}: {
  pb:
    PocketBase;

  record:
    RecordModel;

  reservationRequestId?:
    string;
}) {
  if (
    !reservationRequestId
  ) {
    return record;
  }

  const existingReservationRequestId =
    String(
      record.reservation_request_id ||
        ""
    ).trim();

  /*
   * Already linked correctly.
   */

  if (
    existingReservationRequestId ===
    reservationRequestId
  ) {
    return record;
  }

  /*
   * Usage قبلاً به Reservation دیگری متصل است.
   */

  if (
    existingReservationRequestId
  ) {
    throw new Error(
      "AI usage reservation request id mismatch"
    );
  }

  /*
   * Legacy record؛ ارتباط را Repair می‌کنیم.
   */

  return pb
    .collection(
      "ai_usage"
    )
    .update(
      record.id,
      {
        reservation_request_id:
          reservationRequestId,
      }
    );
}

/*
 * ============================================
 * Active Pricing
 *
 * Shared internal implementation.
 * ============================================
 */

async function findActivePricing({
  pb,
  model,
}: {
  pb:
    PocketBase;

  model:
    string;
}): Promise<
  UsagePricing |
  null
> {
  const cleanModel =
    normalizeModel(
      model
    );

  if (
    !cleanModel
  ) {
    return null;
  }

  /*
   * OpenAI ممکن است در Response نام Snapshot
   * تاریخ‌دار مدل را برگرداند، مثلاً:
   *
   * gpt-5-mini-2025-08-07
   *
   * در حالی که Pricing پروژه روی Alias پایدار:
   *
   * gpt-5-mini
   *
   * تعریف شده است.
   *
   * ترتیب Lookup:
   *
   * 1. نام دقیق Snapshot
   * 2. Alias پایه فقط در صورت داشتن suffix
   *    استاندارد YYYY-MM-DD
   *
   * بنابراین اگر برای Snapshot خاص Pricing
   * جداگانه تعریف شده باشد، همیشه همان اولویت
   * دارد و Pricing مدل نامرتبط هرگز استفاده
   * نمی‌شود.
   */

  const pricingModels =
    getPricingModelCandidates(
      cleanModel
    );

  const now =
    Date.now();

  for (
    const pricingModel of
    pricingModels
  ) {
    const records =
      await pb
        .collection(
          "model_pricing"
        )
        .getFullList({
          filter:
            pb.filter(
              "model = {:model} && active = true",
              {
                model:
                  pricingModel,
              }
            ),

          /*
           * جدیدترین Pricing معتبر در اولویت.
           */
          sort:
            "-effective_from,-created",

          fields:
            [
              "id",
              "input_per_1m",
              "cached_input_per_1m",
              "output_per_1m",
              "effective_from",
              "created",
            ].join(
              ","
            ),
        });

    const applicable =
      records.find(
        (
          record
        ) => {
          const effectiveFrom =
            String(
              record.effective_from ||
                ""
            ).trim();

          /*
           * بدون effective_from یعنی فوراً فعال.
           */
          if (
            !effectiveFrom
          ) {
            return true;
          }

          const timestamp =
            Date.parse(
              effectiveFrom
            );

          return (
            Number.isFinite(
              timestamp
            ) &&
            timestamp <=
              now
          );
        }
      );

    /*
     * برای این Candidate هنوز Pricing قابل
     * استفاده نداریم؛ Candidate بعدی را امتحان
     * می‌کنیم.
     *
     * این حالت اجازه می‌دهد Pricing آینده‌ی یک
     * Snapshot تعریف شده باشد ولی تا زمان
     * effective_from همچنان Alias پایه استفاده
     * شود.
     */
    if (
      !applicable
    ) {
      continue;
    }

    const pricing:
      UsagePricing = {
      inputPer1m:
        Number(
          applicable.input_per_1m
        ),

      cachedInputPer1m:
        Number(
          applicable.cached_input_per_1m
        ),

      outputPer1m:
        Number(
          applicable.output_per_1m
        ),
    };

    if (
      !isNonNegativeNumber(
        pricing.inputPer1m
      ) ||
      !isNonNegativeNumber(
        pricing.cachedInputPer1m
      ) ||
      !isNonNegativeNumber(
        pricing.outputPer1m
      )
    ) {
      /*
       * اگر برای همین Candidate یک Pricing فعال
       * پیدا شده ولی مقادیرش خراب است، Fail-closed
       * می‌کنیم و به Candidate عمومی‌تر Fallback
       * نمی‌کنیم؛ چون Config خراب نباید پنهان شود.
       */
      return null;
    }

    return pricing;
  }

  return null;
}

/*
 * ============================================
 * Pricing Model Candidates
 *
 * فقط Snapshotهایی را Normalize می‌کنیم که
 * suffix تاریخ استاندارد OpenAI داشته باشند.
 *
 * مثال:
 *
 * gpt-5-mini-2025-08-07
 *      ↓
 * gpt-5-mini
 *
 * suffixهای دلخواه یا نسخه‌های عددی دیگر حذف
 * نمی‌شوند تا یک مدل اشتباه قیمت‌گذاری نشود.
 * ============================================
 */

function getPricingModelCandidates(
  model:
    string
) {
  const candidates =
    [
      model,
    ];

  const baseModel =
    getBaseModelFromDatedSnapshot(
      model
    );

  if (
    baseModel &&
    baseModel !==
      model
  ) {
    candidates.push(
      baseModel
    );
  }

  return candidates;
}

function getBaseModelFromDatedSnapshot(
  model:
    string
) {
  const baseModel =
    model.replace(
      /-\d{4}-\d{2}-\d{2}$/,
      ""
    );

  if (
    baseModel ===
    model
  ) {
    return "";
  }

  return normalizeModel(
    baseModel
  );
}

/*
 * ============================================
 * Existing Usage
 * ============================================
 */

async function findExistingUsage(
  pb:
    PocketBase,

  recordId:
    string,

  requestId:
    string
) {
  try {
    const existing =
      await pb
        .collection(
          "ai_usage"
        )
        .getOne(
          recordId
        );

    if (
      String(
        existing.request_id ||
          ""
      ) !==
      requestId
    ) {
      throw new Error(
        "AI usage record id collision detected"
      );
    }

    return existing;
  } catch (error) {
    if (
      getErrorMetadata(
        error
      ).status ===
      404
    ) {
      return null;
    }

    throw error;
  }
}

/*
 * ============================================
 * Safe Existing Usage Lookup
 *
 * در مسیر Recovery، خطای Lookup نباید Error
 * اصلی Create را مخفی کند.
 * ============================================
 */

async function safeFindExistingUsage(
  pb:
    PocketBase,

  recordId:
    string,

  requestId:
    string
) {
  try {
    return await findExistingUsage(
      pb,
      recordId,
      requestId
    );
  } catch {
    return null;
  }
}

/*
 * ============================================
 * Deterministic Record ID
 * ============================================
 */

function createUsageRecordId(
  requestId:
    string
) {
  const digest =
    createHash(
      "sha256"
    )
      .update(
        requestId
      )
      .digest(
        "hex"
      );

  /*
   * PocketBase Record ID = 15 characters.
   */
  return `g${digest.slice(
    0,
    14
  )}`;
}

/*
 * ============================================
 * Stored Cost
 * ============================================
 */

function getStoredEstimatedCost(
  record:
    RecordModel
) {
  if (
    record.cost_available ===
    false
  ) {
    return null;
  }

  const value =
    Number(
      record.estimated_cost_usd
    );

  return Number.isFinite(
    value
  ) &&
    value >=
      0
    ? value
    : null;
}

/*
 * ============================================
 * Validation
 * ============================================
 */

function validateParams(
  params:
    RecordAIUsageParams
) {
  if (
    !isSafeRecordId(
      params.userId
    )
  ) {
    throw new Error(
      "Invalid AI usage userId"
    );
  }

  if (
    !isSafeRecordId(
      params.conversationId
    )
  ) {
    throw new Error(
      "Invalid AI usage conversationId"
    );
  }

  if (
    params.messageId &&
    !isSafeRecordId(
      params.messageId
    )
  ) {
    throw new Error(
      "Invalid AI usage messageId"
    );
  }

  if (
    params.reservationRequestId &&
    !isSafeRequestId(
      params.reservationRequestId
    )
  ) {
    throw new Error(
      "Invalid AI usage reservation request id"
    );
  }

  if (
    !normalizeModel(
      params.model
    )
  ) {
    throw new Error(
      "Invalid AI usage model"
    );
  }

  if (
    params.requestType !==
      "chat" &&
    params.requestType !==
      "classification"
  ) {
    throw new Error(
      "Invalid AI usage request type"
    );
  }
}

/*
 * ============================================
 * Model
 * ============================================
 */

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

/*
 * ============================================
 * Request ID
 * ============================================
 */

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

/*
 * ============================================
 * Retry Decision
 * ============================================
 */

function shouldRetryPersistence(
  error:
    unknown
) {
  const metadata =
    getErrorMetadata(
      error
    );

  /*
   * Network / unknown errors ممکن است transient
   * باشند.
   */

  if (
    metadata.status ===
    undefined
  ) {
    return true;
  }

  /*
   * Timeout / conflict / rate-limit /
   * server errors.
   */

  if (
    metadata.status ===
      408 ||
    metadata.status ===
      409 ||
    metadata.status ===
      425 ||
    metadata.status ===
      429 ||
    metadata.status >=
      500
  ) {
    return true;
  }

  /*
   * سایر 4xxها معمولاً schema / validation /
   * auth هستند.
   */

  return false;
}

/*
 * ============================================
 * Retry Delay
 * ============================================
 */

function retryDelay(
  attempt:
    number
) {
  const exponential =
    Math.min(
      RETRY_MAX_MILLISECONDS,
      RETRY_BASE_MILLISECONDS *
        2 **
          Math.max(
            0,
            attempt -
              1
          )
    );

  const jitter =
    Math.floor(
      Math.random() *
        50
    );

  return (
    exponential +
    jitter
  );
}

/*
 * ============================================
 * Sleep
 * ============================================
 */

function sleep(
  milliseconds:
    number
) {
  return new Promise<void>(
    (
      resolve
    ) => {
      setTimeout(
        resolve,
        milliseconds
      );
    }
  );
}

/*
 * ============================================
 * Number
 * ============================================
 */

function isNonNegativeNumber(
  value:
    number
) {
  return (
    Number.isFinite(
      value
    ) &&
    value >=
      0
  );
}

/*
 * ============================================
 * Record ID
 * ============================================
 */

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

/*
 * ============================================
 * Safe Log ID
 * ============================================
 */

function safeRecordIdForLog(
  value:
    string
) {
  return isSafeRecordId(
    value
  )
    ? value
    : undefined;
}

/*
 * ============================================
 * Safe Log Text
 * ============================================
 */

function cleanLogText(
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
      /[\u0000-\u001f\u007f]/g,
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
 * Error Metadata
 * ============================================
 */

function getErrorMetadata(
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
      message:
        String(
          error
        ),
    };
  }

  const value =
    error as {
      message?:
        unknown;

      status?:
        unknown;

      code?:
        unknown;

      name?:
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