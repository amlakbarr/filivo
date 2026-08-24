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
 * Result
 * ============================================
 */

export type ConversationCreateRateLimitResult =
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
        "CONVERSATION_CREATE_RATE_LIMITED";

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
 * Records
 * ============================================
 */

type ConversationRateLimitRecord =
  RecordModel & {
    user?:
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

type ConversationRateLimitLockRecord =
  RecordModel & {
    user?:
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
 * Policy
 *
 * 20 conversation creations / 10 minutes / user
 * ============================================
 */

const MAX_REQUESTS =
  20;

const WINDOW_MILLISECONDS =
  10 *
  60 *
  1000;

/*
 * Lock فقط برای جلوگیری از Race بین چند
 * درخواست همزمان استفاده می‌شود.
 */
const LOCK_TTL_MILLISECONDS =
  5_000;

const LOCK_RETRY_ATTEMPTS =
  12;

const LOCK_RETRY_BASE_MILLISECONDS =
  35;

const LOCK_RETRY_MAX_MILLISECONDS =
  150;

const RECORD_ID_PATTERN =
  /^[a-zA-Z0-9_-]{1,64}$/;

/*
 * ============================================
 * Consume
 *
 * Fail-closed:
 * هر خطای Infrastructure به Caller منتقل
 * می‌شود و Route باید 503 برگرداند.
 * ============================================
 */

export async function consumeConversationCreateRateLimit({
  userId,
  requestId,
}: {
  userId:
    string;

  requestId?:
    string;
}): Promise<ConversationCreateRateLimitResult> {
  if (
    !isSafeRecordId(
      userId
    )
  ) {
    throw new Error(
      "Invalid user id for conversation rate limit"
    );
  }

  const effectiveRequestId =
    isSafeRequestId(
      requestId
    )
      ? requestId
      : randomUUID();

  const pb =
    await getPocketBaseServiceClient();

  await acquireLock({
    pb,

    userId,

    requestId:
      effectiveRequestId,
  });

  try {
    return await consumeLocked({
      pb,

      userId,
    });
  } finally {
    await releaseLock({
      pb,

      userId,

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

async function consumeLocked({
  pb,
  userId,
}: {
  pb:
    PocketBase;

  userId:
    string;
}): Promise<ConversationCreateRateLimitResult> {
  const now =
    new Date();

  let record =
    await findRateLimitRecord(
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
    const resetAt =
      new Date(
        now.getTime() +
          WINDOW_MILLISECONDS
      );

    try {
      await pb
        .collection(
          "conversation_rate_limits"
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

          last_request_at:
            now.toISOString(),
        });

      return {
        allowed:
          true,

        limit:
          MAX_REQUESTS,

        remaining:
          MAX_REQUESTS -
          1,

        resetAt:
          resetAt.toISOString(),
      };
    } catch (error) {
      /*
       * Lock باید Create Race را حذف کند، ولی
       * در صورت وجود Record دوباره Lookup
       * می‌کنیم.
       */

      record =
        await findRateLimitRecord(
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
   * Existing Explicit Block
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
        "CONVERSATION_CREATE_RATE_LIMITED",

      limit:
        MAX_REQUESTS,

      remaining:
        0,

      retryAfterSeconds:
        secondsUntil(
          blockedUntil,
          now
        ),

      resetAt:
        blockedUntil.toISOString(),
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
      storedWindowStartedAt.getTime() >=
      WINDOW_MILLISECONDS;

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
          WINDOW_MILLISECONDS
      );

    await pb
      .collection(
        "conversation_rate_limits"
      )
      .update(
        record.id,
        {
          user:
            userId,

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
        MAX_REQUESTS,

      remaining:
        MAX_REQUESTS -
        1,

      resetAt:
        resetAt.toISOString(),
    };
  }

  /*
   * ==========================================
   * Active Window
   * ==========================================
   */

  const windowStartedAt =
    storedWindowStartedAt;

  const resetAt =
    new Date(
      windowStartedAt.getTime() +
        WINDOW_MILLISECONDS
    );

  const requestCount =
    toNonNegativeInteger(
      record.request_count
    );

  /*
   * ==========================================
   * Limit Reached
   *
   * request 1..20 → allowed
   * request 21    → blocked
   * ==========================================
   */

  if (
    requestCount >=
    MAX_REQUESTS
  ) {
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
        "conversation_rate_limits"
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
        "CONVERSATION_CREATE_RATE_LIMITED",

      limit:
        MAX_REQUESTS,

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
   * Consume
   * ==========================================
   */

  const nextRequestCount =
    requestCount +
    1;

  await pb
    .collection(
      "conversation_rate_limits"
    )
    .update(
      record.id,
      {
        user:
          userId,

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
      MAX_REQUESTS,

    remaining:
      Math.max(
        0,
        MAX_REQUESTS -
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

async function acquireLock({
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
      await findLock(
        pb,
        userId
      );

    if (
      existing
    ) {
      /*
       * همان Request قبلاً Lock را گرفته.
       */

      if (
        existing.request_id ===
        requestId
      ) {
        const expiry =
          parseDate(
            existing.expires_at
          );

        if (
          expiry &&
          expiry.getTime() >
            now.getTime()
        ) {
          return;
        }
      }

      /*
       * Stale Lock
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
              "conversation_rate_limit_locks"
            )
            .delete(
              existing.id
            );
        } catch (error) {
          if (
            getErrorStatus(
              error
            ) !==
            404
          ) {
            /*
             * Retry بعدی وضعیت را دوباره
             * بررسی می‌کند.
             */
          }
        }
      } else {
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
          "conversation_rate_limit_locks"
        )
        .create({
          user:
            userId,

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
      const current =
        await findLock(
          pb,
          userId
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

  throw new Error(
    "Conversation create rate-limit lock could not be acquired"
  );
}

/*
 * ============================================
 * Release Lock
 * ============================================
 */

async function releaseLock({
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
  try {
    const lock =
      await pb
        .collection(
          "conversation_rate_limit_locks"
        )
        .getFirstListItem<ConversationRateLimitLockRecord>(
          pb.filter(
            "user = {:userId} && request_id = {:requestId}",
            {
              userId,

              requestId,
            }
          )
        );

    try {
      await pb
        .collection(
          "conversation_rate_limit_locks"
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
        console.error(
          "Conversation rate-limit lock release failed",
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
  } catch (error) {
    if (
      getErrorStatus(
        error
      ) !==
      404
    ) {
      console.error(
        "Conversation rate-limit lock lookup failed",
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
}

/*
 * ============================================
 * Find Counter
 * ============================================
 */

async function findRateLimitRecord(
  pb:
    PocketBase,

  userId:
    string
): Promise<
  ConversationRateLimitRecord |
  null
> {
  try {
    return await pb
      .collection(
        "conversation_rate_limits"
      )
      .getFirstListItem<ConversationRateLimitRecord>(
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
 * Find Lock
 * ============================================
 */

async function findLock(
  pb:
    PocketBase,

  userId:
    string
): Promise<
  ConversationRateLimitLockRecord |
  null
> {
  try {
    return await pb
      .collection(
        "conversation_rate_limit_locks"
      )
      .getFirstListItem<ConversationRateLimitLockRecord>(
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
 * Helpers
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

function isSafeRequestId(
  value:
    string |
    undefined
): value is string {
  return Boolean(
    value &&
      /^[a-zA-Z0-9_-]{1,128}$/.test(
        value
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

function toNonNegativeInteger(
  value:
    unknown
) {
  const parsed =
    Number(
      value
    );

  return Number.isSafeInteger(
    parsed
  ) &&
    parsed >=
      0
    ? parsed
    : 0;
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

  return (
    base +
    Math.floor(
      Math.random() *
        20
    )
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