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

import type {
  ChatFeedback,
  FeedbackRating,
} from "@/types/chat";

/*
 * ============================================
 * Limits
 * ============================================
 */

const MAX_COMMENT_LENGTH =
  1000;

const MAX_FEEDBACK_REASONS =
  3;

const MAX_REQUEST_BODY_BYTES =
  8 * 1024;

const RECORD_ID_PATTERN =
  /^[a-zA-Z0-9_-]{1,64}$/;

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

type FeedbackPayload =
  ChatFeedback & {
    reasons?:
      FeedbackReason[];
  };

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

/*
 * ============================================
 * GET
 *
 * دریافت Feedback فعلی کاربر
 * برای یک Assistant Message
 * ============================================
 */

export async function GET(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{
      messageId: string;
    }>;
  }
) {
  const requestId =
    crypto.randomUUID();

  /*
   * ==========================================
   * Message ID
   * ==========================================
   */

  const {
    messageId,
  } = await params;

  if (
    !isSafeRecordId(
      messageId
    )
  ) {
    return apiError(
      requestId,
      400,
      "INVALID_MESSAGE_ID",
      "شناسه پیام معتبر نیست."
    );
  }

  /*
   * ==========================================
   * Authentication
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
      "Feedback service unavailable",
      {
        requestId,

        userId:
          account.id,

        messageId,

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
   * Assistant Message Ownership
   * ==========================================
   */

  let message:
    RecordModel |
    null;

  try {
    message =
      await getOwnedAssistantMessage({
        pb,

        messageId,

        userId:
          account.id,
      });
  } catch (error) {
    console.error(
      "Feedback message ownership check failed",
      {
        requestId,

        userId:
          account.id,

        messageId,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return apiError(
      requestId,
      503,
      "FEEDBACK_MESSAGE_CHECK_FAILED",
      "بررسی پیام موقتاً امکان‌پذیر نیست."
    );
  }

  if (!message) {
    return apiError(
      requestId,
      404,
      "MESSAGE_NOT_FOUND",
      "پیام موردنظر پیدا نشد."
    );
  }

  /*
   * ==========================================
   * Feedback
   * ==========================================
   */

  let feedback:
    RecordModel |
    null;

  try {
    feedback =
      await findFeedback({
        pb,

        messageId:
          message.id,

        userId:
          account.id,
      });
  } catch (error) {
    console.error(
      "Load message feedback failed",
      {
        requestId,

        userId:
          account.id,

        messageId:
          message.id,

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
      "دریافت بازخورد انجام نشد."
    );
  }

  return apiSuccess(
    requestId,
    {
      feedback:
        feedback
          ? toFeedback(
              feedback
            )
          : null,
    }
  );
}

/*
 * ============================================
 * PUT
 *
 * Create / Update Feedback
 * ============================================
 */

export async function PUT(
  request: Request,
  {
    params,
  }: {
    params: Promise<{
      messageId: string;
    }>;
  }
) {
  const requestId =
    crypto.randomUUID();

  /*
   * ==========================================
   * Message ID
   * ==========================================
   */

  const {
    messageId,
  } = await params;

  if (
    !isSafeRecordId(
      messageId
    )
  ) {
    return apiError(
      requestId,
      400,
      "INVALID_MESSAGE_ID",
      "شناسه پیام معتبر نیست."
    );
  }

  /*
   * ==========================================
   * Authentication
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
    return apiError(
      requestId,
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "نوع محتوای درخواست معتبر نیست."
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
      return apiError(
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

  const parsedBody =
    await readJsonBodyWithLimit(
      request,
      MAX_REQUEST_BODY_BYTES
    );

  if (
    !parsedBody.ok
  ) {
    return apiError(
      requestId,
      parsedBody.status,
      parsedBody.code,
      parsedBody.message
    );
  }

  const body =
    parsedBody.body;

  /*
   * ==========================================
   * Rating
   * ==========================================
   */

  const rating =
    getRating(
      body
    );

  if (!rating) {
    return apiError(
      requestId,
      400,
      "INVALID_FEEDBACK_RATING",
      "امتیاز انتخاب‌شده معتبر نیست."
    );
  }

  /*
   * ==========================================
   * Comment
   * ==========================================
   */

  const commentResult =
    getComment(
      body
    );

  if (
    !commentResult.ok
  ) {
    return apiError(
      requestId,
      400,
      commentResult.code,
      commentResult.message
    );
  }

  /*
   * ==========================================
   * Structured Reasons
   *
   * reasons اختیاری است تا Clientهای قدیمی
   * همچنان سازگار بمانند.
   *
   * اگر در Update ارسال نشود، برای Down Vote
   * مقدار قبلی حفظ می‌شود.
   * ==========================================
   */

  const reasonsResult =
    getReasons(
      body
    );

  if (
    !reasonsResult.ok
  ) {
    return apiError(
      requestId,
      400,
      reasonsResult.code,
      reasonsResult.message
    );
  }

  /*
   * Up Vote هیچ Comment/Reason منفی ندارد.
   */

  const comment =
    rating ===
    "down"
      ? commentResult.comment
      : "";

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
      "Feedback service unavailable",
      {
        requestId,

        userId:
          account.id,

        messageId,

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
   * Ownership
   * ==========================================
   */

  let message:
    RecordModel |
    null;

  try {
    message =
      await getOwnedAssistantMessage({
        pb,

        messageId,

        userId:
          account.id,
      });
  } catch (error) {
    console.error(
      "Feedback message ownership check failed",
      {
        requestId,

        userId:
          account.id,

        messageId,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return apiError(
      requestId,
      503,
      "FEEDBACK_MESSAGE_CHECK_FAILED",
      "بررسی پیام موقتاً امکان‌پذیر نیست."
    );
  }

  if (!message) {
    return apiError(
      requestId,
      404,
      "MESSAGE_NOT_FOUND",
      "پیام موردنظر پیدا نشد."
    );
  }

  /*
   * ==========================================
   * Existing Feedback
   * ==========================================
   */

  let feedback:
    RecordModel |
    null;

  try {
    feedback =
      await findFeedback({
        pb,

        messageId:
          message.id,

        userId:
          account.id,
      });
  } catch (error) {
    console.error(
      "Feedback lookup failed",
      {
        requestId,

        userId:
          account.id,

        messageId:
          message.id,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return apiError(
      requestId,
      503,
      "FEEDBACK_LOOKUP_FAILED",
      "بررسی بازخورد فعلی انجام نشد."
    );
  }

  /*
   * ==========================================
   * Resolve Reasons
   *
   * - Up: همیشه پاک شود.
   * - Down + reasons provided: مقدار جدید.
   * - Down + reasons omitted: مقدار قبلی حفظ شود.
   * ==========================================
   */

  const reasons =
    rating ===
    "up"
      ? []
      : reasonsResult.provided
        ? reasonsResult.reasons
        : feedback
          ? normalizeFeedbackReasons(
              feedback.reasons
            )
          : [];

  /*
   * ==========================================
   * Update
   * ==========================================
   */

  if (
    feedback
  ) {
    const feedbackId =
      feedback.id;

    try {
      feedback =
        await pb
          .collection(
            "message_feedback"
          )
          .update(
            feedbackId,
            {
              rating,

              reasons,

              comment,
            }
          );
    } catch (error) {
      console.error(
        "Update feedback failed",
        {
          requestId,

          feedbackId,

          userId:
            account.id,

          messageId:
            message.id,

          error:
            safeErrorMetadata(
              error
            ),
        }
      );

      return apiError(
        requestId,
        503,
        "FEEDBACK_UPDATE_FAILED",
        "ثبت بازخورد انجام نشد."
      );
    }
  } else {
    /*
     * ========================================
     * Create
     *
     * user و message از Body گرفته نمی‌شوند.
     * ========================================
     */

    try {
      feedback =
        await pb
          .collection(
            "message_feedback"
          )
          .create({
            message:
              message.id,

            user:
              account.id,

            rating,

            reasons,

            comment,
          });
    } catch (error) {
      /*
       * ======================================
       * Race Recovery
       *
       * برای Unique(message,user)
       * ======================================
       */

      let existing:
        RecordModel |
        null;

      try {
        existing =
          await findFeedback({
            pb,

            messageId:
              message.id,

            userId:
              account.id,
          });
      } catch (
        lookupError
      ) {
        console.error(
          "Feedback race lookup failed",
          {
            requestId,

            userId:
              account.id,

            messageId:
              message.id,

            error:
              safeErrorMetadata(
                lookupError
              ),
          }
        );

        return apiError(
          requestId,
          503,
          "FEEDBACK_CREATE_FAILED",
          "ثبت بازخورد انجام نشد."
        );
      }

      if (
        !existing
      ) {
        console.error(
          "Create feedback failed",
          {
            requestId,

            userId:
              account.id,

            messageId:
              message.id,

            error:
              safeErrorMetadata(
                error
              ),
          }
        );

        return apiError(
          requestId,
          503,
          "FEEDBACK_CREATE_FAILED",
          "ثبت بازخورد انجام نشد."
        );
      }

      const recoveryReasons =
        rating ===
        "up"
          ? []
          : reasonsResult.provided
            ? reasonsResult.reasons
            : normalizeFeedbackReasons(
                existing.reasons
              );

      try {
        feedback =
          await pb
            .collection(
              "message_feedback"
            )
            .update(
              existing.id,
              {
                rating,

                reasons:
                  recoveryReasons,

                comment,
              }
            );
      } catch (
        updateError
      ) {
        console.error(
          "Feedback race recovery failed",
          {
            requestId,

            feedbackId:
              existing.id,

            userId:
              account.id,

            messageId:
              message.id,

            error:
              safeErrorMetadata(
                updateError
              ),
          }
        );

        return apiError(
          requestId,
          503,
          "FEEDBACK_RACE_RECOVERY_FAILED",
          "ثبت بازخورد انجام نشد."
        );
      }
    }
  }

  /*
   * ==========================================
   * Success
   * ==========================================
   */

  if (
    !feedback
  ) {
    return apiError(
      requestId,
      500,
      "FEEDBACK_MISSING_AFTER_SAVE",
      "بازخورد ذخیره شد اما نتیجه قابل بازیابی نیست."
    );
  }

  return apiSuccess(
    requestId,
    {
      feedback:
        toFeedback(
          feedback
        ),
    }
  );
}

/*
 * ============================================
 * DELETE
 *
 * حذف رأی
 * ============================================
 */

export async function DELETE(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{
      messageId: string;
    }>;
  }
) {
  const requestId =
    crypto.randomUUID();

  /*
   * ==========================================
   * Message ID
   * ==========================================
   */

  const {
    messageId,
  } = await params;

  if (
    !isSafeRecordId(
      messageId
    )
  ) {
    return apiError(
      requestId,
      400,
      "INVALID_MESSAGE_ID",
      "شناسه پیام معتبر نیست."
    );
  }

  /*
   * ==========================================
   * Authentication
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
      "Feedback service unavailable",
      {
        requestId,

        userId:
          account.id,

        messageId,

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
   * Ownership
   * ==========================================
   */

  let message:
    RecordModel |
    null;

  try {
    message =
      await getOwnedAssistantMessage({
        pb,

        messageId,

        userId:
          account.id,
      });
  } catch (error) {
    console.error(
      "Feedback message ownership check failed",
      {
        requestId,

        userId:
          account.id,

        messageId,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return apiError(
      requestId,
      503,
      "FEEDBACK_MESSAGE_CHECK_FAILED",
      "بررسی پیام موقتاً امکان‌پذیر نیست."
    );
  }

  if (
    !message
  ) {
    return apiError(
      requestId,
      404,
      "MESSAGE_NOT_FOUND",
      "پیام موردنظر پیدا نشد."
    );
  }

  /*
   * ==========================================
   * Find Feedback
   * ==========================================
   */

  let feedback:
    RecordModel |
    null;

  try {
    feedback =
      await findFeedback({
        pb,

        messageId:
          message.id,

        userId:
          account.id,
      });
  } catch (error) {
    console.error(
      "Feedback lookup failed",
      {
        requestId,

        userId:
          account.id,

        messageId:
          message.id,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return apiError(
      requestId,
      503,
      "FEEDBACK_LOOKUP_FAILED",
      "بررسی بازخورد فعلی انجام نشد."
    );
  }

  /*
   * ==========================================
   * Idempotent Delete
   * ==========================================
   */

  if (
    !feedback
  ) {
    return apiSuccess(
      requestId,
      {
        feedback:
          null,

        alreadyDeleted:
          true,
      }
    );
  }

  /*
   * ==========================================
   * Delete
   * ==========================================
   */

  const feedbackId =
    feedback.id;

  try {
    await pb
      .collection(
        "message_feedback"
      )
      .delete(
        feedbackId
      );
  } catch (error) {
    console.error(
      "Delete feedback failed",
      {
        requestId,

        feedbackId,

        userId:
          account.id,

        messageId:
          message.id,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return apiError(
      requestId,
      503,
      "FEEDBACK_DELETE_FAILED",
      "حذف بازخورد انجام نشد."
    );
  }

  return apiSuccess(
    requestId,
    {
      feedback:
        null,
    }
  );
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
 * Owned Assistant Message
 * ============================================
 */

async function getOwnedAssistantMessage({
  pb,
  messageId,
  userId,
}: {
  pb:
    PocketBase;

  messageId:
    string;

  userId:
    string;
}): Promise<RecordModel | null> {
  try {
    return await pb
      .collection(
        "messages"
      )
      .getFirstListItem(
        pb.filter(
          "id = {:messageId} && role = {:role} && user = {:userId} && conversation.user = {:userId}",
          {
            messageId,

            role:
              "assistant",

            userId,
          }
        ),
        {
          fields:
            "id,user,conversation,role",
        }
      );
  } catch (error) {
    if (
      getErrorStatus(
        error
      ) ===
      404
    ) {
      return null;
    }

    throw error;
  }
}

/*
 * ============================================
 * Find Feedback
 * ============================================
 */

async function findFeedback({
  pb,
  messageId,
  userId,
}: {
  pb:
    PocketBase;

  messageId:
    string;

  userId:
    string;
}): Promise<RecordModel | null> {
  try {
    return await pb
      .collection(
        "message_feedback"
      )
      .getFirstListItem(
        pb.filter(
          "message = {:messageId} && user = {:userId}",
          {
            messageId,

            userId,
          }
        )
      );
  } catch (error) {
    if (
      getErrorStatus(
        error
      ) ===
      404
    ) {
      return null;
    }

    throw error;
  }
}

/*
 * ============================================
 * Mapping
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
 * Rating Validation
 * ============================================
 */

function getRating(
  body:
    unknown
): FeedbackRating | null {
  if (
    typeof body !==
      "object" ||
    body ===
      null ||
    !(
      "rating" in
      body
    )
  ) {
    return null;
  }

  const value =
    (
      body as {
        rating?:
          unknown;
      }
    ).rating;

  if (
    typeof value !==
    "string"
  ) {
    return null;
  }

  if (
    value ===
      "up" ||
    value ===
      "down"
  ) {
    return value;
  }

  return null;
}

/*
 * ============================================
 * Reasons Validation
 * ============================================
 */

function getReasons(
  body:
    unknown
):
  | {
      ok:
        true;

      provided:
        boolean;

      reasons:
        FeedbackReason[];
    }
  | {
      ok:
        false;

      code:
        string;

      message:
        string;
    } {
  if (
    typeof body !==
      "object" ||
    body ===
      null
  ) {
    return {
      ok:
        false,

      code:
        "INVALID_FEEDBACK_REASONS",

      message:
        "دلایل بازخورد معتبر نیست.",
    };
  }

  if (
    !(
      "reasons" in
      body
    )
  ) {
    return {
      ok:
        true,

      provided:
        false,

      reasons:
        [],
    };
  }

  const value =
    (
      body as {
        reasons?:
          unknown;
      }
    ).reasons;

  if (
    !Array.isArray(
      value
    )
  ) {
    return {
      ok:
        false,

      code:
        "INVALID_FEEDBACK_REASONS",

      message:
        "دلایل بازخورد باید به‌صورت فهرست ارسال شوند.",
    };
  }

  if (
    value.length >
    MAX_FEEDBACK_REASONS
  ) {
    return {
      ok:
        false,

      code:
        "TOO_MANY_FEEDBACK_REASONS",

      message:
        `حداکثر ${MAX_FEEDBACK_REASONS} دلیل برای بازخورد قابل انتخاب است.`,
    };
  }

  const reasons:
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
      return {
        ok:
          false,

        code:
          "INVALID_FEEDBACK_REASONS",

        message:
          "یکی از دلایل بازخورد معتبر نیست.",
      };
    }

    const reason =
      item.trim();

    if (
      !isFeedbackReason(
        reason
      )
    ) {
      return {
        ok:
          false,

        code:
          "INVALID_FEEDBACK_REASONS",

        message:
          "یکی از دلایل بازخورد معتبر نیست.",
      };
    }

    if (
      !reasons.includes(
        reason
      )
    ) {
      reasons.push(
        reason
      );
    }
  }

  return {
    ok:
      true,

    provided:
      true,

    reasons,
  };
}

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
 * Comment Validation
 * ============================================
 */

function getComment(
  body:
    unknown
):
  | {
      ok:
        true;

      comment:
        string;
    }
  | {
      ok:
        false;

      code:
        string;

      message:
        string;
    } {
  if (
    typeof body !==
      "object" ||
    body ===
      null
  ) {
    return {
      ok:
        false,

      code:
        "INVALID_FEEDBACK_COMMENT",

      message:
        "متن توضیح بازخورد معتبر نیست.",
    };
  }

  if (
    !(
      "comment" in
      body
    )
  ) {
    return {
      ok:
        true,

      comment:
        "",
    };
  }

  const value =
    (
      body as {
        comment?:
          unknown;
      }
    ).comment;

  if (
    typeof value !==
    "string"
  ) {
    return {
      ok:
        false,

      code:
        "INVALID_FEEDBACK_COMMENT",

      message:
        "متن توضیح بازخورد معتبر نیست.",
    };
  }

  const comment =
    value
      .replace(
        /[\u0000-\u001f\u007f]/g,
        " "
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim();

  if (
    comment.length >
    MAX_COMMENT_LENGTH
  ) {
    return {
      ok:
        false,

      code:
        "FEEDBACK_COMMENT_TOO_LONG",

      message:
        `حداکثر طول توضیح بازخورد ${MAX_COMMENT_LENGTH} کاراکتر است.`,
    };
  }

  return {
    ok:
      true,

    comment,
  };
}

/*
 * ============================================
 * Record ID
 * ============================================
 */

function isSafeRecordId(
  value:
    string
) {
  return RECORD_ID_PATTERN.test(
    String(
      value ||
        ""
    ).trim()
  );
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
