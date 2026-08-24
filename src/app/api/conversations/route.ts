import {
  NextResponse,
} from "next/server";

import {
  consumeConversationCreateRateLimit,
} from "@/lib/conversations/rate-limit";

import {
  getAuthenticatedPocketBase,
} from "@/lib/pocketbase/auth";

import {
  getPocketBaseServiceClient,
} from "@/lib/pocketbase/service";

/*
 * ============================================
 * POST
 *
 * Create Conversation
 *
 * Rate Limit:
 *
 * 20 requests / 10 minutes / user
 * ============================================
 */

export async function POST() {
  const requestId =
    crypto.randomUUID();

  /*
   * ==========================================
   * Authentication
   * ==========================================
   */

  const session =
    await getAuthenticatedPocketBase();

  if (
    !session
  ) {
    return apiError(
      requestId,
      401,
      "UNAUTHORIZED",
      "ابتدا وارد حساب کاربری شوید."
    );
  }

  const {
    account,
  } = session;

  /*
   * ==========================================
   * Conversation Create Rate Limit
   *
   * مستقل از Chat Message Rate Limit است.
   *
   * Fail-closed:
   * اگر Rate Limiter در دسترس نباشد Conversation
   * ساخته نمی‌شود.
   * ==========================================
   */

  let rateLimit:
    Awaited<
      ReturnType<
        typeof consumeConversationCreateRateLimit
      >
    >;

  try {
    rateLimit =
      await consumeConversationCreateRateLimit({
        userId:
          account.id,

        requestId,
      });
  } catch (error) {
    console.error(
      "Conversation create rate limit unavailable",
      {
        requestId,

        userId:
          account.id,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return apiError(
      requestId,
      503,
      "CONVERSATION_RATE_LIMIT_UNAVAILABLE",
      "امکان بررسی محدودیت ایجاد گفتگو در حال حاضر وجود ندارد. دوباره تلاش کنید."
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
      apiError(
        requestId,
        429,
        "CONVERSATION_CREATE_RATE_LIMITED",
        "تعداد گفتگوهای جدید ایجادشده بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.",
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

  const respond =
    <TResponse extends Response>(
      response:
        TResponse
    ) =>
      withRateLimitHeaders(
        response,
        rateLimit
      );

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
      "Conversation service client unavailable",
      {
        requestId,

        userId:
          account.id,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return respond(
      apiError(
        requestId,
        503,
        "CONVERSATION_SERVICE_UNAVAILABLE",
        "سرویس گفتگو موقتاً در دسترس نیست."
      )
    );
  }

  /*
   * ==========================================
   * Create
   *
   * user از Request گرفته نمی‌شود.
   * همیشه از Session معتبر تعیین می‌شود.
   * ==========================================
   */

  try {
    const conversation =
      await pb
        .collection(
          "conversations"
        )
        .create({
          user:
            account.id,

          title:
            "گفتگوی جدید",

          status:
            "active",
        });

    return respond(
      NextResponse.json(
        {
          success:
            true,

          conversation: {
            id:
              conversation.id,

            title:
              String(
                conversation.title ||
                  "گفتگوی جدید"
              ),

            status:
              String(
                conversation.status ||
                  "active"
              ),

            created:
              String(
                conversation.created ||
                  ""
              ),

            updated:
              String(
                conversation.updated ||
                  ""
              ),

            last_message_at:
              conversation.last_message_at
                ? String(
                    conversation.last_message_at
                  )
                : undefined,
          },

          requestId,
        },
        {
          status:
            201,

          headers: {
            "Cache-Control":
              "no-store",

            "X-Request-Id":
              requestId,
          },
        }
      )
    );
  } catch (error) {
    console.error(
      "Create conversation failed",
      {
        requestId,

        userId:
          account.id,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return respond(
      apiError(
        requestId,
        503,
        "CONVERSATION_CREATE_FAILED",
        "خطا در ایجاد گفتگو."
      )
    );
  }
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
 * Error Response
 * ============================================
 */

function apiError(
  requestId:
    string,

  status:
    number,

  code:
    string,

  message:
    string,

  extra?:
    Record<
      string,
      unknown
    >
) {
  return NextResponse.json(
    {
      success:
        false,

      code,

      message,

      ...(extra ||
        {}),

      requestId,
    },
    {
      status,

      headers: {
        "Cache-Control":
          "no-store",

        "X-Request-Id":
          requestId,

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