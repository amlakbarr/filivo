import {
  randomUUID,
} from "node:crypto";

import {
  cookies,
} from "next/headers";

import {
  NextResponse,
} from "next/server";

import {
  recordAuditLog,
} from "@/lib/audit/log";

import {
  revokeAppSession,
} from "@/lib/auth/app-session";

import {
  getAuthenticatedPocketBase,
} from "@/lib/pocketbase/auth";

import {
  APP_SESSION_COOKIE_NAME,
  getExpiredAppSessionCookie,
  getExpiredAuthCookie,
} from "@/lib/pocketbase/auth-cookie";

/*
 * ============================================
 * POST
 * ============================================
 */

export async function POST(
  request: Request
) {
  const requestId =
    randomUUID();

  const cookieStore =
    await cookies();

  /*
   * Raw app_session فقط برای Hash Lookup
   * استفاده می‌شود.
   *
   * مقدار Token هرگز Log نمی‌شود.
   */
  const appSessionToken =
    cookieStore.get(
      APP_SESSION_COOKIE_NAME
    )?.value ||
    "";

  /*
   * ==========================================
   * Resolve Current Account
   *
   * قبل از Revocation انجام می‌شود تا اگر
   * Session معتبر است Actor را برای Audit
   * داشته باشیم.
   * ==========================================
   */

  let session:
    Awaited<
      ReturnType<
        typeof getAuthenticatedPocketBase
      >
    > =
    null;

  try {
    session =
      await getAuthenticatedPocketBase();
  } catch (error) {
    /*
     * Logout باید حتی در صورت خرابی Auth
     * بتواند Cookieهای Browser را پاک کند.
     */
    console.error(
      "Logout session lookup failed",
      {
        requestId,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );
  }

  /*
   * ==========================================
   * Revoke Server-side App Session
   * ==========================================
   */

  let revocationFailed =
    false;

  let revoked =
    false;

  let alreadyRevoked =
    false;

  let sessionFound =
    false;

  if (
    appSessionToken
  ) {
    try {
      const result =
        await revokeAppSession({
          token:
            appSessionToken,

          reason:
            "logout",
        });

      sessionFound =
        result.found ===
        true;

      revoked =
        result.revoked ===
        true;

      alreadyRevoked =
        "alreadyRevoked" in
          result &&
        result.alreadyRevoked ===
          true;
    } catch (error) {
      revocationFailed =
        true;

      console.error(
        "Logout app session revocation failed",
        {
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
   * ==========================================
   * Audit
   * ==========================================
   */

  try {
    await recordAuditLog({
      request,

      requestId,

      ...(session
        ? {
            actorId:
              session.account.id,

            actorRole:
              session.account.role,

            entityType:
              "account",

            entityId:
              session.account.id,
          }
        : {
            actorRole:
              "system" as const,

            entityType:
              "auth",
          }),

      action:
        "auth.logout",

      result:
        revocationFailed
          ? "failure"
          : "success",

      ...(revocationFailed
        ? {
            errorCode:
              "APP_SESSION_REVOCATION_FAILED",
          }
        : {}),

      metadata: {
        had_valid_session:
          Boolean(
            session
          ),

        had_app_session_cookie:
          Boolean(
            appSessionToken
          ),

        server_session_found:
          sessionFound,

        server_session_revoked:
          revoked,

        server_session_already_revoked:
          alreadyRevoked,
      },
    });
  } catch (error) {
    /*
     * Audit Failure هرگز نباید جلوی حذف
     * Cookieها را بگیرد.
     */
    console.error(
      "Logout audit failed",
      {
        requestId,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );
  }

  /*
   * ==========================================
   * Response
   *
   * حتی در صورت Revocation failure،
   * Cookieها پایین پاک می‌شوند.
   *
   * اما پاسخ 503 اعلام می‌کند Server-side
   * Session با قطعیت revoke نشده است.
   * ==========================================
   */

  const response =
    revocationFailed
      ? NextResponse.json(
          {
            success:
              false,

            code:
              "APP_SESSION_REVOCATION_FAILED",

            message:
              "خروج محلی انجام شد، اما ابطال نشست سمت سرور کامل نشد.",

            requestId,
          },
          {
            status:
              503,

            headers: {
  "Cache-Control":
    "no-store",

  "Pragma":
    "no-cache",

  "X-Request-Id":
    requestId,

  "X-Content-Type-Options":
    "nosniff",
},
          }
        )
      : NextResponse.json(
          {
            success:
              true,

            requestId,
          },
          {
            status:
              200,

            headers: {
  "Cache-Control":
    "no-store",

  "Pragma":
    "no-cache",

  "X-Request-Id":
    requestId,

  "X-Content-Type-Options":
    "nosniff",
},
          }
        );

  /*
   * ==========================================
   * Delete Both Cookies
   *
   * این قسمت در هر دو حالت Success/Failure
   * اجرا می‌شود.
   * ==========================================
   */

  response.cookies.set(
    getExpiredAuthCookie()
  );

  response.cookies.set(
    getExpiredAppSessionCookie()
  );

  return response;
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