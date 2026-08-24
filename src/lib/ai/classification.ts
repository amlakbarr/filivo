import {
  randomUUID,
} from "node:crypto";

import { zodTextFormat } from "openai/helpers/zod";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { z } from "zod";

import {
  completeAIBudgetReservation,
  createAIBudgetReservation,
} from "@/lib/ai/budget-reservation";

import {
  checkAIBudgetGuard,
} from "@/lib/ai/budget-guard";

import {
  getOpenAIClassifierModel,
  getOpenAIClient,
} from "@/lib/ai/openai";

import {
  calculateReservedTokenCost,
  estimateUtf8TokenUpperBound,
  getActiveModelPricing,
  recordAIUsage,
} from "@/lib/ai/usage";

import {
  getPocketBaseServiceClient,
} from "@/lib/pocketbase/service";

/*
 * ============================================
 * Limits
 * ============================================
 */

const MAX_TOPIC_CANDIDATES =
  100;

const MAX_CONTEXT_MESSAGES =
  4;

const MAX_CONTEXT_LENGTH =
  300;

const MAX_QUESTION_LENGTH =
  4000;

const MAX_TOPIC_NAME_LENGTH =
  160;

const MAX_DESCRIPTION_LENGTH =
  200;

const DEFAULT_MIN_CONFIDENCE =
  0.65;

const CLASSIFICATION_MAX_OUTPUT_TOKENS =
  200;

const CLASSIFICATION_RESERVATION_OVERHEAD_TOKENS =
  256;

const RECORD_ID_PATTERN =
  /^[a-zA-Z0-9_-]{1,64}$/;

/*
 * ============================================
 * Output Schema
 * ============================================
 */

const ClassificationOutputSchema =
  z
    .object({
      matched:
        z.boolean(),

      topic_id:
        z
          .string()
          .nullable(),

      confidence:
        z
          .number()
          .min(0)
          .max(1),
    })
    .strict();

/*
 * ============================================
 * Types
 * ============================================
 */

export type ClassificationContextMessage = {
  role:
    | "user"
    | "assistant";

  content:
    string;
};

export type TopicClassificationResult =
  | {
      status:
        "classified";

      topicId:
        string;

      confidence:
        number;

      model:
        string;
    }
  | {
      status:
        "unclassified";

      topicId:
        null;

      confidence:
        number;

      model?:
        string;
    }
  | {
      status:
        "error";

      topicId:
        null;

      confidence:
        0;

      model?:
        string;
    }
  | {
      status:
        "skipped";

      topicId:
        string |
        null;

      confidence:
        number;

      model?:
        string;
    };

type TopicCandidate = {
  id:
    string;

  name:
    string;

  parentId:
    string |
    null;

  parentName:
    string |
    null;

  description:
    string |
    null;

  isLeaf:
    boolean;
};

/*
 * ============================================
 * Main Classification
 * ============================================
 */

export async function classifyUserMessage({
  question,
  context,
  userId,
  conversationId,
  messageId,
}: {
  question:
    string;

  context:
    ClassificationContextMessage[];

  userId:
    string;

  conversationId:
    string;

  messageId:
    string;
}): Promise<TopicClassificationResult> {
  const cleanUserId =
    cleanRecordId(
      userId
    );

  const cleanConversationId =
    cleanRecordId(
      conversationId
    );

  const cleanMessageId =
    cleanRecordId(
      messageId
    );

  const cleanQuestion =
    normalizeText(
      question,
      MAX_QUESTION_LENGTH
    );

  if (
    !cleanUserId ||
    !cleanConversationId ||
    !cleanMessageId ||
    !cleanQuestion
  ) {
    logClassificationError(
      cleanMessageId ||
        "invalid",
      new Error(
        "Invalid classification input"
      ),
      {
        stage:
          "validation",
      }
    );

    return {
      status:
        "error",

      topicId:
        null,

      confidence:
        0,
    };
  }

  let pb:
    PocketBase |
    undefined;

  try {
    pb =
      await getPocketBaseServiceClient();

    /*
     * ========================================
     * Message Ownership + Idempotency
     *
     * چون Service Client Ruleها را bypass می‌کند،
     * پیام باید صریحاً متعلق به همان User و
     * Conversation و از نوع user باشد.
     * ========================================
     */

    const message =
      await getOwnedUserMessage({
        pb,

        messageId:
          cleanMessageId,

        userId:
          cleanUserId,

        conversationId:
          cleanConversationId,
      });

    if (
      !message
    ) {
      logClassificationError(
        cleanMessageId,
        new Error(
          "Classification message was not found or is not owned by the user"
        ),
        {
          stage:
            "ownership",
        }
      );

      return {
        status:
          "error",

        topicId:
          null,

        confidence:
          0,
      };
    }

    const currentStatus =
      String(
        message.classification_status ||
          ""
      );

    /*
     * classified / unclassified نهایی هستند.
     *
     * error عمداً Terminal نیست تا خطای موقت
     * OpenAI/PocketBase در Retry بعدی قابل
     * بازیابی باشد.
     */
    if (
      isTerminalStatus(
        currentStatus
      )
    ) {
      return {
        status:
          "skipped",

        topicId:
          cleanRecordId(
            message.topic
          ) ||
          null,

        confidence:
          clampConfidence(
            message.topic_confidence
          ),
      };
    }

    /*
     * ========================================
     * Candidates
     * ========================================
     */

    const candidates =
      await getActiveTopics(
        pb
      );

    if (
      candidates.length ===
      0
    ) {
      await updateMessageClassification(
        pb,
        cleanMessageId,
        {
          topic:
            "",

          topic_confidence:
            0,

          classification_status:
            "unclassified",
        }
      );

      return {
        status:
          "unclassified",

        topicId:
          null,

        confidence:
          0,
      };
    }

    /*
     * ========================================
     * Reservation-aware AI Budget Guard
     *
     * Classification یک AI Call مستقل است.
     * ورودی واقعی Classifier قبل از Guard ساخته
     * می‌شود تا projected usage بررسی شود.
     * ========================================
     */

    const model =
      getOpenAIClassifierModel();

    const classifierInput =
      buildClassifierInput(
        cleanQuestion,
        context,
        candidates
      );

    const reservationInputTokens =
      estimateClassificationReservationInputTokens(
        classifierInput
      );

    try {
      const budgetGuard =
        await checkAIBudgetGuard({
          userId:
            cleanUserId,

          reservation: {
            model,

            inputTokens:
              reservationInputTokens,

            outputTokens:
              CLASSIFICATION_MAX_OUTPUT_TOKENS,
          },
        });

      if (
        !budgetGuard.allowed
      ) {
        await markClassificationErrorSafely(
          pb,
          cleanMessageId
        );

        console.warn(
          "Topic classification skipped by AI budget guard",
          {
            messageId:
              cleanMessageId,

            userId:
              cleanUserId,

            code:
              budgetGuard.code,

            retryAfterSeconds:
              budgetGuard.retryAfterSeconds,
          }
        );

        return {
          status:
            "error",

          topicId:
            null,

          confidence:
            0,

          model,
        };
      }
    } catch (error) {
      await markClassificationErrorSafely(
        pb,
        cleanMessageId
      );

      logClassificationError(
        cleanMessageId,
        error,
        {
          stage:
            "budget_guard",
        }
      );

      return {
        status:
          "error",

        topicId:
          null,

        confidence:
          0,

        model,
      };
    }

    /*
     * ========================================
     * Persistent AI Budget Reservation
     *
     * Budget Guard ظرفیت را بررسی کرده است.
     * حالا قبل از OpenAI همان ظرفیت به‌صورت
     * pending داخل PocketBase رزرو می‌شود.
     *
     * برای هر Classification attempt یک Request
     * ID مستقل ساخته می‌شود؛ بنابراین Retry بعدی
     * با Reservation cancelled/expired قبلی برخورد
     * نمی‌کند.
     * ========================================
     */

    const reservationRequestId =
      createClassificationReservationRequestId();

    const reservedTokens =
      safeBudgetInteger(
        reservationInputTokens +
          CLASSIFICATION_MAX_OUTPUT_TOKENS
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
                CLASSIFICATION_MAX_OUTPUT_TOKENS,
            },
            pricing
          );
      }
    } catch (error) {
      await markClassificationErrorSafely(
        pb,
        cleanMessageId
      );

      logClassificationError(
        cleanMessageId,
        error,
        {
          stage:
            "budget_reservation_pricing",
        }
      );

      return {
        status:
          "error",

        topicId:
          null,

        confidence:
          0,

        model,
      };
    }

    try {
      const reservationResult =
        await createAIBudgetReservation({
          userId:
            cleanUserId,

          conversationId:
            cleanConversationId,

          requestId:
            reservationRequestId,

          requestType:
            "classification",

          model,

          reservedTokens,

          reservedCostUsd,
        });

      /*
       * Random request id باعث می‌شود این حالت
       * در مسیر عادی رخ ندهد؛ Defense in depth.
       */
      if (
        !reservationResult.created &&
        reservationResult.reservation.status ===
          "completed"
      ) {
        await markClassificationErrorSafely(
          pb,
          cleanMessageId
        );

        logClassificationError(
          cleanMessageId,
          new Error(
            "Classification budget reservation was already completed"
          ),
          {
            stage:
              "budget_reservation",

            reservationRequestId,
          }
        );

        return {
          status:
            "error",

          topicId:
            null,

          confidence:
            0,

          model,
        };
      }
    } catch (error) {
      await markClassificationErrorSafely(
        pb,
        cleanMessageId
      );

      logClassificationError(
        cleanMessageId,
        error,
        {
          stage:
            "budget_reservation",

          reservationRequestId,
        }
      );

      return {
        status:
          "error",

        topicId:
          null,

        confidence:
          0,

        model,
      };
    }

    /*
     * ========================================
     * OpenAI
     *
     * اگر Call با Exception تمام شود و Usage
     * قطعی در Response نداشته باشیم، Reservation
     * عمداً pending می‌ماند تا TTL تمام شود.
     * این رفتار محافظه‌کارانه جلوی under-count را
     * می‌گیرد.
     * ========================================
     */

    const startedAt =
      Date.now();

    let response:
      Awaited<
        ReturnType<
          typeof createClassificationResponse
        >
      >;

    try {
      response =
        await createClassificationResponse(
          model,
          classifierInput
        );
    } catch (error) {
      const latencyMs =
        Date.now() -
        startedAt;

      await markClassificationErrorSafely(
        pb,
        cleanMessageId
      );

      await recordClassificationUsageChecked(
        {
          userId:
            cleanUserId,

          conversationId:
            cleanConversationId,

          messageId:
            cleanMessageId,

          requestType:
            "classification",

          reservationRequestId:
            reservationRequestId,

          model,

          latencyMs,

          success:
            false,

          requestId:
            getErrorMetadata(
              error
            ).requestId,

          error,
        },
        {
          messageId:
            cleanMessageId,

          stage:
            "openai_usage",
        }
      );

      logClassificationError(
        cleanMessageId,
        error,
        {
          stage:
            "openai",
        }
      );

      return {
        status:
          "error",

        topicId:
          null,

        confidence:
          0,

        model,
      };
    }

    const latencyMs =
      Date.now() -
      startedAt;

    const parsed =
      response.output_parsed;

    /*
     * ========================================
     * Incomplete / Unparsed Response
     * ========================================
     */

    if (
      response.status !==
        "completed" ||
      !parsed
    ) {
      const error =
        new Error(
          "Classification response was incomplete or unparsed"
        );

      await markClassificationErrorSafely(
        pb,
        cleanMessageId
      );

      const incompleteUsageResult =
        await recordClassificationUsageChecked(
          {
            userId:
              cleanUserId,

            conversationId:
              cleanConversationId,

            messageId:
              cleanMessageId,

            requestType:
              "classification",

            reservationRequestId:
              reservationRequestId,

            model,

            latencyMs,

            success:
              false,

            response,

            error,
          },
          {
            messageId:
              cleanMessageId,

            stage:
              "parse_usage",
          }
        );

      if (
        incompleteUsageResult.ok
      ) {
        await completeClassificationBudgetReservationSafely({
          reservationRequestId,

          userId:
            cleanUserId,

          usageResult:
            incompleteUsageResult,

          messageId:
            cleanMessageId,

          stage:
            "parse_reservation_completion",
        });
      }

      logClassificationError(
        cleanMessageId,
        error,
        {
          stage:
            "parse",

          responseId:
            response.id,

          responseStatus:
            response.status,
        }
      );

      return {
        status:
          "error",

        topicId:
          null,

        confidence:
          0,

        model,
      };
    }

    /*
     * ========================================
     * Validate Topic Result
     * ========================================
     */

    const parsedConfidence =
      clampConfidence(
        parsed.confidence
      );

    const candidateIds =
      new Set(
        candidates.map(
          (
            candidate
          ) =>
            candidate.id
        )
      );

    const parsedTopicId =
      cleanRecordId(
        parsed.topic_id
      );

    const validTopicId =
      parsed.matched &&
      parsedTopicId &&
      candidateIds.has(
        parsedTopicId
      )
        ? parsedTopicId
        : null;

    const confidence =
      parsed.matched
        ? parsedConfidence
        : 0;

    const threshold =
      getTopicClassificationMinConfidence();

    const isClassified =
      validTopicId !==
        null &&
      confidence >=
        threshold;

    const result:
      TopicClassificationResult =
      isClassified
        ? {
            status:
              "classified",

            topicId:
              validTopicId,

            confidence,

            model,
          }
        : {
            status:
              "unclassified",

            topicId:
              null,

            confidence,

            model,
          };

    /*
     * ========================================
     * Classification Persistence
     * ========================================
     */

    try {
      await updateMessageClassification(
        pb,
        cleanMessageId,
        {
          topic:
            result.topicId ||
            "",

          topic_confidence:
            result.confidence,

          classification_status:
            result.status,
        }
      );
    } catch (error) {
      /*
       * AI Call انجام شده؛ Usage حتی اگر Message
       * Update شکست بخورد باید ثبت شود.
       */
      const persistenceUsageResult =
        await recordClassificationUsageChecked(
          {
            userId:
              cleanUserId,

            conversationId:
              cleanConversationId,

            messageId:
              cleanMessageId,

            requestType:
              "classification",

            reservationRequestId:
              reservationRequestId,

            model,

            latencyMs,

            success:
              true,

            response,
          },
          {
            messageId:
              cleanMessageId,

            stage:
              "persistence_usage",
          }
        );

      if (
        persistenceUsageResult.ok
      ) {
        await completeClassificationBudgetReservationSafely({
          reservationRequestId,

          userId:
            cleanUserId,

          usageResult:
            persistenceUsageResult,

          messageId:
            cleanMessageId,

          stage:
            "persistence_reservation_completion",
        });
      }

      logClassificationError(
        cleanMessageId,
        error,
        {
          stage:
            "persistence",

          responseId:
            response.id,
        }
      );

      return {
        status:
          "error",

        topicId:
          null,

        confidence:
          0,

        model,
      };
    }

    /*
     * ========================================
     * AI Usage
     * ========================================
     */

    const successUsageResult =
      await recordClassificationUsageChecked(
        {
          userId:
            cleanUserId,

          conversationId:
            cleanConversationId,

          messageId:
            cleanMessageId,

          requestType:
            "classification",

          reservationRequestId:
            reservationRequestId,

          model,

          latencyMs,

          success:
            true,

          response,
        },
        {
          messageId:
            cleanMessageId,

          stage:
            "success_usage",
        }
      );

    if (
      successUsageResult.ok
    ) {
      await completeClassificationBudgetReservationSafely({
        reservationRequestId,

        userId:
          cleanUserId,

        usageResult:
          successUsageResult,

        messageId:
          cleanMessageId,

        stage:
          "success_reservation_completion",
      });
    }

    return result;
  } catch (error) {
    if (
      pb
    ) {
      await markClassificationErrorSafely(
        pb,
        cleanMessageId
      );
    }

    logClassificationError(
      cleanMessageId,
      error,
      {
        stage:
          "setup",
      }
    );

    return {
      status:
        "error",

      topicId:
        null,

      confidence:
        0,
    };
  }
}

/*
 * ============================================
 * Confidence Config
 * ============================================
 */

export function getTopicClassificationMinConfidence() {
  const value =
    Number(
      process.env
        .TOPIC_CLASSIFICATION_MIN_CONFIDENCE
    );

  return Number.isFinite(
    value
  ) &&
    value >=
      0 &&
    value <=
      1
    ? value
    : DEFAULT_MIN_CONFIDENCE;
}

/*
 * ============================================
 * Classifier Instructions
 * ============================================
 */

const CLASSIFIER_INSTRUCTIONS = `
تو یک طبقه‌بند موضوعی دقیق برای سؤال‌های کارشناسان یک شرکت هستی.

قواعد:
- فقط از topic_idهای فهرست Candidateها استفاده کن و Topic جدید نساز.
- موضوع سؤال فعلی را طبقه‌بندی کن؛ Context فقط برای رفع ابهام Follow-up است.
- اگر چند سطح مناسب‌اند، دقیق‌ترین Child یا Leaf مرتبط را انتخاب کن.
- شباهت چند واژه به‌تنهایی کافی نیست و معنای سؤال باید واقعاً با Topic منطبق باشد.
- سلام، تشکر، مکالمه عمومی و سؤال نامرتبط را matched=false برگردان.
- اگر سؤال مبهم یا بدون Topic مناسب است matched=false و topic_id=null برگردان.
- confidence میزان اطمینان به Match معنایی است و باید بین صفر و یک باشد.
`;

/*
 * ============================================
 * Classification Reservation Estimate
 *
 * Instructions + JSON classifier input +
 * structured-output contract با UTF-8 byte
 * upper bound محاسبه می‌شوند.
 * ============================================
 */

function estimateClassificationReservationInputTokens(
  input:
    string
) {
  const serialized =
    JSON.stringify({
      instructions:
        CLASSIFIER_INSTRUCTIONS,

      input,

      output_schema: {
        matched:
          "boolean",

        topic_id:
          "string|null",

        confidence:
          "number[0,1]",
      },

      reasoning: {
        effort:
          "minimal",
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
      CLASSIFICATION_RESERVATION_OVERHEAD_TOKENS
  );
}

/*
 * ============================================
 * OpenAI Request
 * ============================================
 */

function createClassificationResponse(
  model:
    string,

  input:
    string
) {
  return getOpenAIClient()
    .responses
    .parse({
      model,

      instructions:
        CLASSIFIER_INSTRUCTIONS,

      input,

      text: {
        format:
          zodTextFormat(
            ClassificationOutputSchema,
            "topic_classification"
          ),

        verbosity:
          "low",
      },

      reasoning: {
        effort:
          "minimal",
      },

      max_output_tokens:
        CLASSIFICATION_MAX_OUTPUT_TOKENS,

      store:
        false,
    });
}

/*
 * ============================================
 * Owned User Message
 * ============================================
 */

async function getOwnedUserMessage({
  pb,
  messageId,
  userId,
  conversationId,
}: {
  pb:
    PocketBase;

  messageId:
    string;

  userId:
    string;

  conversationId:
    string;
}): Promise<
  RecordModel |
  null
> {
  try {
    return await pb
      .collection(
        "messages"
      )
      .getFirstListItem(
        pb.filter(
          "id = {:messageId} && user = {:userId} && conversation = {:conversationId} && role = {:role}",
          {
            messageId,

            userId,

            conversationId,

            role:
              "user",
          }
        ),
        {
          fields:
            [
              "id",
              "user",
              "conversation",
              "role",
              "topic",
              "topic_confidence",
              "classification_status",
            ].join(
              ","
            ),
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
}

/*
 * ============================================
 * Active Topics
 * ============================================
 */

async function getActiveTopics(
  pb:
    PocketBase
) {
  const result =
    await pb
      .collection(
        "topics"
      )
      .getList(
        1,
        MAX_TOPIC_CANDIDATES,
        {
          filter:
            "active = true",

          sort:
            "name",

          expand:
            "parent",
        }
      );

  const recordsById =
    new Map(
      result.items.map(
        (
          record
        ) => [
          record.id,
          record,
        ]
      )
    );

  const parentIds =
    new Set(
      result.items
        .map(
          (
            record
          ) =>
            cleanRecordId(
              record.parent
            )
        )
        .filter(
          Boolean
        )
    );

  return result.items
    .map(
      (
        record
      ) => {
        const name =
          normalizeText(
            record.name,
            MAX_TOPIC_NAME_LENGTH
          );

        if (
          !name
        ) {
          return null;
        }

        const parentId =
          cleanRecordId(
            record.parent
          ) ||
          null;

        const expandedParent =
          getExpandedParent(
            record
          );

        const parentRecord =
          parentId
            ? recordsById.get(
                parentId
              ) as
                | RecordModel
                | undefined
            : undefined;

        const parentName =
          normalizeText(
            expandedParent?.name ||
              parentRecord?.name ||
              "",
            MAX_TOPIC_NAME_LENGTH
          ) ||
          null;

        const description =
          normalizeText(
            record.description,
            MAX_DESCRIPTION_LENGTH
          );

        return {
          id:
            record.id,

          name,

          parentId,

          parentName,

          description:
            description ||
            null,

          isLeaf:
            !parentIds.has(
              record.id
            ),
        } satisfies TopicCandidate;
      }
    )
    .filter(
      (
        candidate
      ): candidate is TopicCandidate =>
        candidate !==
        null
    );
}

/*
 * ============================================
 * Classifier Input
 * ============================================
 */

function buildClassifierInput(
  question:
    string,

  context:
    ClassificationContextMessage[],

  candidates:
    TopicCandidate[]
) {
  const safeContext =
    Array.isArray(
      context
    )
      ? context
      : [];

  const recentContext =
    safeContext
      .slice(
        -MAX_CONTEXT_MESSAGES
      )
      .map(
        (
          message
        ) => ({
          role:
            message?.role ===
            "assistant"
              ? "assistant" as const
              : "user" as const,

          content:
            normalizeText(
              message?.content,
              MAX_CONTEXT_LENGTH
            ),
        })
      )
      .filter(
        (
          message
        ) =>
          Boolean(
            message.content
          )
      );

  return JSON.stringify({
    current_question:
      normalizeText(
        question,
        MAX_QUESTION_LENGTH
      ),

    recent_context:
      recentContext,

    topic_candidates:
      candidates.map(
        (
          candidate
        ) => ({
          id:
            candidate.id,

          name:
            candidate.name,

          parent_id:
            candidate.parentId,

          parent_name:
            candidate.parentName,

          description:
            candidate.description,

          is_leaf:
            candidate.isLeaf,
        })
      ),
  });
}

/*
 * ============================================
 * Message Classification Persistence
 * ============================================
 */

async function updateMessageClassification(
  pb:
    PocketBase,

  messageId:
    string,

  data: {
    topic:
      string;

    topic_confidence:
      number;

    classification_status:
      | "classified"
      | "unclassified"
      | "error";
  }
) {
  await pb
    .collection(
      "messages"
    )
    .update(
      messageId,
      data
    );
}

async function markClassificationError(
  pb:
    PocketBase,

  messageId:
    string
) {
  await updateMessageClassification(
    pb,
    messageId,
    {
      topic:
        "",

      topic_confidence:
        0,

      classification_status:
        "error",
    }
  );
}

async function markClassificationErrorSafely(
  pb:
    PocketBase,

  messageId:
    string
) {
  if (
    !messageId
  ) {
    return;
  }

  try {
    await markClassificationError(
      pb,
      messageId
    );
  } catch (error) {
    logClassificationError(
      messageId,
      error,
      {
        stage:
          "error_status",
      }
    );
  }
}

/*
 * ============================================
 * AI Usage Accounting
 *
 * recordAIUsage خودش Retry محدود دارد.
 * این Helper در مسیرهای دارای OpenAI Request ID
 * یک Retry سطح بالاتر و idempotent نیز انجام
 * می‌دهد تا Accounting silently گم نشود.
 * ============================================
 */

async function recordClassificationUsageChecked(
  params:
    Parameters<
      typeof recordAIUsage
    >[0],

  context: {
    messageId:
      string;

    stage:
      string;
  }
) {
  const first =
    await recordAIUsage(
      params
    );

  if (
    first.ok
  ) {
    return first;
  }

  logClassificationError(
    context.messageId,
    first.error,
    {
      stage:
        context.stage,

      operation:
        "record_ai_usage",

      retry:
        false,
    }
  );

  /*
   * Retry فقط وقتی deterministic identifier
   * داریم. در Response موفق response.id وجود
   * دارد و recordAIUsage duplicate-safe است.
   */
  if (
    !params.response &&
    !params.requestId
  ) {
    return first;
  }

  const second =
    await recordAIUsage(
      params
    );

  if (
    second.ok
  ) {
    return second;
  }

  logClassificationError(
    context.messageId,
    second.error,
    {
      stage:
        context.stage,

      operation:
        "record_ai_usage",

      retry:
        true,
    }
  );

  return second;
}

/*
 * ============================================
 * Persistent Budget Reservation Completion
 * ============================================
 */

async function completeClassificationBudgetReservationSafely({
  reservationRequestId,
  userId,
  usageResult,
  messageId,
  stage,
}: {
  reservationRequestId:
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

  messageId:
    string;

  stage:
    string;
}) {
  try {
    await completeAIBudgetReservation({
      userId,

      requestId:
        reservationRequestId,

      actualTokens:
        usageResult.snapshot.totalTokens,

      actualCostUsd:
        usageResult.estimatedCostUsd,

      usageRecordId:
        usageResult.recordId,
    });

    return true;
  } catch (error) {
    /*
     * ai_usage قبلاً ثبت شده است. Pending ماندن
     * Reservation فقط موقتاً Budget را بیشتر
     * اشغال می‌کند و under-count ایجاد نمی‌کند.
     */
    logClassificationError(
      messageId,
      error,
      {
        stage,

        operation:
          "complete_budget_reservation",

        reservationRequestId,

        usageRecordId:
          usageResult.recordId,
      }
    );

    return false;
  }
}

/*
 * ============================================
 * Classification Reservation Request ID
 * ============================================
 */

function createClassificationReservationRequestId() {
  return `c${randomUUID()
    .replace(
      /-/g,
      ""
    )}`;
}

/*
 * ============================================
 * Safe Budget Integer
 * ============================================
 */

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
 * Expanded Parent
 * ============================================
 */

function getExpandedParent(
  record:
    RecordModel
) {
  const expand =
    record.expand as
      | Record<
          string,
          unknown
        >
      | undefined;

  const rawParent =
    expand?.parent;

  const parent =
    Array.isArray(
      rawParent
    )
      ? rawParent[0]
      : rawParent;

  if (
    typeof parent !==
      "object" ||
    parent ===
      null
  ) {
    return null;
  }

  return {
    name:
      normalizeText(
        (
          parent as Record<
            string,
            unknown
          >
        ).name,
        MAX_TOPIC_NAME_LENGTH
      ),
  };
}

/*
 * ============================================
 * Terminal Status
 *
 * error عمداً Terminal نیست.
 * ============================================
 */

function isTerminalStatus(
  value:
    string
) {
  return (
    value ===
      "classified" ||
    value ===
      "unclassified"
  );
}

/*
 * ============================================
 * Confidence
 * ============================================
 */

function clampConfidence(
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

  return Math.min(
    1,
    Math.max(
      0,
      number
    )
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
 * Text Normalization
 * ============================================
 */

function normalizeText(
  value:
    unknown,

  maximumLength:
    number
) {
  return String(
    value ||
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
      maximumLength
    );
}

/*
 * ============================================
 * Logging
 * ============================================
 */

function logClassificationError(
  messageId:
    string,

  error:
    unknown,

  context:
    Record<
      string,
      unknown
    >
) {
  console.error(
    "Topic classification failed",
    {
      messageId,

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
) {
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
      name?:
        unknown;

      message?:
        unknown;

      status?:
        unknown;

      code?:
        unknown;

      request_id?:
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

    requestId:
      typeof value.request_id ===
      "string"
        ? value.request_id
        : undefined,
  };
}
