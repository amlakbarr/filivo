import "server-only";

import {
  createHmac,
  randomBytes,
} from "node:crypto";

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

export type AppSessionRecord =
  RecordModel & {
    user?: string;

    session_hash?: string;

    expires_at?: string;

    revoked_at?: string;

    revoke_reason?: string;

    last_seen_at?: string;

    ip_hash?: string;

    user_agent_hash?: string;
  };

export type ValidAppSession = {
  id: string;

  userId: string;

  expiresAt: Date;

  lastSeenAt:
    Date |
    null;
};

/*
 * ============================================
 * Create
 * ============================================
 */

export async function createAppSession({
  request,
  userId,
  maxExpiresAt,
}: {
  request:
    Request;

  userId:
    string;

  maxExpiresAt?:
    Date;
}) {
  const now =
    new Date();

  const ttlSeconds =
    environmentInteger(
      process.env
        .APP_SESSION_TTL_SECONDS,
      300,
      604800,
      28800
    );

  let expiresAt =
    new Date(
      now.getTime() +
        ttlSeconds *
          1000
    );

  /*
   * Session برنامه نباید از PocketBase Token
   * طولانی‌تر شود.
   */
  if (
    maxExpiresAt &&
    maxExpiresAt.getTime() <
      expiresAt.getTime()
  ) {
    expiresAt =
      maxExpiresAt;
  }

  if (
    expiresAt.getTime() <=
    now.getTime()
  ) {
    throw new Error(
      "Cannot create an already expired application session"
    );
  }

  /*
   * 256-bit random token.
   *
   * مقدار خام فقط به Browser داده می‌شود.
   */
  const token =
    randomBytes(
      32
    ).toString(
      "base64url"
    );

  const sessionHash =
    hashSessionToken(
      token
    );

  const ip =
    getClientIp(
      request
    );

  const userAgent =
    String(
      request.headers.get(
        "user-agent"
      ) ||
        ""
    )
      .trim()
      .slice(
        0,
        2000
      );

  const pb =
    await getPocketBaseServiceClient();

  const record =
    await pb
      .collection(
        "auth_sessions"
      )
      .create<AppSessionRecord>({
        user:
          userId,

        session_hash:
          sessionHash,

        expires_at:
          expiresAt.toISOString(),

        revoked_at:
          "",

        revoke_reason:
          "",

        last_seen_at:
          now.toISOString(),

        ip_hash:
          ip
            ? hashFingerprint(
                "ip",
                ip
              )
            : "",

        user_agent_hash:
          userAgent
            ? hashFingerprint(
                "user_agent",
                userAgent
              )
            : "",
      });

  return {
    token,

    sessionId:
      record.id,

    expiresAt,
  };
}

/*
 * ============================================
 * Validate
 * ============================================
 */

export async function validateAppSession(
  token:
    string
): Promise<ValidAppSession | null> {
  const normalized =
    normalizeSessionToken(
      token
    );

  if (!normalized) {
    return null;
  }

  const record =
    await findSessionByToken(
      normalized
    );

  if (!record) {
    return null;
  }

  /*
   * Revoked
   */
  if (
    String(
      record.revoked_at ||
        ""
    ).trim()
  ) {
    return null;
  }

  /*
   * Expiry
   */
  const expiresAt =
    parseDate(
      record.expires_at
    );

  if (
    !expiresAt ||
    expiresAt.getTime() <=
      Date.now()
  ) {
    return null;
  }

  const userId =
    String(
      record.user ||
        ""
    ).trim();

  if (!userId) {
    return null;
  }

  return {
    id:
      record.id,

    userId,

    expiresAt,

    lastSeenAt:
      parseDate(
        record.last_seen_at
      ),
  };
}

/*
 * ============================================
 * Touch
 *
 * برای جلوگیری از Write روی هر Request،
 * فقط هر ۵ دقیقه last_seen_at را تغییر می‌دهیم.
 * ============================================
 */

export async function touchAppSession(
  session:
    ValidAppSession
) {
  const now =
    Date.now();

  const previous =
    session
      .lastSeenAt
      ?.getTime() ||
    0;

  const minimumInterval =
    5 *
    60 *
    1000;

  if (
    previous &&
    now -
      previous <
      minimumInterval
  ) {
    return;
  }

  const pb =
    await getPocketBaseServiceClient();

  await pb
    .collection(
      "auth_sessions"
    )
    .update(
      session.id,
      {
        last_seen_at:
          new Date(
            now
          ).toISOString(),
      }
    );
}

/*
 * ============================================
 * Revoke Current Session
 * ============================================
 */

export async function revokeAppSession({
  token,
  reason,
}: {
  token:
    string;

  reason:
    string;
}) {
  const normalized =
    normalizeSessionToken(
      token
    );

  if (!normalized) {
    return {
      found:
        false,

      revoked:
        false,
    };
  }

  const record =
    await findSessionByToken(
      normalized
    );

  if (!record) {
    return {
      found:
        false,

      revoked:
        false,
    };
  }

  if (
    String(
      record.revoked_at ||
        ""
    ).trim()
  ) {
    return {
      found:
        true,

      revoked:
        false,

      alreadyRevoked:
        true,
    };
  }

  const pb =
    await getPocketBaseServiceClient();

  await pb
    .collection(
      "auth_sessions"
    )
    .update(
      record.id,
      {
        revoked_at:
          new Date().toISOString(),

        revoke_reason:
          cleanReason(
            reason
          ),
      }
    );

  return {
    found:
      true,

    revoked:
      true,

    alreadyRevoked:
      false,
  };
}

/*
 * ============================================
 * Revoke All User Sessions
 *
 * در مرحله بعد برای:
 * - Disable Account
 * - Logout all devices
 * استفاده می‌شود.
 * ============================================
 */

export async function revokeAllAppSessionsForUser({
  userId,
  reason,
}: {
  userId:
    string;

  reason:
    string;
}) {
  const pb =
    await getPocketBaseServiceClient();

  const records =
    await pb
      .collection(
        "auth_sessions"
      )
      .getFullList<AppSessionRecord>({
        filter:
          pb.filter(
            "user = {:userId} && revoked_at = ''",
            {
              userId,
            }
          ),

        fields:
          "id,user,revoked_at,expires_at",

        batch:
          200,
      });

  let revoked =
    0;

  for (
    const record of
    records
  ) {
    try {
      await pb
        .collection(
          "auth_sessions"
        )
        .update(
          record.id,
          {
            revoked_at:
              new Date().toISOString(),

            revoke_reason:
              cleanReason(
                reason
              ),
          }
        );

      revoked +=
        1;
    } catch (
      error
    ) {
      console.error(
        "App session bulk revoke failed",
        {
          sessionId:
            record.id,

          userId,

          error:
            safeErrorMetadata(
              error
            ),
        }
      );
    }
  }

  return {
    total:
      records.length,

    revoked,
  };
}

/*
 * ============================================
 * Find by Token
 * ============================================
 */

async function findSessionByToken(
  token:
    string
): Promise<AppSessionRecord | null> {
  const pb =
    await getPocketBaseServiceClient();

  const hash =
    hashSessionToken(
      token
    );

  try {
    return await pb
      .collection(
        "auth_sessions"
      )
      .getFirstListItem<AppSessionRecord>(
        pb.filter(
          "session_hash = {:hash}",
          {
            hash,
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
 * HMAC
 *
 * Session token و Fingerprintها هرگز
 * به صورت Raw در PocketBase ذخیره نمی‌شوند.
 * ============================================
 */

function hashSessionToken(
  token:
    string
) {
  return createHmac(
    "sha256",
    getSessionHashSecret()
  )
    .update(
      `session:${token}`,
      "utf8"
    )
    .digest(
      "hex"
    );
}

function hashFingerprint(
  type:
    "ip" |
    "user_agent",

  value:
    string
) {
  return createHmac(
    "sha256",
    getSessionHashSecret()
  )
    .update(
      `${type}:${value}`,
      "utf8"
    )
    .digest(
      "hex"
    );
}

/*
 * ============================================
 * Secret
 * ============================================
 */

function getSessionHashSecret() {
  const value =
    process.env
      .APP_SESSION_HASH_SECRET
      ?.trim();

  if (
    value &&
    value.length >=
      32
  ) {
    return value;
  }

  /*
   * Development convenience.
   */
  if (
    process.env.NODE_ENV !==
    "production"
  ) {
    return "development-only-app-session-secret-change-me";
  }

  throw new Error(
    "APP_SESSION_HASH_SECRET must contain at least 32 characters in production"
  );
}

/*
 * ============================================
 * Client IP
 * ============================================
 */

function getClientIp(
  request:
    Request
) {
  const forwarded =
    request.headers.get(
      "x-forwarded-for"
    );

  if (forwarded) {
    const first =
      forwarded
        .split(",")[0]
        ?.trim();

    if (first) {
      return first.slice(
        0,
        200
      );
    }
  }

  const realIp =
    request.headers.get(
      "x-real-ip"
    );

  if (realIp) {
    return realIp
      .trim()
      .slice(
        0,
        200
      );
  }

  const cloudflareIp =
    request.headers.get(
      "cf-connecting-ip"
    );

  return String(
    cloudflareIp ||
      ""
  )
    .trim()
    .slice(
      0,
      200
    );
}

/*
 * ============================================
 * Token
 * ============================================
 */

function normalizeSessionToken(
  value:
    unknown
) {
  const token =
    String(
      value ||
        ""
    ).trim();

  /*
   * randomBytes(32).toString("base64url")
   * معمولاً 43 کاراکتر است.
   */
  if (
    token.length <
      40 ||
    token.length >
      100
  ) {
    return "";
  }

  if (
    !/^[A-Za-z0-9_-]+$/.test(
      token
    )
  ) {
    return "";
  }

  return token;
}

/*
 * ============================================
 * Reason
 * ============================================
 */

function cleanReason(
  value:
    string
) {
  return String(
    value ||
      "revoked"
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
      200
    );
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

  return Number.isNaN(
    date.getTime()
  )
    ? null
    : date;
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
      status?: unknown;
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
      name?: unknown;
      status?: unknown;
      code?: unknown;
    };

  return {
    name:
      typeof value.name ===
      "string"
        ? value.name
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