import type PocketBase from "pocketbase";

import {
  cookies,
} from "next/headers";

import {
  revokeAppSession,
  touchAppSession,
  validateAppSession,
} from "@/lib/auth/app-session";

import {
  APP_SESSION_COOKIE_NAME,
  AUTH_COOKIE_NAME,
  getExpiredAppSessionCookie,
  getExpiredAuthCookie,
  getPocketBaseAuthCookie,
} from "@/lib/pocketbase/auth-cookie";

import {
  createServerPocketBase,
} from "@/lib/pocketbase/server";

/*
 * ============================================
 * Account Type
 * ============================================
 */

export type CurrentAccount = {
  id: string;

  email: string;

  name: string;

  employee_code: string;

  role:
    | "employee"
    | "admin";

  department?: string;
};

export type AuthenticatedPocketBase = {
  pb: PocketBase;

  account:
    CurrentAccount;
};

/*
 * ============================================
 * Authentication
 * ============================================
 */

export async function getAuthenticatedPocketBase(): Promise<AuthenticatedPocketBase | null> {
  const cookieStore =
    await cookies();

  const authCookie =
    cookieStore.get(
      AUTH_COOKIE_NAME
    );

  const appSessionCookie =
    cookieStore.get(
      APP_SESSION_COOKIE_NAME
    );

  /*
   * ==========================================
   * Both cookies are required
   * ==========================================
   */

  if (
    !authCookie?.value ||
    !appSessionCookie?.value
  ) {
    /*
     * app_session وجود دارد ولی pb_auth نیست.
     * Registry آن Session را هم می‌بندیم.
     */
    if (
      appSessionCookie?.value
    ) {
      await revokeSessionQuietly(
        appSessionCookie.value,
        "incomplete_cookie_pair"
      );
    }

    tryDeleteAuthCookies(
      cookieStore
    );

    return null;
  }

  /*
   * ==========================================
   * Application Session Registry
   * ==========================================
   */

  let appSession;

  try {
    appSession =
      await validateAppSession(
        appSessionCookie.value
      );
  } catch (error) {
    /*
     * Fail closed.
     *
     * اگر Registry قابل بررسی نباشد،
     * Request احراز هویت نمی‌شود.
     */
    console.error(
      "Application session validation failed",
      {
        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return null;
  }

  if (!appSession) {
    tryDeleteAuthCookies(
      cookieStore
    );

    return null;
  }

  /*
   * ==========================================
   * PocketBase
   * ==========================================
   */

  const pb =
    createServerPocketBase();

  pb.authStore.loadFromCookie(
    `${AUTH_COOKIE_NAME}=${authCookie.value}`,
    AUTH_COOKIE_NAME
  );

  /*
   * ==========================================
   * Local Token Expiration
   * ==========================================
   */

  if (
    !pb.authStore.isValid
  ) {
    pb.authStore.clear();

    await revokeSessionQuietly(
      appSessionCookie.value,
      "pocketbase_token_invalid"
    );

    tryDeleteAuthCookies(
      cookieStore
    );

    return null;
  }

  try {
    /*
     * ========================================
     * PocketBase Verify + Refresh
     * ========================================
     */

    const authData =
      await pb
        .collection(
          "accounts"
        )
        .authRefresh();

    const record =
      authData.record;

    /*
     * ========================================
     * Active
     * ========================================
     */

    if (
      record.active !==
      true
    ) {
      pb.authStore.clear();

      await revokeSessionQuietly(
        appSessionCookie.value,
        "account_inactive"
      );

      tryDeleteAuthCookies(
        cookieStore
      );

      return null;
    }

    /*
     * ========================================
     * Role
     * ========================================
     */

    if (
      record.role !==
        "employee" &&
      record.role !==
        "admin"
    ) {
      pb.authStore.clear();

      await revokeSessionQuietly(
        appSessionCookie.value,
        "invalid_account_role"
      );

      tryDeleteAuthCookies(
        cookieStore
      );

      return null;
    }

    /*
     * ========================================
     * Identity
     * ========================================
     */

    const id =
      String(
        record.id ||
          ""
      ).trim();

    const email =
      String(
        record.email ||
          ""
      ).trim();

    if (
      !id ||
      !email
    ) {
      pb.authStore.clear();

      await revokeSessionQuietly(
        appSessionCookie.value,
        "invalid_account_identity"
      );

      tryDeleteAuthCookies(
        cookieStore
      );

      return null;
    }

    /*
     * ========================================
     * Registry User must match PocketBase User
     * ========================================
     */

    if (
      appSession.userId !==
      id
    ) {
      pb.authStore.clear();

      await revokeSessionQuietly(
        appSessionCookie.value,
        "session_user_mismatch"
      );

      tryDeleteAuthCookies(
        cookieStore
      );

      return null;
    }

    /*
     * ========================================
     * Persist refreshed pb_auth
     *
     * Expiration به پایان app_session Clamp
     * می‌شود.
     * ========================================
     */

    tryPersistAuthCookie(
      cookieStore,
      pb,
      appSession.expiresAt
    );

    /*
     * ========================================
     * Touch Session
     *
     * Failure این قسمت Authentication را
     * خراب نمی‌کند چون فقط last_seen_at است.
     * ========================================
     */

    try {
      await touchAppSession(
        appSession
      );
    } catch (error) {
      console.error(
        "Application session touch failed",
        {
          sessionId:
            appSession.id,

          error:
            safeErrorMetadata(
              error
            ),
        }
      );
    }

    /*
     * ========================================
     * Sanitized Account
     * ========================================
     */

    const account:
      CurrentAccount = {
      id,

      email,

      name:
        String(
          record.name ||
            ""
        ),

      employee_code:
        String(
          record.employee_code ||
            ""
        ),

      role:
        record.role,

      department:
        record.department
          ? String(
              record.department
            )
          : undefined,
    };

    return {
      pb,
      account,
    };
  } catch (error) {
    /*
     * authRefresh ممکن است به علت Network /
     * PocketBase outage هم Fail شود.
     *
     * بنابراین Session Registry را صرفاً
     * به خاطر خطای Refresh دائماً revoke
     * نمی‌کنیم.
     */

    pb.authStore.clear();

    console.error(
      "PocketBase auth refresh failed",
      {
        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return null;
  }
}

/*
 * ============================================
 * Current Account
 * ============================================
 */

export async function getCurrentAccount(): Promise<CurrentAccount | null> {
  const session =
    await getAuthenticatedPocketBase();

  return (
    session?.account ??
    null
  );
}

/*
 * ============================================
 * Persist refreshed pb_auth
 * ============================================
 */

function tryPersistAuthCookie(
  cookieStore:
    Awaited<
      ReturnType<
        typeof cookies
      >
    >,

  pb:
    PocketBase,

  sessionExpiresAt:
    Date
) {
  try {
    cookieStore.set(
      getPocketBaseAuthCookie(
        pb,
        {
          maxExpiresAt:
            sessionExpiresAt,
        }
      )
    );
  } catch {
    /*
     * Next.js در Server Component اجازه
     * Cookie mutation نمی‌دهد.
     *
     * در Route Handler قابل انجام است.
     */
  }
}

/*
 * ============================================
 * Delete Both Cookies
 * ============================================
 */

function tryDeleteAuthCookies(
  cookieStore:
    Awaited<
      ReturnType<
        typeof cookies
      >
    >
) {
  try {
    cookieStore.set(
      getExpiredAuthCookie()
    );

    cookieStore.set(
      getExpiredAppSessionCookie()
    );
  } catch {
    /*
     * Server Components امکان Cookie mutation
     * ندارند.
     */
  }
}

/*
 * ============================================
 * Quiet Revocation
 * ============================================
 */

async function revokeSessionQuietly(
  token:
    string,

  reason:
    string
) {
  try {
    await revokeAppSession({
      token,
      reason,
    });
  } catch (error) {
    console.error(
      "Application session revoke failed",
      {
        reason,

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
 * Safe Error
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