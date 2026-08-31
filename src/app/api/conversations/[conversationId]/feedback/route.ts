import {
  NextResponse,
} from "next/server";

import type PocketBase from "pocketbase";

import type {
  RecordModel,
} from "pocketbase";

import {
  getAuthenticatedPocketBase,
} from "@/lib/pocketbase/auth";

import {
  getPocketBaseServiceClient,
} from "@/lib/pocketbase/service";

/*
 * ============================================
 * Constants
 * ============================================
 */

const RECORD_ID_PATTERN =
  /^[a-zA-Z0-9_-]{1,64}$/;

const MAX_FEEDBACK_REASONS =
  3;

/*
 * ============================================
 * Feedback Reasons
 * ============================================
 */

type FeedbackReason =
  | "incorrect"
  | "incomplete"
  | "outdated"
  | "irrelevant"
  | "unclear"
  | "source_issue"
  | "other";

const FEEDBACK_REASONS =
  new Set<FeedbackReason>([
    "incorrect",
    "incomplete",
    "outdated",
    "irrelevant",
    "unclear",
    "source_issue",
    "other",
  ]);

type FeedbackPayload = {
  id:
    string;

  rating:
    | "up"
    | "down";

  reasons?:
    FeedbackReason[];

  comment?:
    string;

  created:
    string;

  updated:
    string;
};

/*
 * ============================================
 * GET
 *
 * دریافت تمام Feedbackهای کاربر
 * برای Assistant Messageهای یک Conversation
 * ============================================
 */

export async function GET(
  _request:
    Request,

  {
    params,
  }: {
    params:
      Promise<{
        conversationId:
          string;
      }>;
  }
) {
  const requestId =
    crypto.randomUUID();

  /*
   * ==========================================
   * Conversation ID
   * ==========================================
   */

  const {
    conversationId:
      rawConversationId,
  } = await params;

  const conversationId =
    cleanRecordId(
      rawConversationId
    );

  if (
    !conversationId
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
   * Service Client
   * ==========================================
   */

  let pb:
    PocketBase;

  try {
    pb =
      await getPocketBaseServiceClient();
  } catch (error) {
    console.error(
      "Conversation feedback service unavailable",
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
   * Service Client Ruleها را bypass می‌کند،
   * بنابراین Ownership صریحاً بررسی می‌شود.
   * ==========================================
   */

  try {
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
      "Conversation feedback ownership check failed",
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
      "CONVERSATION_CHECK_FAILED",
      "بررسی گفتگو موقتاً امکان‌پذیر نیست."
    );
  }

  /*
   * ==========================================
   * Feedback List
   *
   * علاوه بر feedback.user،
   * Ownership خود Message و Conversation نیز
   * داخل Filter بررسی می‌شود.
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
              [
                "user = {:userId}",
                "message.user = {:userId}",
                "message.role = {:role}",
                "message.conversation = {:conversationId}",
                "message.conversation.user = {:userId}",
              ].join(
                " && "
              ),
              {
                userId:
                  account.id,

                role:
                  "assistant",

                conversationId,
              }
            ),

          sort:
            "created",

          fields:
            [
              "id",
              "message",
              "rating",
              "reasons",
              "comment",
              "created",
              "updated",
            ].join(
              ","
            ),
        });
  } catch (error) {
    console.error(
      "Conversation feedback load failed",
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
      "دریافت بازخوردهای گفتگو انجام نشد."
    );
  }

  /*
   * ==========================================
   * Response
   * ==========================================
   */

  return apiSuccess(
    requestId,
    {
      items:
        records
          .map(
            (
              record
            ) => {
              const messageId =
                cleanRecordId(
                  record.message
                );

              if (
                !messageId
              ) {
                return null;
              }

              return {
                messageId,

                feedback:
                  toFeedback(
                    record
                  ),
              };
            }
          )
          .filter(
            (
              item
            ): item is {
              messageId:
                string;

              feedback:
                FeedbackPayload;
            } =>
              item !==
              null
          ),
    }
  );
}

/*
 * ============================================
 * Feedback Mapping
 * ============================================
 */

function toFeedback(
  record:
    RecordModel
): FeedbackPayload {
  const reasons =
    normalizeFeedbackReasons(
      record.reasons
    );

  return {
    id:
      record.id,

    rating:
      record.rating ===
      "down"
        ? "down"
        : "up",

    ...(reasons.length >
    0
      ? {
          reasons,
        }
      : {}),

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
 * Feedback Reasons
 * ============================================
 */

function normalizeFeedbackReasons(
  value:
    unknown
): FeedbackReason[] {
  if (
    !Array.isArray(
      value
    )
  ) {
    return [];
  }

  const result:
    FeedbackReason[] =
    [];

  for (
    const item of
    value
  ) {
    if (
      typeof item !==
      "string"
    ) {
      continue;
    }

    const reason =
      item.trim();

    if (
      !isFeedbackReason(
        reason
      ) ||
      result.includes(
        reason
      )
    ) {
      continue;
    }

    result.push(
      reason
    );

    if (
      result.length >=
      MAX_FEEDBACK_REASONS
    ) {
      break;
    }
  }

  return result;
}

function isFeedbackReason(
  value:
    string
): value is FeedbackReason {
  return FEEDBACK_REASONS.has(
    value as FeedbackReason
  );
}

/*
 * ============================================
 * Record ID
 * ============================================
 */

function cleanRecordId(
  value:
    unknown
) {
  if (
    typeof value !==
      "string"
  ) {
    return "";
  }

  const id =
    value.trim();

  return RECORD_ID_PATTERN.test(
    id
  )
    ? id
    : "";
}

/*
 * ============================================
 * Success Response
 * ============================================
 */

function apiSuccess(
  requestId:
    string,

  data:
    Record<
      string,
      unknown
    >
) {
  return NextResponse.json(
    {
      success:
        true,

      ...data,

      requestId,
    },
    {
      status:
        200,

      headers: {
        "X-Request-Id":
          requestId,

        "Cache-Control":
          "no-store",

        "Pragma":
          "no-cache",
      },
    }
  );
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
        "X-Request-Id":
          requestId,

        "Cache-Control":
          "no-store",

        "Pragma":
          "no-cache",
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
      status?:
        unknown;
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
