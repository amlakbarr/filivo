import "server-only";

import {
  randomUUID,
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
 * Actions
 * ============================================
 */

export type AdminRateLimitAction =
  | "account.create"
  | "account.update"
  | "account.password"
  | "account.status"
  | "account.ai_limit"
  | "account.ai_budget_summary"
  | "account.sessions.revoke"
  | "knowledge.create"
  | "knowledge.update"
  | "knowledge.delete"
  | "knowledge.archive"
  | "knowledge.sync"
  | "knowledge.sync_batch"
  | "knowledge_gap.update"
  | "knowledge_gap.resolve"
  | "knowledge.search";

/*
 * ============================================
 * Result
 * ============================================
 */

export type AdminRateLimitResult =
  | {
      allowed:
        true;

      limit:
        number;

      remaining:
        number;

      resetAt:
        string;
    }
  | {
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
    };

/*
 * ============================================
 * Policy
 * ============================================
 */

type AdminRateLimitPolicy = {
  maxRequests:
    number;

  windowMilliseconds:
    number;
};

/*
 * ============================================
 * PocketBase Records
 * ============================================
 */

type AdminRateLimitRecord =
  RecordModel & {
    fingerprint?:
      string;

    admin?:
      string;

    action?:
      string;

    window_started_at?:
      string;

    request_count?:
      number;

    blocked_until?:
      string;

    last_request_at?:
      string;
  };

type AdminRateLimitLockRecord =
  RecordModel & {
    fingerprint?:
      string;

    request_id?:
      string;

    acquired_at?:
      string;

    expires_at?:
      string;
  };

/*
 * ============================================
 * Constants
 * ============================================
 */

/*
 * Lock فقط برای Atomic-like Counter Consume
 * استفاده می‌شود.
 *
 * اگر Process به هر دلیل قبل از Release متوقف
 * شود، Lock حداکثر چند ثانیه باقی می‌ماند.
 */
const LOCK_TTL_MILLISECONDS =
  5_000;

/*
 * در صورت وجود Request همزمان، چند بار برای
 * گرفتن Lock تلاش می‌کنیم.
 */
const LOCK_RETRY_ATTEMPTS =
  12;

const LOCK_RETRY_BASE_MILLISECONDS =
  35;

const LOCK_RETRY_MAX_MILLISECONDS =
  150;

/*
 * Record ID Validation
 */
const RECORD_ID_PATTERN =
  /^[a-zA-Z0-9_-]{1,64}$/;

/*
 * ============================================
 * Policies
 *
 * تمام Policyهای Admin در یک نقطه قرار دارند.
 * ============================================
 */

const ADMIN_RATE_LIMIT_POLICIES:
  Readonly<
    Record<
      AdminRateLimitAction,
      AdminRateLimitPolicy
    >
  > = {
  /*
   * ==========================================
   * Accounts
   * ==========================================
   */

  "account.create": {
    maxRequests:
      10,

    windowMilliseconds:
      minutes(
        10
      ),
  },

  "account.update": {
    maxRequests:
      20,

    windowMilliseconds:
      minutes(
        1
      ),
  },

  "account.password": {
    maxRequests:
      5,

    windowMilliseconds:
      minutes(
        10
      ),
  },

  "account.status": {
    maxRequests:
      20,

    windowMilliseconds:
      minutes(
        1
      ),
  },

  "account.ai_limit": {
    maxRequests:
      20,

    windowMilliseconds:
      minutes(
        1
      ),
  },

  /*
   * Read-only but expensive aggregation.
   *
   * هر Request می‌تواند وضعیت Budget حداکثر
   * 50 کاربر را بررسی کند و هر Budget Guard
   * نیز ممکن است چند Query اجرا کند.
   */
  "account.ai_budget_summary": {
    maxRequests:
      5,

    windowMilliseconds:
      minutes(
        1
      ),
  },

  "account.sessions.revoke": {
    maxRequests:
      10,

    windowMilliseconds:
      minutes(
        1
      ),
  },

  /*
   * ==========================================
   * Knowledge
   * ==========================================
   */

  "knowledge.create": {
    maxRequests:
      10,

    windowMilliseconds:
      minutes(
        1
      ),
  },

  "knowledge.update": {
    maxRequests:
      20,

    windowMilliseconds:
      minutes(
        1
      ),
  },

  "knowledge.delete": {
    maxRequests:
      5,

    windowMilliseconds:
      minutes(
        1
      ),
  },

  "knowledge.archive": {
    maxRequests:
      10,

    windowMilliseconds:
      minutes(
        1
      ),
  },

  "knowledge.sync": {
    maxRequests:
      5,

    windowMilliseconds:
      minutes(
        1
      ),
  },

  "knowledge.sync_batch": {
    maxRequests:
      2,

    windowMilliseconds:
      minutes(
        1
      ),
  },

  /*
   * ==========================================
   * Knowledge Gaps
   * ==========================================
   */

  "knowledge_gap.update": {
    maxRequests:
      20,

    windowMilliseconds:
      minutes(
        1
      ),
  },

  "knowledge_gap.resolve": {
    maxRequests:
      10,

    windowMilliseconds:
      minutes(
        1
      ),
  },

  /*
   * ==========================================
   * Search
   * ==========================================
   */

  "knowledge.search": {
    maxRequests:
      30,

    windowMilliseconds:
      minutes(
        1
      ),
  },
};

/*
 * ============================================
 * Consume Admin Rate Limit
 *
 * Fail-closed:
 *
 * اگر Infrastructure این Rate Limiter خطا دهد
 * Exception به Caller منتقل می‌شود.
 *
 * Routeهای حساس باید در این حالت Mutation را
 * اجرا نکنند و 503 برگردانند.
 * ============================================
 */

export async function consumeAdminRateLimit({
  adminId,
  action,
  requestId,
}: {
  adminId:
    string;

  action:
    AdminRateLimitAction;

  requestId?:
    string;
}): Promise<AdminRateLimitResult> {
  /*
   * ==========================================
   * Defensive Validation
   * ==========================================
   */

  if (
    !isSafeRecordId(
      adminId
    )
  ) {
    throw new Error(
      "Invalid admin id for rate limit"
    );
  }

  const policy =
    ADMIN_RATE_LIMIT_POLICIES[
      action
    ];

  if (
    !policy
  ) {
    throw new Error(
      "Unknown admin rate limit action"
    );
  }

  const effectiveRequestId =
    isSafeRequestId(
      requestId
    )
      ? requestId
      : randomUUID();

  /*
   * ==========================================
   * Service Client
   * ==========================================
   */

  const pb =
    await getPocketBaseServiceClient();

  /*
   * fingerprint intentionally includes only
   * stable server-known values.
   *
   * Target account/knowledge ID وارد fingerprint
   * نمی‌شود تا Admin نتواند با تغییر Target
   * محدودیت را دور بزند.
   */
  const fingerprint =
    createFingerprint(
      adminId,
      action
    );

  /*
   * ==========================================
   * Acquire Lock
   * ==========================================
   */

  await acquireRateLimitLock({
    pb,

    fingerprint,

    requestId:
      effectiveRequestId,
  });

  /*
   * ==========================================
   * Consume + Always Release
   * ==========================================
   */

  try {
    return await consumeLockedRateLimit({
      pb,

      adminId,

      action,

      fingerprint,

      policy,
    });
  } finally {
    await releaseRateLimitLock({
      pb,

      fingerprint,

      requestId:
        effectiveRequestId,
    });
  }
}

/*
 * ============================================
 * Locked Consume
 * ============================================
 */

async function consumeLockedRateLimit({
  pb,
  adminId,
  action,
  fingerprint,
  policy,
}: {
  pb:
    PocketBase;

  adminId:
    string;

  action:
    AdminRateLimitAction;

  fingerprint:
    string;

  policy:
    AdminRateLimitPolicy;
}): Promise<AdminRateLimitResult> {
  const now =
    new Date();

  /*
   * ==========================================
   * Load Existing Counter
   * ==========================================
   */

  let record =
    await findRateLimitRecord(
      pb,
      fingerprint
    );

  /*
   * ==========================================
   * First Request
   * ==========================================
   */

  if (
    !record
  ) {
    const windowStartedAt =
      now;

    const resetAt =
      new Date(
        windowStartedAt.getTime() +
          policy.windowMilliseconds
      );

    try {
      await pb
        .collection(
          "admin_rate_limits"
        )
        .create({
          fingerprint,

          admin:
            adminId,

          action,

          window_started_at:
            windowStartedAt
              .toISOString(),

          request_count:
            1,

          blocked_until:
            "",

          last_request_at:
            now.toISOString(),
        });

      return {
        allowed:
          true,

        limit:
          policy.maxRequests,

        remaining:
          Math.max(
            0,
            policy.maxRequests -
              1
          ),

        resetAt:
          resetAt.toISOString(),
      };
    } catch (error) {
      /*
       * Lock عملاً باید Create Race را حذف کند.
       * اما اگر یک Record قدیمی/Concurrent وجود
       * داشت، دوباره Lookup می‌کنیم.
       */

      record =
        await findRateLimitRecord(
          pb,
          fingerprint
        );

      if (
        !record
      ) {
        throw error;
      }
    }
  }

  /*
   * ==========================================
   * Existing Record
   * ==========================================
   */

  const blockedUntil =
    parseDate(
      record.blocked_until
    );

  /*
   * ==========================================
   * Explicit Block
   * ==========================================
   */

  if (
    blockedUntil &&
    blockedUntil.getTime() >
      now.getTime()
  ) {
    return {
      allowed:
        false,

      code:
        "ADMIN_RATE_LIMITED",

      limit:
        policy.maxRequests,

      remaining:
        0,

      retryAfterSeconds:
        secondsUntil(
          blockedUntil,
          now
        ),

      resetAt:
        blockedUntil
          .toISOString(),
    };
  }

  /*
   * ==========================================
   * Window
   * ==========================================
   */

  const storedWindowStartedAt =
    parseDate(
      record.window_started_at
    );

  const windowExpired =
    !storedWindowStartedAt ||
    now.getTime() -
      storedWindowStartedAt
        .getTime() >=
      policy.windowMilliseconds;

  /*
   * ==========================================
   * New Window
   * ==========================================
   */

  if (
    windowExpired
  ) {
    const resetAt =
      new Date(
        now.getTime() +
          policy.windowMilliseconds
      );

    await pb
      .collection(
        "admin_rate_limits"
      )
      .update(
        record.id,
        {
          /*
           * admin/action نیز repair می‌شوند اگر
           * یک Record Legacy ناسازگار باشد.
           */
          admin:
            adminId,

          action,

          window_started_at:
            now.toISOString(),

          request_count:
            1,

          blocked_until:
            "",

          last_request_at:
            now.toISOString(),
        }
      );

    return {
      allowed:
        true,

      limit:
        policy.maxRequests,

      remaining:
        Math.max(
          0,
          policy.maxRequests -
            1
        ),

      resetAt:
        resetAt.toISOString(),
    };
  }

  /*
   * ==========================================
   * Valid Active Window
   * ==========================================
   */

  const windowStartedAt =
    storedWindowStartedAt;

  const resetAt =
    new Date(
      windowStartedAt.getTime() +
        policy.windowMilliseconds
    );

  const requestCount =
    toNonNegativeInteger(
      record.request_count
    );

  /*
   * ==========================================
   * Threshold Reached
   *
   * Example:
   *
   * max = 5
   *
   * request 1..5 → allowed
   * request 6    → blocked
   * ==========================================
   */

  if (
    requestCount >=
    policy.maxRequests
  ) {
    /*
     * Defensive:
     * اگر به دلیل Clock/Data inconsistency
     * resetAt گذشته باشد، حداقل یک ثانیه Block
     * ایجاد می‌کنیم.
     */
    const effectiveBlockUntil =
      resetAt.getTime() >
      now.getTime()
        ? resetAt
        : new Date(
            now.getTime() +
              1000
          );

    await pb
      .collection(
        "admin_rate_limits"
      )
      .update(
        record.id,
        {
          blocked_until:
            effectiveBlockUntil
              .toISOString(),

          last_request_at:
            now.toISOString(),
        }
      );

    return {
      allowed:
        false,

      code:
        "ADMIN_RATE_LIMITED",

      limit:
        policy.maxRequests,

      remaining:
        0,

      retryAfterSeconds:
        secondsUntil(
          effectiveBlockUntil,
          now
        ),

      resetAt:
        effectiveBlockUntil
          .toISOString(),
    };
  }

  /*
   * ==========================================
   * Consume Request
   * ==========================================
   */

  const nextRequestCount =
    requestCount +
    1;

  await pb
    .collection(
      "admin_rate_limits"
    )
    .update(
      record.id,
      {
        admin:
          adminId,

        action,

        request_count:
          nextRequestCount,

        blocked_until:
          "",

        last_request_at:
          now.toISOString(),
      }
    );

  return {
    allowed:
      true,

    limit:
      policy.maxRequests,

    remaining:
      Math.max(
        0,
        policy.maxRequests -
          nextRequestCount
      ),

    resetAt:
      resetAt.toISOString(),
  };
}

/*
 * ============================================
 * Acquire Lock
 * ============================================
 */

async function acquireRateLimitLock({
  pb,
  fingerprint,
  requestId,
}: {
  pb:
    PocketBase;

  fingerprint:
    string;

  requestId:
    string;
}) {
  /*
   * ==========================================
   * Retry Loop
   * ==========================================
   */

  for (
    let attempt =
      0;

    attempt <
    LOCK_RETRY_ATTEMPTS;

    attempt +=
      1
  ) {
    const now =
      new Date();

    /*
     * ========================================
     * Existing Lock
     * ========================================
     */

    const existing =
      await findLockRecord(
        pb,
        fingerprint
      );

    if (
      existing
    ) {
      /*
       * ======================================
       * Lock Already Belongs to This Request
       * ======================================
       */

      if (
        existing.request_id ===
        requestId
      ) {
        const existingExpiry =
          parseDate(
            existing.expires_at
          );

        if (
          existingExpiry &&
          existingExpiry.getTime() >
            now.getTime()
        ) {
          return;
        }
      }

      /*
       * ======================================
       * Stale Lock
       * ======================================
       */

      const expiresAt =
        parseDate(
          existing.expires_at
        );

      if (
        !expiresAt ||
        expiresAt.getTime() <=
          now.getTime()
      ) {
        try {
          await pb
            .collection(
              "admin_rate_limit_locks"
            )
            .delete(
              existing.id
            );
        } catch (error) {
          /*
           * 404 یعنی Request دیگری قبلاً Lock
           * stale را حذف کرده است.
           */
          if (
            getErrorStatus(
              error
            ) !==
            404
          ) {
            /*
             * ممکن است Request دیگری Lock را
             * جایگزین کرده باشد؛ در Retry بعدی
             * دوباره وضعیت را بررسی می‌کنیم.
             */
          }
        }
      } else {
        /*
         * Lock معتبر مربوط به Request دیگر است.
         */
        await sleep(
          lockRetryDelay(
            attempt
          )
        );

        continue;
      }
    }

    /*
     * ========================================
     * Create Lock
     * ========================================
     */

    const acquiredAt =
      new Date();

    const expiresAt =
      new Date(
        acquiredAt.getTime() +
          LOCK_TTL_MILLISECONDS
      );

    try {
      await pb
        .collection(
          "admin_rate_limit_locks"
        )
        .create({
          fingerprint,

          request_id:
            requestId,

          acquired_at:
            acquiredAt
              .toISOString(),

          expires_at:
            expiresAt
              .toISOString(),
        });

      return;
    } catch {
      /*
       * معمولاً Unique Constraint collision
       * است چون Request دیگری چند میلی‌ثانیه
       * زودتر Lock را گرفته است.
       */

      const current =
        await findLockRecord(
          pb,
          fingerprint
        );

      if (
        current?.request_id ===
        requestId
      ) {
        const currentExpiry =
          parseDate(
            current.expires_at
          );

        if (
          currentExpiry &&
          currentExpiry.getTime() >
            Date.now()
        ) {
          return;
        }
      }

      await sleep(
        lockRetryDelay(
          attempt
        )
      );
    }
  }

  /*
   * ==========================================
   * Lock Timeout
   *
   * به‌جای bypass کردن Rate Limit، fail-closed
   * می‌کنیم.
   * ==========================================
   */

  throw new AdminRateLimitUnavailableError(
    "Admin rate-limit lock could not be acquired"
  );
}

/*
 * ============================================
 * Release Lock
 *
 * فقط Lock متعلق به همان request_id حذف می‌شود.
 * ============================================
 */

async function releaseRateLimitLock({
  pb,
  fingerprint,
  requestId,
}: {
  pb:
    PocketBase;

  fingerprint:
    string;

  requestId:
    string;
}) {
  try {
    const lock =
      await pb
        .collection(
          "admin_rate_limit_locks"
        )
        .getFirstListItem<AdminRateLimitLockRecord>(
          pb.filter(
            "fingerprint = {:fingerprint} && request_id = {:requestId}",
            {
              fingerprint,

              requestId,
            }
          )
        );

    try {
      await pb
        .collection(
          "admin_rate_limit_locks"
        )
        .delete(
          lock.id
        );
    } catch (error) {
      if (
        getErrorStatus(
          error
        ) !==
        404
      ) {
        /*
         * Release failure نباید نتیجه Rate Limit
         * موفق را خراب کند.
         *
         * Lock TTL کوتاه است و خودکار Stale
         * محسوب خواهد شد.
         */
        console.error(
          "Admin rate-limit lock release failed",
          {
            fingerprint,

            requestId,

            error:
              safeErrorMetadata(
                error
              ),
          }
        );
      }
    }
  } catch (error) {
    if (
      getErrorStatus(
        error
      ) !==
      404
    ) {
      console.error(
        "Admin rate-limit lock lookup during release failed",
        {
          fingerprint,

          requestId,

          error:
            safeErrorMetadata(
              error
            ),
        }
      );
    }
  }
}

/*
 * ============================================
 * Find Rate Limit Record
 * ============================================
 */

async function findRateLimitRecord(
  pb:
    PocketBase,

  fingerprint:
    string
): Promise<
  AdminRateLimitRecord |
  null
> {
  try {
    return await pb
      .collection(
        "admin_rate_limits"
      )
      .getFirstListItem<AdminRateLimitRecord>(
        pb.filter(
          "fingerprint = {:fingerprint}",
          {
            fingerprint,
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
 * Find Lock
 * ============================================
 */

async function findLockRecord(
  pb:
    PocketBase,

  fingerprint:
    string
): Promise<
  AdminRateLimitLockRecord |
  null
> {
  try {
    return await pb
      .collection(
        "admin_rate_limit_locks"
      )
      .getFirstListItem<AdminRateLimitLockRecord>(
        pb.filter(
          "fingerprint = {:fingerprint}",
          {
            fingerprint,
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
 * Fingerprint
 *
 * adminId + action
 *
 * Target ID عمداً وارد Bucket نمی‌شود.
 * ============================================
 */

function createFingerprint(
  adminId:
    string,

  action:
    AdminRateLimitAction
) {
  /*
   * تمام مقادیر محدود و server-controlled
   * هستند، بنابراین fingerprint خوانا و قابل
   * Debug نگه داشته می‌شود.
   */
  return [
    "admin",
    adminId,
    "action",
    action,
  ].join(
    ":"
  );
}

/*
 * ============================================
 * Export Policy Information
 *
 * برای Debug/Test در صورت نیاز مفید است.
 * ============================================
 */

export function getAdminRateLimitPolicy(
  action:
    AdminRateLimitAction
) {
  const policy =
    ADMIN_RATE_LIMIT_POLICIES[
      action
    ];

  return {
    maxRequests:
      policy.maxRequests,

    windowSeconds:
      Math.ceil(
        policy.windowMilliseconds /
          1000
      ),
  };
}

/*
 * ============================================
 * Error Type
 * ============================================
 */

export class AdminRateLimitUnavailableError
  extends Error {
  constructor(
    message =
      "Admin rate limit unavailable"
  ) {
    super(
      message
    );

    this.name =
      "AdminRateLimitUnavailableError";
  }
}

/*
 * ============================================
 * Time
 * ============================================
 */

function minutes(
  value:
    number
) {
  return (
    value *
    60 *
    1000
  );
}

function secondsUntil(
  target:
    Date,

  now:
    Date
) {
  return Math.max(
    1,
    Math.ceil(
      (
        target.getTime() -
        now.getTime()
      ) /
        1000
    )
  );
}

/*
 * ============================================
 * Parse Date
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
 * Integer
 * ============================================
 */

function toNonNegativeInteger(
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
    return 0;
  }

  return parsed;
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
    value
  );
}

/*
 * ============================================
 * Request ID
 * ============================================
 */

function isSafeRequestId(
  value:
    string |
    undefined
): value is string {
  if (
    !value
  ) {
    return false;
  }

  return /^[a-zA-Z0-9_-]{1,128}$/.test(
    value
  );
}

/*
 * ============================================
 * Lock Retry Delay
 * ============================================
 */

function lockRetryDelay(
  attempt:
    number
) {
  /*
   * Linear-ish backoff با jitter کوچک.
   */
  const base =
    Math.min(
      LOCK_RETRY_MAX_MILLISECONDS,
      LOCK_RETRY_BASE_MILLISECONDS *
        (
          attempt +
          1
        )
    );

  const jitter =
    Math.floor(
      Math.random() *
        20
    );

  return (
    base +
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