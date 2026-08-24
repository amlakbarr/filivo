import {
  createHmac,
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

export type LoginRateLimitResult =
  | {
      allowed: true;
    }
  | {
      allowed: false;
      retryAfterSeconds: number;
    };

type RateLimitConfig = {
  maxFailures: number;

  windowMilliseconds: number;

  blockMilliseconds: number;
};

/*
 * ============================================
 * Check
 * ============================================
 */

export async function checkLoginRateLimit({
  email,
  ip,
}: {
  email: string;
  ip: string;
}): Promise<LoginRateLimitResult> {
  const pb =
    await getPocketBaseServiceClient();

  const config =
    getRateLimitConfig();

  const fingerprint =
    createLoginFingerprint(
      email,
      ip
    );

  const record =
    await findRateLimitRecord(
      pb,
      fingerprint
    );

  if (!record) {
    return {
      allowed: true,
    };
  }

  const now =
    Date.now();

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
      now
  ) {
    return {
      allowed:
        false,

      retryAfterSeconds:
        secondsUntil(
          blockedUntil,
          now
        ),
    };
  }

  /*
   * ==========================================
   * Window
   * ==========================================
   */

  const windowStartedAt =
    parseDate(
      record.window_started_at
    );

  /*
   * Window تمام شده.
   *
   * Counter قدیمی در Attempt بعدی Reset
   * خواهد شد.
   */
  if (
    !windowStartedAt ||
    now -
      windowStartedAt.getTime() >=
      config.windowMilliseconds
  ) {
    return {
      allowed:
        true,
    };
  }

  /*
   * ==========================================
   * Defensive Threshold Check
   *
   * اگر failed_count به Threshold رسیده ولی
   * به هر علت blocked_until قبلاً ذخیره نشده،
   * اجازه یک Attempt اضافه نمی‌دهیم.
   * ==========================================
   */

  const failedCount =
    toNonNegativeInteger(
      record.failed_count
    );

  if (
    failedCount >=
    config.maxFailures
  ) {
    const newBlockedUntil =
      new Date(
        now +
          config.blockMilliseconds
      );

    await pb
      .collection(
        "login_rate_limits"
      )
      .update(
        record.id,
        {
          blocked_until:
            newBlockedUntil.toISOString(),
        }
      );

    return {
      allowed:
        false,

      retryAfterSeconds:
        secondsUntil(
          newBlockedUntil,
          now
        ),
    };
  }

  return {
    allowed:
      true,
  };
}

/*
 * ============================================
 * Register Failed Attempt
 * ============================================
 */

export async function registerLoginFailure({
  email,
  ip,
}: {
  email: string;
  ip: string;
}): Promise<LoginRateLimitResult> {
  const pb =
    await getPocketBaseServiceClient();

  const config =
    getRateLimitConfig();

  const fingerprint =
    createLoginFingerprint(
      email,
      ip
    );

  const now =
    new Date();

  let record =
    await findRateLimitRecord(
      pb,
      fingerprint
    );

  /*
   * ==========================================
   * First Failed Attempt
   * ==========================================
   */

  if (!record) {
    try {
      await pb
        .collection(
          "login_rate_limits"
        )
        .create({
          fingerprint,

          failed_count:
            1,

          window_started_at:
            now.toISOString(),

          last_failed_at:
            now.toISOString(),

          blocked_until:
            "",
        });

      return {
        allowed:
          true,
      };
    } catch {
      /*
       * ممکن است Request دیگری همزمان همان
       * Fingerprint را ساخته باشد.
       *
       * این Recovery زمانی درست عمل می‌کند که
       * fingerprint در PocketBase Unique باشد.
       */

      record =
        await findRateLimitRecord(
          pb,
          fingerprint
        );

      if (!record) {
        throw new Error(
          "Unable to create login rate limit record"
        );
      }
    }
  }

  /*
   * ==========================================
   * Existing Active Block
   * ==========================================
   */

  const existingBlock =
    parseDate(
      record.blocked_until
    );

  if (
    existingBlock &&
    existingBlock.getTime() >
      now.getTime()
  ) {
    return {
      allowed:
        false,

      retryAfterSeconds:
        secondsUntil(
          existingBlock,
          now.getTime()
        ),
    };
  }

  /*
   * ==========================================
   * Window
   * ==========================================
   */

  const windowStartedAt =
    parseDate(
      record.window_started_at
    );

  const windowExpired =
    !windowStartedAt ||
    now.getTime() -
      windowStartedAt.getTime() >=
      config.windowMilliseconds;

  /*
   * ==========================================
   * Reset Expired Window
   * ==========================================
   */

  if (
    windowExpired
  ) {
    await pb
      .collection(
        "login_rate_limits"
      )
      .update(
        record.id,
        {
          failed_count:
            1,

          window_started_at:
            now.toISOString(),

          last_failed_at:
            now.toISOString(),

          blocked_until:
            "",
        }
      );

    return {
      allowed:
        true,
    };
  }

  /*
   * ==========================================
   * Atomic Increment
   * ==========================================
   */

  const updated =
    await pb
      .collection(
        "login_rate_limits"
      )
      .update(
        record.id,
        {
          "failed_count+":
            1,

          last_failed_at:
            now.toISOString(),
        }
      );

  const failedCount =
    toNonNegativeInteger(
      updated.failed_count
    );

  /*
   * Threshold هنوز نرسیده.
   */

  if (
    failedCount <
    config.maxFailures
  ) {
    return {
      allowed:
        true,
    };
  }

  /*
   * ==========================================
   * Block
   * ==========================================
   */

  const blockedUntil =
    new Date(
      now.getTime() +
        config.blockMilliseconds
    );

  await pb
    .collection(
      "login_rate_limits"
    )
    .update(
      updated.id,
      {
        blocked_until:
          blockedUntil.toISOString(),
      }
    );

  return {
    allowed:
      false,

    retryAfterSeconds:
      secondsUntil(
        blockedUntil,
        now.getTime()
      ),
  };
}

/*
 * ============================================
 * Successful Login
 * ============================================
 */

export async function clearLoginFailures({
  email,
  ip,
}: {
  email: string;
  ip: string;
}) {
  const pb =
    await getPocketBaseServiceClient();

  const fingerprint =
    createLoginFingerprint(
      email,
      ip
    );

  const record =
    await findRateLimitRecord(
      pb,
      fingerprint
    );

  if (!record) {
    return;
  }

  try {
    await pb
      .collection(
        "login_rate_limits"
      )
      .delete(
        record.id
      );
  } catch (error) {
    /*
     * Race طبیعی:
     * Request دیگری قبلاً Record را حذف کرده.
     */
    if (
      getErrorStatus(
        error
      ) ===
      404
    ) {
      return;
    }

    /*
     * خطای واقعی Storage را مخفی نمی‌کنیم.
     *
     * Login Route تصمیم می‌گیرد Fail-Closed
     * رفتار کند.
     */
    throw error;
  }
}

/*
 * ============================================
 * Client IP
 * ============================================
 */

export function getLoginClientIp(
  request: Request
) {
  /*
   * این Headerها فقط وقتی قابل اتکا هستند
   * که Reverse Proxy / Hosting معتبر آن‌ها
   * را کنترل کند.
   *
   * IP فقط بخشی از Rate Limit Fingerprint
   * است و به‌تنهایی معیار Authorization نیست.
   */

  const forwarded =
    request.headers.get(
      "x-forwarded-for"
    );

  if (forwarded) {
    const first =
      forwarded
        .split(
          ","
        )[0]
        ?.trim();

    if (first) {
      return normalizeIp(
        first
      );
    }
  }

  const realIp =
    request.headers
      .get(
        "x-real-ip"
      )
      ?.trim();

  if (realIp) {
    return normalizeIp(
      realIp
    );
  }

  const cloudflareIp =
    request.headers
      .get(
        "cf-connecting-ip"
      )
      ?.trim();

  if (cloudflareIp) {
    return normalizeIp(
      cloudflareIp
    );
  }

  /*
   * Hosting هیچ IP قابل استفاده‌ای نداده.
   *
   * همچنان Email باعث می‌شود تمام Loginها
   * وارد یک Fingerprint جهانی نشوند.
   */
  return "unknown";
}

/*
 * ============================================
 * Fingerprint
 *
 * Email و IP خام ذخیره نمی‌شوند.
 *
 * HMAC بهتر از اضافه‌کردن Pepper به متن
 * و SHA-256 ساده است.
 * ============================================
 */

function createLoginFingerprint(
  email:
    string,

  ip:
    string
) {
  const normalizedEmail =
    email
      .trim()
      .toLowerCase();

  const normalizedIp =
    normalizeIp(
      ip
    );

  return createHmac(
    "sha256",
    getRateLimitPepper()
  )
    .update(
      [
        "login-v2",
        normalizedEmail,
        normalizedIp,
      ].join(
        "\u0000"
      ),
      "utf8"
    )
    .digest(
      "hex"
    );
}

/*
 * ============================================
 * Pepper
 * ============================================
 */

function getRateLimitPepper() {
  const pepper =
    process.env
      .AUTH_RATE_LIMIT_PEPPER
      ?.trim();

  if (
    pepper &&
    pepper.length >=
      32
  ) {
    return pepper;
  }

  if (
    process.env.NODE_ENV !==
    "production"
  ) {
    return "development-only-rate-limit-pepper-change-me";
  }

  throw new Error(
    "AUTH_RATE_LIMIT_PEPPER must contain at least 32 characters in production"
  );
}

/*
 * ============================================
 * Database Lookup
 * ============================================
 */

async function findRateLimitRecord(
  pb:
    PocketBase,

  fingerprint:
    string
): Promise<RecordModel | null> {
  try {
    return await pb
      .collection(
        "login_rate_limits"
      )
      .getFirstListItem(
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
 * Config
 * ============================================
 */

function getRateLimitConfig(): RateLimitConfig {
  const maxFailures =
    environmentInteger(
      process.env
        .AUTH_LOGIN_MAX_FAILURES,
      2,
      50,
      5
    );

  const windowMinutes =
    environmentInteger(
      process.env
        .AUTH_LOGIN_WINDOW_MINUTES,
      1,
      1440,
      15
    );

  const blockMinutes =
    environmentInteger(
      process.env
        .AUTH_LOGIN_BLOCK_MINUTES,
      1,
      1440,
      15
    );

  return {
    maxFailures,

    windowMilliseconds:
      windowMinutes *
      60 *
      1000,

    blockMilliseconds:
      blockMinutes *
      60 *
      1000,
  };
}

/*
 * ============================================
 * Seconds Until
 * ============================================
 */

function secondsUntil(
  date:
    Date,

  now:
    number
) {
  return Math.max(
    1,
    Math.ceil(
      (
        date.getTime() -
        now
      ) /
        1000
    )
  );
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
    Math.floor(
      number
    )
  );
}

/*
 * ============================================
 * IP Normalization
 * ============================================
 */

function normalizeIp(
  value:
    string
) {
  return String(
    value ||
      "unknown"
  )
    .replace(
      /[\u0000-\u001f\u007f]/g,
      ""
    )
    .trim()
    .slice(
      0,
      100
    ) ||
    "unknown";
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
  if (!value) {
    return null;
  }

  const date =
    new Date(
      String(
        value
      )
    );

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return null;
  }

  return date;
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
      status?: unknown;
    };

  return typeof value.status ===
    "number"
    ? value.status
    : undefined;
}