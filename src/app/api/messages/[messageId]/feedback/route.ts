import {
  NextResponse,
} from "next/server";

import type PocketBase from "pocketbase";

import type {
  RecordModel,
} from "pocketbase";

import {
  consumeFeedbackRateLimit,
} from "@/lib/feedback/rate-limit";

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

const MAX_REQUEST_BODY_BYTES =
  8 * 1024;

const RECORD_ID_PATTERN =
  /^[a-zA-Z0-9_-]{1,64}$/;

/*
 * ============================================
 * GET
 *
 * دریافت Feedback فعلی کاربر
 *
 * Read-only:
 * Mutation Rate Limit روی GET اعمال نمی‌شود.
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
 *
 * Rate Limit:
 *
 * message.feedback
 * 30 operations / 10 minutes / user
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
   * Shared PUT + DELETE Rate Limit
   * ==========================================
   */

  const rateLimitResult =
    await consumeMessageFeedbackRateLimit({
      requestId,

      userId:
        account.id,

      messageId,
    });

  if (
    !rateLimitResult.ok
  ) {
    return rateLimitResult.response;
  }

  const rateLimit =
    rateLimitResult.rateLimit;

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
      apiError(
        requestId,
        415,
        "UNSUPPORTED_MEDIA_TYPE",
        "نوع محتوای درخواست معتبر نیست."
      )
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
      !Number.isSafeInteger(
        declaredLength
      ) ||
      declaredLength <
        0
    ) {
      return respond(
        apiError(
          requestId,
          400,
          "INVALID_CONTENT_LENGTH",
          "حجم درخواست معتبر نیست."
        )
      );
    }

    if (
      declaredLength >
      MAX_REQUEST_BODY_BYTES
    ) {
      return respond(
        apiError(
          requestId,
          413,
          "REQUEST_BODY_TOO_LARGE",
          "حجم درخواست بیش از حد مجاز است."
        )
      );
    }
  }

  const parsedBody =
    await readJsonBodyWithLimit(
      request,
      MAX_REQUEST_BODY_BYTES
    );

  if (
    !parsedBody.ok
  ) {
    return respond(
      apiError(
        requestId,
        parsedBody.status,
        parsedBody.code,
        parsedBody.message
      )
    );
  }

  const body =
    parsedBody.body;

  const rating =
    getRating(
      body
    );

  if (
    !rating
  ) {
    return respond(
      apiError(
        requestId,
        400,
        "INVALID_FEEDBACK_RATING",
        "امتیاز انتخاب‌شده معتبر نیست."
      )
    );
  }

  const commentResult =
    getComment(
      body
    );

  if (
    !commentResult.ok
  ) {
    return respond(
      apiError(
        requestId,
        400,
        commentResult.code,
        commentResult.message
      )
    );
  }

  const comment =
    rating ===
    "down"
      ? commentResult.comment
      : "";

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

    return respond(
      apiError(
        requestId,
        503,
        "FEEDBACK_SERVICE_UNAVAILABLE",
        "سرویس بازخورد موقتاً در دسترس نیست."
      )
    );
  }

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

    return respond(
      apiError(
        requestId,
        503,
        "FEEDBACK_MESSAGE_CHECK_FAILED",
        "بررسی پیام موقتاً امکان‌پذیر نیست."
      )
    );
  }

  if (
    !message
  ) {
    return respond(
      apiError(
        requestId,
        404,
        "MESSAGE_NOT_FOUND",
        "پیام موردنظر پیدا نشد."
      )
    );
  }

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

    return respond(
      apiError(
        requestId,
        503,
        "FEEDBACK_LOOKUP_FAILED",
        "بررسی بازخورد فعلی انجام نشد."
      )
    );
  }

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

      return respond(
        apiError(
          requestId,
          503,
          "FEEDBACK_UPDATE_FAILED",
          "ثبت بازخورد انجام نشد."
        )
      );
    }
  } else {
    /*
     * ========================================
     * Create + Race Recovery
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

            comment,
          });
    } catch (error) {
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

        return respond(
          apiError(
            requestId,
            503,
            "FEEDBACK_CREATE_FAILED",
            "ثبت بازخورد انجام نشد."
          )
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

        return respond(
          apiError(
            requestId,
            503,
            "FEEDBACK_CREATE_FAILED",
            "ثبت بازخورد انجام نشد."
          )
        );
      }

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

        return respond(
          apiError(
            requestId,
            503,
            "FEEDBACK_RACE_RECOVERY_FAILED",
            "ثبت بازخورد انجام نشد."
          )
        );
      }
    }
  }

  if (
    !feedback
  ) {
    return respond(
      apiError(
        requestId,
        500,
        "FEEDBACK_MISSING_AFTER_SAVE",
        "بازخورد ذخیره شد اما نتیجه قابل بازیابی نیست."
      )
    );
  }

  return respond(
    apiSuccess(
      requestId,
      {
        feedback:
          toFeedback(
            feedback
          ),
      }
    )
  );
}

/*
 * ============================================
 * DELETE
 *
 * Shared message.feedback Rate Limit
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

  const rateLimitResult =
    await consumeMessageFeedbackRateLimit({
      requestId,

      userId:
        account.id,

      messageId,
    });

  if (
    !rateLimitResult.ok
  ) {
    return rateLimitResult.response;
  }

  const rateLimit =
    rateLimitResult.rateLimit;

  const respond =
    <TResponse extends Response>(
      response:
        TResponse
    ) =>
      withRateLimitHeaders(
        response,
        rateLimit
      );

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

    return respond(
      apiError(
        requestId,
        503,
        "FEEDBACK_SERVICE_UNAVAILABLE",
        "سرویس بازخورد موقتاً در دسترس نیست."
      )
    );
  }

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

    return respond(
      apiError(
        requestId,
        503,
        "FEEDBACK_MESSAGE_CHECK_FAILED",
        "بررسی پیام موقتاً امکان‌پذیر نیست."
      )
    );
  }

  if (
    !message
  ) {
    return respond(
      apiError(
        requestId,
        404,
        "MESSAGE_NOT_FOUND",
        "پیام موردنظر پیدا نشد."
      )
    );
  }

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

    return respond(
      apiError(
        requestId,
        503,
        "FEEDBACK_LOOKUP_FAILED",
        "بررسی بازخورد فعلی انجام نشد."
      )
    );
  }

  /*
   * Idempotent Delete همچنان Rate Limit
   * Consume کرده است.
   */

  if (
    !feedback
  ) {
    return respond(
      apiSuccess(
        requestId,
        {
          feedback:
            null,

          alreadyDeleted:
            true,
        }
      )
    );
  }

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

    return respond(
      apiError(
        requestId,
        503,
        "FEEDBACK_DELETE_FAILED",
        "حذف بازخورد انجام نشد."
      )
    );
  }

  return respond(
    apiSuccess(
      requestId,
      {
        feedback:
          null,
      }
    )
  );
}

/*
 * ============================================
 * Feedback Rate Limit Helper
 * ============================================
 */

async function consumeMessageFeedbackRateLimit({
  requestId,
  userId,
  messageId,
}: {
  requestId:
    string;

  userId:
    string;

  messageId:
    string;
}): Promise<
  | {
      ok:
        true;

      rateLimit: {
        allowed:
          true;

        limit:
          number;

        remaining:
          number;

        resetAt:
          string;
      };
    }
  | {
      ok:
        false;

      response:
        Response;
    }
> {
  let rateLimit:
    Awaited<
      ReturnType<
        typeof consumeFeedbackRateLimit
      >
    >;

  try {
    rateLimit =
      await consumeFeedbackRateLimit({
        userId,

        action:
          "message.feedback",

        requestId,
      });
  } catch (error) {
    console.error(
      "Message feedback rate limit unavailable",
      {
        requestId,

        userId,

        messageId,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return {
      ok:
        false,

      response:
        apiError(
          requestId,
          503,
          "MESSAGE_FEEDBACK_RATE_LIMIT_UNAVAILABLE",
          "امکان بررسی محدودیت بازخورد در حال حاضر وجود ندارد. دوباره تلاش کنید."
        ),
    };
  }

  if (
    !rateLimit.allowed
  ) {
    const response =
      apiError(
        requestId,
        429,
        "MESSAGE_FEEDBACK_RATE_LIMITED",
        "تعداد تغییرات بازخورد بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.",
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

    return {
      ok:
        false,

      response,
    };
  }

  return {
    ok:
      true,

    rateLimit,
  };
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

        "X-Content-Type-Options":
          "nosniff",
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

        "Pragma":
          "no-cache",

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