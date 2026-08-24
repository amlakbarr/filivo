import {
  NextResponse,
} from "next/server";

import {
  consumeAdminRateLimit,
} from "@/lib/admin/rate-limit";

import {
  searchKnowledge,
} from "@/lib/ai/knowledge";

import {
  getAdminSession,
} from "@/lib/pocketbase/admin";

/*
 * ============================================
 * Limits
 * ============================================
 */

const MAX_REQUEST_BODY_BYTES =
  8 * 1024;

const MAX_QUERY_LENGTH =
  500;

const SEARCH_RESULT_LIMIT =
  5;

/*
 * ============================================
 * Types
 * ============================================
 */

type SearchPayload =
  | {
      success:
        true;

      query:
        string;
    }
  | {
      success:
        false;

      code:
        string;

      message:
        string;

      fieldErrors?:
        Record<
          string,
          string
        >;
    };

type AllowedRateLimit = {
  allowed:
    true;

  limit:
    number;

  remaining:
    number;

  resetAt:
    string;
};

/*
 * ============================================
 * POST
 *
 * Admin Knowledge Search
 *
 * Rate Limit:
 *
 * knowledge.search
 * 30 requests / minute / admin
 * ============================================
 */

export async function POST(
  request:
    Request
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
    return jsonResponse(
      {
        success:
          false,

        code:
          admin.code,

        message:
          admin.message,
      },
      admin.status,
      requestId
    );
  }

  /*
   * ==========================================
   * Admin Rate Limit
   *
   * knowledge.search
   *
   * 30 requests / minute / admin
   *
   * Query وارد fingerprint نمی‌شود.
   *
   * بنابراین Admin نمی‌تواند با تغییر متن
   * Search محدودیت را دور بزند.
   *
   * Fail-closed:
   * اگر Rate Limiter در دسترس نباشد Search
   * اجرا نمی‌شود.
   * ==========================================
   */

  let rateLimit:
    Awaited<
      ReturnType<
        typeof consumeAdminRateLimit
      >
    >;

  try {
    rateLimit =
      await consumeAdminRateLimit({
        adminId:
          admin.account.id,

        action:
          "knowledge.search",

        requestId,
      });
  } catch (error) {
    console.error(
      "Admin knowledge search rate limit unavailable",
      {
        requestId,

        adminId:
          admin.account.id,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return jsonResponse(
      {
        success:
          false,

        code:
          "ADMIN_RATE_LIMIT_UNAVAILABLE",

        message:
          "سرویس کنترل تعداد درخواست‌ها موقتاً در دسترس نیست.",
      },
      503,
      requestId
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
    return rateLimitedResponse(
      requestId,
      rateLimit
    );
  }

  const allowedRateLimit:
    AllowedRateLimit =
    rateLimit;

  /*
   * تمام Responseهای بعد از Consume باید
   * Headerهای Rate Limit را داشته باشند.
   */

  const respond =
    <TResponse extends Response>(
      response:
        TResponse
    ) =>
      withRateLimitHeaders(
        response,
        allowedRateLimit
      );

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
    return respond(
      jsonResponse(
        {
          success:
            false,

          code:
            "UNSUPPORTED_MEDIA_TYPE",

          message:
            "نوع محتوای درخواست معتبر نیست.",
        },
        415,
        requestId
      )
    );
  }

  /*
   * ==========================================
   * Content-Length Fast Reject
   *
   * فقط Fast Reject است.
   *
   * محدودیت واقعی در Stream Reader نیز
   * اعمال می‌شود.
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
      return respond(
        jsonResponse(
          {
            success:
              false,

            code:
              "INVALID_CONTENT_LENGTH",

            message:
              "حجم درخواست معتبر نیست.",
          },
          400,
          requestId
        )
      );
    }

    if (
      contentLength >
      MAX_REQUEST_BODY_BYTES
    ) {
      return respond(
        jsonResponse(
          {
            success:
              false,

            code:
              "REQUEST_BODY_TOO_LARGE",

            message:
              "حجم درخواست بیش از حد مجاز است.",
          },
          413,
          requestId
        )
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
    return respond(
      jsonResponse(
        {
          success:
            false,

          code:
            bodyResult.code,

          message:
            bodyResult.message,
        },
        bodyResult.status,
        requestId
      )
    );
  }

  /*
   * ==========================================
   * Strict Payload
   *
   * فقط:
   *
   * {
   *   query: string
   * }
   *
   * پذیرفته می‌شود.
   * ==========================================
   */

  const payload =
    parseSearchPayload(
      bodyResult.body
    );

  if (
    !payload.success
  ) {
    return respond(
      jsonResponse(
        {
          success:
            false,

          code:
            payload.code,

          message:
            payload.message,

          ...(payload.fieldErrors
            ? {
                fieldErrors:
                  payload.fieldErrors,
              }
            : {}),
        },
        400,
        requestId
      )
    );
  }

  const {
    query,
  } = payload;

  /*
   * ==========================================
   * Search
   * ==========================================
   */

  try {
    const results =
      await searchKnowledge(
        query,
        SEARCH_RESULT_LIMIT
      );

    return respond(
      jsonResponse(
        {
          success:
            true,

          query,

          count:
            results.length,

          results,
        },
        200,
        requestId
      )
    );
  } catch (error) {
    /*
     * Query یا نتایج Search داخل Log قرار
     * نمی‌گیرند.
     *
     * فقط طول Query ثبت می‌شود.
     */

    console.error(
      "Knowledge search failed",
      {
        requestId,

        adminId:
          admin.account.id,

        queryLength:
          query.length,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return respond(
      jsonResponse(
        {
          success:
            false,

          code:
            "KNOWLEDGE_SEARCH_FAILED",

          message:
            "جستجو در پایگاه دانش ناموفق بود.",
        },
        502,
        requestId
      )
    );
  }
}

/*
 * ============================================
 * Rate Limited Response
 * ============================================
 */

function rateLimitedResponse(
  requestId:
    string,

  rateLimit: {
    allowed:
      false;

    code:
      "ADMIN_RATE_LIMITED";

    limit:
      number;

    remaining:
      0;

    retryAfterSeconds:
      number;

    resetAt:
      string;
  }
) {
  const response =
    jsonResponse(
      {
        success:
          false,

        code:
          "ADMIN_RATE_LIMITED",

        message:
          "تعداد درخواست‌های جستجو در پایگاه دانش بیش از حد مجاز است.",

        retryAfterSeconds:
          rateLimit.retryAfterSeconds,

        limit:
          rateLimit.limit,

        remaining:
          rateLimit.remaining,

        resetAt:
          rateLimit.resetAt,
      },
      429,
      requestId
    );

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
 * ============================================
 * Rate Limit Headers
 * ============================================
 */

function withRateLimitHeaders<
  TResponse extends Response,
>(
  response:
    TResponse,

  rateLimit: {
    limit:
      number;

    remaining:
      number;

    resetAt:
      string;
  }
) {
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
 * Strict Search Payload
 * ============================================
 */

function parseSearchPayload(
  body:
    unknown
): SearchPayload {
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
      success:
        false,

      code:
        "INVALID_REQUEST",

      message:
        "ساختار درخواست معتبر نیست.",
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

  const keys =
    Object.keys(
      value
    );

  if (
    keys.some(
      (
        key
      ) =>
        key !==
        "query"
    )
  ) {
    return {
      success:
        false,

      code:
        "UNEXPECTED_FIELDS",

      message:
        "فیلدهای ارسالی برای جستجو معتبر نیستند.",
    };
  }

  /*
   * ==========================================
   * Query Type
   *
   * String(...) عمداً استفاده نمی‌شود.
   * ==========================================
   */

  if (
    typeof value.query !==
    "string"
  ) {
    return {
      success:
        false,

      code:
        "INVALID_QUERY",

      message:
        "متن جستجو معتبر نیست.",

      fieldErrors: {
        query:
          "متن جستجو باید از نوع متن باشد.",
      },
    };
  }

  /*
   * ==========================================
   * Raw Length
   *
   * Query بلند silently truncate نمی‌شود.
   * ==========================================
   */

  if (
    value.query.length >
    MAX_QUERY_LENGTH
  ) {
    return {
      success:
        false,

      code:
        "QUERY_TOO_LONG",

      message:
        "متن جستجو بیش از حد طولانی است.",

      fieldErrors: {
        query:
          `متن جستجو نباید بیشتر از ${MAX_QUERY_LENGTH.toLocaleString(
            "fa-IR"
          )} نویسه باشد.`,
      },
    };
  }

  /*
   * ==========================================
   * Normalize
   * ==========================================
   */

  const query =
    normalizeQuery(
      value.query
    );

  if (
    !query
  ) {
    return {
      success:
        false,

      code:
        "EMPTY_QUERY",

      message:
        "متن جستجو نمی‌تواند خالی باشد.",

      fieldErrors: {
        query:
          "متن جستجو نمی‌تواند خالی باشد.",
      },
    };
  }

  return {
    success:
      true,

    query,
  };
}

/*
 * ============================================
 * Normalize Query
 * ============================================
 */

function normalizeQuery(
  value:
    string
) {
  return value
    /*
     * Control Characters
     */
    .replace(
      /[\u0000-\u001F\u007F]/g,
      " "
    )

    /*
     * Whitespace Normalization
     */
    .replace(
      /\s+/g,
      " "
    )

    .trim();
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
   * Parse JSON
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
 * JSON Response
 * ============================================
 */

function jsonResponse(
  body:
    Record<
      string,
      unknown
    >,

  status:
    number,

  requestId:
    string
) {
  return NextResponse.json(
    {
      ...body,

      requestId,
    },
    {
      status:
        safeHttpStatus(
          status,
          500
        ),

      headers: {
        "X-Request-Id":
          requestId,

        "Cache-Control":
          "private, no-store, no-cache, max-age=0, must-revalidate",

        "Pragma":
          "no-cache",

        "Expires":
          "0",

        "X-Content-Type-Options":
          "nosniff",
      },
    }
  );
}

/*
 * ============================================
 * Safe HTTP Status
 * ============================================
 */

function safeHttpStatus(
  value:
    unknown,

  fallback:
    number
) {
  const status =
    Number(
      value
    );

  if (
    !Number.isSafeInteger(
      status
    ) ||
    status <
      100 ||
    status >
      599
  ) {
    return fallback;
  }

  return status;
}

/*
 * ============================================
 * Safe Error Metadata
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