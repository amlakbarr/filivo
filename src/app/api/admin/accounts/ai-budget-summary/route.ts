import {
  NextResponse,
} from "next/server";

import {
  checkAIBudgetGuard,
} from "@/lib/ai/budget-guard";

import {
  isSafeRecordId,
} from "@/lib/accounts/admin";

import {
  consumeAdminRateLimit,
} from "@/lib/admin/rate-limit";

import {
  getAdminSession,
} from "@/lib/pocketbase/admin";

/*
 * ============================================
 * Limits
 * ============================================
 */

const MAX_USERS =
  50;

const MAX_REQUEST_BODY_BYTES =
  8 * 1024;

/*
 * هر Budget Guard ممکن است چند Query اجرا کند.
 *
 * به‌جای اجرای همزمان 50 User، فشار را محدود
 * می‌کنیم.
 */
const BUDGET_CHECK_CONCURRENCY =
  6;

/*
 * ============================================
 * Types
 * ============================================
 */

type BudgetStatus =
  | "normal"
  | "warning"
  | "blocked";

type BudgetSummaryItem =
  | {
      userId:
        string;

      available:
        true;

      status:
        BudgetStatus;

      source:
        unknown;

      warningPercent:
        unknown;

      code:
        string |
        null;

      warnings:
        Array<{
          type:
            unknown;

          percent:
            number;
        }>;

      usage: {
        daily: {
          tokens:
            number;

          costUsd:
            number;

          requests:
            number;

          unpricedRequests:
            number;
        };

        monthly: {
          tokens:
            number;

          costUsd:
            number;

          requests:
            number;

          unpricedRequests:
            number;
        };
      };

      limits: {
        dailyTokenLimit:
          number;

        monthlyTokenLimit:
          number;

        dailyCostLimitUsd:
          number;

        monthlyCostLimitUsd:
          number;
      };

      percentages: {
        dailyTokens:
          number |
          null;

        monthlyTokens:
          number |
          null;

        dailyCost:
          number |
          null;

        monthlyCost:
          number |
          null;
      };
    }
  | {
      userId:
        string;

      available:
        false;
    };

/*
 * ============================================
 * POST
 *
 * دریافت وضعیت سهمیه چند کاربر با یک Request
 *
 * Rate Limit:
 *
 * account.ai_budget_summary
 * 5 requests / minute / admin
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
    return apiResponse(
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
   * account.ai_budget_summary
   *
   * 5 requests / minute / admin
   *
   * این Endpoint read-only است اما می‌تواند
   * در یک Request تا 50 Budget Guard اجرا کند.
   *
   * User IDها وارد Fingerprint نمی‌شوند؛
   * بنابراین تغییر لیست کاربران باعث دور زدن
   * Rate Limit نمی‌شود.
   *
   * Fail-closed:
   * اگر Rate Limiter در دسترس نباشد هیچ
   * Budget Guard اجرا نمی‌شود.
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
          "account.ai_budget_summary",

        requestId,
      });
  } catch (error) {
    console.error(
      "Admin AI budget summary rate limit unavailable",
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

    return apiResponse(
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

  /*
   * ==========================================
   * Response Wrapper
   *
   * تمام Responseهای بعد از Consume اطلاعات
   * Rate Limit را برمی‌گردانند.
   * ==========================================
   */

  const allowedRateLimit =
    rateLimit;

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
      .split(
        ";"
      )[0]
      .trim()
      .toLowerCase();

  if (
    contentType !==
    "application/json"
  ) {
    return respond(
      apiResponse(
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
   * Declared Content Length
   *
   * Fast Reject.
   *
   * محدودیت اصلی پایین‌تر هنگام Stream Read
   * نیز اعمال می‌شود تا Chunked Body نتواند
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
      return respond(
        apiResponse(
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
        apiResponse(
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
      apiResponse(
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
   * Parse User IDs
   * ==========================================
   */

  const parsed =
    parseUserIds(
      bodyResult.body
    );

  if (
    !parsed.success
  ) {
    return respond(
      apiResponse(
        {
          success:
            false,

          code:
            parsed.code,

          message:
            parsed.message,
        },
        400,
        requestId
      )
    );
  }

  const userIds =
    parsed.userIds;

  /*
   * ==========================================
   * Empty
   *
   * حتی Empty Batch نیز Rate Limit Consume
   * کرده است.
   * ==========================================
   */

  if (
    userIds.length ===
    0
  ) {
    return respond(
      apiResponse(
        {
          success:
            true,

          items:
            [],

          summary: {
            requested:
              0,

            available:
              0,

            unavailable:
              0,
          },
        },
        200,
        requestId
      )
    );
  }

  /*
   * ==========================================
   * Budget Guard
   *
   * Failure یک User باعث Fail شدن همه Batch
   * نمی‌شود.
   *
   * Concurrency محدود است تا Request روی
   * Database / AI Usage فشار انفجاری وارد نکند.
   * ==========================================
   */

  const items =
    await mapWithConcurrency<
      string,
      BudgetSummaryItem
    >(
      userIds,
      BUDGET_CHECK_CONCURRENCY,

      async (
        userId
      ) => {
        try {
          const budget =
            await checkAIBudgetGuard({
              userId,
            });

          const warnings =
            budget.allowed
              ? budget.warnings
              : [];

          const status:
            BudgetStatus =
            budget.allowed
              ? warnings.length >
                  0
                ? "warning"
                : "normal"
              : "blocked";

          return {
            userId,

            available:
              true,

            status,

            source:
              budget.limits
                .source,

            warningPercent:
              budget.limits
                .warningPercent,

            code:
              budget.allowed
                ? null
                : budget.code,

            warnings:
              warnings.map(
                (
                  warning
                ) => ({
                  type:
                    warning.type,

                  percent:
                    roundPercent(
                      warning.percent
                    ),
                })
              ),

            usage: {
              daily: {
                tokens:
                  safeNonNegativeNumber(
                    budget.usage
                      .daily
                      .tokens
                  ),

                costUsd:
                  safeNonNegativeNumber(
                    budget.usage
                      .daily
                      .costUsd
                  ),

                requests:
                  safeNonNegativeNumber(
                    budget.usage
                      .daily
                      .requests
                  ),

                unpricedRequests:
                  safeNonNegativeNumber(
                    budget.usage
                      .daily
                      .unpricedRequests
                  ),
              },

              monthly: {
                tokens:
                  safeNonNegativeNumber(
                    budget.usage
                      .monthly
                      .tokens
                  ),

                costUsd:
                  safeNonNegativeNumber(
                    budget.usage
                      .monthly
                      .costUsd
                  ),

                requests:
                  safeNonNegativeNumber(
                    budget.usage
                      .monthly
                      .requests
                  ),

                unpricedRequests:
                  safeNonNegativeNumber(
                    budget.usage
                      .monthly
                      .unpricedRequests
                  ),
              },
            },

            limits: {
              dailyTokenLimit:
                safeNonNegativeNumber(
                  budget.limits
                    .dailyTokenLimit
                ),

              monthlyTokenLimit:
                safeNonNegativeNumber(
                  budget.limits
                    .monthlyTokenLimit
                ),

              dailyCostLimitUsd:
                safeNonNegativeNumber(
                  budget.limits
                    .dailyCostLimitUsd
                ),

              monthlyCostLimitUsd:
                safeNonNegativeNumber(
                  budget.limits
                    .monthlyCostLimitUsd
                ),
            },

            percentages: {
              dailyTokens:
                calculatePercent(
                  budget.usage
                    .daily
                    .tokens,

                  budget.limits
                    .dailyTokenLimit
                ),

              monthlyTokens:
                calculatePercent(
                  budget.usage
                    .monthly
                    .tokens,

                  budget.limits
                    .monthlyTokenLimit
                ),

              dailyCost:
                calculatePercent(
                  budget.usage
                    .daily
                    .costUsd,

                  budget.limits
                    .dailyCostLimitUsd
                ),

              monthlyCost:
                calculatePercent(
                  budget.usage
                    .monthly
                    .costUsd,

                  budget.limits
                    .monthlyCostLimitUsd
                ),
            },
          };
        } catch (
          error
        ) {
          console.error(
            "AI budget summary failed",
            {
              requestId,

              adminId:
                admin.account.id,

              userId,

              error:
                safeErrorMetadata(
                  error
                ),
            }
          );

          return {
            userId,

            available:
              false,
          };
        }
      }
    );

  /*
   * ==========================================
   * Summary
   * ==========================================
   */

  const available =
    items.filter(
      (
        item
      ) =>
        item.available
    ).length;

  const unavailable =
    items.length -
    available;

  /*
   * ==========================================
   * Response
   * ==========================================
   */

  return respond(
    apiResponse(
      {
        /*
         * Batch Request خودش موفق اجرا شده است.
         * Failure یک User در items.available
         * مشخص می‌شود.
         */
        success:
          true,

        items,

        summary: {
          requested:
            userIds.length,

          available,

          unavailable,

          concurrency:
            BUDGET_CHECK_CONCURRENCY,
        },
      },
      200,
      requestId
    )
  );
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
    apiResponse(
      {
        success:
          false,

        code:
          "ADMIN_RATE_LIMITED",

        message:
          "تعداد درخواست‌های دریافت وضعیت سهمیه کاربران بیش از حد مجاز است.",

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
 * Parse User IDs
 * ============================================
 */

function parseUserIds(
  body:
    unknown
):
  | {
      success:
        true;

      userIds:
        string[];
    }
  | {
      success:
        false;

      code:
        string;

      message:
        string;
    } {
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
        "INVALID_USER_IDS",

      message:
        "ساختار فهرست کاربران معتبر نیست.",
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
   *
   * فقط:
   *
   * {
   *   userIds: [...]
   * }
   *
   * مجاز است.
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
        "userIds"
    )
  ) {
    return {
      success:
        false,

      code:
        "UNEXPECTED_FIELDS",

      message:
        "فیلدهای ارسالی برای دریافت وضعیت سهمیه معتبر نیستند.",
    };
  }

  /*
   * ==========================================
   * Array
   * ==========================================
   */

  if (
    !Array.isArray(
      value.userIds
    )
  ) {
    return {
      success:
        false,

      code:
        "INVALID_USER_IDS",

      message:
        "فهرست کاربران معتبر نیست.",
    };
  }

  /*
   * ==========================================
   * Max Users
   * ==========================================
   */

  if (
    value.userIds.length >
    MAX_USERS
  ) {
    return {
      success:
        false,

      code:
        "TOO_MANY_USERS",

      message:
        `حداکثر وضعیت ${MAX_USERS.toLocaleString(
          "fa-IR"
        )} کاربر را می‌توان در یک درخواست دریافت کرد.`,
    };
  }

  /*
   * ==========================================
   * Validate / Deduplicate
   * ==========================================
   */

  const unique =
    new Set<
      string
    >();

  for (
    const rawId of
    value.userIds
  ) {
    if (
      typeof rawId !==
      "string"
    ) {
      return {
        success:
          false,

        code:
          "INVALID_USER_IDS",

        message:
          "شناسه کاربران معتبر نیست.",
      };
    }

    const id =
      rawId.trim();

    /*
     * Empty String نیز رد می‌شود.
     */

    if (
      !isSafeRecordId(
        id
      )
    ) {
      return {
        success:
          false,

        code:
          "INVALID_USER_IDS",

        message:
          "یکی از شناسه‌های کاربران معتبر نیست.",
      };
    }

    unique.add(
      id
    );
  }

  return {
    success:
      true,

    userIds: [
      ...unique,
    ],
  };
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
 * Limited Concurrency
 * ============================================
 */

async function mapWithConcurrency<
  TItem,
  TResult
>(
  items:
    TItem[],

  concurrency:
    number,

  worker: (
    item:
      TItem
  ) => Promise<TResult>
) {
  const results =
    new Array<TResult>(
      items.length
    );

  if (
    items.length ===
    0
  ) {
    return results;
  }

  const workerCount =
    Math.min(
      Math.max(
        1,
        Math.floor(
          concurrency
        )
      ),
      items.length
    );

  let nextIndex =
    0;

  async function runWorker() {
    while (
      true
    ) {
      const currentIndex =
        nextIndex;

      if (
        currentIndex >=
        items.length
      ) {
        return;
      }

      /*
       * Index قبل از اولین await رزرو می‌شود.
       */
      nextIndex +=
        1;

      results[
        currentIndex
      ] =
        await worker(
          items[
            currentIndex
          ]
        );
    }
  }

  await Promise.all(
    Array.from(
      {
        length:
          workerCount,
      },
      () =>
        runWorker()
    )
  );

  return results;
}

/*
 * ============================================
 * Percentage
 * ============================================
 */

function calculatePercent(
  used:
    number,

  limit:
    number
) {
  if (
    !Number.isFinite(
      limit
    ) ||
    limit <=
      0
  ) {
    return null;
  }

  return roundPercent(
    (
      Math.max(
        0,
        Number.isFinite(
          used
        )
          ? used
          : 0
      ) /
      limit
    ) *
      100
  );
}

/*
 * ============================================
 * Round Percent
 * ============================================
 */

function roundPercent(
  value:
    number
) {
  if (
    !Number.isFinite(
      value
    )
  ) {
    return 0;
  }

  return (
    Math.round(
      value *
        10
    ) /
    10
  );
}

/*
 * ============================================
 * Safe Non-negative Number
 * ============================================
 */

function safeNonNegativeNumber(
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
    number
  );
}

/*
 * ============================================
 * Response
 * ============================================
 */

function apiResponse(
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
      status,

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