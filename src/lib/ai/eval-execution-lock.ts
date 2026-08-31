import "server-only";

import {
  createHash,
  randomUUID,
} from "node:crypto";

import type PocketBase from "pocketbase";

import type {
  RecordModel,
} from "pocketbase";

/*
 * ============================================
 * Eval Distributed Execution Lock
 *
 * از Collection موجود زیر استفاده می‌کنیم:
 *
 * admin_rate_limit_locks
 *
 * اما Fingerprint با Namespace مستقل:
 *
 * ai-eval:<sha256>
 *
 * نتیجه:
 * - Cross-instance / Serverless safe
 * - بدون Collection جدید
 * - Lockهای Rate Limit با Eval تداخل ندارند
 * - Lock stale بعد از TTL قابل بازیابی است
 * ============================================
 */

type EvalExecutionLockRecord =
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

export type EvalExecutionLease = {
  fingerprint:
    string;

  ownerId:
    string;

  expiresAt:
    string;
};

/*
 * Default = 30 minutes.
 *
 * یک Eval OpenAI ممکن است چندین Case داشته باشد،
 * بنابراین TTL باید بسیار بیشتر از Lock کوتاه
 * Rate Limiter باشد.
 */
const DEFAULT_LOCK_TTL_SECONDS =
  30 *
  60;

const MIN_LOCK_TTL_SECONDS =
  60;

const MAX_LOCK_TTL_SECONDS =
  2 *
  60 *
  60;

const LOCK_RETRY_ATTEMPTS =
  4;

const LOCK_RETRY_BASE_MILLISECONDS =
  40;

const LOCK_RETRY_MAX_MILLISECONDS =
  150;

const LOCK_COLLECTION =
  "admin_rate_limit_locks";

/*
 * ============================================
 * Acquire
 *
 * Busy => null
 * Infrastructure failure => throw
 * ============================================
 */

export async function tryAcquireEvalExecutionLock({
  pb,
  key,
  ttlSeconds,
}: {
  pb:
    PocketBase;

  key:
    string;

  ttlSeconds?:
    number;
}): Promise<
  EvalExecutionLease |
  null
> {
  const normalizedKey =
    normalizeKey(
      key
    );

  if (
    !normalizedKey
  ) {
    throw new Error(
      "Invalid eval execution lock key"
    );
  }

  const fingerprint =
    createFingerprint(
      normalizedKey
    );

  const ownerId =
    randomUUID();

  const ttl =
    clampInteger(
      ttlSeconds ??
        environmentInteger(
          process.env
            .AI_EVAL_LOCK_TTL_SECONDS,
          MIN_LOCK_TTL_SECONDS,
          MAX_LOCK_TTL_SECONDS,
          DEFAULT_LOCK_TTL_SECONDS
        ),
      MIN_LOCK_TTL_SECONDS,
      MAX_LOCK_TTL_SECONDS
    );

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
      const expiresAt =
        parseDate(
          existing.expires_at
        );

      /*
       * Valid lock owned by another request.
       */
      if (
        expiresAt &&
        expiresAt.getTime() >
          now.getTime()
      ) {
        return null;
      }

      /*
       * Stale lock.
       */
      try {
        await pb
          .collection(
            LOCK_COLLECTION
          )
          .delete(
            existing.id
          );
      } catch (
        error
      ) {
        if (
          getErrorStatus(
            error
          ) !==
          404
        ) {
          /*
           * ممکن است Request دیگری Lock stale را
           * همزمان حذف/جایگزین کرده باشد.
           * Retry وضعیت واقعی را دوباره می‌خواند.
           */
        }
      }
    }

    const acquiredAt =
      new Date();

    const lockExpiresAt =
      new Date(
        acquiredAt.getTime() +
          ttl *
            1000
      );

    try {
      await pb
        .collection(
          LOCK_COLLECTION
        )
        .create({
          fingerprint,

          request_id:
            ownerId,

          acquired_at:
            acquiredAt
              .toISOString(),

          expires_at:
            lockExpiresAt
              .toISOString(),
        });

      return {
        fingerprint,

        ownerId,

        expiresAt:
          lockExpiresAt
            .toISOString(),
      };
    } catch (
      error
    ) {
      /*
       * Expected race:
       * یک Instance دیگر بین lookup و create
       * Lock را گرفته است.
       */
      const current =
        await findLock(
          pb,
          fingerprint
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
          return null;
        }
      }

      if (
        attempt ===
        LOCK_RETRY_ATTEMPTS -
          1
      ) {
        /*
         * اگر هیچ Lock واقعی پیدا نشد، Create
         * Error را Infrastructure Error می‌دانیم.
         */
        throw error;
      }

      await sleep(
        retryDelay(
          attempt
        )
      );
    }
  }

  return null;
}

/*
 * ============================================
 * Release
 *
 * فقط Lock متعلق به ownerId خودمان حذف می‌شود.
 * ============================================
 */

export async function releaseEvalExecutionLock({
  pb,
  lease,
}: {
  pb:
    PocketBase;

  lease:
    EvalExecutionLease |
    null |
    undefined;
}) {
  if (
    !lease
  ) {
    return;
  }

  try {
    const lock =
      await pb
        .collection(
          LOCK_COLLECTION
        )
        .getFirstListItem<EvalExecutionLockRecord>(
          pb.filter(
            "fingerprint = {:fingerprint} && request_id = {:ownerId}",
            {
              fingerprint:
                lease.fingerprint,

              ownerId:
                lease.ownerId,
            }
          )
        );

    try {
      await pb
        .collection(
          LOCK_COLLECTION
        )
        .delete(
          lock.id
        );
    } catch (
      error
    ) {
      if (
        getErrorStatus(
          error
        ) !==
        404
      ) {
        console.error(
          "AI eval execution lock release failed",
          {
            fingerprint:
              lease.fingerprint,

            error:
              safeErrorMetadata(
                error
              ),
          }
        );
      }
    }
  } catch (
    error
  ) {
    if (
      getErrorStatus(
        error
      ) !==
      404
    ) {
      console.error(
        "AI eval execution lock lookup during release failed",
        {
          fingerprint:
            lease.fingerprint,

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
 * Feature Flags
 * ============================================
 */

export function isAutoEvalEnabled() {
  return environmentBoolean(
    process.env
      .AI_AUTO_EVAL_ENABLED,
    true
  );
}

export function isManualEvalEnabled() {
  return environmentBoolean(
    process.env
      .AI_MANUAL_EVAL_ENABLED,
    true
  );
}

/*
 * ============================================
 * Find
 * ============================================
 */

async function findLock(
  pb:
    PocketBase,

  fingerprint:
    string
): Promise<
  EvalExecutionLockRecord |
  null
> {
  try {
    return await pb
      .collection(
        LOCK_COLLECTION
      )
      .getFirstListItem<EvalExecutionLockRecord>(
        pb.filter(
          "fingerprint = {:fingerprint}",
          {
            fingerprint,
          }
        )
      );
  } catch (
    error
  ) {
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
  key:
    string
) {
  /*
   * Prefix prevents collision with the existing
   * Admin Rate Limit fingerprints.
   *
   * Result length is bounded and safe for DB.
   */
  return `ai-eval:${createHash(
    "sha256"
  )
    .update(
      key,
      "utf8"
    )
    .digest(
      "hex"
    )}`;
}

function normalizeKey(
  value:
    string
) {
  return String(
    value ||
      ""
  )
    .replace(
      /[\u0000-\u001f\u007f]/g,
      ""
    )
    .trim()
    .slice(
      0,
      500
    );
}

/*
 * ============================================
 * Helpers
 * ============================================
 */

function environmentBoolean(
  value:
    string |
    undefined,

  fallback:
    boolean
) {
  if (
    value ===
    undefined ||
    value.trim() ===
      ""
  ) {
    return fallback;
  }

  const normalized =
    value
      .trim()
      .toLowerCase();

  if (
    normalized ===
      "1" ||
    normalized ===
      "true" ||
    normalized ===
      "yes" ||
    normalized ===
      "on"
  ) {
    return true;
  }

  if (
    normalized ===
      "0" ||
    normalized ===
      "false" ||
    normalized ===
      "no" ||
    normalized ===
      "off"
  ) {
    return false;
  }

  return fallback;
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
  const number =
    Number(
      value
    );

  if (
    !Number.isInteger(
      number
    )
  ) {
    return fallback;
  }

  return clampInteger(
    number,
    minimum,
    maximum
  );
}

function clampInteger(
  value:
    number,

  minimum:
    number,

  maximum:
    number
) {
  return Math.min(
    maximum,
    Math.max(
      minimum,
      Math.trunc(
        value
      )
    )
  );
}

function parseDate(
  value:
    unknown
) {
  const text =
    String(
      value ||
        ""
    ).trim();

  if (
    !text
  ) {
    return null;
  }

  const date =
    new Date(
      text
    );

  return Number.isFinite(
    date.getTime()
  )
    ? date
    : null;
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

function retryDelay(
  attempt:
    number
) {
  return Math.min(
    LOCK_RETRY_MAX_MILLISECONDS,
    LOCK_RETRY_BASE_MILLISECONDS *
      (
        attempt +
        1
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
      message:
        String(
          error
        ),
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
