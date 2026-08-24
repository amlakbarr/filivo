import type OpenAI from "openai";

import type { ChatSource } from "@/types/chat";

export const INSUFFICIENT_KNOWLEDGE_MESSAGE =
  "اطلاعات کافی برای پاسخ به این سؤال در پایگاه دانش وجود ندارد.";

const DEFAULT_MAX_RESULTS = 5;
const DEFAULT_MIN_SCORE = 0.15;

export type ChatRetrievalResult = {
  fileId: string;
  filename: string;
  score: number;
  text: string;
  attributes: Record<string, string | number | boolean>;
  knowledgeId?: string;
};

export function getChatRetrievalSettings() {
  const configuredScore = Number(
    process.env.OPENAI_FILE_SEARCH_MIN_SCORE
  );

  return {
    maxResults: DEFAULT_MAX_RESULTS,
    minScore:
      Number.isFinite(configuredScore) &&
      configuredScore >= 0 &&
      configuredScore <= 1
        ? configuredScore
        : DEFAULT_MIN_SCORE,
  };
}

export function extractFileSearchResults(
  output: OpenAI.Responses.ResponseOutputItem[]
) {
  const results: ChatRetrievalResult[] = [];

  for (const item of output) {
    if (item.type !== "file_search_call") {
      continue;
    }

    for (const result of item.results || []) {
      const attributes = result.attributes || {};
      const knowledgeId =
        typeof attributes.knowledge_id === "string"
          ? attributes.knowledge_id.trim()
          : undefined;

      results.push({
        fileId: String(result.file_id || "").trim(),
        filename: String(result.filename || "").trim(),
        score:
          typeof result.score === "number"
            ? result.score
            : 0,
        text: String(result.text || "").trim(),
        attributes,
        knowledgeId: knowledgeId || undefined,
      });
    }
  }

  return results;
}

export function extractCitedFileIds(
  output: OpenAI.Responses.ResponseOutputItem[]
) {
  const fileIds = new Set<string>();

  for (const item of output) {
    if (item.type !== "message") {
      continue;
    }

    for (const content of item.content) {
      if (content.type !== "output_text") {
        continue;
      }

      for (const annotation of content.annotations) {
        if (annotation.type === "file_citation") {
          fileIds.add(annotation.file_id);
        }
      }
    }
  }

  return fileIds;
}

export function selectRelevantRetrievalResults({
  results,
  citedFileIds,
  minScore,
  maxResults,
}: {
  results: ChatRetrievalResult[];
  citedFileIds: ReadonlySet<string>;
  minScore: number;
  maxResults: number;
}) {
  const uniqueKnowledgeItems =
    new Map<string, ChatRetrievalResult>();

  if (citedFileIds.size === 0) {
    return [];
  }

  for (const result of [...results].sort(
    (left, right) => right.score - left.score
  )) {
    const status = result.attributes.status;

    if (
      status !== "published" ||
      result.score < minScore ||
      !result.text ||
      !result.knowledgeId ||
      !citedFileIds.has(result.fileId)
    ) {
      continue;
    }

    if (!uniqueKnowledgeItems.has(result.knowledgeId)) {
      uniqueKnowledgeItems.set(result.knowledgeId, result);
    }

    if (uniqueKnowledgeItems.size >= maxResults) {
      break;
    }
  }

  return [...uniqueKnowledgeItems.values()];
}

export function determineHasAnswer({
  answer,
  relevantResults,
  sources,
}: {
  answer: string;
  relevantResults: ChatRetrievalResult[];
  sources: ChatSource[];
}) {
  if (isInsufficientKnowledgeAnswer(answer)) {
    return false;
  }

  if (relevantResults.length > 0 && sources.length === 0) {
    return false;
  }

  return true;
}

export function isInsufficientKnowledgeAnswer(
  answer: string
) {
  return normalizePersianText(answer).includes(
    normalizePersianText(INSUFFICIENT_KNOWLEDGE_MESSAGE)
  );
}

function normalizePersianText(value: string) {
  return value
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/\s+/g, " ")
    .trim();
}
