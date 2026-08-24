import "server-only";

import type PocketBase from "pocketbase";

/*
 * ============================================
 * Cookie Names
 * ============================================
 */

export const AUTH_COOKIE_NAME =
  "pb_auth";

export const APP_SESSION_COOKIE_NAME =
  "app_session";

/*
 * ============================================
 * Shared Security Options
 * ============================================
 */

export const AUTH_COOKIE_OPTIONS = {
  httpOnly: true,

  secure:
    process.env.NODE_ENV ===
    "production",

  sameSite:
    "strict" as const,

  path:
    "/",

  priority:
    "high" as const,
};

/*
 * ============================================
 * PocketBase Cookie
 * ============================================
 */

export function getPocketBaseAuthCookie(
  pb: PocketBase,
  options?: {
    maxExpiresAt?: Date;
  }
) {
  /*
   * PocketBase خودش Expiry توکن را
   * داخل Set-Cookie قرار می‌دهد.
   */
  const serialized =
    pb.authStore.exportToCookie(
      {
        httpOnly:
          AUTH_COOKIE_OPTIONS.httpOnly,

        secure:
          AUTH_COOKIE_OPTIONS.secure,

        sameSite:
          AUTH_COOKIE_OPTIONS.sameSite,

        path:
          AUTH_COOKIE_OPTIONS.path,
      },

      AUTH_COOKIE_NAME
    );

  const parsed =
    parseExportedAuthCookie(
      serialized
    );

  if (
    !parsed.value
  ) {
    throw new Error(
      "PocketBase authentication cookie is empty"
    );
  }

  /*
   * pb_auth نباید بیشتر از app_session
   * در Browser باقی بماند.
   */
  const expires =
    earlierDate(
      parsed.expires,
      options?.maxExpiresAt
    );

  return {
    name:
      AUTH_COOKIE_NAME,

    value:
      parsed.value,

    httpOnly:
      AUTH_COOKIE_OPTIONS.httpOnly,

    secure:
      AUTH_COOKIE_OPTIONS.secure,

    sameSite:
      AUTH_COOKIE_OPTIONS.sameSite,

    path:
      AUTH_COOKIE_OPTIONS.path,

    priority:
      AUTH_COOKIE_OPTIONS.priority,

    ...(expires
      ? {
          expires,
        }
      : {}),
  };
}

/*
 * ============================================
 * App Session Cookie
 * ============================================
 */

export function getAppSessionCookie(
  token: string,
  expiresAt: Date
) {
  return {
    name:
      APP_SESSION_COOKIE_NAME,

    value:
      token,

    httpOnly:
      AUTH_COOKIE_OPTIONS.httpOnly,

    secure:
      AUTH_COOKIE_OPTIONS.secure,

    sameSite:
      AUTH_COOKIE_OPTIONS.sameSite,

    path:
      AUTH_COOKIE_OPTIONS.path,

    priority:
      AUTH_COOKIE_OPTIONS.priority,

    expires:
      expiresAt,
  };
}

/*
 * ============================================
 * Expired pb_auth
 * ============================================
 */

export function getExpiredAuthCookie() {
  return {
    name:
      AUTH_COOKIE_NAME,

    value:
      "",

    httpOnly:
      AUTH_COOKIE_OPTIONS.httpOnly,

    secure:
      AUTH_COOKIE_OPTIONS.secure,

    sameSite:
      AUTH_COOKIE_OPTIONS.sameSite,

    path:
      AUTH_COOKIE_OPTIONS.path,

    priority:
      AUTH_COOKIE_OPTIONS.priority,

    maxAge:
      0,

    expires:
      new Date(
        0
      ),
  };
}

/*
 * ============================================
 * Expired app_session
 * ============================================
 */

export function getExpiredAppSessionCookie() {
  return {
    name:
      APP_SESSION_COOKIE_NAME,

    value:
      "",

    httpOnly:
      AUTH_COOKIE_OPTIONS.httpOnly,

    secure:
      AUTH_COOKIE_OPTIONS.secure,

    sameSite:
      AUTH_COOKIE_OPTIONS.sameSite,

    path:
      AUTH_COOKIE_OPTIONS.path,

    priority:
      AUTH_COOKIE_OPTIONS.priority,

    maxAge:
      0,

    expires:
      new Date(
        0
      ),
  };
}

/*
 * ============================================
 * Parse PocketBase exported cookie
 * ============================================
 */

function parseExportedAuthCookie(
  serialized:
    string
) {
  const parts =
    serialized
      .split(";")
      .map(
        (
          part
        ) =>
          part.trim()
      );

  const first =
    parts[0] ||
    "";

  const separator =
    first.indexOf(
      "="
    );

  const value =
    separator >=
    0
      ? first.slice(
          separator +
            1
        )
      : "";

  let expires:
    Date |
    undefined;

  for (
    const part of
    parts.slice(
      1
    )
  ) {
    if (
      !part
        .toLowerCase()
        .startsWith(
          "expires="
        )
    ) {
      continue;
    }

    const raw =
      part.slice(
        "expires=".length
      );

    const parsed =
      new Date(
        raw
      );

    if (
      !Number.isNaN(
        parsed.getTime()
      )
    ) {
      expires =
        parsed;
    }
  }

  return {
    value,
    expires,
  };
}

/*
 * ============================================
 * Earlier Date
 * ============================================
 */

function earlierDate(
  first:
    Date |
    undefined,

  second:
    Date |
    undefined
) {
  if (
    first &&
    second
  ) {
    return first.getTime() <=
      second.getTime()
      ? first
      : second;
  }

  return (
    first ||
    second
  );
}