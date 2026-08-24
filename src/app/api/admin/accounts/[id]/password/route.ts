import {
  getPocketBaseError,
  isSafeRecordId,
  parsePasswordInput,
  type AccountRecord,
} from "@/lib/accounts/admin";

import {
  accountApiError,
  accountApiResponse,
} from "@/lib/accounts/response";

import {
  consumeAdminRateLimit,
} from "@/lib/admin/rate-limit";

import {
  getAdminSession,
} from "@/lib/pocketbase/admin";

import {
  getPocketBaseServiceClient,
} from "@/lib/pocketbase/service";

/*
 * ============================================
 * Limits
 * ============================================
 */

const MAX_REQUEST_BODY_BYTES =
  8 * 1024;

const ALLOWED_PASSWORD_FIELDS =
  new Set([
    "password",
    "passwordConfirm",
  ]);

/*
 * ============================================
 * POST
 *
 * Admin Password Reset
 * ============================================
 */

export async function POST(
  request: Request,
  {
    params,
  }: {
    params: Promise<{
      id: string;
    }>;
  }
) {
  const requestId =
    crypto.randomUUID();

  /*
   * ==========================================
   * Admin Authorization
   * ==========================================
   */

  const admin =
    await getAdminSession();

  if (
    !admin.ok
  ) {
    return accountApiError(
      requestId,
      admin.status,
      admin.code,
      admin.message
    );
  }

  /*
   * ==========================================
   * Account ID
   * ==========================================
   */

  const {
    id,
  } = await params;

  if (
    !isSafeRecordId(
      id
    )
  ) {
    return accountApiError(
      requestId,
      400,
      "INVALID_ACCOUNT_ID",
      "شناسه حساب معتبر نیست."
    );
  }

  /*
   * ==========================================
   * Admin Rate Limit
   *
   * Policy:
   *
   * account.password
   * 5 requests / 10 minutes / admin
   *
   * Target Account ID عمداً بخشی از Bucket
   * نیست؛ بنابراین تغییر Account نمی‌تواند
   * Rate Limit را دور بزند.
   *
   * Fail-closed:
   * اگر Rate Limiter در دسترس نباشد Password
   * تغییر نمی‌کند.
   * ==========================================
   */

  let rateLimit;

  try {
    rateLimit =
      await consumeAdminRateLimit({
        adminId:
          admin.account.id,

        action:
          "account.password",

        requestId,
      });
  } catch (error) {
    console.error(
      "Admin password rate limit unavailable",
      {
        requestId,

        adminId:
          admin.account.id,

        accountId:
          id,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return accountApiError(
      requestId,
      503,
      "ADMIN_RATE_LIMIT_UNAVAILABLE",
      "سرویس کنترل تعداد درخواست‌ها موقتاً در دسترس نیست."
    );
  }

  /*
   * ==========================================
   * Rate Limited
   * ==========================================
   */

  if (
    !rateLimit.allowed
  ) {
    const response =
      accountApiError(
        requestId,
        429,
        "ADMIN_RATE_LIMITED",
        "تعداد درخواست‌های تغییر رمز عبور بیش از حد مجاز است.",
        {
          retryAfterSeconds:
            rateLimit.retryAfterSeconds,

          limit:
            rateLimit.limit,

          remaining:
            rateLimit.remaining,

          resetAt:
            rateLimit.resetAt,
        }
      );

    /*
     * استاندارد HTTP برای 429.
     */
    response.headers.set(
      "Retry-After",
      String(
        rateLimit.retryAfterSeconds
      )
    );

    response.headers.set(
      "X-RateLimit-Limit",
      String(
        rateLimit.limit
      )
    );

    response.headers.set(
      "X-RateLimit-Remaining",
      "0"
    );

    response.headers.set(
      "X-RateLimit-Reset",
      rateLimit.resetAt
    );

    return response;
  }

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
      .split(
        ";"
      )[0]
      .trim()
      .toLowerCase();

  if (
    contentType !==
    "application/json"
  ) {
    return accountApiError(
      requestId,
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "نوع محتوای درخواست معتبر نیست."
    );
  }

  /*
   * ==========================================
   * Declared Content Length
   *
   * Fast Reject.
   *
   * محدودیت واقعی پایین‌تر هنگام Stream Read
   * نیز اعمال می‌شود تا Chunked Request نتواند
   * Limit را دور بزند.
   * ==========================================
   */

  const rawContentLength =
    request.headers.get(
      "content-length"
    );

  if (
    rawContentLength
  ) {
    const contentLength =
      Number(
        rawContentLength
      );

    if (
      !Number.isSafeInteger(
        contentLength
      ) ||
      contentLength <
        0
    ) {
      return accountApiError(
        requestId,
        400,
        "INVALID_CONTENT_LENGTH",
        "حجم درخواست معتبر نیست."
      );
    }

    if (
      contentLength >
      MAX_REQUEST_BODY_BYTES
    ) {
      return accountApiError(
        requestId,
        413,
        "REQUEST_BODY_TOO_LARGE",
        "حجم درخواست بیش از حد مجاز است."
      );
    }
  }

  /*
   * ==========================================
   * Bounded JSON Body
   * ==========================================
   */

  const bodyResult =
    await readJsonBodyWithLimit(
      request,
      MAX_REQUEST_BODY_BYTES
    );

  if (
    !bodyResult.ok
  ) {
    return accountApiError(
      requestId,
      bodyResult.status,
      bodyResult.code,
      bodyResult.message
    );
  }

  const body =
    bodyResult.body;

  /*
   * ==========================================
   * Strict Password Payload
   *
   * فقط:
   *
   * {
   *   password: string,
   *   passwordConfirm: string
   * }
   *
   * پذیرفته می‌شود.
   * ==========================================
   */

  const payloadError =
    validatePasswordPayload(
      body
    );

  if (
    payloadError
  ) {
    return accountApiError(
      requestId,
      400,
      payloadError.code,
      payloadError.message,
      {
        fieldErrors:
          payloadError.fieldErrors,
      }
    );
  }

  /*
   * ==========================================
   * Password Validation
   *
   * Policy اصلی در accounts/admin.ts باقی
   * می‌ماند.
   * ==========================================
   */

  const parsed =
    parsePasswordInput(
      body
    );

  if (
    !parsed.success
  ) {
    return accountApiError(
      requestId,
      400,
      parsed.code,
      parsed.message,
      {
        fieldErrors:
          parsed.fieldErrors,
      }
    );
  }

  /*
   * ==========================================
   * Service Client
   * ==========================================
   */

  let pb;

  try {
    pb =
      await getPocketBaseServiceClient();
  } catch (error) {
    console.error(
      "Password update service unavailable",
      {
        requestId,

        adminId:
          admin.account.id,

        accountId:
          id,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return accountApiError(
      requestId,
      503,
      "ACCOUNT_SERVICE_UNAVAILABLE",
      "سرویس مدیریت حساب‌ها موقتاً در دسترس نیست."
    );
  }

  /*
   * ==========================================
   * Verify Target Account
   * ==========================================
   */

  try {
    await pb
      .collection(
        "accounts"
      )
      .getOne<AccountRecord>(
        id,
        {
          fields:
            "id",
        }
      );
  } catch (error) {
    const metadata =
      getPocketBaseError(
        error
      );

    if (
      metadata.status ===
      404
    ) {
      return accountApiError(
        requestId,
        404,
        "ACCOUNT_NOT_FOUND",
        "حساب موردنظر پیدا نشد."
      );
    }

    console.error(
      "Password target account lookup failed",
      {
        requestId,

        adminId:
          admin.account.id,

        accountId:
          id,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return accountApiError(
      requestId,
      503,
      "ACCOUNT_LOOKUP_FAILED",
      "بررسی حساب موردنظر ناموفق بود."
    );
  }

  /*
   * ==========================================
   * Update Password
   *
   * Password و PasswordConfirm هیچ‌وقت در Log
   * یا Response ثبت نمی‌شوند.
   * ==========================================
   */

  try {
    await pb
      .collection(
        "accounts"
      )
      .update(
        id,
        {
          password:
            parsed.data.password,

          passwordConfirm:
            parsed.data.passwordConfirm,
        }
      );
  } catch (error) {
    const metadata =
      getPocketBaseError(
        error
      );

    console.error(
      "Password update failed",
      {
        requestId,

        adminId:
          admin.account.id,

        accountId:
          id,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return accountApiError(
      requestId,

      metadata.status ===
        404
        ? 404
        : metadata.status ===
            400
          ? 400
          : 503,

      metadata.status ===
        404
        ? "ACCOUNT_NOT_FOUND"
        : metadata.status ===
            400
          ? "PASSWORD_REJECTED"
          : "PASSWORD_UPDATE_FAILED",

      metadata.status ===
        404
        ? "حساب موردنظر پیدا نشد."
        : metadata.status ===
            400
          ? "رمز عبور انتخاب‌شده توسط سرویس حساب پذیرفته نشد."
          : "تغییر رمز عبور ناموفق بود."
    );
  }

  /*
   * ==========================================
   * Success
   * ==========================================
   */

  const response =
    accountApiResponse(
      {
        success:
          true,

        message:
          "رمز عبور با موفقیت تغییر کرد.",
      },
      200,
      requestId
    );

  /*
   * اطلاعات Rate Limit برای Client مفید است.
   */
  response.headers.set(
    "X-RateLimit-Limit",
    String(
      rateLimit.limit
    )
  );

  response.headers.set(
    "X-RateLimit-Remaining",
    String(
      rateLimit.remaining
    )
  );

  response.headers.set(
    "X-RateLimit-Reset",
    rateLimit.resetAt
  );

  return response;
}

/*
 * ============================================
 * Strict Password Payload
 * ============================================
 */

function validatePasswordPayload(
  body:
    unknown
):
  | {
      code:
        string;

      message:
        string;

      fieldErrors:
        Record<
          string,
          string
        >;
    }
  | null {
  /*
   * Array نیز typeof object دارد.
   */
  if (
    typeof body !==
      "object" ||
    body ===
      null ||
    Array.isArray(
      body
    )
  ) {
    return {
      code:
        "INVALID_PASSWORD_PAYLOAD",

      message:
        "ساختار اطلاعات رمز عبور معتبر نیست.",

      fieldErrors: {
        form:
          "ساختار اطلاعات رمز عبور معتبر نیست.",
      },
    };
  }

  const value =
    body as Record<
      string,
      unknown
    >;

  /*
   * ==========================================
   * Unknown Fields
   * ==========================================
   */

  const unknownFields =
    Object.keys(
      value
    ).filter(
      (
        key
      ) =>
        !ALLOWED_PASSWORD_FIELDS.has(
          key
        )
    );

  if (
    unknownFields.length >
    0
  ) {
    return {
      code:
        "UNEXPECTED_FIELDS",

      message:
        "فیلدهای ارسالی برای تغییر رمز عبور معتبر نیستند.",

      fieldErrors: {
        form:
          "فقط password و passwordConfirm قابل ارسال هستند.",
      },
    };
  }

  const fieldErrors:
    Record<
      string,
      string
    > = {};

  /*
   * ==========================================
   * Password
   * ==========================================
   */

  if (
    typeof value.password !==
    "string"
  ) {
    fieldErrors.password =
      "رمز عبور معتبر نیست.";
  }

  /*
   * ==========================================
   * Password Confirmation
   * ==========================================
   */

  if (
    typeof value.passwordConfirm !==
    "string"
  ) {
    fieldErrors.passwordConfirm =
      "تکرار رمز عبور معتبر نیست.";
  }

  if (
    Object.keys(
      fieldErrors
    ).length >
    0
  ) {
    return {
      code:
        "INVALID_PASSWORD_PAYLOAD",

      message:
        Object.values(
          fieldErrors
        )[0],

      fieldErrors,
    };
  }

  return null;
}

/*
 * ============================================
 * Limited JSON Body
 * ============================================
 */

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

      code:
        string;

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

      code:
        "INVALID_JSON",

      message:
        "ساختار درخواست معتبر نیست.",
    };
  }

  const reader =
    request.body
      .getReader();

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
          /*
           * Cancel failure مهم نیست.
           */
        }

        return {
          ok:
            false,

          status:
            413,

          code:
            "REQUEST_BODY_TOO_LARGE",

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

      code:
        "INVALID_JSON",

      message:
        "ساختار درخواست معتبر نیست.",
    };
  }

  /*
   * ==========================================
   * Empty Body
   * ==========================================
   */

  if (
    !text.trim()
  ) {
    return {
      ok:
        false,

      status:
        400,

      code:
        "INVALID_JSON",

      message:
        "ساختار درخواست معتبر نیست.",
    };
  }

  /*
   * ==========================================
   * JSON Parse
   * ==========================================
   */

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

      code:
        "INVALID_JSON",

      message:
        "ساختار درخواست معتبر نیست.",
    };
  }
}

/*
 * ============================================
 * Safe Error Metadata
 *
 * Password / Request Body عمداً Log نمی‌شود.
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
      name?:
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