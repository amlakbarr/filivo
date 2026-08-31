import type {
  ChatRetrievalResult,
} from "@/lib/ai/chat-retrieval";

import {
  INSUFFICIENT_KNOWLEDGE_MESSAGE,
  isInsufficientKnowledgeAnswer,
} from "@/lib/ai/chat-retrieval";

import type {
  ChatSource,
} from "@/types/chat";

/*
 * ============================================
 * Types
 * ============================================
 */

export type GroundingReason =
  | "model_declared_insufficient"
  | "safe_ungrounded_question"
  | "verified_knowledge"
  | "missing_verified_knowledge";

export type GroundedAnswerDecision = {
  answer: string;
  hasAnswer: boolean;
  requiresKnowledge: boolean;
  verifiedEvidence: boolean;
  reason: GroundingReason;
  sources: ChatSource[];
};

/*
 * ============================================
 * Hard Grounding Gate
 * ============================================
 */

export function enforceGroundedAnswer({
  question,
  answer,
  relevantResults,
  sources,
}: {
  question: string;
  answer: string;
  relevantResults: ChatRetrievalResult[];
  sources: ChatSource[];
}): GroundedAnswerDecision {
  const cleanAnswer = String(answer || "").trim();

  if (
    isInsufficientKnowledgeAnswer(
      cleanAnswer
    )
  ) {
    return {
      answer:
        INSUFFICIENT_KNOWLEDGE_MESSAGE,
      hasAnswer:
        false,
      requiresKnowledge:
        true,
      verifiedEvidence:
        false,
      reason:
        "model_declared_insufficient",
      sources:
        [],
    };
  }

  if (
    isSafeUngroundedQuestion(
      question
    )
  ) {
    return {
      answer:
        cleanAnswer,
      hasAnswer:
        Boolean(
          cleanAnswer
        ),
      requiresKnowledge:
        false,
      verifiedEvidence:
        false,
      reason:
        "safe_ungrounded_question",
      sources:
        [],
    };
  }

  const relevantKnowledgeIds =
    new Set(
      relevantResults
        .map(
          (
            result
          ) =>
            normalizeRecordId(
              result.knowledgeId
            )
        )
        .filter(
          Boolean
        )
    );

  const verifiedSources =
    deduplicateSources(
      sources.filter(
        (
          source
        ) => {
          const knowledgeId =
            normalizeRecordId(
              source.knowledgeId
            );

          return (
            Boolean(
              knowledgeId
            ) &&
            relevantKnowledgeIds.has(
              knowledgeId
            )
          );
        }
      )
    );

  const verifiedEvidence =
    relevantKnowledgeIds.size >
      0 &&
    verifiedSources.length >
      0;

  if (
    !verifiedEvidence
  ) {
    return {
      answer:
        INSUFFICIENT_KNOWLEDGE_MESSAGE,
      hasAnswer:
        false,
      requiresKnowledge:
        true,
      verifiedEvidence:
        false,
      reason:
        "missing_verified_knowledge",
      sources:
        [],
    };
  }

  return {
    answer:
      cleanAnswer,
    hasAnswer:
      true,
    requiresKnowledge:
      true,
    verifiedEvidence:
      true,
    reason:
      "verified_knowledge",
    sources:
      verifiedSources,
  };
}

/*
 * ============================================
 * Safe Ungrounded Questions
 * ============================================
 */

export function isSafeUngroundedQuestion(
  value: string
) {
  const question =
    normalizePersianText(
      value
    );

  if (
    !question ||
    question.length >
      160
  ) {
    return false;
  }

  return SAFE_UNGROUNDED_PATTERNS.some(
    (
      pattern
    ) =>
      pattern.test(
        question
      )
  );
}

const SAFE_UNGROUNDED_PATTERNS:
  readonly RegExp[] = [
  /^(سلام|درود|سلام علیکم|وقت بخیر|صبح بخیر|ظهر بخیر|عصر بخیر|شب بخیر|خسته نباشید)[.!؟? ]*$/u,
  /^(ممنون|مرسی|متشکرم|سپاس|سپاسگزارم|خیلی ممنون|خیلی متشکرم|باشه|اوکی|متوجه شدم)[.!؟? ]*$/u,
  /^(خداحافظ|فعلا|فعلاً|روز خوش|شب خوش|موفق باشی)[.!؟? ]*$/u,
  /^(تو کی هستی|شما کی هستید|خودت را معرفی کن|خودتو معرفی کن)[.!؟? ]*$/u,
  /^(چه کارهایی میتونی انجام بدی|چه کارهایی می‌توانی انجام بدهی|چه کمکی میتونی بکنی|چه کمکی می‌توانی بکنی)[.!؟? ]*$/u,
  /^(امروز چه روزی است|امروز چه روزیه|امروز چندشنبه است|امروز چند شنبه است)[.!؟? ]*$/u,
  /^(تاریخ امروز چیست|تاریخ امروز چیه|امروز چندمه|امروز چندم است)[.!؟? ]*$/u,
  /^(الان ساعت چند است|الان ساعت چنده|ساعت الان چند است|ساعت الان چنده|اکنون ساعت چند است)[.!؟? ]*$/u,
  /^(فردا چه روزی است|فردا چندشنبه است|فردا چند شنبه است)[.!؟? ]*$/u,
  /^(دیروز چه روزی بود|دیروز چندشنبه بود|دیروز چند شنبه بود)[.!؟? ]*$/u,
];

/*
 * ============================================
 * Source Deduplication
 * ============================================
 */

function deduplicateSources(
  sources: ChatSource[]
) {
  const unique =
    new Map<
      string,
      ChatSource
    >();

  for (
    const source of
    sources
  ) {
    const knowledgeId =
      normalizeRecordId(
        source.knowledgeId
      );

    if (
      !knowledgeId ||
      unique.has(
        knowledgeId
      )
    ) {
      continue;
    }

    unique.set(
      knowledgeId,
      source
    );
  }

  return [
    ...unique.values(),
  ];
}

/*
 * ============================================
 * Record ID
 * ============================================
 */

function normalizeRecordId(
  value: unknown
) {
  const id =
    String(
      value ||
        ""
    ).trim();

  return /^[a-zA-Z0-9_-]{1,64}$/.test(
    id
  )
    ? id
    : "";
}

/*
 * ============================================
 * Persian Normalization
 * ============================================
 */

function normalizePersianText(
  value: string
) {
  return String(
    value ||
      ""
  )
    .replace(
      /ي/g,
      "ی"
    )
    .replace(
      /ك/g,
      "ک"
    )
    .replace(
      /\u200c/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim()
    .toLocaleLowerCase(
      "fa-IR"
    );
}
