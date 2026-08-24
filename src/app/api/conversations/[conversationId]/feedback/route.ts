import {
  NextResponse,
} from "next/server";

import type {
  RecordModel,
} from "pocketbase";

import {
  getAuthenticatedPocketBase,
} from "@/lib/pocketbase/auth";

import {
  getPocketBaseServiceClient,
} from "@/lib/pocketbase/service";

import type {
  ChatFeedback,
} from "@/types/chat";

const RECORD_ID_PATTERN =
  /^[a-zA-Z0-9_-]{1,64}$/;

/*
 * ============================================
 * GET
 *
 * Get feedbacks for assistant messages
 * in one conversation.
 * ============================================
 */

export async function GET(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{
      conversationId: string;
    }>;
  }
) {
  const requestId =
    crypto.randomUUID();

  /*
   * ==========================================
   * Authentication
   *
   * فقط برای تشخیص هویت کاربر.
   * ==========================================
   */

  const session =
    await getAuthenticatedPocketBase();

  if (!session) {
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

  const {
    conversationId,
  } = await params;

  if (
  !RECORD_ID_PATTERN.test(
    conversationId
  )
) {
  return apiError(
    requestId,
    400,
    "INVALID_CONVERSATION_ID",
    "شناسه گفتگو معتبر نیست."
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
      "Feedback service unavailable",
      {
        requestId,

        userId:
          account.id,

        conversationId,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return apiError(
      requestId,
      503,
      "FEEDBACK_SERVICE_UNAVAILABLE",
      "سرویس بازخورد موقتاً در دسترس نیست."
    );
  }

  /*
   * ==========================================
   * Conversation Ownership
   *
   * چون Service Client Ruleها را bypass
   * می‌کند، مالکیت را صریح بررسی می‌کنیم.
   * ==========================================
   */

  try {
    const conversation =
      await pb
        .collection(
          "conversations"
        )
        .getFirstListItem(
          pb.filter(
            "id = {:conversationId} && user = {:userId}",
            {
              conversationId,

              userId:
                account.id,
            }
          ),
          {
            fields:
              "id,user",
          }
        );

    /*
     * Defense in depth
     */
    if (
      String(
        conversation.user ||
          ""
      ) !==
      account.id
    ) {
      return apiError(
        requestId,
        404,
        "CONVERSATION_NOT_FOUND",
        "گفتگو پیدا نشد."
      );
    }
  } catch (error) {
    const status =
      getErrorStatus(
        error
      );

    if (
      status ===
      404
    ) {
      return apiError(
        requestId,
        404,
        "CONVERSATION_NOT_FOUND",
        "گفتگو پیدا نشد."
      );
    }

    console.error(
      "Feedback conversation ownership failed",
      {
        requestId,

        userId:
          account.id,

        conversationId,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return apiError(
      requestId,
      503,
      "FEEDBACK_CONVERSATION_CHECK_FAILED",
      "در بررسی گفتگو خطایی رخ داد."
    );
  }

  /*
   * ==========================================
   * Feedbacks
   *
   * سه شرط مالکیت:
   *
   * feedback.user = current account
   * message.user = current account
   * message.conversation = current conversation
   *
   * و فقط Messageهای Assistant.
   * ==========================================
   */

  let records:
    RecordModel[];

  try {
    records =
      await pb
        .collection(
          "message_feedback"
        )
        .getFullList({
          filter:
            pb.filter(
              "user = {:userId} && message.user = {:userId} && message.conversation = {:conversationId} && message.role = {:assistantRole}",
              {
                userId:
                  account.id,

                conversationId,

                assistantRole:
                  "assistant",
              }
            ),

          sort:
            "created",

          fields:
            "id,message,rating,comment,created,updated",
        });
  } catch (error) {
    console.error(
      "Load conversation feedback failed",
      {
        requestId,

        userId:
          account.id,

        conversationId,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return apiError(
      requestId,
      503,
      "FEEDBACK_LOAD_FAILED",
      "دریافت بازخوردها انجام نشد."
    );
  }

  /*
   * ==========================================
   * Response
   * ==========================================
   */

  return NextResponse.json(
    {
      success:
        true,

      items:
        records.map(
          (
            record
          ) => ({
            messageId:
              String(
                record.message ||
                  ""
              ),

            feedback:
              toFeedback(
                record
              ),
          })
        ),

      requestId,
    },
    {
      status:
        200,

      headers: {
        "Cache-Control":
          "no-store",

        "X-Request-Id":
          requestId,
      },
    }
  );
}

/*
 * ============================================
 * Serialize Feedback
 * ============================================
 */

function toFeedback(
  record: RecordModel
): ChatFeedback {
  return {
    id:
      record.id,

    rating:
      record.rating ===
      "down"
        ? "down"
        : "up",

    ...(record.comment
      ? {
          comment:
            String(
              record.comment
            ),
        }
      : {}),

    created:
      String(
        record.created ||
          ""
      ),

    updated:
      String(
        record.updated ||
          ""
      ),
  };
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
    string
) {
  return NextResponse.json(
    {
      success:
        false,

      code,

      message,

      requestId,
    },
    {
      status,

      headers: {
        "Cache-Control":
          "no-store",

        "X-Request-Id":
          requestId,
      },
    }
  );
}

/*
 * ============================================
 * Error Status
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