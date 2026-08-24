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

export type FeedbackRateLimitAction =
  | "message.feedback";

/*
 * ============================================
 * Result
 * ============================================
 */

export type FeedbackRateLimitResult =
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
        "MESSAGE_FEEDBACK_RATE_LIMITED";

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

type FeedbackRateLimitPolicy = {
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

type FeedbackRateLimitRecord =
  RecordModel & {
    fingerprint?:
      string;

    user?:
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

type FeedbackRateLimitLockRecord =
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
 * Policies
 * ============================================
 */

const FEEDBACK_RATE_LIMIT_POLICIES:
  Readonly<
    Record<
      FeedbackRateLimitAction,
      FeedbackRateLimitPolicy
    >
  > = {
  /*
   * PUT + DELETE از همین Bucket استفاده
   * می‌کنند.
   */
  "message.feedback": {
    maxRequests:
      30,

    windowMilliseconds:
      minutes(
        10
      ),
  },
};

/*
 * ============================================
 * Consume Feedback Rate Limit
 *
 * Fail-closed:
 * Infrastructure failure به Caller منتقل
 * می‌شود.
 * ============================================
 */

export async function consumeFeedbackRateLimit({
  userId,
  action,
  requestId,
}: {
  userId:
    string;

  action:
    FeedbackRateLimitAction;

  requestId?:
    string;
}): Promise<FeedbackRateLimitResult> {
  if (
    !isSafeRecordId(
      userId
    )
  ) {
    throw new Error(
      "Invalid user id for feedback rate limit"
    );
  }

  const policy =
    FEEDBACK_RATE_LIMIT_POLICIES[
      action
    ];

  if (
    !policy
  ) {
    throw new Error(
      "Unknown feedback rate limit action"
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

  /*
   * Target message ID عمداً وارد fingerprint
   * نمی‌شود.
   */
  const fingerprint =
    createFingerprint(
      userId,
      action
    );

  await acquireLock({
    pb,

    fingerprint,

    requestId:
      effectiveRequestId,
  });

  try {
    return await consumeLocked({
      pb,

      userId,

      action,

      fingerprint,

      policy,
    });
  } finally {
    await releaseLock({
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

async function consumeLocked({
  pb,
  userId,
  action,
  fingerprint,
  policy,
}: {
  pb:
    PocketBase;

  userId:
    string;

  action:
    FeedbackRateLimitAction;

  fingerprint:
    string;

  policy:
    FeedbackRateLimitPolicy;
}): Promise<FeedbackRateLimitResult> {
  const now =
    new Date();

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
    const resetAt =
      new Date(
        now.getTime() +
          policy.windowMilliseconds
      );

    try {
      await pb
        .collection(
          "feedback_rate_limits"
        )
        .create({
          fingerprint,

          user:
            userId,

          action,

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
   * Explicit Block
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
        "MESSAGE_FEEDBACK_RATE_LIMITED",

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
        "feedback_rate_limits"
      )
      .update(
        record.id,
        {
          fingerprint,

          user:
            userId,

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
   * Active Window
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
   * request 1..30 → allowed
   * request 31    → blocked
   */

  if (
    requestCount >=
    policy.maxRequests
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
        "feedback_rate_limits"
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
        "MESSAGE_FEEDBACK_RATE_LIMITED",

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
        effectiveBlockUntil.toISOString(),
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
      "feedback_rate_limits"
    )
    .update(
      record.id,
      {
        fingerprint,

        user:
          userId,

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

async function acquireLock({
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
        fingerprint
      );

    if (
      existing
    ) {
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
              "feedback_rate_limit_locks"
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
             * Retry بعدی.
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
          "feedback_rate_limit_locks"
        )
        .create({
          fingerprint,

          request_id:
            requestId,

          acquired_at:
            acquiredAt.toISOString(),

          expires_at:
            expiresAt.toISOString(),
        });

      return;
    } catch {
      const current =
        await findLock(
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

  throw new Error(
    "Feedback rate-limit lock could not be acquired"
  );
}

/*
 * ============================================
 * Release Lock
 * ============================================
 */

async function releaseLock({
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
          "feedback_rate_limit_locks"
        )
        .getFirstListItem<FeedbackRateLimitLockRecord>(
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
          "feedback_rate_limit_locks"
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
          "Feedback rate-limit lock release failed",
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
        "Feedback rate-limit lock lookup failed",
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
 * Find Counter
 * ============================================
 */

async function findRateLimitRecord(
  pb:
    PocketBase,

  fingerprint:
    string
): Promise<
  FeedbackRateLimitRecord |
  null
> {
  try {
    return await pb
      .collection(
        "feedback_rate_limits"
      )
      .getFirstListItem<FeedbackRateLimitRecord>(
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

async function findLock(
  pb:
    PocketBase,

  fingerprint:
    string
): Promise<
  FeedbackRateLimitLockRecord |
  null
> {
  try {
    return await pb
      .collection(
        "feedback_rate_limit_locks"
      )
      .getFirstListItem<FeedbackRateLimitLockRecord>(
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
 * ============================================
 */

function createFingerprint(
  userId:
    string,

  action:
    FeedbackRateLimitAction
) {
  return [
    "user",
    userId,
    "action",
    action,
  ].join(
    ":"
  );
}

/*
 * ============================================
 * Helpers
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