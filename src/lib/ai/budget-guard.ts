import type {
  RecordModel,
} from "pocketbase";

import {
  resolveAnalyticsRange,
} from "@/lib/analytics/range";

import {
  getActiveAIBudgetReservationTotals,
} from "@/lib/ai/budget-reservation";

import {
  calculateReservedTokenCost,
  getActiveModelPricing,
} from "@/lib/ai/usage";

import {
  getPocketBaseServiceClient,
} from "@/lib/pocketbase/service";

/*
 * ============================================
 * Types
 * ============================================
 */

export type AIBudgetLimitCode =
  | "AI_DAILY_TOKEN_LIMIT_REACHED"
  | "AI_MONTHLY_TOKEN_LIMIT_REACHED"
  | "AI_DAILY_COST_LIMIT_REACHED"
  | "AI_MONTHLY_COST_LIMIT_REACHED"
  | "AI_COST_ACCOUNTING_UNAVAILABLE";

export type AIBudgetPeriodUsage = {
  tokens:
    number;

  costUsd:
    number;

  pricedRequests:
    number;

  unpricedRequests:
    number;

  requests:
    number;
};

export type AIBudgetLimits = {
  dailyTokenLimit:
    number;

  monthlyTokenLimit:
    number;

  dailyCostLimitUsd:
    number;

  monthlyCostLimitUsd:
    number;

  warningPercent:
    number;

  source:
    | "default"
    | "account_override";
};

export type AIBudgetUsage = {
  daily:
    AIBudgetPeriodUsage;

  monthly:
    AIBudgetPeriodUsage;
};

export type AIBudgetWarning = {
  type:
    | "daily_tokens"
    | "monthly_tokens"
    | "daily_cost"
    | "monthly_cost";

  percent:
    number;
};

export type AIBudgetReservation = {
  model:
    string;

  inputTokens:
    number;

  outputTokens:
    number;
};

export type AIBudgetGuardResult =
  | {
      allowed:
        true;

      limits:
        AIBudgetLimits;

      usage:
        AIBudgetUsage;

      warnings:
        AIBudgetWarning[];
    }
  | {
      allowed:
        false;

      code:
        AIBudgetLimitCode;

      limits:
        AIBudgetLimits;

      usage:
        AIBudgetUsage;

      retryAfterSeconds:
        number;
    };

type AccountAILimitRecord =
  RecordModel & {
    user?:
      string;

    enabled?:
      boolean;

    daily_token_limit?:
      number;

    monthly_token_limit?:
      number;

    daily_cost_limit_usd?:
      number;

    monthly_cost_limit_usd?:
      number;

    warning_percent?:
      number;
  };

type AIUsageBudgetRecord =
  RecordModel & {
    user?:
      string;

    request_type?:
      string;

    total_tokens?:
      number;

    estimated_cost_usd?:
      number;

    cost_available?:
      boolean;
  };

type NormalizedReservation = {
  model:
    string;

  inputTokens:
    number;

  outputTokens:
    number;

  totalTokens:
    number;
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

/*
 * ============================================
 * Main Guard
 *
 * reservation اختیاری است تا Callهای Read-only
 * مثل Admin Budget Summary همچنان فقط Usage فعلی
 * را بررسی کنند.
 *
 * برای AI Call واقعی، Caller باید Reservation
 * محافظه‌کارانه را ارسال کند.
 * ============================================
 */

export async function checkAIBudgetGuard({
  userId,
  reservation,
  excludeReservationRequestId,
}: {
  userId:
    string;

  reservation?:
    AIBudgetReservation;

  excludeReservationRequestId?:
    string;
}): Promise<AIBudgetGuardResult> {
  const cleanUserId =
    String(
      userId ||
        ""
    ).trim();

  if (
    !RECORD_ID_PATTERN.test(
      cleanUserId
    )
  ) {
    throw new Error(
      "AI budget guard requires a valid userId"
    );
  }

  const normalizedReservation =
    normalizeReservation(
      reservation
    );

  const cleanExcludeReservationRequestId =
    normalizeOptionalRequestId(
      excludeReservationRequestId
    );

  /*
   * ==========================================
   * Date Ranges
   * ==========================================
   */

  const todayParams =
    new URLSearchParams({
      range:
        "today",
    });

  const monthParams =
    new URLSearchParams({
      range:
        "this_month",
    });

  const today =
    resolveAnalyticsRange(
      todayParams
    );

  const month =
    resolveAnalyticsRange(
      monthParams
    );

  /*
   * ==========================================
   * PocketBase
   * ==========================================
   */

  const pb =
    await getPocketBaseServiceClient();

  /*
   * ==========================================
   * Effective Limits
   * ==========================================
   */

  const accountLimit =
    await getAccountAILimit(
      pb,
      cleanUserId
    );

  const limits =
    resolveLimits(
      accountLimit
    );

  /*
   * ==========================================
   * Usage
   *
   * فقط یک Query برای کل ماه.
   * ==========================================
   */

  const monthlyRecords =
    await pb
      .collection(
        "ai_usage"
      )
      .getFullList<AIUsageBudgetRecord>({
        filter:
          pb.filter(
            "user = {:userId} && created >= {:from} && created < {:to}",
            {
              userId:
                cleanUserId,

              from:
                month.from.toISOString(),

              to:
                month.to.toISOString(),
            }
          ),

        fields:
          [
            "id",
            "user",
            "request_type",
            "total_tokens",
            "estimated_cost_usd",
            "cost_available",
            "created",
          ].join(
            ","
          ),

        sort:
          "created",

        batch:
          500,
      });

  const dailyRecords =
    monthlyRecords.filter(
      (
        record
      ) =>
        isInsideRange(
          record.created,
          today.from,
          today.to
        )
    );

  const usage:
    AIBudgetUsage = {
    daily:
      summarizeUsage(
        dailyRecords
      ),

    monthly:
      summarizeUsage(
        monthlyRecords
      ),
  };

  /*
   * ==========================================
   * Active Pending Reservations
   *
   * فقط Reservationهای pending و منقضی‌نشده
   * در Budget اشغال‌شده حساب می‌شوند.
   *
   * Completedها داخل ai_usage هستند و اینجا
   * دوباره شمرده نمی‌شوند.
   * ==========================================
   */

  const activeReservations =
    await getActiveAIBudgetReservationTotals({
      userId:
        cleanUserId,

      ...(cleanExcludeReservationRequestId
        ? {
            excludeRequestId:
              cleanExcludeReservationRequestId,
          }
        : {}),
    });

  const dailyTokensWithPending =
    addBudgetAmounts(
      usage.daily.tokens,
      activeReservations.reservedTokens
    );

  const monthlyTokensWithPending =
    addBudgetAmounts(
      usage.monthly.tokens,
      activeReservations.reservedTokens
    );

  const dailyCostWithPending =
    addBudgetAmounts(
      usage.daily.costUsd,
      activeReservations.reservedCostUsd
    );

  const monthlyCostWithPending =
    addBudgetAmounts(
      usage.monthly.costUsd,
      activeReservations.reservedCostUsd
    );

  /*
   * ==========================================
   * Daily Token Limit
   *
   * Usage فعلی اگر به سقف رسیده باشد Block.
   * Reservation فقط وقتی Block می‌شود که
   * projected usage از سقف عبور کند.
   *
   * بنابراین:
   * current = 199000
   * reserve = 1000
   * limit   = 200000
   * مجاز است.
   * ==========================================
   */

  if (
    currentLimitReached(
      dailyTokensWithPending,
      limits.dailyTokenLimit
    ) ||
    reservationWouldExceedLimit(
      dailyTokensWithPending,
      normalizedReservation.totalTokens,
      limits.dailyTokenLimit
    )
  ) {
    return {
      allowed:
        false,

      code:
        "AI_DAILY_TOKEN_LIMIT_REACHED",

      limits,

      usage,

      retryAfterSeconds:
        secondsUntil(
          today.to
        ),
    };
  }

  /*
   * ==========================================
   * Daily Cost Accounting
   * ==========================================
   */

  if (
    costLimitEnabled(
      limits.dailyCostLimitUsd
    ) &&
    usage.daily
      .unpricedRequests >
      0
  ) {
    return {
      allowed:
        false,

      code:
        "AI_COST_ACCOUNTING_UNAVAILABLE",

      limits,

      usage,

      retryAfterSeconds:
        getAccountingRetrySeconds(),
    };
  }

  /*
   * ==========================================
   * Reservation Cost
   *
   * Pricing فقط وقتی لازم است که Reservation
   * واقعی داریم و حداقل یکی از Cost Limitها
   * فعال است.
   * ==========================================
   */

  let reservedCostUsd =
    0;

  const needsReservationPricing =
    normalizedReservation.totalTokens >
      0 &&
    (
      costLimitEnabled(
        limits.dailyCostLimitUsd
      ) ||
      costLimitEnabled(
        limits.monthlyCostLimitUsd
      )
    );

  if (
    needsReservationPricing
  ) {
    if (
      !normalizedReservation.model
    ) {
      return {
        allowed:
          false,

        code:
          "AI_COST_ACCOUNTING_UNAVAILABLE",

        limits,

        usage,

        retryAfterSeconds:
          getAccountingRetrySeconds(),
      };
    }

    const pricing =
      await getActiveModelPricing(
        normalizedReservation.model
      );

    if (
      !pricing
    ) {
      return {
        allowed:
          false,

        code:
          "AI_COST_ACCOUNTING_UNAVAILABLE",

        limits,

        usage,

        retryAfterSeconds:
          getAccountingRetrySeconds(),
      };
    }

    reservedCostUsd =
      calculateReservedTokenCost(
        {
          inputTokens:
            normalizedReservation.inputTokens,

          outputTokens:
            normalizedReservation.outputTokens,
        },
        pricing
      );
  }

  /*
   * ==========================================
   * Daily Cost Limit
   * ==========================================
   */

  if (
    currentLimitReached(
      dailyCostWithPending,
      limits.dailyCostLimitUsd
    ) ||
    reservationWouldExceedLimit(
      dailyCostWithPending,
      reservedCostUsd,
      limits.dailyCostLimitUsd
    )
  ) {
    return {
      allowed:
        false,

      code:
        "AI_DAILY_COST_LIMIT_REACHED",

      limits,

      usage,

      retryAfterSeconds:
        secondsUntil(
          today.to
        ),
    };
  }

  /*
   * ==========================================
   * Monthly Token Limit
   * ==========================================
   */

  if (
    currentLimitReached(
      monthlyTokensWithPending,
      limits.monthlyTokenLimit
    ) ||
    reservationWouldExceedLimit(
      monthlyTokensWithPending,
      normalizedReservation.totalTokens,
      limits.monthlyTokenLimit
    )
  ) {
    return {
      allowed:
        false,

      code:
        "AI_MONTHLY_TOKEN_LIMIT_REACHED",

      limits,

      usage,

      retryAfterSeconds:
        secondsUntil(
          month.to
        ),
    };
  }

  /*
   * ==========================================
   * Monthly Cost Accounting
   * ==========================================
   */

  if (
    costLimitEnabled(
      limits.monthlyCostLimitUsd
    ) &&
    usage.monthly
      .unpricedRequests >
      0
  ) {
    return {
      allowed:
        false,

      code:
        "AI_COST_ACCOUNTING_UNAVAILABLE",

      limits,

      usage,

      retryAfterSeconds:
        getAccountingRetrySeconds(),
    };
  }

  /*
   * ==========================================
   * Monthly Cost Limit
   * ==========================================
   */

  if (
    currentLimitReached(
      monthlyCostWithPending,
      limits.monthlyCostLimitUsd
    ) ||
    reservationWouldExceedLimit(
      monthlyCostWithPending,
      reservedCostUsd,
      limits.monthlyCostLimitUsd
    )
  ) {
    return {
      allowed:
        false,

      code:
        "AI_MONTHLY_COST_LIMIT_REACHED",

      limits,

      usage,

      retryAfterSeconds:
        secondsUntil(
          month.to
        ),
    };
  }

  /*
   * ==========================================
   * Warnings
   *
   * Warningها بر اساس Usage واقعی ذخیره‌شده
   * هستند، نه Reservation احتمالی.
   * ==========================================
   */

  const warnings =
    buildWarnings(
      limits,
      usage
    );

  return {
    allowed:
      true,

    limits,

    usage,

    warnings,
  };
}

/*
 * ============================================
 * Account-specific Limit
 * ============================================
 */

async function getAccountAILimit(
  pb:
    Awaited<
      ReturnType<
        typeof getPocketBaseServiceClient
      >
    >,

  userId:
    string
): Promise<
  AccountAILimitRecord |
  null
> {
  try {
    return await pb
      .collection(
        "account_ai_limits"
      )
      .getFirstListItem<AccountAILimitRecord>(
        pb.filter(
          "user = {:userId}",
          {
            userId,
          }
        )
      );
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
 * Effective Limits
 * ============================================
 */

function resolveLimits(
  accountLimit:
    AccountAILimitRecord |
    null
): AIBudgetLimits {
  const defaultDailyTokens =
    environmentNumber(
      process.env
        .AI_DEFAULT_DAILY_TOKEN_LIMIT,
      0,
      100_000_000,
      200_000
    );

  const defaultMonthlyTokens =
    environmentNumber(
      process.env
        .AI_DEFAULT_MONTHLY_TOKEN_LIMIT,
      0,
      1_000_000_000,
      4_000_000
    );

  const defaultDailyCost =
    environmentNumber(
      process.env
        .AI_DEFAULT_DAILY_COST_LIMIT_USD,
      0,
      100_000,
      2
    );

  const defaultMonthlyCost =
    environmentNumber(
      process.env
        .AI_DEFAULT_MONTHLY_COST_LIMIT_USD,
      0,
      1_000_000,
      40
    );

  const defaultWarningPercent =
    environmentNumber(
      process.env
        .AI_USAGE_WARNING_PERCENT,
      1,
      100,
      80
    );

  const useOverride =
    accountLimit?.enabled ===
    true;

  if (
    !useOverride
  ) {
    return {
      dailyTokenLimit:
        defaultDailyTokens,

      monthlyTokenLimit:
        defaultMonthlyTokens,

      dailyCostLimitUsd:
        defaultDailyCost,

      monthlyCostLimitUsd:
        defaultMonthlyCost,

      warningPercent:
        defaultWarningPercent,

      source:
        "default",
    };
  }

  return {
    dailyTokenLimit:
      positiveOrFallback(
        accountLimit
          ?.daily_token_limit,
        defaultDailyTokens
      ),

    monthlyTokenLimit:
      positiveOrFallback(
        accountLimit
          ?.monthly_token_limit,
        defaultMonthlyTokens
      ),

    dailyCostLimitUsd:
      positiveOrFallback(
        accountLimit
          ?.daily_cost_limit_usd,
        defaultDailyCost
      ),

    monthlyCostLimitUsd:
      positiveOrFallback(
        accountLimit
          ?.monthly_cost_limit_usd,
        defaultMonthlyCost
      ),

    warningPercent:
      positiveOrFallback(
        accountLimit
          ?.warning_percent,
        defaultWarningPercent,
        100
      ),

    source:
      "account_override",
  };
}

/*
 * ============================================
 * Reservation
 * ============================================
 */

function normalizeReservation(
  reservation:
    AIBudgetReservation |
    undefined
): NormalizedReservation {
  if (
    !reservation
  ) {
    return {
      model:
        "",

      inputTokens:
        0,

      outputTokens:
        0,

      totalTokens:
        0,
    };
  }

  const model =
    String(
      reservation.model ||
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
    throw new Error(
      "AI budget reservation requires a valid model"
    );
  }

  const inputTokens =
    toSafeReservationInteger(
      reservation.inputTokens
    );

  const outputTokens =
    toSafeReservationInteger(
      reservation.outputTokens
    );

  const totalTokens =
    safeAdd(
      inputTokens,
      outputTokens
    );

  return {
    model,

    inputTokens,

    outputTokens,

    totalTokens,
  };
}

function toSafeReservationInteger(
  value:
    unknown
) {
  const parsed =
    Number(
      value
    );

  if (
    !Number.isSafeInteger(
      parsed
    ) ||
    parsed <
      0
  ) {
    throw new Error(
      "AI budget reservation token count is invalid"
    );
  }

  return parsed;
}

function safeAdd(
  first:
    number,

  second:
    number
) {
  const total =
    first +
    second;

  if (
    !Number.isSafeInteger(
      total
    ) ||
    total <
      0
  ) {
    throw new Error(
      "AI budget reservation token total is invalid"
    );
  }

  return total;
}

/*
 * ============================================
 * Optional Reservation Request ID
 * ============================================
 */

function normalizeOptionalRequestId(
  value:
    string |
    undefined
) {
  if (
    value ===
    undefined
  ) {
    return "";
  }

  const clean =
    String(
      value ||
        ""
    ).trim();

  if (
    !REQUEST_ID_PATTERN.test(
      clean
    )
  ) {
    throw new Error(
      "AI budget guard received an invalid reservation request id"
    );
  }

  return clean;
}

/*
 * ============================================
 * Budget Amount Addition
 *
 * اگر داده خراب/بیش از محدوده عدد امن باشد،
 * fail-closed رفتار می‌کنیم و مقدار بسیار بزرگ
 * برمی‌گردانیم تا Guard اجازه عبور ندهد.
 * ============================================
 */

function addBudgetAmounts(
  first:
    number,

  second:
    number
) {
  const left =
    safePositiveNumber(
      first
    );

  const right =
    safePositiveNumber(
      second
    );

  const total =
    left +
    right;

  if (
    !Number.isFinite(
      total
    ) ||
    total >
      Number.MAX_SAFE_INTEGER
  ) {
    return Number.MAX_SAFE_INTEGER;
  }

  return total;
}

/*
 * ============================================
 * Usage Summary
 * ============================================
 */

function summarizeUsage(
  records:
    AIUsageBudgetRecord[]
): AIBudgetPeriodUsage {
  let tokens =
    0;

  let costUsd =
    0;

  let pricedRequests =
    0;

  let unpricedRequests =
    0;

  for (
    const record of
    records
  ) {
    tokens +=
      safePositiveNumber(
        record.total_tokens
      );

    if (
      record.cost_available ===
      true
    ) {
      costUsd +=
        safePositiveNumber(
          record.estimated_cost_usd
        );

      pricedRequests +=
        1;
    } else {
      unpricedRequests +=
        1;
    }
  }

  return {
    tokens,

    costUsd,

    pricedRequests,

    unpricedRequests,

    requests:
      records.length,
  };
}

/*
 * ============================================
 * Warnings
 * ============================================
 */

function buildWarnings(
  limits:
    AIBudgetLimits,

  usage:
    AIBudgetUsage
): AIBudgetWarning[] {
  const warnings:
    AIBudgetWarning[] =
    [];

  appendWarning(
    warnings,
    "daily_tokens",
    usage.daily.tokens,
    limits.dailyTokenLimit,
    limits.warningPercent
  );

  appendWarning(
    warnings,
    "monthly_tokens",
    usage.monthly.tokens,
    limits.monthlyTokenLimit,
    limits.warningPercent
  );

  if (
    usage.daily
      .unpricedRequests ===
    0
  ) {
    appendWarning(
      warnings,
      "daily_cost",
      usage.daily.costUsd,
      limits.dailyCostLimitUsd,
      limits.warningPercent
    );
  }

  if (
    usage.monthly
      .unpricedRequests ===
    0
  ) {
    appendWarning(
      warnings,
      "monthly_cost",
      usage.monthly.costUsd,
      limits.monthlyCostLimitUsd,
      limits.warningPercent
    );
  }

  return warnings;
}

function appendWarning(
  warnings:
    AIBudgetWarning[],

  type:
    AIBudgetWarning["type"],

  used:
    number,

  limit:
    number,

  warningPercent:
    number
) {
  if (
    limit <=
    0
  ) {
    return;
  }

  const percent =
    (
      used /
      limit
    ) *
    100;

  if (
    percent >=
    warningPercent
  ) {
    warnings.push({
      type,

      percent,
    });
  }
}

/*
 * ============================================
 * Limit Checks
 * ============================================
 */

function currentLimitReached(
  used:
    number,

  limit:
    number
) {
  if (
    limit <=
    0
  ) {
    return false;
  }

  return (
    used >=
    limit
  );
}

function reservationWouldExceedLimit(
  used:
    number,

  reserved:
    number,

  limit:
    number
) {
  if (
    limit <=
      0 ||
    reserved <=
      0
  ) {
    return false;
  }

  /*
   * به‌جای used + reserved مستقیم، این فرم
   * در برابر Overflow امن‌تر است.
   */
  const remaining =
    Math.max(
      0,
      limit -
        used
    );

  return (
    reserved >
    remaining
  );
}

function costLimitEnabled(
  limit:
    number
) {
  return (
    Number.isFinite(
      limit
    ) &&
    limit >
      0
  );
}

/*
 * ============================================
 * Accounting Retry
 * ============================================
 */

function getAccountingRetrySeconds() {
  return environmentInteger(
    process.env
      .AI_COST_ACCOUNTING_RETRY_SECONDS,
    30,
    3600,
    300
  );
}

/*
 * ============================================
 * Date Range
 * ============================================
 */

function isInsideRange(
  value:
    unknown,

  from:
    Date,

  to:
    Date
) {
  const timestamp =
    Date.parse(
      String(
        value ||
          ""
      )
    );

  if (
    !Number.isFinite(
      timestamp
    )
  ) {
    return false;
  }

  return (
    timestamp >=
      from.getTime() &&
    timestamp <
      to.getTime()
  );
}

function secondsUntil(
  date:
    Date
) {
  return Math.max(
    1,
    Math.ceil(
      (
        date.getTime() -
        Date.now()
      ) /
        1000
    )
  );
}

/*
 * ============================================
 * Numbers
 * ============================================
 */

function safePositiveNumber(
  value:
    unknown
) {
  const parsed =
    Number(
      value
    );

  if (
    !Number.isFinite(
      parsed
    )
  ) {
    return 0;
  }

  return Math.max(
    0,
    parsed
  );
}

function positiveOrFallback(
  value:
    unknown,

  fallback:
    number,

  maximum =
    Number.MAX_SAFE_INTEGER
) {
  const parsed =
    Number(
      value
    );

  if (
    !Number.isFinite(
      parsed
    ) ||
    parsed <=
      0
  ) {
    return fallback;
  }

  return Math.min(
    parsed,
    maximum
  );
}

function environmentNumber(
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
    !Number.isFinite(
      parsed
    )
  ) {
    return fallback;
  }

  return Math.min(
    Math.max(
      parsed,
      minimum
    ),
    maximum
  );
}

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
    Math.max(
      parsed,
      minimum
    ),
    maximum
  );
}

/*
 * ============================================
 * Error
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
