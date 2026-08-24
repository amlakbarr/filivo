import type { RecordModel } from "pocketbase";

import type {
  ChatMessage,
  ChatSource,
} from "@/types/chat";

export function toChatMessage(
  record: RecordModel,
  sourceOverride?: ChatSource[]
): ChatMessage {
  const role =
    record.role === "assistant"
      ? "assistant"
      : "user";
  const sources =
    role === "assistant"
      ? sourceOverride ?? getExpandedSources(record)
      : undefined;

  return {
    id: record.id,
    role,
    content: String(record.content || ""),
    created: String(record.created || ""),
    ...(role === "assistant" && record.model
      ? { model: String(record.model) }
      : {}),
    ...(role === "assistant"
      ? {
          hasAnswer: Boolean(record.has_answer),
          sources,
        }
      : {}),
  };
}

export function getExpandedSources(
  record: RecordModel
): ChatSource[] {
  const expand = record.expand as
    | Record<string, unknown>
    | undefined;
  const rawSources = expand?.sources;
  const sourceRecords = Array.isArray(rawSources)
    ? rawSources
    : rawSources
      ? [rawSources]
      : [];
  const uniqueSources = new Map<string, ChatSource>();

  for (const rawSource of sourceRecords) {
    if (
      typeof rawSource !== "object" ||
      rawSource === null
    ) {
      continue;
    }

    const source = rawSource as Record<string, unknown>;
    const knowledgeId = String(source.id || "").trim();
    const title = String(source.title || "").trim();

    if (!knowledgeId || !title) {
      continue;
    }

    uniqueSources.set(knowledgeId, {
      knowledgeId,
      title,
    });
  }

  return [...uniqueSources.values()];
}
