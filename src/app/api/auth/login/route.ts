import {
  randomUUID,
} from "node:crypto";

import {
  NextResponse,
} from "next/server";

import type {
  RecordModel,
} from "pocketbase";

import {
  recordAuditLog,
} from "@/lib/audit/log";

import {
  createAppSession,
  revokeAppSession,
} from "@/lib/auth/app-session";

import {
  checkLoginRateLimit,
  clearLoginFailures,
  getLoginClientIp,
  registerLoginFailure,
} from "@/lib/auth/login-rate-limit";

import {
  APP_SESSION_COOKIE_NAME,
  getAppSessionCookie,
  getPocketBaseAuthCookie,
} from "@/lib/pocketbase/auth-cookie";

import {
  createServerPocketBase,
} from "@/lib/pocketbase/server";

const MAX_EMAIL_LENGTH =
  254;

const MAX_PASSWORD_LENGTH =
  1024;

  const MAX_REQUEST_BODY_BYTES =
  8 * 1024;

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

  /*
   * ==========================================
   * Existing Application Session
   *
   * اگر Browser از قبل Session داشته باشد،
   * فقط بعد از Login موفق و ساخت Session جدید
   * آن Session قبلی revoke خواهد شد.
   * ==========================================
   */

  const previousAppSessionToken =
    getCookieValue(
      request.headers.get(
        "cookie"
      ),
      APP_SESSION_COOKIE_NAME
    );

  /*
   * ==========================================
   * Body
   * ==========================================
   */

  /*
 * ==========================================
 * Content Type
 * ==========================================
 */

const contentType =
  String(
    request.headers.get(
      "content-type"
    ) ||
      ""
  )
    .split(";")[0]
    .trim()
    .toLowerCase();

if (
  contentType !==
  "application/json"
) {
  return jsonResponse(
    {
      success:
        false,

      message:
        "نوع محتوای درخواست معتبر نیست.",
    },
    415,
    requestId
  );
}

/*
 * ==========================================
 * Declared Body Size
 * ==========================================
 */

const contentLength =
  request.headers.get(
    "content-length"
  );

if (
  contentLength
) {
  const declaredLength =
    Number(
      contentLength
    );

  if (
    Number.isFinite(
      declaredLength
    ) &&
    declaredLength >
      MAX_REQUEST_BODY_BYTES
  ) {
    return jsonResponse(
      {
        success:
          false,

        message:
          "حجم درخواست بیش از حد مجاز است.",
      },
      413,
      requestId
    );
  }
}

/*
 * ==========================================
 * Bounded JSON Body
 * ==========================================
 */

const parsedBody =
  await readJsonBodyWithLimit(
    request,
    MAX_REQUEST_BODY_BYTES
  );

if (
  !parsedBody.ok
) {
  return jsonResponse(
    {
      success:
        false,

      message:
        parsedBody.message,
    },
    parsedBody.status,
    requestId
  );
}

const body =
  parsedBody.body;

  /*
   * ==========================================
   * Credentials
   * ==========================================
   */

  const credentials =
    parseCredentials(
      body
    );

  if (
    !credentials
  ) {
    return jsonResponse(
      {
        success:
          false,

        message:
          "ایمیل و رمز عبور الزامی است.",
      },
      400,
      requestId
    );
  }

  const {
    email,
    password,
  } =
    credentials;

  /*
   * ==========================================
   * Client IP
   * ==========================================
   */

  const ip =
    getLoginClientIp(
      request
    );

  /*
   * ==========================================
   * Pre-login Rate Limit
   * ==========================================
   */

  try {
    const rateLimit =
      await checkLoginRateLimit({
        email,
        ip,
      });

    if (
      !rateLimit.allowed
    ) {
      await recordAuditLog({
        request,

        requestId,

        actorRole:
          "system",

        action:
          "auth.login.blocked",

        result:
          "blocked",

        entityType:
          "auth",

        errorCode:
          "LOGIN_RATE_LIMITED",

        metadata: {
          reason:
            "rate_limit",

          retry_after_seconds:
            rateLimit.retryAfterSeconds,
        },
      });

      return rateLimitedResponse(
        rateLimit.retryAfterSeconds,
        requestId
      );
    }
  } catch (error) {
    console.error(
      "Login rate limit check failed",
      {
        requestId,

        ...safeErrorMetadata(
          error
        ),
      }
    );

    await recordAuditLog({
      request,

      requestId,

      actorRole:
        "system",

      action:
        "auth.login.blocked",

      result:
        "blocked",

      entityType:
        "auth",

      errorCode:
        "RATE_LIMIT_UNAVAILABLE",

      metadata: {
        reason:
          "rate_limit_service_unavailable",
      },
    });

    return jsonResponse(
      {
        success:
          false,

        message:
          "سرویس ورود موقتاً در دسترس نیست. کمی بعد دوباره تلاش کنید.",
      },
      503,
      requestId
    );
  }

  /*
   * ==========================================
   * PocketBase Authentication
   * ==========================================
   */

  const pb =
    createServerPocketBase();

  let account:
    RecordModel;

  try {
    const authData =
      await pb
        .collection(
          "accounts"
        )
        .authWithPassword(
          email,
          password
        );

    account =
      authData.record;
  } catch (error) {
    return handleInvalidCredentials({
      request,

      requestId,

      email,

      ip,

      error,
    });
  }

  /*
   * ==========================================
   * Active
   * ==========================================
   */

  if (
    account.active !==
    true
  ) {
    pb.authStore.clear();

    await recordAuditLog({
      request,

      requestId,

      actorId:
        account.id,

      actorRole:
        isKnownRole(
          account.role
        )
          ? account.role
          : "system",

      action:
        "auth.login.blocked",

      result:
        "blocked",

      entityType:
        "account",

      entityId:
        account.id,

      errorCode:
        "ACCOUNT_INACTIVE",

      metadata: {
        reason:
          "account_inactive",
      },
    });

    return jsonResponse(
      {
        success:
          false,

        message:
          "حساب کاربری غیرفعال است.",
      },
      403,
      requestId
    );
  }

  /*
   * ==========================================
   * Role
   * ==========================================
   */

  if (
    account.role !==
      "employee" &&
    account.role !==
      "admin"
  ) {
    pb.authStore.clear();

    await recordAuditLog({
      request,

      requestId,

      actorId:
        account.id,

      actorRole:
        "system",

      action:
        "auth.login.blocked",

      result:
        "blocked",

      entityType:
        "account",

      entityId:
        account.id,

      errorCode:
        "INVALID_ACCOUNT_ROLE",

      metadata: {
        reason:
          "invalid_role",
      },
    });

    return jsonResponse(
      {
        success:
          false,

        message:
          "سطح دسترسی حساب معتبر نیست.",
      },
      403,
      requestId
    );
  }

  /*
   * ==========================================
   * Auth Store Sanity
   * ==========================================
   */

  if (
    !pb.authStore.isValid ||
    !pb.authStore.token
  ) {
    pb.authStore.clear();

    console.error(
      "Login authentication store is invalid",
      {
        accountId:
          account.id,

        requestId,
      }
    );

    await recordAuditLog({
      request,

      requestId,

      actorId:
        account.id,

      actorRole:
        account.role,

      action:
        "auth.login.failure",

      result:
        "failure",

      entityType:
        "account",

      entityId:
        account.id,

      errorCode:
        "INVALID_AUTH_STORE",

      metadata: {
        reason:
          "authentication_store_invalid",
      },
    });

    return jsonResponse(
      {
        success:
          false,

        message:
          "ورود به حساب انجام نشد.",
      },
      500,
      requestId
    );
  }

  /*
   * ==========================================
   * Clear Previous Login Failures
   * ==========================================
   */

  try {
    await clearLoginFailures({
      email,
      ip,
    });
  } catch (error) {
    pb.authStore.clear();

    console.error(
      "Clear login failures failed",
      {
        requestId,

        accountId:
          account.id,

        ...safeErrorMetadata(
          error
        ),
      }
    );

    await recordAuditLog({
      request,

      requestId,

      actorId:
        account.id,

      actorRole:
        account.role,

      action:
        "auth.login.blocked",

      result:
        "blocked",

      entityType:
        "account",

      entityId:
        account.id,

      errorCode:
        "LOGIN_RATE_LIMIT_STATE_UNAVAILABLE",

      metadata: {
        reason:
          "rate_limit_state_clear_failed",
      },
    });

    return jsonResponse(
      {
        success:
          false,

        message:
          "سرویس ورود موقتاً در دسترس نیست. کمی بعد دوباره تلاش کنید.",
      },
      503,
      requestId
    );
  }

  /*
   * ==========================================
   * Initial PocketBase Cookie
   *
   * Expiry اصلی PocketBase Token را قبل از
   * ساخت app_session می‌خوانیم.
   * ==========================================
   */

  let initialPbCookie;

  try {
    initialPbCookie =
      getPocketBaseAuthCookie(
        pb
      );
  } catch (error) {
    pb.authStore.clear();

    console.error(
      "PocketBase cookie creation failed",
      {
        requestId,

        accountId:
          account.id,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    await recordAuditLog({
      request,

      requestId,

      actorId:
        account.id,

      actorRole:
        account.role,

      action:
        "auth.login.failure",

      result:
        "failure",

      entityType:
        "account",

      entityId:
        account.id,

      errorCode:
        "AUTH_COOKIE_CREATE_FAILED",

      metadata: {
        reason:
          "auth_cookie_create_failed",
      },
    });

    return jsonResponse(
      {
        success:
          false,

        message:
          "ایجاد نشست ورود ناموفق بود.",
      },
      503,
      requestId
    );
  }

  /*
   * ==========================================
   * Create New Application Session
   *
   * همیشه یک Token جدید 256-bit ساخته می‌شود.
   * Session قبلی Browser reuse نمی‌شود.
   * ==========================================
   */

  let appSession;

  try {
    appSession =
      await createAppSession({
        request,

        userId:
          account.id,

        maxExpiresAt:
          initialPbCookie.expires,
      });
  } catch (error) {
    pb.authStore.clear();

    console.error(
      "Application session creation failed",
      {
        requestId,

        accountId:
          account.id,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    await recordAuditLog({
      request,

      requestId,

      actorId:
        account.id,

      actorRole:
        account.role,

      action:
        "auth.login.failure",

      result:
        "failure",

      entityType:
        "account",

      entityId:
        account.id,

      errorCode:
        "APP_SESSION_CREATE_FAILED",

      metadata: {
        reason:
          "application_session_create_failed",
      },
    });

    return jsonResponse(
      {
        success:
          false,

        message:
          "ایجاد نشست امن ورود ناموفق بود.",
      },
      503,
      requestId
    );
  }

  /*
   * ==========================================
   * Session Rotation
   *
   * فقط بعد از اینکه Session جدید با موفقیت
   * ساخته شد، Session قبلی Browser را revoke
   * می‌کنیم.
   *
   * بنابراین Login موفق همیشه Token جدید دارد.
   * ==========================================
   */

  if (
    previousAppSessionToken &&
    previousAppSessionToken !==
      appSession.token
  ) {
    try {
      await revokeAppSession({
        token:
          previousAppSessionToken,

        reason:
          "login_rotation",
      });
    } catch (error) {
      /*
       * Rotation را Fail-Closed نگه می‌داریم.
       *
       * اگر Session قبلی قابل revoke نباشد،
       * Session جدید را هم تا حد امکان revoke
       * می‌کنیم و Cookie جدید صادر نمی‌کنیم.
       */

      try {
        await revokeAppSession({
          token:
            appSession.token,

          reason:
            "login_rotation_failed",
        });
      } catch (
        cleanupError
      ) {
        console.error(
          "New application session cleanup failed",
          {
            requestId,

            accountId:
              account.id,

            error:
              safeErrorMetadata(
                cleanupError
              ),
          }
        );
      }

      pb.authStore.clear();

      console.error(
        "Previous application session rotation failed",
        {
          requestId,

          accountId:
            account.id,

          error:
            safeErrorMetadata(
              error
            ),
        }
      );

      await recordAuditLog({
        request,

        requestId,

        actorId:
          account.id,

        actorRole:
          account.role,

        action:
          "auth.login.failure",

        result:
          "failure",

        entityType:
          "account",

        entityId:
          account.id,

        errorCode:
          "SESSION_ROTATION_FAILED",

        metadata: {
          reason:
            "previous_session_revocation_failed",
        },
      });

      return jsonResponse(
        {
          success:
            false,

          message:
            "ایجاد نشست امن ورود ناموفق بود.",
        },
        503,
        requestId
      );
    }
  }

  /*
   * ==========================================
   * Final pb_auth Cookie
   *
   * Expiry را دقیقاً به پایان app_session
   * Clamp می‌کنیم.
   * ==========================================
   */

  let pbCookie;

  try {
    pbCookie =
      getPocketBaseAuthCookie(
        pb,
        {
          maxExpiresAt:
            appSession.expiresAt,
        }
      );
  } catch (error) {
    /*
     * Session برنامه ساخته شده ولی Cookie
     * PocketBase قابل تولید نیست.
     *
     * Session جدید را revoke می‌کنیم تا یک
     * Session معتبرِ بدون Browser باقی نماند.
     */

    try {
      await revokeAppSession({
        token:
          appSession.token,

        reason:
          "final_auth_cookie_failed",
      });
    } catch (
      cleanupError
    ) {
      console.error(
        "Application session cleanup after cookie failure failed",
        {
          requestId,

          accountId:
            account.id,

          error:
            safeErrorMetadata(
              cleanupError
            ),
        }
      );
    }

    pb.authStore.clear();

    console.error(
      "Final PocketBase cookie creation failed",
      {
        requestId,

        accountId:
          account.id,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    await recordAuditLog({
      request,

      requestId,

      actorId:
        account.id,

      actorRole:
        account.role,

      action:
        "auth.login.failure",

      result:
        "failure",

      entityType:
        "account",

      entityId:
        account.id,

      errorCode:
        "FINAL_AUTH_COOKIE_CREATE_FAILED",

      metadata: {
        reason:
          "final_auth_cookie_create_failed",
      },
    });

    return jsonResponse(
      {
        success:
          false,

        message:
          "ایجاد نشست امن ورود ناموفق بود.",
      },
      503,
      requestId
    );
  }

  /*
   * ==========================================
   * Audit Success
   * ==========================================
   */

  await recordAuditLog({
    request,

    requestId,

    actorId:
      account.id,

    actorRole:
      account.role,

    action:
      "auth.login.success",

    result:
      "success",

    entityType:
      "account",

    entityId:
      account.id,

    metadata: {
      role:
        account.role,

      session_expires_at:
        appSession
          .expiresAt
          .toISOString(),

      session_rotated:
        Boolean(
          previousAppSessionToken
        ),
    },
  });

  /*
   * ==========================================
   * Response
   * ==========================================
   */

  const response =
    NextResponse.json(
      {
        success:
          true,

        account: {
          id:
            account.id,

          email:
            account.email,

          name:
            String(
              account.name ||
                ""
            ),

          employee_code:
            String(
              account.employee_code ||
                ""
            ),

          role:
            account.role,

          department:
            account.department ||
            undefined,
        },

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
        },
      }
    );

  /*
   * ==========================================
   * Cookies
   * ==========================================
   */

  response.cookies.set(
    pbCookie
  );

  response.cookies.set(
    getAppSessionCookie(
      appSession.token,
      appSession.expiresAt
    )
  );

  return response;
}

/*
 * ============================================
 * Invalid Credentials
 * ============================================
 */

async function handleInvalidCredentials({
  request,
  requestId,
  email,
  ip,
  error,
}: {
  request:
    Request;

  requestId:
    string;

  email:
    string;

  ip:
    string;

  error:
    unknown;
}) {
  console.warn(
    "Login failed",
    {
      requestId,

      ...safeErrorMetadata(
        error
      ),
    }
  );

  try {
    const rateLimit =
      await registerLoginFailure({
        email,
        ip,
      });

    if (
      !rateLimit.allowed
    ) {
      await recordAuditLog({
        request,

        requestId,

        actorRole:
          "system",

        action:
          "auth.login.blocked",

        result:
          "blocked",

        entityType:
          "auth",

        errorCode:
          "LOGIN_RATE_LIMITED",

        metadata: {
          reason:
            "maximum_failures_reached",

          retry_after_seconds:
            rateLimit.retryAfterSeconds,
        },
      });

      return rateLimitedResponse(
        rateLimit.retryAfterSeconds,
        requestId
      );
    }
  } catch (
  rateLimitError
) {
  /*
   * ========================================
   * Fail Closed
   *
   * اگر نتوانیم Attempt ناموفق را در
   * Rate Limit Registry ثبت کنیم، اجازه
   * ادامه Login Attemptها را نمی‌دهیم.
   * ========================================
   */

  console.error(
    "Register login failure failed",
    {
      requestId,

      ...safeErrorMetadata(
        rateLimitError
      ),
    }
  );

  try {
    await recordAuditLog({
      request,

      requestId,

      actorRole:
        "system",

      action:
        "auth.login.blocked",

      result:
        "blocked",

      entityType:
        "auth",

      errorCode:
        "RATE_LIMIT_WRITE_UNAVAILABLE",

      metadata: {
        reason:
          "failed_attempt_could_not_be_registered",
      },
    });
  } catch (
    auditError
  ) {
    /*
     * Audit Failure نباید باعث شود
     * Fail-Closed بودن Rate Limit از بین برود.
     */
    console.error(
      "Login rate-limit failure audit failed",
      {
        requestId,

        ...safeErrorMetadata(
          auditError
        ),
      }
    );
  }

  return jsonResponse(
    {
      success:
        false,

      message:
        "سرویس ورود موقتاً در دسترس نیست. کمی بعد دوباره تلاش کنید.",
    },
    503,
    requestId
  );
}

  await recordAuditLog({
    request,

    requestId,

    actorRole:
      "system",

    action:
      "auth.login.failure",

    result:
      "failure",

    entityType:
      "auth",

    errorCode:
      "INVALID_CREDENTIALS",

    metadata: {
      reason:
        "invalid_credentials",
    },
  });

  return jsonResponse(
    {
      success:
        false,

      message:
        "ایمیل یا رمز عبور اشتباه است.",
    },
    401,
    requestId
  );
}

async function readJsonBodyWithLimit(
  request:
    Request,

  maximumBytes:
    number
): Promise<
  | {
      ok:
        true;
      body:
        unknown;
    }
  | {
      ok:
        false;
      status:
        number;
      message:
        string;
    }
> {
  if (
    !request.body
  ) {
    return {
      ok:
        false,

      status:
        400,

      message:
        "ساختار درخواست معتبر نیست.",
    };
  }

  const reader =
    request.body.getReader();

  const decoder =
    new TextDecoder(
      "utf-8",
      {
        fatal:
          true,
      }
    );

  let totalBytes =
    0;

  let text =
    "";

  try {
    while (
      true
    ) {
      const {
        done,
        value,
      } =
        await reader.read();

      if (
        done
      ) {
        break;
      }

      if (
        !value
      ) {
        continue;
      }

      totalBytes +=
        value.byteLength;

      if (
        totalBytes >
        maximumBytes
      ) {
        try {
          await reader.cancel();
        } catch {
          // Ignore cancel failure.
        }

        return {
          ok:
            false,

          status:
            413,

          message:
            "حجم درخواست بیش از حد مجاز است.",
        };
      }

      text +=
        decoder.decode(
          value,
          {
            stream:
              true,
          }
        );
    }

    text +=
      decoder.decode();
  } catch {
    return {
      ok:
        false,

      status:
        400,

      message:
        "ساختار درخواست معتبر نیست.",
    };
  }

  if (
    !text.trim()
  ) {
    return {
      ok:
        false,

      status:
        400,

      message:
        "ساختار درخواست معتبر نیست.",
    };
  }

  try {
    return {
      ok:
        true,

      body:
        JSON.parse(
          text
        ),
    };
  } catch {
    return {
      ok:
        false,

      status:
        400,

      message:
        "ساختار درخواست معتبر نیست.",
    };
  }
}

/*
 * ============================================
 * Credentials
 * ============================================
 */
function parseCredentials(
  body:
    unknown
): {
  email:
    string;

  password:
    string;
} | null {
  if (
    typeof body !==
      "object" ||
    body ===
      null
  ) {
    return null;
  }

  const value =
    body as {
      email?: unknown;
      password?: unknown;
    };

  if (
    typeof value.email !==
      "string" ||
    typeof value.password !==
      "string"
  ) {
    return null;
  }

  const email =
    value.email
      .trim()
      .toLowerCase();

  const password =
    value.password;

  if (
    !email ||
    !password
  ) {
    return null;
  }

  if (
    email.length >
      MAX_EMAIL_LENGTH ||
    password.length >
      MAX_PASSWORD_LENGTH
  ) {
    return null;
  }

  return {
    email,
    password,
  };
}

/*
 * ============================================
 * Rate Limited Response
 * ============================================
 */

function rateLimitedResponse(
  retryAfterSeconds:
    number,

  requestId:
    string
) {
  const safeRetry =
    Math.max(
      1,
      Math.ceil(
        retryAfterSeconds
      )
    );

  return NextResponse.json(
    {
      success:
        false,

      code:
        "LOGIN_RATE_LIMITED",

      message:
        "تعداد تلاش‌های ورود بیش از حد مجاز است. چند دقیقه دیگر دوباره تلاش کنید.",

      retryAfterSeconds:
        safeRetry,

      requestId,
    },
    {
      status:
        429,

      headers: {
        "Cache-Control":
          "no-store",

        "Pragma":
          "no-cache",

        "Retry-After":
          String(
            safeRetry
          ),

        "X-Request-Id":
          requestId,
      },
    }
  );
}

/*
 * ============================================
 * JSON Response
 * ============================================
 */

function jsonResponse(
  data: {
    success:
      boolean;

    message?:
      string;
  },

  status:
    number,

  requestId:
    string
) {
  return NextResponse.json(
    {
      ...data,

      requestId,
    },
    {
      status,

      headers: {
        "Cache-Control":
          "no-store",

        "Pragma":
          "no-cache",

        "X-Request-Id":
          requestId,
      },
    }
  );
}

/*
 * ============================================
 * Cookie Reader
 * ============================================
 */

function getCookieValue(
  cookieHeader:
    string |
    null,

  name:
    string
) {
  if (!cookieHeader) {
    return "";
  }

  for (
    const part of
    cookieHeader.split(
      ";"
    )
  ) {
    const separator =
      part.indexOf(
        "="
      );

    if (
      separator <
      0
    ) {
      continue;
    }

    const cookieName =
      part
        .slice(
          0,
          separator
        )
        .trim();

    if (
      cookieName !==
      name
    ) {
      continue;
    }

    const value =
      part
        .slice(
          separator +
            1
        )
        .trim();

    try {
      return decodeURIComponent(
        value
      );
    } catch {
      return value;
    }
  }

  return "";
}

/*
 * ============================================
 * Roles
 * ============================================
 */

function isKnownRole(
  value:
    unknown
): value is
  | "employee"
  | "admin" {
  return (
    value ===
      "employee" ||
    value ===
      "admin"
  );
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
        "number" ||
      typeof value.code ===
        "string"
        ? value.code
        : undefined,
  };
}