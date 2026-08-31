import {
  after,
  NextResponse,
} from "next/server";

import type OpenAI from "openai";

import type PocketBase from "pocketbase";

import type {
  RecordModel,
} from "pocketbase";

import {
  createChatLatencyProfiler,
} from "@/lib/chat/latency-profiler";

import {
  checkAIBudgetGuard,
  type AIBudgetLimitCode,
} from "@/lib/ai/budget-guard";

import {
  cancelAIBudgetReservation,
  completeAIBudgetReservation,
  createAIBudgetReservation,
} from "@/lib/ai/budget-reservation";

import {
  buildChatFileSearchFilter,
  extractCitedFileIds,
  extractFileSearchResults,
  getChatRetrievalSettings,
  INSUFFICIENT_KNOWLEDGE_MESSAGE,
  isInsufficientKnowledgeAnswer,
  selectRelevantRetrievalResults,
  type ChatRetrievalResult,
} from "@/lib/ai/chat-retrieval";

import {
  classifyUserMessage,
} from "@/lib/ai/classification";

import {
  getOpenAIClient,
  getOpenAIModel,
  getOpenAIVectorStoreId,
} from "@/lib/ai/openai";

import {
  calculateReservedTokenCost,
  estimateUtf8TokenUpperBound,
  getActiveModelPricing,
  recordAIUsage,
} from "@/lib/ai/usage";

import {
  acquireChatRequestLock,
  consumeChatRateLimit,
  refreshChatRequestLock,
  releaseChatRequestLock,
} from "@/lib/chat/rate-limit";

import {
  toChatMessage,
} from "@/lib/chat/messages";

import {
  trackKnowledgeGap,
} from "@/lib/knowledge-gaps/tracker";

import {
  getAuthenticatedPocketBase,
} from "@/lib/pocketbase/auth";

import {
  getPocketBaseServiceClient,
} from "@/lib/pocketbase/service";

import type {
  ChatMessage,
  ChatSource,
} from "@/types/chat";

import {
  enforceGroundedAnswer,
} from "@/lib/ai/chat-grounding";

import {
  verifyGroundedAnswer,
} from "@/lib/ai/chat-grounding-verifier";

/*
 * ============================================
 * Request / AI Limits
 * ============================================
 */

const MAX_MESSAGE_LENGTH =
  4000;

const MAX_REQUEST_BODY_BYTES =
  16 * 1024;

const MAX_HISTORY_MESSAGES =
  20;

const MAX_HISTORY_CHARACTERS =
  16_000;

const MAX_HISTORY_ITEM_LENGTH =
  4_000;

const CHAT_MAX_OUTPUT_TOKENS =
  700;

/*
 * UTF-8 byte count یک upper bound محافظه‌کارانه
 * برای Tokenهای متن است. این Overhead برای
 * ساختار Request / Tool metadata در نظر گرفته
 * می‌شود.
 */
const CHAT_RESERVATION_OVERHEAD_TOKENS =
  512;

const CLIENT_MESSAGE_ID_PATTERN =
  /^u[a-z0-9]{14}$/;

const RECORD_ID_PATTERN =
  /^[a-zA-Z0-9_-]{1,64}$/;

/*
 * ============================================
 * Assistant Instructions
 * ============================================
 */

const ASSISTANT_INSTRUCTIONS_BASE = `
تو دستیار فارسی‌زبان کارشناسان یک شرکت هستی و به پایگاه دانش داخلی شرکت دسترسی داری.

قوانین پاسخ‌گویی:
- همیشه به زبان فارسی، مستقیم، واضح و کاربردی پاسخ بده.
- اگر پاسخ مرحله‌ای است، مراحل را شماره‌گذاری کن و بی‌دلیل پاسخ را طولانی نکن.
- برای هر سؤال مرتبط با قوانین، فرایندها، محصولات، قیمت‌ها، شرایط، سیاست‌ها یا هر اطلاعات داخلی شرکت، فقط بر پایه اطلاعات بازیابی‌شده از پایگاه دانش پاسخ بده.
- هیچ قانون، فرایند، قیمت، درصد، شرط یا سیاست داخلی را حدس نزن و از دانش عمومی مدل برای تکمیل اطلاعات داخلی استفاده نکن.
- اگر اطلاعات بازیابی‌شده برای پاسخ دقیق به سؤال داخلی کافی نیست، فقط همین جمله را برگردان و توضیح دیگری اضافه نکن:
${INSUFFICIENT_KNOWLEDGE_MESSAGE}
- سؤال‌های عمومی و غیرسازمانی مانند سلام، توضیح یک مفهوم عمومی یا ادامه طبیعی مکالمه را می‌توانی معمولی پاسخ بدهی.
- برای سؤال‌های مربوط به امروز، فردا، دیروز، تاریخ، روز هفته یا ساعت، فقط از «زمان جاری سیستم» که در ادامه Instructions دریافت می‌کنی استفاده کن و هرگز تاریخ یا روز هفته را حدس نزن.
- در پاسخ به کارشناس از عبارت‌های «RAG»، «Vector Store»، «File Search» یا جزئیات فنی بازیابی اطلاعات نام نبر.
`;

/*
 * ============================================
 * Types
 * ============================================
 */

type ChatStage =
  | "request"
  | "authentication"
  | "service_client"
  | "conversation"
  | "idempotency"
  | "request_lock"
  | "rate_limit"
  | "budget_guard"
  | "budget_reservation"
  | "classification"
  | "history"
  | "user_persistence"
  | "openai"
  | "source_resolution"
  | "grounding_verification"
  | "assistant_persistence"
  | "conversation_update";

type ChatInputItem = {
  role:
    | "user"
    | "assistant";

  content:
    string;
};

type ErrorMetadata = {
  name?: string;
  message?: string;
  status?: number;
  code?: string;
  type?: string;
  requestId?: string;
  response?: unknown;
};

/*
 * ============================================
 * POST
 * ============================================
 */

export async function POST(
  request: Request,
  {
    params,
  }: RouteContext<
    "/api/conversations/[conversationId]/messages"
  >
) {
  const requestId =
    crypto.randomUUID();

  let stage:
    ChatStage =
      "request";

  /*
   * ========================================
   * Request Latency Profiling
   *
   * Stageهای موجود Chat Route را اندازه‌گیری
   * می‌کند بدون اینکه Business Logic تغییر کند.
   * ========================================
   */

  const latencyProfiler =
    createChatLatencyProfiler({
      requestId,

      initialStage:
        stage,
    });

  function setStage(
    nextStage:
      ChatStage
  ) {
    stage =
      nextStage;

    latencyProfiler.setStage(
      nextStage
    );
  }

  let persistedUserMessage:
    | ChatMessage
    | undefined;

  /*
   * Request Lock
   */

  let lockAcquired =
    false;

  let lockedUserId =
    "";

  try {
    const {
      conversationId,
    } = await params;

    /*
     * ========================================
     * Conversation ID Validation
     * ========================================
     */

    if (
      !RECORD_ID_PATTERN.test(
        conversationId
      )
    ) {
      return jsonError({
        requestId,

        status:
          400,

        code:
          "INVALID_CONVERSATION_ID",

        message:
          "شناسه گفتگو معتبر نیست.",
      });
    }

    /*
     * ========================================
     * Request Content Type
     * ========================================
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
      return jsonError({
        requestId,

        status:
          415,

        code:
          "UNSUPPORTED_MEDIA_TYPE",

        message:
          "نوع محتوای درخواست معتبر نیست.",
      });
    }

    /*
     * ========================================
     * Declared Body Size
     * ========================================
     */

    const rawContentLength =
      request.headers.get(
        "content-length"
      );

    if (
      rawContentLength
    ) {
      const declaredLength =
        Number(
          rawContentLength
        );

      if (
        Number.isFinite(
          declaredLength
        ) &&
        declaredLength >
          MAX_REQUEST_BODY_BYTES
      ) {
        return jsonError({
          requestId,

          status:
            413,

          code:
            "REQUEST_BODY_TOO_LARGE",

          message:
            "حجم درخواست بیش از حد مجاز است.",
        });
      }
    }

    /*
     * ========================================
     * Bounded JSON Body
     *
     * Content-Length به‌تنهایی کافی نیست چون
     * Request می‌تواند chunked باشد.
     * ========================================
     */

    const parsedBody =
      await readJsonBodyWithLimit(
        request,
        MAX_REQUEST_BODY_BYTES
      );

    if (
      !parsedBody.ok
    ) {
      return jsonError({
        requestId,

        status:
          parsedBody.status,

        code:
          parsedBody.code,

        message:
          parsedBody.message,
      });
    }

    const body =
      parsedBody.body;

    /*
     * ========================================
     * Message Content
     * ========================================
     */

    const content =
      getMessageContent(
        body
      );

    if (!content) {
      return jsonError({
        requestId,

        status:
          400,

        code:
          "EMPTY_MESSAGE",

        message:
          "متن سؤال نمی‌تواند خالی باشد.",
      });
    }

    if (
      content.length >
      MAX_MESSAGE_LENGTH
    ) {
      return jsonError({
        requestId,

        status:
          400,

        code:
          "MESSAGE_TOO_LONG",

        message:
          `حداکثر طول سؤال ${MAX_MESSAGE_LENGTH} کاراکتر است.`,
      });
    }

    /*
     * ========================================
     * Client Message ID
     * ========================================
     */

    const clientMessageId =
      getClientMessageId(
        body
      );

    if (
      !clientMessageId
    ) {
      return jsonError({
        requestId,

        status:
          400,

        code:
          "INVALID_CLIENT_MESSAGE_ID",

        message:
          "شناسه پیام معتبر نیست.",
      });
    }

    const assistantMessageId =
      getAssistantMessageId(
        clientMessageId
      );

    /*
     * ========================================
     * Authentication
     *
     * فقط برای اثبات هویت کاربر.
     *
     * PocketBase Client داخل Session برای
     * دسترسی داده‌های Chat استفاده نمی‌شود.
     * ========================================
     */

    setStage(
      "authentication"
    );

    const session =
      await getAuthenticatedPocketBase();

    if (!session) {
      return jsonError({
        requestId,

        status:
          401,

        code:
          "UNAUTHORIZED",

        message:
          "ابتدا وارد حساب کاربری شوید.",
      });
    }

    const {
      account,
    } = session;

    lockedUserId =
      account.id;

    /*
     * ========================================
     * Backend Service Client
     * ========================================
     */

    setStage(
      "service_client"
    );

    let pb:
      PocketBase;

    try {
      pb =
        await getPocketBaseServiceClient();
    } catch (error) {
      logStageError(
        requestId,
        stage,
        error
      );

      return jsonError({
        requestId,

        status:
          503,

        code:
          "CHAT_DATA_SERVICE_UNAVAILABLE",

        message:
          "سرویس داده گفتگو موقتاً در دسترس نیست. دوباره تلاش کنید.",
      });
    }

    /*
     * ========================================
     * Conversation Ownership
     * ========================================
     */

    setStage(
      "conversation"
    );

    let conversation:
      RecordModel;

    try {
      conversation =
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
            )
          );
    } catch (error) {
      logStageError(
        requestId,
        stage,
        error
      );

      if (
        getErrorMetadata(
          error
        ).status ===
        404
      ) {
        return jsonError({
          requestId,

          status:
            404,

          code:
            "CONVERSATION_NOT_FOUND",

          message:
            "گفتگو پیدا نشد.",
        });
      }

      return jsonError({
        requestId,

        status:
          503,

        code:
          "CONVERSATION_UNAVAILABLE",

        message:
          "در بررسی گفتگو خطایی رخ داد. دوباره تلاش کنید.",
      });
    }

    if (
      conversation.status !==
      "active"
    ) {
      return jsonError({
        requestId,

        status:
          400,

        code:
          "CONVERSATION_INACTIVE",

        message:
          "این گفتگو غیرفعال است.",
      });
    }

    /*
     * ========================================
     * Idempotency
     *
     * قبل از Rate Limit و Budget Guard.
     * ========================================
     */

    setStage(
      "idempotency"
    );

    try {
      const existingAssistant =
        await getExistingAssistantMessage({
          pb,

          id:
            assistantMessageId,

          conversationId:
            conversation.id,

          userId:
            account.id,
        });

      if (
        existingAssistant
      ) {
        const existingUser =
          await getExistingUserMessage({
            pb,

            id:
              clientMessageId,

            conversationId:
              conversation.id,

            userId:
              account.id,

            content,
          });

        if (
          !existingUser
        ) {
          throw new Error(
            "Idempotent assistant exists without matching user message."
          );
        }

        persistedUserMessage =
          toChatMessage(
            existingUser
          );

        after(() =>
          runPostResponseTasks({
            requestId,

            userMessageId:
              existingUser.id,

            assistantMessageId:
              existingAssistant.id,
          })
        );

        return successResponse({
          requestId,

          userMessage:
            persistedUserMessage,

          assistantMessage:
            toChatMessage(
              existingAssistant
            ),

          conversationId:
            conversation.id,

          title:
            String(
              conversation.title ||
                "گفتگوی جدید"
            ),

          responseTime:
            Number(
              existingAssistant
                .response_time_ms ||
                0
            ),

          responseId:
            String(
              existingAssistant
                .openai_response_id ||
                ""
            ),
        });
      }
    } catch (error) {
      logStageError(
        requestId,
        stage,
        error
      );

      return jsonError({
        requestId,

        status:
          503,

        code:
          "MESSAGE_RETRY_CHECK_FAILED",

        message:
          "وضعیت پیام قابل بررسی نیست. دوباره تلاش کنید.",
      });
    }

    /*
     * ========================================
     * Request Lock
     * ========================================
     */

    setStage(
      "request_lock"
    );

    let lockResult;

    try {
      lockResult =
        await acquireChatRequestLock({
          userId:
            account.id,

          conversationId:
            conversation.id,

          requestId,
        });
    } catch (error) {
      logStageError(
        requestId,
        stage,
        error
      );

      return jsonError({
        requestId,

        status:
          503,

        code:
          "CHAT_GUARD_UNAVAILABLE",

        message:
          "امکان بررسی وضعیت درخواست در حال حاضر وجود ندارد. دوباره تلاش کنید.",
      });
    }

    if (
      !lockResult.acquired
    ) {
      return jsonError({
        requestId,

        status:
          409,

        code:
          "CHAT_REQUEST_IN_PROGRESS",

        message:
          "درخواست قبلی شما هنوز در حال پردازش است. پس از دریافت پاسخ دوباره تلاش کنید.",

        retryAfterSeconds:
          lockResult.retryAfterSeconds,
      });
    }

    lockAcquired =
      true;

    /*
     * ========================================
     * Rate Limit
     * ========================================
     */

    setStage(
      "rate_limit"
    );

    let rateLimit;

    try {
      rateLimit =
        await consumeChatRateLimit({
          userId:
            account.id,

          requestId,
        });
    } catch (error) {
      logStageError(
        requestId,
        stage,
        error
      );

      return jsonError({
        requestId,

        status:
          503,

        code:
          "CHAT_RATE_LIMIT_UNAVAILABLE",

        message:
          "امکان بررسی سهمیه استفاده در حال حاضر وجود ندارد. دوباره تلاش کنید.",
      });
    }

    if (
      !rateLimit.allowed
    ) {
      if (
        rateLimit.code ===
        "CHAT_DAILY_LIMIT_REACHED"
      ) {
        return jsonError({
          requestId,

          status:
            429,

          code:
            "CHAT_DAILY_LIMIT_REACHED",

          message:
            "سقف تعداد درخواست روزانه شما به پایان رسیده است. فردا دوباره می‌توانید از دستیار استفاده کنید.",

          retryAfterSeconds:
            rateLimit.retryAfterSeconds,
        });
      }

      return jsonError({
        requestId,

        status:
          429,

        code:
          "CHAT_RATE_LIMITED",

        message:
          "تعداد درخواست‌های شما بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.",

        retryAfterSeconds:
          rateLimit.retryAfterSeconds,
      });
    }

    /*
     * ========================================
     * History
     * ========================================
     */

    setStage(
      "history"
    );

    let historyResult;

    try {
      historyResult =
        await pb
          .collection(
            "messages"
          )
          .getList(
            1,
            MAX_HISTORY_MESSAGES,
            {
              filter:
                pb.filter(
                  "conversation = {:conversationId} && user = {:userId}",
                  {
                    conversationId:
                      conversation.id,

                    userId:
                      account.id,
                  }
                ),

              sort:
                "-created",
            }
          );
    } catch (error) {
      logStageError(
        requestId,
        stage,
        error
      );

      return jsonError({
        requestId,

        status:
          503,

        code:
          "CHAT_HISTORY_UNAVAILABLE",

        message:
          "تاریخچه گفتگو در دسترس نیست. دوباره تلاش کنید.",
      });
    }

    /*
     * ========================================
     * Bounded OpenAI History
     *
     * History قبل از Persist پیام فعلی ساخته
     * می‌شود. clientMessageId عمداً exclude
     * می‌شود تا Retry نیمه‌کاره پیام جاری را
     * دوباره وارد Context نکند.
     * ========================================
     */

    const history =
      buildBoundedHistory(
        historyResult.items,
        clientMessageId
      );

    const input:
      ChatInputItem[] = [
      ...history,

      {
        role:
          "user",

        content,
      },
    ];

    /*
     * ========================================
     * Reservation-aware AI Budget Guard
     *
     * Budget بر اساس Usage ثبت‌شده +
     * upper-bound درخواست جدید بررسی می‌شود.
     *
     * این Guard قبل از Persist پیام کاربر و
     * قبل از OpenAI اجرا می‌شود.
     * ========================================
     */

    const assistantInstructions =
      buildAssistantInstructions();

    const model =
      getOpenAIModel();

    const retrievalSettings =
      getChatRetrievalSettings();

    const vectorStoreId =
      getOpenAIVectorStoreId();

    /*
     * ========================================
     * Retrieval Scope Mode
     *
     * true  => Classification قبل از File Search
     *          و Retrieval محدود به Topic
     *
     * false => Retrieval فقط روی published knowledge
     *          و Classification بعد از Response
     *          داخل after()
     *
     * Default عمداً true است تا Deploy به‌تنهایی
     * رفتار Production را تغییر ندهد.
     * ========================================
     */

    const topicScopedRetrievalEnabled =
      isChatTopicScopedRetrievalEnabled();

    const preflightFileSearchFilter =
      buildChatFileSearchFilter(
        null
      );

    const preflightReservationInputTokens =
      estimateChatReservationInputTokens({
        model,

        assistantInstructions,

        input,

        vectorStoreId,

        maxResults:
          retrievalSettings.maxResults,

        minScore:
          retrievalSettings.minScore,

        fileSearchFilter:
          preflightFileSearchFilter,
      });

    setStage(
      "budget_guard"
    );

    let budgetGuard;

    try {
      budgetGuard =
        await checkAIBudgetGuard({
          userId:
            account.id,

          reservation: {
            model,

            inputTokens:
              preflightReservationInputTokens,

            outputTokens:
              CHAT_MAX_OUTPUT_TOKENS,
          },

          excludeReservationRequestId:
            requestId,
        });
    } catch (error) {
      logStageError(
        requestId,
        stage,
        error
      );

      return jsonError({
        requestId,

        status:
          503,

        code:
          "AI_BUDGET_GUARD_UNAVAILABLE",

        message:
          "امکان بررسی سهمیه هوش مصنوعی در حال حاضر وجود ندارد. کمی بعد دوباره تلاش کنید.",
      });
    }

    if (
      !budgetGuard.allowed
    ) {
      return jsonError({
        requestId,

        status:
          429,

        code:
          budgetGuard.code,

        message:
          getBudgetLimitMessage(
            budgetGuard.code
          ),

        retryAfterSeconds:
          budgetGuard.retryAfterSeconds,
      });
    }

    if (
      budgetGuard.warnings.length >
      0
    ) {
      console.warn(
        "AI budget warning",
        {
          requestId,

          userId:
            account.id,

          warnings:
            budgetGuard.warnings.map(
              (
                warning
              ) => ({
                type:
                  warning.type,

                percent:
                  Math.round(
                    warning.percent *
                      100
                  ) /
                  100,
              })
            ),
        }
      );
    }

    /*
     * ========================================
     * User Message
     * ========================================
     */

    setStage(
      "user_persistence"
    );

    let userMessage:
      RecordModel;

    try {
      const result =
        await getOrCreateUserMessage({
          pb,

          id:
            clientMessageId,

          conversationId:
            conversation.id,

          userId:
            account.id,

          content,
        });

      userMessage =
        result.record;

      persistedUserMessage =
        toChatMessage(
          userMessage
        );
    } catch (error) {
      logStageError(
        requestId,
        stage,
        error,
        {
          operation:
            "create_or_reuse_user_message",
        }
      );

      return jsonError({
        requestId,

        status:
          503,

        code:
          "USER_MESSAGE_PERSISTENCE_FAILED",

        message:
          "پیام شما ذخیره نشد. دوباره تلاش کنید.",
      });
    }

    /*
     * ========================================
     * Second Idempotency Check
     * ========================================
     */

    try {
      const existingAssistant =
        await getExistingAssistantMessage({
          pb,

          id:
            assistantMessageId,

          conversationId:
            conversation.id,

          userId:
            account.id,
        });

      if (
        existingAssistant
      ) {
        after(() =>
          runPostResponseTasks({
            requestId,

            userMessageId:
              userMessage.id,

            assistantMessageId:
              existingAssistant.id,
          })
        );

        return successResponse({
          requestId,

          userMessage:
            persistedUserMessage,

          assistantMessage:
            toChatMessage(
              existingAssistant
            ),

          conversationId:
            conversation.id,

          title:
            String(
              conversation.title ||
                "گفتگوی جدید"
            ),

          responseTime:
            Number(
              existingAssistant
                .response_time_ms ||
                0
            ),

          responseId:
            String(
              existingAssistant
                .openai_response_id ||
                ""
            ),
        });
      }
    } catch (error) {
      logStageError(
        requestId,
        stage,
        error,
        {
          operation:
            "second_idempotency_check",
        }
      );

      return jsonError({
        requestId,

        status:
          503,

        code:
          "MESSAGE_RETRY_CHECK_FAILED",

        message:
          "وضعیت پیام قابل بررسی نیست. دوباره تلاش کنید.",

        userMessage:
          persistedUserMessage,
      });
    }

    /*
     * ========================================
     * Topic Classification / Retrieval Scope
     *
     * Scoped Mode:
     * Classification همچنان قبل از Retrieval
     * اجرا می‌شود.
     *
     * Fast Mode:
     * Classification از Critical Path خارج
     * می‌شود و پس از Response اجرا خواهد شد.
     * File Search فقط status=published دارد.
     * ========================================
     */

    let classificationTopicId:
      string |
      null =
        null;

    if (
      topicScopedRetrievalEnabled
    ) {
      setStage(
        "request_lock"
      );

      try {
        await refreshChatRequestLock({
          userId:
            account.id,

          requestId,
        });
      } catch (error) {
        logStageError(
          requestId,
          stage,
          error,
          {
            operation:
              "refresh_request_lock_before_classification",
          }
        );

        return jsonError({
          requestId,

          status:
            503,

          code:
            "CHAT_GUARD_UNAVAILABLE",

          message:
            "امکان حفظ وضعیت درخواست در حال حاضر وجود ندارد. دوباره تلاش کنید.",

          userMessage:
            persistedUserMessage,
        });
      }

      setStage(
        "classification"
      );

      try {
        const classification =
          await classifyUserMessage({
            question:
              content,

            context:
              history,

            userId:
              account.id,

            conversationId:
              conversation.id,

            messageId:
              userMessage.id,
          });

        if (
          classification.status ===
            "classified" ||
          classification.status ===
            "skipped"
        ) {
          classificationTopicId =
            classification.topicId;
        }

        if (
          classification.status ===
          "error"
        ) {
          console.warn(
            "Topic classification completed with error status; chat will use published-only retrieval",
            {
              requestId,

              userId:
                account.id,

              conversationId:
                conversation.id,

              messageId:
                userMessage.id,
            }
          );
        }
      } catch (error) {
        classificationTopicId =
          null;

        logStageError(
          requestId,
          stage,
          error,
          {
            operation:
              "classify_before_chat",

            messageId:
              userMessage.id,
          }
        );
      }

      setStage(
        "request_lock"
      );

      try {
        await refreshChatRequestLock({
          userId:
            account.id,

          requestId,
        });
      } catch (error) {
        logStageError(
          requestId,
          stage,
          error,
          {
            operation:
              "refresh_request_lock_after_classification",
          }
        );

        return jsonError({
          requestId,

          status:
            503,

          code:
            "CHAT_GUARD_UNAVAILABLE",

          message:
            "امکان حفظ وضعیت درخواست در حال حاضر وجود ندارد. دوباره تلاش کنید.",

          userMessage:
            persistedUserMessage,
        });
      }
    } else {
      console.info(
        "Chat fast retrieval mode enabled",
        {
          requestId,

          conversationId:
            conversation.id,

          messageId:
            userMessage.id,

          retrievalScope:
            "published_only",

          classification:
            "background",
        }
      );
    }

    /*
     * ========================================
     * Final Topic-aware Chat Budget Guard
     *
     * Scoped Mode:
     * - Classification قبل از Chat اجرا شده.
     * - Filter نهایی ممکن است تغییر کرده باشد.
     * - مصرف Classification نیز به Budget اضافه
     *   شده است.
     * - پس Guard دوم لازم است.
     *
     * Fast Mode:
     * - Classification هنوز اجرا نشده.
     * - Filter همان published-only Preflight است.
     * - Reservation estimate همان Preflight است.
     * - بنابراین Guard دوم تکراری است.
     * ========================================
     */

    const fileSearchFilter =
      topicScopedRetrievalEnabled
        ? buildChatFileSearchFilter(
            classificationTopicId
          )
        : preflightFileSearchFilter;

    const reservationInputTokens =
      topicScopedRetrievalEnabled
        ? estimateChatReservationInputTokens({
            model,

            assistantInstructions,

            input,

            vectorStoreId,

            maxResults:
              retrievalSettings.maxResults,

            minScore:
              retrievalSettings.minScore,

            fileSearchFilter,
          })
        : preflightReservationInputTokens;

    /*
     * در Fast Mode از نتیجه همان Guard اولیه
     * استفاده می‌کنیم.
     */

   let finalBudgetGuard:
  Awaited<
    ReturnType<
      typeof checkAIBudgetGuard
    >
  > =
    budgetGuard;

    if (
      topicScopedRetrievalEnabled
    ) {
      setStage(
        "budget_guard"
      );

      try {
        finalBudgetGuard =
          await checkAIBudgetGuard({
            userId:
              account.id,

            reservation: {
              model,

              inputTokens:
                reservationInputTokens,

              outputTokens:
                CHAT_MAX_OUTPUT_TOKENS,
            },

            excludeReservationRequestId:
              requestId,
          });
      } catch (error) {
        logStageError(
          requestId,
          stage,
          error,
          {
            operation:
              "final_chat_budget_guard_after_classification",
          }
        );

        return jsonError({
          requestId,

          status:
            503,

          code:
            "AI_BUDGET_GUARD_UNAVAILABLE",

          message:
            "امکان بررسی سهمیه هوش مصنوعی در حال حاضر وجود ندارد. کمی بعد دوباره تلاش کنید.",

          userMessage:
            persistedUserMessage,
        });
      }
    }

    if (
      !finalBudgetGuard.allowed
    ) {
      return jsonError({
        requestId,

        status:
          429,

        code:
          finalBudgetGuard.code,

        message:
          getBudgetLimitMessage(
            finalBudgetGuard.code
          ),

        retryAfterSeconds:
          finalBudgetGuard.retryAfterSeconds,

        userMessage:
          persistedUserMessage,
      });
    }

    if (
      finalBudgetGuard.warnings.length >
      0
    ) {
      console.warn(
        topicScopedRetrievalEnabled
          ? "AI budget warning after topic classification"
          : "AI budget warning before chat",
        {
          requestId,

          userId:
            account.id,

          topicId:
            classificationTopicId,

          warnings:
            finalBudgetGuard.warnings.map(
              (
                warning
              ) => ({
                type:
                  warning.type,

                percent:
                  Math.round(
                    warning.percent *
                      100
                  ) /
                  100,
              })
            ),
        }
      );
    }

    /*
     * ========================================
     * Persistent AI Budget Reservation
     *
     * Budget Guard بالا ظرفیت را بررسی کرده است.
     * حالا همان ظرفیت قبل از OpenAI داخل
     * PocketBase به‌صورت pending رزرو می‌شود.
     *
     * اگر Process بعد از این نقطه Crash کند،
     * Reservation تا TTL همچنان Budget را اشغال
     * می‌کند و از under-accounting جلوگیری می‌شود.
     * ========================================
     */

    setStage(
      "budget_reservation"
    );

    const reservedTokens =
      safeBudgetInteger(
        reservationInputTokens +
          CHAT_MAX_OUTPUT_TOKENS
      );

    let reservedCostUsd =
      0;

    try {
      const pricing =
        await getActiveModelPricing(
          model
        );

      if (
        pricing
      ) {
        reservedCostUsd =
          calculateReservedTokenCost(
            {
              inputTokens:
                reservationInputTokens,

              outputTokens:
                CHAT_MAX_OUTPUT_TOKENS,
            },
            pricing
          );
      }
    } catch (error) {
      logStageError(
        requestId,
        stage,
        error,
        {
          operation:
            "resolve_chat_reservation_pricing",
        }
      );

      return jsonError({
        requestId,

        status:
          503,

        code:
          "AI_BUDGET_RESERVATION_UNAVAILABLE",

        message:
          "امکان رزرو سهمیه هوش مصنوعی در حال حاضر وجود ندارد. دوباره تلاش کنید.",

        userMessage:
          persistedUserMessage,
      });
    }

    try {
      const reservationResult =
        await createAIBudgetReservation({
          userId:
            account.id,

          conversationId:
            conversation.id,

          requestId,

          requestType:
            "chat",

          model,

          reservedTokens,

          reservedCostUsd,
        });

      /*
       * create=false فقط برای Retry داخلی همان
       * requestId ممکن است. Completed یعنی این
       * AI operation قبلاً Accounting شده و نباید
       * دوباره OpenAI اجرا شود.
       */
      if (
        !reservationResult.created &&
        reservationResult.reservation.status ===
          "completed"
      ) {
        return jsonError({
          requestId,

          status:
            409,

          code:
            "AI_BUDGET_RESERVATION_ALREADY_COMPLETED",

          message:
            "این درخواست هوش مصنوعی قبلاً پردازش شده است. وضعیت پیام را دوباره بررسی کنید.",

          userMessage:
            persistedUserMessage,
        });
      }
    } catch (error) {
      logStageError(
        requestId,
        stage,
        error,
        {
          operation:
            "create_chat_budget_reservation",
        }
      );

      return jsonError({
        requestId,

        status:
          503,

        code:
          "AI_BUDGET_RESERVATION_UNAVAILABLE",

        message:
          "رزرو سهمیه هوش مصنوعی انجام نشد. دوباره تلاش کنید.",

        userMessage:
          persistedUserMessage,
      });
    }

    /*
     * ========================================
     * Refresh Request Lock
     *
     * عملیات OpenAI ممکن است طولانی باشد.
     * قبل از شروع آن TTL Lock دوباره کامل
     * می‌شود.
     * ========================================
     */

    setStage(
      "request_lock"
    );

    try {
      await refreshChatRequestLock({
        userId:
          account.id,

        requestId,
      });
    } catch (error) {
      logStageError(
        requestId,
        stage,
        error,
        {
          operation:
            "refresh_request_lock_before_openai",
        }
      );

      await cancelChatBudgetReservationSafely({
        requestId,

        userId:
          account.id,

        errorCode:
          "CHAT_REQUEST_LOCK_REFRESH_FAILED",
      });

      return jsonError({
        requestId,

        status:
          503,

        code:
          "CHAT_GUARD_UNAVAILABLE",

        message:
          "امکان حفظ وضعیت درخواست در حال حاضر وجود ندارد. دوباره تلاش کنید.",

        userMessage:
          persistedUserMessage,
      });
    }

    /*
     * ========================================
     * OpenAI
     * ========================================
     */

    setStage(
      "openai"
    );

    const startedAt =
      Date.now();

    let openAIResponse;

    try {
      openAIResponse =
        await getOpenAIClient()
          .responses.create({
            model,

            instructions:
              assistantInstructions,

            input,

            tools: [
              {
                type:
                  "file_search",

                vector_store_ids:
                  [
                    vectorStoreId,
                  ],

                max_num_results:
                  retrievalSettings
                    .maxResults,

                filters:
                  fileSearchFilter,

                ranking_options:
                  {
                    score_threshold:
                      retrievalSettings
                        .minScore,
                  },
              },
            ],

            include: [
              "file_search_call.results",
            ],

            reasoning: {
              effort:
                "none",
            },

            text: {
              verbosity:
                "low",
            },

            max_output_tokens:
              CHAT_MAX_OUTPUT_TOKENS,

            store:
              false,
          });
    } catch (error) {
      const responseTime =
        Date.now() -
        startedAt;

      logStageError(
        requestId,
        stage,
        error
      );

      await recordAIUsageChecked(
        requestId,
        {
          userId:
            account.id,

          conversationId:
            conversation.id,

          requestType:
            "chat",

          reservationRequestId:
            requestId,

          model,

          latencyMs:
            responseTime,

          success:
            false,

          requestId:
            getErrorMetadata(
              error
            ).requestId,

          error,
        }
      );

      return openAIErrorResponse(
        requestId,
        error,
        persistedUserMessage
      );
    }

    const responseTime =
      Date.now() -
      startedAt;

    let answer =
      openAIResponse
        .output_text
        .trim();

    /*
     * ========================================
     * Incomplete OpenAI Response
     * ========================================
     */

    if (
      openAIResponse.status !==
        "completed" ||
      !answer
    ) {
      logStageError(
        requestId,
        stage,
        {
          name:
            "IncompleteOpenAIResponse",

          message:
            "OpenAI response was not completed",

          code:
            openAIResponse
              .error?.code,

          response: {
            status:
              openAIResponse.status,

            error:
              openAIResponse.error,

            incompleteDetails:
              openAIResponse
                .incomplete_details,
          },
        }
      );

      const incompleteUsageResult =
        await recordAIUsageChecked(
          requestId,
          {
            userId:
              account.id,

            conversationId:
              conversation.id,

            requestType:
              "chat",

            reservationRequestId:
              requestId,

            model,

            latencyMs:
              responseTime,

            success:
              false,

            response:
              openAIResponse,

            errorMessage:
              "OpenAI response was not completed",
          }
        );

      if (
        incompleteUsageResult.ok
      ) {
        await completeChatBudgetReservationSafely({
          requestId,

          userId:
            account.id,

          usageResult:
            incompleteUsageResult,
        });
      }

      return jsonError({
        requestId,

        status:
          502,

        code:
          "OPENAI_INCOMPLETE_RESPONSE",

        message:
          "پاسخ هوش مصنوعی کامل نشد. دوباره تلاش کنید.",

        upstreamRequestId:
          openAIResponse.id,

        userMessage:
          persistedUserMessage,
      });
    }

    /*
     * ========================================
     * Retrieval
     * ========================================
     */

    const retrievalResults =
      extractFileSearchResults(
        openAIResponse.output
      );

    const citedFileIds =
      extractCitedFileIds(
        openAIResponse.output
      );

    const relevantResults =
      isInsufficientKnowledgeAnswer(
        answer
      )
        ? []
        : selectRelevantRetrievalResults({
            results:
              retrievalResults,

            citedFileIds,

            minScore:
              retrievalSettings
                .minScore,

            maxResults:
              retrievalSettings
                .maxResults,
          });

    /*
     * ========================================
     * Sources
     * ========================================
     */

    setStage(
      "source_resolution"
    );

    let sources:
      ChatSource[];

    try {
      sources =
        await resolveKnowledgeSources(
          pb,
          relevantResults
        );
    } catch (error) {
      logStageError(
        requestId,
        stage,
        error,
        {
          knowledgeIds:
            relevantResults
              .map(
                (
                  result
                ) =>
                  result.knowledgeId
              )
              .filter(
                Boolean
              ),
        }
      );

      const sourceUsageResult =
        await recordAIUsageChecked(
          requestId,
          {
            userId:
              account.id,

            conversationId:
              conversation.id,

            requestType:
              "chat",

            reservationRequestId:
              requestId,

            model,

            latencyMs:
              responseTime,

            success:
              true,

            response:
              openAIResponse,
          }
        );

      if (
        sourceUsageResult.ok
      ) {
        await completeChatBudgetReservationSafely({
          requestId,

          userId:
            account.id,

          usageResult:
            sourceUsageResult,
        });
      }

      return jsonError({
        requestId,

        status:
          503,

        code:
          "KNOWLEDGE_SOURCES_UNAVAILABLE",

        message:
          "منابع پاسخ قابل بررسی نیستند. دوباره تلاش کنید.",

        userMessage:
          persistedUserMessage,
      });
    }

    /*
     * ========================================
     * Hard Grounding Gate
     * ========================================
     */

    const groundingCheckedAt =
      new Date()
        .toISOString();

    /*
     * این Countها قبل از هر Block ثبت می‌شوند
     * تا Analytics بتواند تفاوت بین:
     *
     * - بدون Retrieval
     * - Retrieval نامعتبر
     * - Evidence معتبر ولی Claim نامعتبر
     *
     * را تشخیص دهد.
     */

    const groundingRetrievalCount =
      retrievalResults.length;

    const groundingRelevantCount =
      relevantResults.length;

    const groundingSourceCount =
      sources.length;

    const grounding =
      enforceGroundedAnswer({
        question:
          content,

        answer,

        relevantResults,

        sources,
      });

    answer =
      grounding.answer;

    sources =
      grounding.sources;

    let hasAnswer =
      grounding.hasAnswer;

    let groundingStatus:
      | "not_required"
      | "verified"
      | "blocked" =
        grounding.requiresKnowledge
          ? grounding.hasAnswer
            ? "verified"
            : "blocked"
          : "not_required";

    let groundingVerifierStatus =
      grounding.requiresKnowledge
        ? grounding.hasAnswer
          ? "pending"
          : "not_run"
        : "not_required";

    let groundingVerifierReason =
      "";

    let groundingUnsupportedClaims:
      string[] =
        [];

    let groundingVerifierModel =
      "";

    let groundingVerifierRequestId =
      "";

    /*
     * ========================================
     * Semantic Claim Verification
     *
     * فقط پاسخ‌های سازمانی که Hard Gate را
     * عبور کرده‌اند بررسی دوم می‌شوند.
     * ========================================
     */

    if (
      hasAnswer &&
      grounding.requiresKnowledge
    ) {
      setStage(
        "grounding_verification"
      );

      const verification =
        await verifyGroundedAnswer({
          question:
            content,

          answer,

          retrievalResults,

          citedFileIds,

          sources,

          minScore:
            retrievalSettings.minScore,

          userId:
            account.id,

          conversationId:
            conversation.id,

          messageId:
            userMessage.id,

          baseRequestId:
            requestId,
        });

      groundingVerifierStatus =
        verification.reason;

      groundingVerifierReason =
        verification.verifierReason ||
        "";

      groundingUnsupportedClaims =
        verification
          .unsupportedClaims;

      groundingVerifierModel =
        verification.model ||
        "";

      groundingVerifierRequestId =
        verification
          .verifierRequestId ||
        "";

      if (
        verification.verified
      ) {
        groundingStatus =
          "verified";

        groundingVerifierStatus =
          "supported";
      } else {
        groundingStatus =
          "blocked";

        console.warn(
          "Chat answer rejected by semantic grounding verifier",
          {
            requestId,

            conversationId:
              conversation.id,

            userMessageId:
              userMessage.id,

            groundingReason:
              grounding.reason,

            verificationReason:
              verification.reason,

            verifierReason:
              verification.verifierReason,

            unsupportedClaims:
              verification
                .unsupportedClaims,

            verifierRequestId:
              verification
                .verifierRequestId,

            verifierModel:
              verification.model,
          }
        );

        answer =
          INSUFFICIENT_KNOWLEDGE_MESSAGE;

        sources =
          [];

        hasAnswer =
          false;
      }
    }

    if (
      !hasAnswer
    ) {
      groundingStatus =
        "blocked";

      console.warn(
        "Chat answer blocked by grounding",
        {
          requestId,

          conversationId:
            conversation.id,

          userMessageId:
            userMessage.id,

          reason:
            grounding.reason,

          requiresKnowledge:
            grounding.requiresKnowledge,

          retrievalResultCount:
            groundingRetrievalCount,

          relevantResultCount:
            groundingRelevantCount,

          sourceCount:
            groundingSourceCount,

          verifierStatus:
            groundingVerifierStatus,
        }
      );
    }

    /*
     * ========================================
     * Conversation Title
     * ========================================
     */

    const newTitle =
      !conversation.title ||
      conversation.title ===
        "گفتگوی جدید"
        ? createConversationTitle(
            content
          )
        : String(
            conversation.title
          );

    /*
     * ========================================
     * Assistant Message
     * ========================================
     */

    setStage(
      "assistant_persistence"
    );

    let assistantMessage:
      RecordModel;

    try {
      assistantMessage =
        await pb
          .collection(
            "messages"
          )
          .create({
            id:
              assistantMessageId,

            conversation:
              conversation.id,

            user:
              account.id,

            role:
              "assistant",

            reply_to:
              userMessage.id,

            content:
              answer,

            model,

            openai_response_id:
              openAIResponse.id,

            has_answer:
              hasAnswer,

            response_time_ms:
              responseTime,

            /*
             * ==================================
             * Grounding / Hallucination Metadata
             * ==================================
             */

            grounding_status:
              groundingStatus,

            grounding_gate_reason:
              grounding.reason,

            grounding_verifier_status:
              groundingVerifierStatus,

            grounding_verifier_reason:
              groundingVerifierReason
                .trim()
                .slice(
                  0,
                  1000
                ),

            grounding_unsupported_claims:
              serializeGroundingUnsupportedClaims(
                groundingUnsupportedClaims
              ),

            grounding_verifier_model:
              groundingVerifierModel
                .trim()
                .slice(
                  0,
                  200
                ),

            grounding_verifier_request_id:
              groundingVerifierRequestId
                .trim()
                .slice(
                  0,
                  128
                ),

            grounding_checked_at:
              groundingCheckedAt,

            grounding_retrieval_count:
              groundingRetrievalCount,

            grounding_relevant_count:
              groundingRelevantCount,

            grounding_source_count:
              groundingSourceCount,

            sources:
              sources.map(
                (
                  source
                ) =>
                  source.knowledgeId
              ),
          });
    } catch (error) {
      logStageError(
        requestId,
        stage,
        error,
        {
          operation:
            "create_assistant_message",
        }
      );

      try {
        const existingAssistant =
          await getExistingAssistantMessage({
            pb,

            id:
              assistantMessageId,

            conversationId:
              conversation.id,

            userId:
              account.id,
          });

        if (
          existingAssistant
        ) {
          assistantMessage =
            existingAssistant;

          sources =
            toChatMessage(
              existingAssistant
            ).sources ||
            [];
        } else {
          throw error;
        }
      } catch (
        retryError
      ) {
        logStageError(
          requestId,
          stage,
          retryError,
          {
            operation:
              "recover_assistant_message",
          }
        );

        const persistenceUsageResult =
          await recordAIUsageChecked(
            requestId,
            {
              userId:
                account.id,

              conversationId:
                conversation.id,

              requestType:
                "chat",

              reservationRequestId:
                requestId,

              model,

              latencyMs:
                responseTime,

              success:
                true,

              response:
                openAIResponse,
            }
          );

        if (
          persistenceUsageResult.ok
        ) {
          await completeChatBudgetReservationSafely({
            requestId,

            userId:
              account.id,

            usageResult:
              persistenceUsageResult,
          });
        }

        return jsonError({
          requestId,

          status:
            503,

          code:
            "ASSISTANT_MESSAGE_PERSISTENCE_FAILED",

          message:
            "پاسخ ذخیره نشد. برای تلاش دوباره، همین پیام را مجدداً ارسال کنید.",

          userMessage:
            persistedUserMessage,
        });
      }
    }

    /*
     * ========================================
     * Background Finalization
     *
     * Assistant Message در این نقطه Durable است.
     * کارهای زیر دیگر برای نمایش پاسخ به کاربر
     * لازم نیستند:
     *
     * - Conversation title
     * - last_message_at
     * - AI usage accounting
     * - Budget reservation completion
     * - Background classification
     * - Knowledge gap tracking
     *
     * اگر Background accounting دیر شود،
     * Reservation pending باقی می‌ماند و Budget
     * محافظه‌کارانه‌تر محاسبه می‌شود؛ under-count
     * ایجاد نمی‌شود.
     * ========================================
     */

    after(
      async () => {
        await Promise.allSettled([
          finalizeSuccessfulChatInBackground({
            requestId,

            userId:
              account.id,

            conversationId:
              conversation.id,

            previousTitle:
              String(
                conversation.title ||
                  ""
              ),

            newTitle,

            assistantCreated:
              String(
                assistantMessage.created ||
                  ""
              ),

            assistantMessageId:
              assistantMessage.id,

            model,

            responseTime,

            openAIResponse,
          }),

          runPostResponseTasks({
            requestId,

            userMessageId:
              userMessage.id,

            assistantMessageId:
              assistantMessage.id,

            backgroundClassification:
              topicScopedRetrievalEnabled
                ? undefined
                : {
                    question:
                      content,

                    context:
                      history,

                    userId:
                      account.id,

                    conversationId:
                      conversation.id,

                    messageId:
                      userMessage.id,
                  },
          }),
        ]);
      }
    );

    /*
     * ========================================
     * Success
     * ========================================
     */

    return successResponse({
      requestId,

      userMessage:
        persistedUserMessage,

      assistantMessage:
        toChatMessage(
          assistantMessage,
          sources
        ),

      conversationId:
        conversation.id,

      title:
        newTitle,

      responseTime,

      responseId:
        openAIResponse.id,
    });
  } catch (error) {
    logStageError(
      requestId,
      stage,
      error
    );

    return jsonError({
      requestId,

      status:
        500,

      code:
        "INTERNAL_ERROR",

      message:
        "خطای پیش‌بینی‌نشده‌ای رخ داد. دوباره تلاش کنید.",

      userMessage:
        persistedUserMessage,
    });
  } finally {
    /*
     * ========================================
     * Always Release Request Lock
     *
     * خطای Release نباید پاسخ موفق Chat را
     * به Error تبدیل کند.
     * ========================================
     */

    if (
      lockAcquired &&
      lockedUserId
    ) {
      setStage(
        "request_lock"
      );

      try {
        await releaseChatRequestLock({
          userId:
            lockedUserId,

          requestId,
        });
      } catch (error) {
        logStageError(
          requestId,
          "request_lock",
          error,
          {
            operation:
              "release_request_lock",
          }
        );
      }
    }

    latencyProfiler.finish({
      finalStage:
        stage,

      lockAcquired,

      hasPersistedUserMessage:
        Boolean(
          persistedUserMessage
        ),
    });
  }
}

/*
 * ============================================
 * Budget Limit Message
 * ============================================
 */

function getBudgetLimitMessage(
  code:
    AIBudgetLimitCode
) {
  switch (code) {
    case "AI_DAILY_TOKEN_LIMIT_REACHED":
      return "سقف مصرف روزانه هوش مصنوعی شما به پایان رسیده است. فردا دوباره می‌توانید از دستیار استفاده کنید.";

    case "AI_MONTHLY_TOKEN_LIMIT_REACHED":
      return "سقف مصرف ماهانه هوش مصنوعی شما به پایان رسیده است.";

    case "AI_DAILY_COST_LIMIT_REACHED":
      return "سقف هزینه روزانه هوش مصنوعی برای حساب شما به پایان رسیده است. فردا دوباره می‌توانید از دستیار استفاده کنید.";

    case "AI_MONTHLY_COST_LIMIT_REACHED":
      return "سقف هزینه ماهانه هوش مصنوعی برای حساب شما به پایان رسیده است.";
    case "AI_COST_ACCOUNTING_UNAVAILABLE":
      return "محاسبه هزینه مصرف هوش مصنوعی موقتاً کامل نیست. کمی بعد دوباره تلاش کنید.";
  }
}

/*
 * ============================================
 * AI Usage Accounting
 *
 * Usage persistence نباید silently نادیده
 * گرفته شود.
 *
 * اگر Sync persistence شکست بخورد:
 *
 * 1. Error ثبت می‌شود.
 * 2. یک Retry پس از Response زمان‌بندی می‌شود،
 *    ولی فقط وقتی OpenAI Request ID قابل
 *    بازیابی باشد تا Retry idempotent بماند.
 *
 * Result=false به Caller برمی‌گردد تا مسیر
 * Success بتواند Warning نشان دهد.
 * ============================================
 */

async function recordAIUsageChecked(
  requestId:
    string,

  params:
    Parameters<
      typeof recordAIUsage
    >[0]
) {
  const result =
    await recordAIUsage(
      params
    );

  if (
    result.ok
  ) {
    return result;
  }

  console.error(
    "AI usage accounting failed",
    {
      requestId,

      requestType:
        params.requestType,

      model:
        String(
          params.model ||
            ""
        )
          .trim()
          .slice(
            0,
            120
          ),

      success:
        params.success,

      error:
        getErrorMetadata(
          result.error
        ),
    }
  );

  /*
   * Background retry فقط وقتی امن است که
   * deterministic OpenAI request identifier
   * داریم.
   *
   * recordAIUsage با همان ID duplicate-safe
   * است.
   */

  if (
    params.response ||
    params.requestId
  ) {
    after(
      async () => {
        const retry =
          await recordAIUsage(
            params
          );

        if (
          !retry.ok
        ) {
          console.error(
            "AI usage background retry failed",
            {
              requestId,

              requestType:
                params.requestType,

              model:
                String(
                  params.model ||
                    ""
                )
                  .trim()
                  .slice(
                    0,
                    120
                  ),

              success:
                params.success,

              error:
                getErrorMetadata(
                  retry.error
                ),
            }
          );
        }
      }
    );
  }

  return result;
}

/*
 * ============================================
 * Persistent Budget Reservation Helpers
 * ============================================
 */

async function completeChatBudgetReservationSafely({
  requestId,
  userId,
  usageResult,
}: {
  requestId:
    string;

  userId:
    string;

  usageResult:
    Extract<
      Awaited<
        ReturnType<
          typeof recordAIUsage
        >
      >,
      {
        ok:
          true;
      }
    >;
}) {
  try {
    await completeAIBudgetReservation({
      userId,

      requestId,

      actualTokens:
        usageResult.snapshot.totalTokens,

      actualCostUsd:
        usageResult.estimatedCostUsd,

      usageRecordId:
        usageResult.recordId,
    });

    return true;
  } catch (error) {
    console.error(
      "AI budget reservation completion failed",
      {
        requestId,

        userId,

        usageRecordId:
          usageResult.recordId,

        error:
          getErrorMetadata(
            error
          ),
      }
    );

    /*
     * ai_usage قبلاً ثبت شده است. Pending ماندن
     * Reservation فقط موقتاً Budget را محافظه‌کارانه
     * بیشتر اشغال می‌کند و under-count ایجاد نمی‌کند.
     */
    return false;
  }
}

async function cancelChatBudgetReservationSafely({
  requestId,
  userId,
  errorCode,
}: {
  requestId:
    string;

  userId:
    string;

  errorCode:
    string;
}) {
  try {
    await cancelAIBudgetReservation({
      userId,

      requestId,

      errorCode,
    });
  } catch (error) {
    console.error(
      "AI budget reservation cancellation failed",
      {
        requestId,

        userId,

        errorCode,

        error:
          getErrorMetadata(
            error
          ),
      }
    );
  }
}

function safeBudgetInteger(
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

  return Math.max(
    0,
    Math.min(
      Number.MAX_SAFE_INTEGER,
      Math.trunc(
        value
      )
    )
  );
}

/*
 * ============================================
 * Successful Chat Background Finalization
 * ============================================
 */

async function finalizeSuccessfulChatInBackground({
  requestId,
  userId,
  conversationId,
  previousTitle,
  newTitle,
  assistantCreated,
  assistantMessageId,
  model,
  responseTime,
  openAIResponse,
}: {
  requestId:
    string;

  userId:
    string;

  conversationId:
    string;

  previousTitle:
    string;

  newTitle:
    string;

  assistantCreated:
    string;

  assistantMessageId:
    string;

  model:
    string;

  responseTime:
    number;

  openAIResponse:
  OpenAI.Responses.Response;
}) {
  let pb:
    PocketBase |
    null =
      null;

  try {
    pb =
      await getPocketBaseServiceClient();
  } catch (error) {
    console.error(
      "Chat background finalization service client failed",
      {
        requestId,

        conversationId,

        error:
          getErrorMetadata(
            error
          ),
      }
    );
  }

  /*
   * Conversation metadata is best-effort.
   */
  if (
    pb
  ) {
    const updates:
      Record<
        string,
        string
      > = {};

    if (
      newTitle !==
      previousTitle
    ) {
      updates.title =
        newTitle;
    }

    if (
      assistantCreated
    ) {
      updates.last_message_at =
        assistantCreated;
    }

    if (
      Object.keys(
        updates
      ).length >
      0
    ) {
      try {
        await pb
          .collection(
            "conversations"
          )
          .update(
            conversationId,
            updates
          );
      } catch (error) {
        console.error(
          "Chat background conversation update failed",
          {
            requestId,

            conversationId,

            error:
              getErrorMetadata(
                error
              ),
          }
        );
      }
    }
  }

  /*
   * Usage accounting remains idempotent because
   * OpenAI response/request identifiers are passed.
   */
  const usageResult =
    await recordAIUsageChecked(
      requestId,
      {
        userId,

        conversationId,

        messageId:
          assistantMessageId,

        requestType:
          "chat",

        reservationRequestId:
          requestId,

        model,

        latencyMs:
          responseTime,

        success:
          true,

        response:
          openAIResponse,
      }
    );

  if (
    usageResult.ok
  ) {
    await completeChatBudgetReservationSafely({
      requestId,

      userId,

      usageResult,
    });
  }
}

/*
 * ============================================
 * Post-response Tasks
 * ============================================
 */

async function runPostResponseTasks({
  requestId,
  userMessageId,
  assistantMessageId,
  backgroundClassification,
}: {
  requestId:
    string;

  userMessageId:
    string;

  assistantMessageId:
    string;

  backgroundClassification?: {
    question:
      string;

    context:
      ChatInputItem[];

    userId:
      string;

    conversationId:
      string;

    messageId:
      string;
  };
}) {
  /*
   * Classification قبل از Knowledge Gap انجام
   * می‌شود تا Gap بتواند Topic ذخیره‌شده پیام را
   * ببیند.
   */

  if (
    backgroundClassification
  ) {
    try {
      const classification =
        await classifyUserMessage({
          question:
            backgroundClassification.question,

          context:
            backgroundClassification.context,

          userId:
            backgroundClassification.userId,

          conversationId:
            backgroundClassification.conversationId,

          messageId:
            backgroundClassification.messageId,
        });

      console.info(
        "Background topic classification completed",
        {
          requestId,

          conversationId:
            backgroundClassification.conversationId,

          messageId:
            backgroundClassification.messageId,

          status:
            classification.status,

          topicId:
            classification.topicId,
        }
      );
    } catch (error) {
      console.error(
        "Background topic classification failed",
        {
          requestId,

          conversationId:
            backgroundClassification.conversationId,

          messageId:
            backgroundClassification.messageId,

          error:
            getErrorMetadata(error),
        }
      );
    }
  }

  try {
    const result =
      await trackKnowledgeGap({
        userMessageId,

        assistantMessageId,
      });

    if (
      result.tracked
    ) {
      console.log(
        "Knowledge gap tracked",
        {
          requestId,

          gapId:
            result.gapId,

          occurrenceId:
            result.occurrenceId,
        }
      );
    }
  } catch (error) {
    console.error(
      "Knowledge gap tracking failed",
      {
        requestId,

        userMessageId,

        assistantMessageId,

        error:
          getErrorMetadata(
            error
          ),
      }
    );
  }
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
          // Ignore cancel error.
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
 * Chat Reservation Estimate
 *
 * JSON Request شامل instructions، history،
 * file_search configuration و سایر metadataها
 * در UTF-8 serialize می‌شود. تعداد Byteها
 * upper bound محافظه‌کارانه‌ای برای Tokenهاست.
 * ============================================
 */

function estimateChatReservationInputTokens({
  model,
  assistantInstructions,
  input,
  vectorStoreId,
  maxResults,
  minScore,
  fileSearchFilter,
}: {
  model:
    string;

  assistantInstructions:
    string;

  input:
    ChatInputItem[];

  vectorStoreId:
    string;

  maxResults:
    number;

  minScore:
    number;

  fileSearchFilter:
    ReturnType<
      typeof buildChatFileSearchFilter
    >;
}) {
  const serialized =
    JSON.stringify({
      model,

      instructions:
        assistantInstructions,

      input,

      tools: [
        {
          type:
            "file_search",

          vector_store_ids: [
            vectorStoreId,
          ],

          max_num_results:
            maxResults,

          filters:
            fileSearchFilter,

          ranking_options: {
            score_threshold:
              minScore,
          },
        },
      ],

      include: [
        "file_search_call.results",
      ],

      reasoning: {
        effort:
          "none",
      },

      text: {
        verbosity:
          "low",
      },

      store:
        false,
    });

  const estimated =
    estimateUtf8TokenUpperBound(
      serialized
    );

  return Math.min(
    Number.MAX_SAFE_INTEGER,
    estimated +
      CHAT_RESERVATION_OVERHEAD_TOKENS
  );
}

/*
 * ============================================
 * Dynamic Assistant Instructions
 *
 * تاریخ و زمان در هر Request از Server گرفته
 * می‌شود و هیچ مقداری Hardcode نمی‌شود.
 * ============================================
 */

function buildAssistantInstructions() {
  const currentDateTime =
    getCurrentDateTimeContext();

  return `${ASSISTANT_INSTRUCTIONS_BASE}

زمان جاری سیستم:
- منطقه زمانی: ${currentDateTime.timezone}
- تاریخ شمسی: ${currentDateTime.persian}
- تاریخ میلادی: ${currentDateTime.gregorian}

این اطلاعات زمان جاری قطعی این درخواست هستند.
برای سؤال‌هایی مثل «امروز چندشنبه است؟»، «تاریخ امروز چیست؟» یا «الان ساعت چند است؟» فقط از اطلاعات بالا استفاده کن.
`;
}

/*
 * ============================================
 * Current Date / Time
 * ============================================
 */

function getCurrentDateTimeContext() {
  const now =
    new Date();

  const timezone =
    getAppTimezone();

  const formatOptions:
    Intl.DateTimeFormatOptions = {
    timeZone:
      timezone,

    weekday:
      "long",

    year:
      "numeric",

    month:
      "long",

    day:
      "numeric",

    hour:
      "2-digit",

    minute:
      "2-digit",

    second:
      "2-digit",

    hourCycle:
      "h23",
  };

  const persian =
    new Intl.DateTimeFormat(
      "fa-IR-u-ca-persian",
      formatOptions
    ).format(
      now
    );

  const gregorian =
    new Intl.DateTimeFormat(
      "fa-IR-u-ca-gregory",
      formatOptions
    ).format(
      now
    );

  return {
    timezone,

    persian,

    gregorian,
  };
}

/*
 * ============================================
 * Topic-scoped Retrieval Feature Flag
 *
 * Default = true
 * ============================================
 */

function isChatTopicScopedRetrievalEnabled() {
  const value =
    process.env
      .CHAT_TOPIC_SCOPED_RETRIEVAL_ENABLED
      ?.trim()
      .toLowerCase();

  if (
    !value
  ) {
    return true;
  }

  return ![
    "0",
    "false",
    "no",
    "off",
  ].includes(
    value
  );
}

/*
 * ============================================
 * Application Timezone
 * ============================================
 */

function getAppTimezone() {
  const requested =
    process.env
      .APP_TIMEZONE
      ?.trim() ||
    "Asia/Tehran";

  try {
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone:
          requested,
      }
    ).format(
      new Date()
    );

    return requested;
  } catch {
    return "Asia/Tehran";
  }
}

/*
 * ============================================
 * Bounded AI History
 *
 * جدیدترین Context اولویت دارد، اما خروجی
 * با ترتیب زمانی قدیم → جدید برگردانده می‌شود.
 * ============================================
 */

function buildBoundedHistory(
  items:
    RecordModel[],

  excludedMessageId:
    string
): ChatInputItem[] {
  /*
   * Query با sort=-created آمده است:
   * جدید → قدیم
   */
  const candidates =
    items.filter(
      (
        item
      ) =>
        item.id !==
          excludedMessageId &&
        (
          item.role ===
            "user" ||
          item.role ===
            "assistant"
        )
    );

  const selected:
    ChatInputItem[] = [];

  let characters =
    0;

  /*
   * چون candidates جدید → قدیم است،
   * از ابتدا جدیدترین‌ها را انتخاب می‌کنیم.
   *
   * با unshift خروجی نهایی قدیم → جدید می‌شود.
   */
  for (
    const item of
    candidates
  ) {
    const itemContent =
      String(
        item.content ||
          ""
      )
        .trim()
        .slice(
          0,
          MAX_HISTORY_ITEM_LENGTH
        );

    if (
      !itemContent
    ) {
      continue;
    }

    if (
      characters +
        itemContent.length >
      MAX_HISTORY_CHARACTERS
    ) {
      break;
    }

    characters +=
      itemContent.length;

    selected.unshift({
      role:
        item.role ===
        "assistant"
          ? "assistant"
          : "user",

      content:
        itemContent,
    });
  }

  return selected;
}

/*
 * ============================================
 * Request Helpers
 * ============================================
 */

function getMessageContent(
  body:
    unknown
) {
  if (
    typeof body !==
      "object" ||
    body ===
      null ||
    !(
      "content" in
      body
    )
  ) {
    return "";
  }

  const value =
    (
      body as {
        content?:
          unknown;
      }
    ).content;

  if (
    typeof value !==
    "string"
  ) {
    return "";
  }

  return value.trim();
}

function getClientMessageId(
  body:
    unknown
) {
  if (
    typeof body !==
      "object" ||
    body ===
      null
  ) {
    return null;
  }

  if (
    !(
      "clientMessageId" in
      body
    )
  ) {
    return createMessageId(
      "u"
    );
  }

  const value =
    (
      body as {
        clientMessageId?:
          unknown;
      }
    ).clientMessageId;

  if (
    typeof value !==
    "string"
  ) {
    return null;
  }

  const id =
    value.trim();

  return CLIENT_MESSAGE_ID_PATTERN.test(
    id
  )
    ? id
    : null;
}

function createMessageId(
  prefix:
    | "u"
    | "a"
) {
  return `${prefix}${crypto
    .randomUUID()
    .replace(
      /-/g,
      ""
    )
    .slice(
      0,
      14
    )}`;
}

function getAssistantMessageId(
  clientMessageId:
    string
) {
  return `a${clientMessageId.slice(
    1
  )}`;
}

/*
 * ============================================
 * User Message Persistence
 * ============================================
 */

async function getOrCreateUserMessage({
  pb,
  id,
  conversationId,
  userId,
  content,
}: {
  pb:
    PocketBase;

  id:
    string;

  conversationId:
    string;

  userId:
    string;

  content:
    string;
}) {
  try {
    const record =
      await pb
        .collection(
          "messages"
        )
        .create({
          id,

          conversation:
            conversationId,

          user:
            userId,

          role:
            "user",

          content,

          topic:
            "",

          topic_confidence:
            0,

          classification_status:
            "pending",
        });

    return {
      record,

      created:
        true,
    };
  } catch (
    createError
  ) {
    try {
      const existing =
        await pb
          .collection(
            "messages"
          )
          .getOne(
            id
          );

      if (
        existing.role ===
          "user" &&
        existing.conversation ===
          conversationId &&
        existing.user ===
          userId &&
        String(
          existing.content ||
            ""
        ) ===
          content
      ) {
        return {
          record:
            existing,

          created:
            false,
        };
      }
    } catch {
      // Keep original create error.
    }

    /*
     * Compatibility fallback:
     *
     * اگر Classification fields هنوز در
     * PocketBase وجود نداشته باشند.
     */

    try {
      const record =
        await pb
          .collection(
            "messages"
          )
          .create({
            id,

            conversation:
              conversationId,

            user:
              userId,

            role:
              "user",

            content,
          });

      return {
        record,

        created:
          true,
      };
    } catch {
      // Throw original error below.
    }

    throw createError;
  }
}

/*
 * ============================================
 * Existing User
 * ============================================
 */

async function getExistingUserMessage({
  pb,
  id,
  conversationId,
  userId,
  content,
}: {
  pb:
    PocketBase;

  id:
    string;

  conversationId:
    string;

  userId:
    string;

  content:
    string;
}) {
  let existing:
    RecordModel;

  try {
    existing =
      await pb
        .collection(
          "messages"
        )
        .getOne(
          id
        );
  } catch (error) {
    if (
      getErrorMetadata(
        error
      ).status ===
      404
    ) {
      return null;
    }

    throw error;
  }

  if (
    existing.role !==
      "user" ||
    existing.conversation !==
      conversationId ||
    existing.user !==
      userId ||
    String(
      existing.content ||
        ""
    ) !==
      content
  ) {
    throw new Error(
      "The idempotent user message does not match the current request."
    );
  }

  return existing;
}

/*
 * ============================================
 * Existing Assistant
 * ============================================
 */

async function getExistingAssistantMessage({
  pb,
  id,
  conversationId,
  userId,
}: {
  pb:
    PocketBase;

  id:
    string;

  conversationId:
    string;

  userId:
    string;
}) {
  let existing:
    RecordModel;

  try {
    existing =
      await pb
        .collection(
          "messages"
        )
        .getOne(
          id,
          {
            expand:
              "sources",
          }
        );
  } catch (error) {
    if (
      getErrorMetadata(
        error
      ).status ===
      404
    ) {
      return null;
    }

    throw error;
  }

  if (
    existing.role !==
      "assistant" ||
    existing.conversation !==
      conversationId ||
    existing.user !==
      userId
  ) {
    throw new Error(
      "The idempotent assistant message does not match the current conversation."
    );
  }

  return existing;
}

/*
 * ============================================
 * Knowledge Sources
 * ============================================
 */

async function resolveKnowledgeSources(
  pb:
    PocketBase,

  results:
    ChatRetrievalResult[]
) {
  const knowledgeIds = [
    ...new Set(
      results
        .map(
          (
            result
          ) =>
            result.knowledgeId
        )
        .filter(
          (
            id
          ): id is string =>
            Boolean(
              id
            )
        )
    ),
  ];

  if (
    knowledgeIds.length ===
    0
  ) {
    return [];
  }

  const filterValues:
    Record<
      string,
      string
    > = {
    status:
      "published",
  };

  const idClauses =
    knowledgeIds.map(
      (
        id,
        index
      ) => {
        const key =
          `id${index}`;

        filterValues[
          key
        ] =
          id;

        return `id = {:${key}}`;
      }
    );

  const records =
    await pb
      .collection(
        "knowledge_items"
      )
      .getFullList({
        filter:
          pb.filter(
            `status = {:status} && (${idClauses.join(
              " || "
            )})`,

            filterValues
          ),

        fields:
          "id,title,status",
      });

  const recordsById =
    new Map(
      records.map(
        (
          record
        ) => [
          record.id,
          record,
        ]
      )
    );

  const sources:
    ChatSource[] =
    [];

  for (
    const result of
    results
  ) {
    const knowledgeId =
      result.knowledgeId;

    const record =
      knowledgeId
        ? recordsById.get(
            knowledgeId
          )
        : undefined;

    const title =
      String(
        record?.title ||
          ""
      ).trim();

    if (
      !knowledgeId ||
      !record ||
      !title
    ) {
      continue;
    }

    sources.push({
      knowledgeId,

      title,

      ...(result.filename
        ? {
            filename:
              result.filename,
          }
        : {}),
    });
  }

  return sources;
}

/*
 * ============================================
 * Grounding Unsupported Claims
 *
 * Field در PocketBase از نوع Text است.
 * JSON معتبر و حداکثر 4000 نویسه ذخیره
 * می‌کنیم.
 * ============================================
 */

function serializeGroundingUnsupportedClaims(
  claims:
    string[]
) {
  const normalized =
    [
      ...new Set(
        claims
          .map(
            (
              claim
            ) =>
              String(
                claim ||
                  ""
              )
                .replace(
                  /[\u0000-\u001f\u007f]/g,
                  " "
                )
                .replace(
                  /\s+/g,
                  " "
                )
                .trim()
                .slice(
                  0,
                  450
                )
          )
          .filter(
            Boolean
          )
      ),
    ]
      .slice(
        0,
        8
      );

  while (
    normalized.length >
    0
  ) {
    const serialized =
      JSON.stringify(
        normalized
      );

    if (
      serialized.length <=
      4000
    ) {
      return serialized;
    }

    normalized.pop();
  }

  return "[]";
}

/*
 * ============================================
 * Conversation Title
 * ============================================
 */

function createConversationTitle(
  content:
    string
) {
  const normalized =
    content
      .replace(
        /\s+/g,
        " "
      )
      .trim();

  const maxLength =
    45;

  if (
    normalized.length <=
    maxLength
  ) {
    return normalized;
  }

  return `${normalized
    .slice(
      0,
      maxLength
    )
    .trim()}...`;
}

/*
 * ============================================
 * OpenAI Error
 * ============================================
 */

function openAIErrorResponse(
  requestId:
    string,

  error:
    unknown,

  userMessage:
    ChatMessage
) {
  const metadata =
    getErrorMetadata(
      error
    );

  if (
    metadata.status ===
    429
  ) {
    return jsonError({
      requestId,

      status:
        429,

      code:
        "OPENAI_RATE_LIMITED",

      message:
        "ظرفیت سرویس هوش مصنوعی موقتاً تکمیل است. کمی بعد دوباره تلاش کنید.",

      upstreamRequestId:
        metadata.requestId,

      userMessage,
    });
  }

  if (
    metadata.status ===
      401 ||
    metadata.status ===
      403
  ) {
    return jsonError({
      requestId,

      status:
        503,

      code:
        "OPENAI_AUTH_ERROR",

      message:
        "تنظیمات دسترسی سرویس هوش مصنوعی معتبر نیست.",

      upstreamRequestId:
        metadata.requestId,

      userMessage,
    });
  }

  if (
    metadata.status ===
      400 ||
    metadata.status ===
      404
  ) {
    return jsonError({
      requestId,

      status:
        502,

      code:
        "OPENAI_REQUEST_REJECTED",

      message:
        "سرویس هوش مصنوعی درخواست را نپذیرفت. تنظیمات مدل و پایگاه دانش را بررسی کنید.",

      upstreamRequestId:
        metadata.requestId,

      userMessage,
    });
  }

  return jsonError({
    requestId,

    status:
      503,

    code:
      "OPENAI_UNAVAILABLE",

    message:
      "سرویس هوش مصنوعی موقتاً در دسترس نیست. دوباره تلاش کنید.",

    upstreamRequestId:
      metadata.requestId,

    userMessage,
  });
}

/*
 * ============================================
 * Success Response
 * ============================================
 */

function successResponse({
  requestId,
  userMessage,
  assistantMessage,
  conversationId,
  title,
  responseTime,
  responseId,
  warning,
  warningCode,
}: {
  requestId:
    string;

  userMessage:
    ChatMessage;

  assistantMessage:
    ChatMessage;

  conversationId:
    string;

  title:
    string;

  responseTime:
    number;

  responseId:
    string;

  warning?:
    string;

  warningCode?:
    string;
}) {
  return NextResponse.json(
    {
      success:
        true,

      userMessage,

      assistantMessage,

      conversation: {
        id:
          conversationId,

        title,
      },

      warning,

      warningCode,

      meta: {
        requestId,

        responseTimeMs:
          responseTime,

        responseId,
      },
    },
    {
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

function jsonError({
  requestId,
  status,
  code,
  message,
  upstreamRequestId,
  userMessage,
  retryAfterSeconds,
}: {
  requestId:
    string;

  status:
    number;

  code:
    string;

  message:
    string;

  upstreamRequestId?:
    string;

  userMessage?:
    ChatMessage;

  retryAfterSeconds?:
    number;
}) {
  const headers:
    Record<
      string,
      string
    > = {
    "X-Request-Id":
      requestId,

    "Cache-Control":
      "no-store",

    "Pragma":
      "no-cache",
  };

  if (
    retryAfterSeconds &&
    retryAfterSeconds >
      0
  ) {
    headers[
      "Retry-After"
    ] =
      String(
        Math.ceil(
          retryAfterSeconds
        )
      );
  }

  return NextResponse.json(
    {
      success:
        false,

      code,

      message,

      requestId,

      upstreamRequestId,

      ...(retryAfterSeconds
        ? {
            retryAfterSeconds:
              Math.ceil(
                retryAfterSeconds
              ),
          }
        : {}),

      ...(userMessage
        ? {
            userMessage,
          }
        : {}),
    },
    {
      status,

      headers,
    }
  );
}

/*
 * ============================================
 * Logging
 * ============================================
 */

function logStageError(
  requestId:
    string,

  stage:
    ChatStage,

  error:
    unknown,

  context?:
    Record<
      string,
      unknown
    >
) {
  console.error(
    "Chat API error",
    {
      requestId,

      stage,

      ...context,

      error:
        getErrorMetadata(
          error
        ),
    }
  );
}

/*
 * ============================================
 * Error Metadata
 * ============================================
 */

function getErrorMetadata(
  error:
    unknown
): ErrorMetadata {
  if (
    typeof error !==
      "object" ||
    error ===
      null
  ) {
    return {
      message:
        String(
          error
        ),
    };
  }

  const value =
    error as {
      name?: unknown;
      message?: unknown;
      status?: unknown;
      code?: unknown;
      type?: unknown;
      request_id?: unknown;
      response?: unknown;
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
      "string"
        ? value.code
        : undefined,

    type:
      typeof value.type ===
      "string"
        ? value.type
        : undefined,

    requestId:
      typeof value.request_id ===
      "string"
        ? value.request_id
        : undefined,

    response:
      value.response,
  };
}