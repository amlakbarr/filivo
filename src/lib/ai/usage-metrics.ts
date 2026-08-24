import type OpenAI from "openai";

/*
 * ============================================
 * Constants
 * ============================================
 */

const TOKENS_PER_MILLION =
  1_000_000;

const MAX_ERROR_MESSAGE_LENGTH =
  1000;

/*
 * ============================================
 * Types
 * ============================================
 */

export type AIUsageSnapshot = {
  inputTokens:
    number;

  cachedInputTokens:
    number;

  outputTokens:
    number;

  reasoningTokens:
    number;

  totalTokens:
    number;

  fileSearchCalls:
    number;

  model:
    string;

  requestId:
    string;
};

export type UsagePricing = {
  inputPer1m:
    number;

  cachedInputPer1m:
    number;

  outputPer1m:
    number;
};

export type AIUsageReservation = {
  inputTokens:
    number;

  outputTokens:
    number;
};

/*
 * ============================================
 * Extract Usage
 * ============================================
 */

export function extractAIUsage(
  response:
    OpenAI.Responses.Response |
    undefined,

  fallbackModel:
    string,

  fallbackRequestId =
    ""
): AIUsageSnapshot {
  const usage =
    response?.usage;

  return {
    inputTokens:
      toNonNegativeInteger(
        usage?.input_tokens
      ),

    cachedInputTokens:
      toNonNegativeInteger(
        usage
          ?.input_tokens_details
          ?.cached_tokens
      ),

    outputTokens:
      toNonNegativeInteger(
        usage?.output_tokens
      ),

    reasoningTokens:
      toNonNegativeInteger(
        usage
          ?.output_tokens_details
          ?.reasoning_tokens
      ),

    totalTokens:
      toNonNegativeInteger(
        usage?.total_tokens
      ),

    fileSearchCalls:
      response?.output.filter(
        (
          item
        ) =>
          item.type ===
          "file_search_call"
      ).length ||
      0,

    model:
      String(
        response?.model ||
          fallbackModel ||
          "unknown"
      ).trim(),

    requestId:
      String(
        response?.id ||
          fallbackRequestId ||
          ""
      ).trim(),
  };
}

/*
 * ============================================
 * Actual Token Cost
 *
 * برای Usage واقعی.
 * ============================================
 */

export function calculateTokenCost(
  usage:
    Pick<
      AIUsageSnapshot,
      | "inputTokens"
      | "cachedInputTokens"
      | "outputTokens"
    >,

  pricing:
    UsagePricing
) {
  const inputTokens =
    Math.max(
      0,
      usage.inputTokens
    );

  const cachedInputTokens =
    Math.min(
      inputTokens,
      Math.max(
        0,
        usage.cachedInputTokens
      )
    );

  const normalInputTokens =
    Math.max(
      0,
      inputTokens -
        cachedInputTokens
    );

  const outputTokens =
    Math.max(
      0,
      usage.outputTokens
    );

  const cost =
    (
      normalInputTokens *
        Math.max(
          0,
          pricing.inputPer1m
        ) +
      cachedInputTokens *
        Math.max(
          0,
          pricing.cachedInputPer1m
        ) +
      outputTokens *
        Math.max(
          0,
          pricing.outputPer1m
        )
    ) /
    TOKENS_PER_MILLION;

  return Math.max(
    0,
    cost
  );
}

/*
 * ============================================
 * Conservative Reservation Cost
 *
 * برای Hard Budget قبل از OpenAI.
 *
 * هنوز نمی‌دانیم چه مقدار Input واقعاً Cached
 * خواهد شد؛ بنابراین برای تمام Input Tokens
 * نرخ گران‌تر بین Cached و Normal Input را
 * استفاده می‌کنیم.
 *
 * این عدد باید >= هزینه Token-based واقعی
 * Reservation باشد.
 * ============================================
 */

export function calculateReservedTokenCost(
  reservation:
    AIUsageReservation,

  pricing:
    UsagePricing
) {
  const inputTokens =
    toNonNegativeInteger(
      reservation.inputTokens
    );

  const outputTokens =
    toNonNegativeInteger(
      reservation.outputTokens
    );

  const conservativeInputRate =
    Math.max(
      0,
      pricing.inputPer1m,
      pricing.cachedInputPer1m
    );

  const outputRate =
    Math.max(
      0,
      pricing.outputPer1m
    );

  const cost =
    (
      inputTokens *
        conservativeInputRate +
      outputTokens *
        outputRate
    ) /
    TOKENS_PER_MILLION;

  return Math.max(
    0,
    cost
  );
}

/*
 * ============================================
 * UTF-8 Token Upper Bound
 *
 * Tokenizer در نهایت روی Byte sequence کار
 * می‌کند و هر Token حداقل یک Byte را پوشش
 * می‌دهد.
 *
 * بنابراین تعداد UTF-8 Bytes یک حد بالای
 * محافظه‌کارانه برای تعداد Tokenهای متن است.
 *
 * Overheadهای Protocol / Tools باید جداگانه
 * توسط Caller اضافه شوند.
 * ============================================
 */

export function estimateUtf8TokenUpperBound(
  value:
    unknown
) {
  const text =
    String(
      value ||
        ""
    );

  if (
    !text
  ) {
    return 0;
  }

  return new TextEncoder()
    .encode(
      text
    )
    .byteLength;
}

/*
 * ============================================
 * Usage Error Message
 * ============================================
 */

export function getUsageErrorMessage(
  value:
    unknown
) {
  if (
    typeof value ===
    "string"
  ) {
    return value
      .trim()
      .slice(
        0,
        MAX_ERROR_MESSAGE_LENGTH
      );
  }

  if (
    typeof value ===
      "object" &&
    value !==
      null
  ) {
    const error =
      value as {
        message?:
          unknown;

        code?:
          unknown;

        type?:
          unknown;
      };

    const parts = [
      error.code,
      error.type,
      error.message,
    ]
      .filter(
        (
          part
        ): part is string =>
          typeof part ===
            "string" &&
          Boolean(
            part.trim()
          )
      )
      .map(
        (
          part
        ) =>
          part.trim()
      );

    if (
      parts.length >
      0
    ) {
      return parts
        .join(
          ": "
        )
        .slice(
          0,
          MAX_ERROR_MESSAGE_LENGTH
        );
    }
  }

  return "OpenAI request failed";
}

/*
 * ============================================
 * Non-negative Integer
 * ============================================
 */

export function toNonNegativeInteger(
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