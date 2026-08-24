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

export type ChatRateLimitResult =
  | {
      allowed:
        true;

      remainingWindow:
        number;

      remainingDaily:
        number;
    }
  | {
      allowed:
        false;

      code:
        | "CHAT_RATE_LIMITED"
        | "CHAT_DAILY_LIMIT_REACHED";

      retryAfterSeconds?:
        number;
    };

export type ChatRequestLockResult =
  | {
      acquired:
        true;
    }
  | {
      acquired:
        false;

      retryAfterSeconds:
        number;
    };

type ChatRateLimitRecord =
  RecordModel & {
    user?:
      string;

    window_started_at?:
      string;

    request_count?:
      number;

    blocked_until?:
      string;

    daily_key?:
      string;

    daily_count?:
      number;

    last_request_at?:
      string;
  };

type ChatRequestLockRecord =
  RecordModel & {
    user?:
      string;

    request_id?:
      string;

    conversation?:
      string;

    acquired_at?:
      string;

    expires_at?:
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

/*
 * ============================================
 * Lock Retry
 * ============================================
 */

const LOCK_RETRY_ATTEMPTS =
  8;

const LOCK_RETRY_BASE_MILLISECONDS =
  30;

const LOCK_RETRY_MAX_MILLISECONDS =
  120;

/*
 * ============================================
 * Acquire Request Lock
 *
 * فقط یک Chat Request برای هر Account
 * می‌تواند همزمان وارد مرحله AI شود.
 * ============================================
 */

export async function acquireChatRequestLock({
  userId,
  conversationId,
  requestId,
}: {
  userId:
    string;

  conversationId:
    string;

  requestId:
    string;
}): Promise<ChatRequestLockResult> {
  validateLockArguments({
    userId,

    conversationId,

    requestId,
  });

  const pb =
    await getPocketBaseServiceClient();

  const lockSeconds =
    getChatRequestLockSeconds();

  /*
   * Retry Loop برای Raceهای بسیار کوتاه
   * هنگام حذف Lock stale و Create مجدد.
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

    const existing =
      await findChatRequestLock(
        pb,
        userId
      );

    /*
     * ========================================
     * Existing Lock
     * ========================================
     */

    if (
      existing
    ) {
      const expiresAt =
        parseDate(
          existing.expires_at
        );

      /*
       * ======================================
       * Valid Lock
       * ======================================
       */

      if (
        expiresAt &&
        expiresAt.getTime() >
          now.getTime()
      ) {
        /*
         * Idempotent internal retry.
         */
        if (
          existing.request_id ===
          requestId
        ) {
          return {
            acquired:
              true,
          };
        }

        return {
          acquired:
            false,

          retryAfterSeconds:
            secondsUntil(
              expiresAt,
              now
            ),
        };
      }

      /*
       * ======================================
       * Stale Lock
       * ======================================
       */

      try {
        await pb
          .collection(
            "chat_request_locks"
          )
          .delete(
            existing.id
          );
      } catch (error) {
        /*
         * Request دیگری ممکن است همان Lock
         * stale را قبلاً حذف کرده باشد.
         */
        if (
          getErrorStatus(
            error
          ) !==
          404
        ) {
          /*
           * به‌جای Fail فوری، یک Retry کوتاه
           * انجام می‌دهیم.
           */
          if (
            attempt ===
            LOCK_RETRY_ATTEMPTS -
              1
          ) {
            throw error;
          }
        }
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
          lockSeconds *
            1000
      );

    try {
      await pb
        .collection(
          "chat_request_locks"
        )
        .create({
          user:
            userId,

          request_id:
            requestId,

          conversation:
            conversationId,

          acquired_at:
            acquiredAt.toISOString(),

          expires_at:
            expiresAt.toISOString(),
        });

      return {
        acquired:
          true,
      };
    } catch (error) {
      /*
       * معمولاً Unique(user) collision است.
       *
       * وضعیت واقعی Lock دوباره خوانده می‌شود.
       */

      const current =
        await findChatRequestLock(
          pb,
          userId
        );

      if (
        current
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
          if (
            current.request_id ===
            requestId
          ) {
            return {
              acquired:
                true,
            };
          }

          return {
            acquired:
              false,

            retryAfterSeconds:
              secondsUntil(
                currentExpiry,
                new Date()
              ),
          };
        }
      }

      if (
        attempt ===
        LOCK_RETRY_ATTEMPTS -
          1
      ) {
        throw error;
      }

      await sleep(
        lockRetryDelay(
          attempt
        )
      );
    }
  }

  throw new Error(
    "Chat request lock could not be acquired"
  );
}

/*
 * ============================================
 * Refresh Request Lock
 *
 * قبل از شروع عملیات طولانی OpenAI صدا زده
 * می‌شود تا Lock از حالا دوباره TTL کامل داشته
 * باشد.
 *
 * اگر Lock منقضی شده یا متعلق به Request دیگری
 * باشد، Fail-closed می‌کنیم.
 * ============================================
 */

export async function refreshChatRequestLock({
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
    ) ||
    !isSafeRequestId(
      requestId
    )
  ) {
    throw new Error(
      "Invalid chat request lock refresh arguments"
    );
  }

  const pb =
    await getPocketBaseServiceClient();

  const existing =
    await findChatRequestLock(
      pb,
      userId
    );

  if (
    !existing ||
    existing.request_id !==
      requestId
  ) {
    throw new Error(
      "Chat request lock ownership lost"
    );
  }

  const now =
    new Date();

  const currentExpiry =
    parseDate(
      existing.expires_at
    );

  /*
   * Lock منقضی‌شده دوباره revive نمی‌شود؛ چون
   * ممکن است Request دیگری در حال گرفتن Lock
   * باشد.
   */
  if (
    !currentExpiry ||
    currentExpiry.getTime() <=
      now.getTime()
  ) {
    throw new Error(
      "Chat request lock expired"
    );
  }

  const nextExpiry =
    new Date(
      now.getTime() +
        getChatRequestLockSeconds() *
          1000
    );

  try {
    await pb
      .collection(
        "chat_request_locks"
      )
      .update(
        existing.id,
        {
          expires_at:
            nextExpiry.toISOString(),
        }
      );
  } catch (error) {
    /*
     * اگر Lock بین Lookup و Update حذف شده،
     * Fail-closed می‌کنیم.
     */
    throw error;
  }
}

/*
 * ============================================
 * Release Lock
 *
 * فقط Lock همان request_id حذف می‌شود.
 * ============================================
 */

export async function releaseChatRequestLock({
  userId,
  requestId,
}: {
  userId:
    string;

  requestId:
    string;
}) {
  try {
    if (
      !isSafeRecordId(
        userId
      ) ||
      !isSafeRequestId(
        requestId
      )
    ) {
      return;
    }

    const pb =
      await getPocketBaseServiceClient();

    let record:
      ChatRequestLockRecord;

    try {
      record =
        await pb
          .collection(
            "chat_request_locks"
          )
          .getFirstListItem<ChatRequestLockRecord>(
            pb.filter(
              "user = {:userId} && request_id = {:requestId}",
              {
                userId,

                requestId,
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
        return;
      }

      throw error;
    }

    try {
      await pb
        .collection(
          "chat_request_locks"
        )
        .delete(
          record.id
        );
    } catch (error) {
      if (
        getErrorStatus(
          error
        ) !==
        404
      ) {
        throw error;
      }
    }
  } catch (error) {
    /*
     * Failure در Release نباید Response اصلی
     * Chat را خراب کند.
     */
    console.error(
      "Chat request lock release failed",
      {
        userId,

        requestId,

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
 * Consume Rate Limit
 *
 * مهم:
 * این تابع فقط وقتی Counter را مصرف می‌کند که
 * Lock فعال متعلق به همین requestId باشد.
 *
 * بنابراین Caller نمی‌تواند Rate Limit را بدون
 * Request Lock اجرا کند.
 * ============================================
 */

export async function consumeChatRateLimit({
  userId,
  requestId,
}: {
  userId:
    string;

  requestId:
    string;
}): Promise<ChatRateLimitResult> {
  if (
    !isSafeRecordId(
      userId
    ) ||
    !isSafeRequestId(
      requestId
    )
  ) {
    throw new Error(
      "Invalid chat rate limit arguments"
    );
  }

  const pb =
    await getPocketBaseServiceClient();

  /*
   * ==========================================
   * Assert Request Lock Ownership
   * ==========================================
   */

  await assertActiveChatRequestLock({
    pb,

    userId,

    requestId,
  });

  const now =
    new Date();

  const config =
    getRateLimitConfig();

  const dailyKey =
    getLocalDateKey(
      now,
      config.timezone
    );

  let record =
    await findChatRateLimit(
      pb,
      userId
    );

  /*
   * ==========================================
   * First Request
   * ==========================================
   */

  if (
    !record
  ) {
    try {
      await pb
        .collection(
          "chat_rate_limits"
        )
        .create({
          user:
            userId,

          window_started_at:
            now.toISOString(),

          request_count:
            1,

          blocked_until:
            "",

          daily_key:
            dailyKey,

          daily_count:
            1,

          last_request_at:
            now.toISOString(),
        });

      return {
        allowed:
          true,

        remainingWindow:
          Math.max(
            0,
            config.maxRequests -
              1
          ),

        remainingDaily:
          Math.max(
            0,
            config.dailyLimit -
              1
          ),
      };
    } catch (error) {
      /*
       * Unique(user) Race Recovery.
       *
       * این Race در حالت صحیح نباید رخ دهد چون
       * Request Lock Counterها را serialize
       * می‌کند، اما به‌صورت دفاعی نگه می‌داریم.
       */

      record =
        await findChatRateLimit(
          pb,
          userId
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
   * Temporary Block
   * ==========================================
   */

  const blockedUntil =
    parseDate(
      record.blocked_until
    );

  if (
    blockedUntil &&
    blockedUntil.getTime() >
      now.getTime()
  ) {
    return {
      allowed:
        false,

      code:
        "CHAT_RATE_LIMITED",

      retryAfterSeconds:
        secondsUntil(
          blockedUntil,
          now
        ),
    };
  }

  /*
   * ==========================================
   * Daily Counter
   * ==========================================
   */

  const storedDailyKey =
    String(
      record.daily_key ||
        ""
    );

  const dailyCount =
    storedDailyKey ===
    dailyKey
      ? safeCount(
          record.daily_count
        )
      : 0;

  if (
    dailyCount >=
    config.dailyLimit
  ) {
    return {
      allowed:
        false,

      code:
        "CHAT_DAILY_LIMIT_REACHED",

      retryAfterSeconds:
        secondsUntilLocalDayChanges(
          now,
          config.timezone
        ),
    };
  }

  /*
   * ==========================================
   * Short Window
   * ==========================================
   */

  let windowStartedAt =
    parseDate(
      record.window_started_at
    );

  let requestCount =
    safeCount(
      record.request_count
    );

  const windowExpired =
    !windowStartedAt ||
    now.getTime() -
      windowStartedAt.getTime() >=
      config.windowMilliseconds;

  if (
    windowExpired
  ) {
    windowStartedAt =
      now;

    requestCount =
      0;
  }

  /*
   * ==========================================
   * Burst Limit Reached
   * ==========================================
   */

  if (
    requestCount >=
    config.maxRequests
  ) {
    const safeWindowStartedAt =
      windowStartedAt ||
      now;

    const windowEndsAt =
      new Date(
        safeWindowStartedAt.getTime() +
          config.windowMilliseconds
      );

    const effectiveBlockUntil =
      windowEndsAt.getTime() >
      now.getTime()
        ? windowEndsAt
        : new Date(
            now.getTime() +
              1000
          );

    await pb
      .collection(
        "chat_rate_limits"
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
        "CHAT_RATE_LIMITED",

      retryAfterSeconds:
        secondsUntil(
          effectiveBlockUntil,
          now
        ),
    };
  }

  /*
   * ==========================================
   * Consume
   * ==========================================
   */

  const nextRequestCount =
    requestCount +
    1;

  const nextDailyCount =
    dailyCount +
    1;

  await pb
    .collection(
      "chat_rate_limits"
    )
    .update(
      record.id,
      {
        user:
          userId,

        window_started_at:
          (
            windowStartedAt ||
            now
          ).toISOString(),

        request_count:
          nextRequestCount,

        blocked_until:
          "",

        daily_key:
          dailyKey,

        daily_count:
          nextDailyCount,

        last_request_at:
          now.toISOString(),
      }
    );

  return {
    allowed:
      true,

    remainingWindow:
      Math.max(
        0,
        config.maxRequests -
          nextRequestCount
      ),

    remainingDaily:
      Math.max(
        0,
        config.dailyLimit -
          nextDailyCount
      ),
  };
}

/*
 * ============================================
 * Assert Active Request Lock
 * ============================================
 */

async function assertActiveChatRequestLock({
  pb,
  userId,
  requestId,
}: {
  pb:
    PocketBase;

  userId:
    string;

  requestId:
    string;
}) {
  const lock =
    await findChatRequestLock(
      pb,
      userId
    );

  if (
    !lock
  ) {
    throw new Error(
      "Chat request lock is missing"
    );
  }

  if (
    lock.request_id !==
    requestId
  ) {
    throw new Error(
      "Chat request lock belongs to another request"
    );
  }

  const expiresAt =
    parseDate(
      lock.expires_at
    );

  if (
    !expiresAt ||
    expiresAt.getTime() <=
      Date.now()
  ) {
    throw new Error(
      "Chat request lock has expired"
    );
  }
}

/*
 * ============================================
 * Lookups
 * ============================================
 */

async function findChatRequestLock(
  pb:
    PocketBase,

  userId:
    string
): Promise<
  ChatRequestLockRecord |
  null
> {
  try {
    return await pb
      .collection(
        "chat_request_locks"
      )
      .getFirstListItem<ChatRequestLockRecord>(
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

async function findChatRateLimit(
  pb:
    PocketBase,

  userId:
    string
): Promise<
  ChatRateLimitRecord |
  null
> {
  try {
    return await pb
      .collection(
        "chat_rate_limits"
      )
      .getFirstListItem<ChatRateLimitRecord>(
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
 * Rate Limit Config
 * ============================================
 */

function getRateLimitConfig() {
  const maxRequests =
    environmentInteger(
      process.env
        .CHAT_RATE_LIMIT_MAX_REQUESTS,
      1,
      100,
      8
    );

  const windowSeconds =
    environmentInteger(
      process.env
        .CHAT_RATE_LIMIT_WINDOW_SECONDS,
      10,
      3600,
      60
    );

  const dailyLimit =
    environmentInteger(
      process.env
        .CHAT_DAILY_LIMIT,
      1,
      10000,
      200
    );

  return {
    maxRequests,

    windowMilliseconds:
      windowSeconds *
      1000,

    dailyLimit,

    timezone:
      getAppTimezone(),
  };
}

/*
 * ============================================
 * Request Lock Config
 *
 * Default از 180 به 300 ثانیه افزایش یافته است.
 *
 * قبل از OpenAI نیز Lock Refresh می‌شود.
 * ============================================
 */

function getChatRequestLockSeconds() {
  return environmentInteger(
    process.env
      .CHAT_REQUEST_LOCK_SECONDS,
    60,
    900,
    300
  );
}

/*
 * ============================================
 * Local Day
 * ============================================
 */

function getAppTimezone() {
  const requested =
    process.env
      .APP_TIMEZONE
      ?.trim() ||
    "Asia/Tehran";

  try {
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone:
          requested,
      }
    ).format(
      new Date()
    );

    return requested;
  } catch {
    return "Asia/Tehran";
  }
}

function getLocalDateKey(
  date:
    Date,

  timezone:
    string
) {
  const parts =
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone:
          timezone,

        year:
          "numeric",

        month:
          "2-digit",

        day:
          "2-digit",
      }
    ).formatToParts(
      date
    );

  const values =
    new Map(
      parts.map(
        (
          part
        ) => [
          part.type,
          part.value,
        ]
      )
    );

  return [
    values.get(
      "year"
    ),

    values.get(
      "month"
    ),

    values.get(
      "day"
    ),
  ].join(
    "-"
  );
}

/*
 * ============================================
 * Seconds Until Local Day Changes
 * ============================================
 */

function secondsUntilLocalDayChanges(
  now:
    Date,

  timezone:
    string
) {
  const currentKey =
    getLocalDateKey(
      now,
      timezone
    );

  let low =
    now.getTime();

  let high =
    now.getTime() +
    30 *
      60 *
      60 *
      1000;

  /*
   * Safety fallback.
   */
  if (
    getLocalDateKey(
      new Date(
        high
      ),
      timezone
    ) ===
    currentKey
  ) {
    return (
      24 *
      60 *
      60
    );
  }

  /*
   * Binary Search برای اولین لحظه‌ای که
   * Local Date تغییر می‌کند.
   */
  while (
    high -
      low >
    1000
  ) {
    const middle =
      Math.floor(
        (
          low +
          high
        ) /
          2
      );

    if (
      getLocalDateKey(
        new Date(
          middle
        ),
        timezone
      ) ===
      currentKey
    ) {
      low =
        middle;
    } else {
      high =
        middle;
    }
  }

  return Math.max(
    1,
    Math.ceil(
      (
        high -
        now.getTime()
      ) /
        1000
    )
  );
}

/*
 * ============================================
 * Validation
 * ============================================
 */

function validateLockArguments({
  userId,
  conversationId,
  requestId,
}: {
  userId:
    string;

  conversationId:
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
      "Invalid chat lock user id"
    );
  }

  if (
    !isSafeRecordId(
      conversationId
    )
  ) {
    throw new Error(
      "Invalid chat lock conversation id"
    );
  }

  if (
    !isSafeRequestId(
      requestId
    )
  ) {
    throw new Error(
      "Invalid chat lock request id"
    );
  }
}

function isSafeRecordId(
  value:
    string
) {
  return RECORD_ID_PATTERN.test(
    value
  );
}

function isSafeRequestId(
  value:
    string
) {
  return REQUEST_ID_PATTERN.test(
    value
  );
}

/*
 * ============================================
 * Helpers
 * ============================================
 */

function safeCount(
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
    Math.floor(
      parsed
    )
  );
}

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

function environmentInteger(
  value:
    string |
    undefined,

  min:
    number,

  max:
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
      min
    ),
    max
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

function lockRetryDelay(
  attempt:
    number
) {
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