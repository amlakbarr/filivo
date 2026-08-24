import {
  toFile,
  type OpenAI,
} from "openai";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";

import {
  getOpenAIClient,
  getOpenAIVectorStoreId,
} from "@/lib/ai/openai";

const MAX_SYNC_ERROR_LENGTH = 1500;
const MAX_SEARCH_QUERY_LENGTH = 2000;

export type KnowledgeItemRecord = RecordModel & {
  title?: string;
  content?: string;
  topic?: unknown;
  departments?: unknown;
  tags?: unknown;
  source_type?: string;
  attachment?: unknown;
  status?: "draft" | "published" | "archived";
  version?: string | number;
  sync_status?: "pending" | "synced" | "error";
  openai_file_id?: string;
  sync_error?: string;
  created_by?: string;
  updated_by?: string;
};

export type KnowledgeSyncResult =
  | {
      success: true;
      id: string;
      sync_status: "synced";
      openai_file_id: string;
      replaced_file_id?: string;
      cleanup_warning?: string;
    }
  | {
      success: false;
      id: string;
      code:
        | "KNOWLEDGE_NOT_FOUND"
        | "KNOWLEDGE_NOT_PUBLISHED"
        | "KNOWLEDGE_SYNC_FAILED";
      message: string;
      status: number;
      sync_status?: "pending" | "error";
      openai_file_id?: string;
    };

export type KnowledgeRemovalResult =
  | {
      success: true;
      id: string;
      sync_status: "pending";
      openai_file_id: "";
      removed_file_id?: string;
    }
  | {
      success: false;
      id: string;
      code:
        | "KNOWLEDGE_NOT_FOUND"
        | "KNOWLEDGE_REMOVAL_FAILED";
      message: string;
      status: number;
      sync_status?: "error";
      openai_file_id?: string;
    };

export type KnowledgeSearchResult = {
  file_id: string;
  filename: string;
  score: number;
  text: string;
  attributes: Record<
    string,
    string | number | boolean
  > | null;
  knowledge_id?: string;
};

export async function syncKnowledgeItem(
  id: string,
  pb: PocketBase
): Promise<KnowledgeSyncResult> {
  const itemResult =
    await getKnowledgeItem(id, pb);

  if (!itemResult.success) {
    return itemResult.result;
  }

  const item = itemResult.item;

  if (item.status !== "published") {
    const removal =
      await removeKnowledgeItemFromOpenAI(
        id,
        pb,
        item
      );

    if (!removal.success) {
      return {
        success: false,
        id,
        code: "KNOWLEDGE_SYNC_FAILED",
        message: removal.message,
        status: removal.status,
        sync_status: removal.sync_status,
        openai_file_id:
          removal.openai_file_id,
      };
    }

    return {
      success: false,
      id,
      code: "KNOWLEDGE_NOT_PUBLISHED",
      message:
        "فقط دانش منتشرشده قابل همگام‌سازی است.",
      status: 409,
      sync_status: "pending",
      openai_file_id: "",
    };
  }

  const previousFileId =
    String(item.openai_file_id || "").trim();
  let newFileId: string | undefined;

  try {
    await updateKnowledgeSyncState(pb, id, {
      sync_status: "pending",
      sync_error: "",
    });

    const openai = getOpenAIClient();
    const vectorStoreId =
      getOpenAIVectorStoreId();
    const file = await buildKnowledgeFile(item, pb);

    const uploadedFile =
      await openai.files.create({
        file,
        purpose: "assistants",
      });

    newFileId = uploadedFile.id;

    const vectorStoreFile =
      await openai.vectorStores.files.createAndPoll(
        vectorStoreId,
        {
          file_id: newFileId,
          attributes:
            buildKnowledgeAttributes(item),
        },
        {
          pollIntervalMs: 1000,
        }
      );

    if (vectorStoreFile.status !== "completed") {
      throw new Error(
        vectorStoreFile.last_error?.message ||
          `Vector Store indexing ended with status ${vectorStoreFile.status}`
      );
    }

    await updateKnowledgeSyncState(pb, id, {
      openai_file_id: newFileId,
      sync_status: "synced",
      sync_error: "",
    });

    let cleanupWarning: string | undefined;

    if (
      previousFileId &&
      previousFileId !== newFileId
    ) {
      try {
        await retireKnowledgeFile(
          previousFileId,
          id,
          "replaced"
        );
      } catch (error) {
        cleanupWarning =
          `نسخه جدید فعال شد، اما پاک‌سازی فایل قبلی ${previousFileId} ناموفق بود: ${formatSyncError(error)}`;

        console.error(
          "Old knowledge file cleanup failed",
          {
            knowledgeId: id,
            previousFileId,
            newFileId,
            error: getErrorMetadata(error),
          }
        );
      }
    }

    return {
      success: true,
      id,
      sync_status: "synced",
      openai_file_id: newFileId,
      replaced_file_id:
        previousFileId || undefined,
      cleanup_warning: cleanupWarning,
    };
  } catch (error) {
    const message = formatSyncError(error);

    if (
      newFileId &&
      newFileId !== previousFileId
    ) {
      try {
        await deleteOpenAIFile(newFileId);
      } catch (cleanupError) {
        console.error(
          "Failed to clean up new knowledge file",
          {
            knowledgeId: id,
            newFileId,
            error: getErrorMetadata(cleanupError),
          }
        );
      }
    }

    await updateKnowledgeSyncState(pb, id, {
      openai_file_id: previousFileId,
      sync_status: "error",
      sync_error: message,
    }).catch((updateError) => {
      console.error(
        "Failed to save knowledge sync error",
        {
          knowledgeId: id,
          error: getErrorMetadata(updateError),
        }
      );
    });

    console.error("Knowledge sync failed", {
      knowledgeId: id,
      previousFileId: previousFileId || undefined,
      error: getErrorMetadata(error),
    });

    return {
      success: false,
      id,
      code: "KNOWLEDGE_SYNC_FAILED",
      message,
      status: 502,
      sync_status: "error",
      openai_file_id:
        previousFileId || undefined,
    };
  }
}

export async function removeKnowledgeItemFromOpenAI(
  id: string,
  pb: PocketBase,
  knownItem?: KnowledgeItemRecord
): Promise<KnowledgeRemovalResult> {
  let item = knownItem;

  if (!item) {
    const itemResult =
      await getKnowledgeItem(id, pb);

    if (!itemResult.success) {
      return {
        success: false,
        id,
        code: "KNOWLEDGE_NOT_FOUND",
        message: itemResult.result.message,
        status: itemResult.result.status,
      };
    }

    item = itemResult.item;
  }

  const fileId =
    String(item.openai_file_id || "").trim();

  try {
    if (fileId) {
      await retireKnowledgeFile(
        fileId,
        id,
        item.status === "draft"
          ? "draft"
          : "archived"
      );
    }

    await updateKnowledgeSyncState(pb, id, {
      openai_file_id: "",
      sync_status: "pending",
      sync_error: "",
    });

    return {
      success: true,
      id,
      sync_status: "pending",
      openai_file_id: "",
      removed_file_id: fileId || undefined,
    };
  } catch (error) {
    const message = formatSyncError(error);

    await updateKnowledgeSyncState(pb, id, {
      sync_status: "error",
      sync_error: message,
    }).catch((updateError) => {
      console.error(
        "Failed to save knowledge removal error",
        {
          knowledgeId: id,
          error: getErrorMetadata(updateError),
        }
      );
    });

    console.error("Knowledge removal failed", {
      knowledgeId: id,
      fileId: fileId || undefined,
      error: getErrorMetadata(error),
    });

    return {
      success: false,
      id,
      code: "KNOWLEDGE_REMOVAL_FAILED",
      message,
      status: 502,
      sync_status: "error",
      openai_file_id: fileId || undefined,
    };
  }
}

export async function searchKnowledge(
  query: string,
  maxResults = 5
): Promise<KnowledgeSearchResult[]> {
  const normalizedQuery = query.trim();

  if (!normalizedQuery) {
    throw new Error("Search query cannot be empty");
  }

  if (
    normalizedQuery.length >
    MAX_SEARCH_QUERY_LENGTH
  ) {
    throw new Error(
      `Search query cannot exceed ${MAX_SEARCH_QUERY_LENGTH} characters`
    );
  }

  const response =
    await getOpenAIClient().vectorStores.search(
      getOpenAIVectorStoreId(),
      {
        query: normalizedQuery,
        max_num_results: Math.min(
          Math.max(maxResults, 1),
          5
        ),
        rewrite_query: true,
        filters: {
          type: "eq",
          key: "status",
          value: "published",
        },
      }
    );

  return response.data.map((result) => {
    const knowledgeId =
      typeof result.attributes?.knowledge_id ===
      "string"
        ? result.attributes.knowledge_id
        : undefined;

    return {
      file_id: result.file_id,
      filename: result.filename,
      score: result.score,
      text: result.content
        .map((part) => part.text)
        .join("\n")
        .trim(),
      attributes: result.attributes,
      knowledge_id: knowledgeId,
    };
  });
}

async function getKnowledgeItem(
  id: string,
  pb: PocketBase
): Promise<
  | {
      success: true;
      item: KnowledgeItemRecord;
    }
  | {
      success: false;
      result: Extract<
        KnowledgeSyncResult,
        { success: false }
      >;
    }
> {
  try {
    const item = await pb
      .collection("knowledge_items")
      .getOne<KnowledgeItemRecord>(id);

    return {
      success: true,
      item,
    };
  } catch (error) {
    const metadata = getErrorMetadata(error);

    return {
      success: false,
      result: {
        success: false,
        id,
        code:
          metadata.status === 404
            ? "KNOWLEDGE_NOT_FOUND"
            : "KNOWLEDGE_SYNC_FAILED",
        message:
          metadata.status === 404
            ? "رکورد دانش پیدا نشد."
            : formatSyncError(error),
        status:
          metadata.status === 404 ? 404 : 503,
      },
    };
  }
}

function buildKnowledgeDocument(
  item: KnowledgeItemRecord
) {
  const title = String(item.title || "").trim();
  const content = String(item.content || "").trim();

  if (!title) {
    throw new Error(
      "Knowledge item title cannot be empty"
    );
  }

  if (!content) {
    throw new Error(
      "Knowledge item content cannot be empty"
    );
  }

  const topics = normalizeStringList(item.topic);
  const tags = normalizeStringList(item.tags);
  const lines = [
    `# ${title}`,
    "",
    `Knowledge ID: ${item.id}`,
    "Status: published",
  ];

  if (topics.length > 0) {
    lines.push(`Topic: ${topics.join(", ")}`);
  }

  if (tags.length > 0) {
    lines.push(`Tags: ${tags.join(", ")}`);
  }

  lines.push("", "## Content", "", content, "");

  return lines.join("\n");
}

async function buildKnowledgeFile(
  item: KnowledgeItemRecord,
  pb: PocketBase
) {
  if (item.source_type === "file") {
    const attachment = normalizeStringList(
      item.attachment
    )[0];

    if (!attachment) {
      throw new Error(
        "فایل منبع این مطلب در PocketBase موجود نیست."
      );
    }

    const token = await pb.files.getToken();
    const url = pb.files.getURL(item, attachment, {
      token,
    });
    const response = await fetch(url, {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(
        `دریافت فایل منبع از PocketBase ناموفق بود (HTTP ${response.status}).`
      );
    }

    return toFile(
      Buffer.from(await response.arrayBuffer()),
      attachment,
      {
        type:
          response.headers.get("content-type") ||
          "application/octet-stream",
      }
    );
  }

  const document = buildKnowledgeDocument(item);
  const filename = buildKnowledgeFilename(item);

  return toFile(
    Buffer.from(document, "utf8"),
    filename,
    {
      type: "text/markdown; charset=utf-8",
    }
  );
}

function buildKnowledgeFilename(
  item: KnowledgeItemRecord
) {
  const version = String(
    item.version || "current"
  )
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .slice(0, 40);

  return `knowledge-${item.id}-v${version}.md`;
}

function buildKnowledgeAttributes(
  item: KnowledgeItemRecord
): OpenAI.VectorStores.FileCreateParams["attributes"] {
  const attributes: NonNullable<
    OpenAI.VectorStores.FileCreateParams["attributes"]
  > = {
    knowledge_id: item.id,
    status: "published",
  };
  const topic = normalizeStringList(item.topic)
    .join(", ")
    .slice(0, 512);

  if (topic) {
    attributes.topic = topic;
  }

  if (
    typeof item.version === "number" ||
    typeof item.version === "string"
  ) {
    attributes.version = String(item.version).slice(
      0,
      512
    );
  }

  return attributes;
}

function normalizeStringList(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item).trim())
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return [String(value)];
  }

  return [];
}

async function updateKnowledgeSyncState(
  pb: PocketBase,
  id: string,
  data: Record<string, unknown>
) {
  return pb
    .collection("knowledge_items")
    .update<KnowledgeItemRecord>(id, data);
}

async function deleteOpenAIFile(fileId: string) {
  const openai = getOpenAIClient();
  const failures: string[] = [];

  try {
    await openai.vectorStores.files.delete(
      fileId,
      {
        vector_store_id:
          getOpenAIVectorStoreId(),
      }
    );
  } catch (error) {
    if (getErrorMetadata(error).status !== 404) {
      failures.push(
        `detach failed: ${formatSyncError(error)}`
      );
    }
  }

  try {
    await openai.files.delete(fileId);
  } catch (error) {
    if (getErrorMetadata(error).status !== 404) {
      failures.push(
        `file delete failed: ${formatSyncError(error)}`
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(failures.join(" | "));
  }
}

async function retireKnowledgeFile(
  fileId: string,
  knowledgeId: string,
  status: "draft" | "archived" | "replaced"
) {
  let attributeError: unknown;

  try {
    await getOpenAIClient().vectorStores.files.update(
      fileId,
      {
        vector_store_id:
          getOpenAIVectorStoreId(),
        attributes: {
          knowledge_id: knowledgeId,
          status,
        },
      }
    );
  } catch (error) {
    if (getErrorMetadata(error).status !== 404) {
      attributeError = error;
    }
  }

  try {
    await deleteOpenAIFile(fileId);
  } catch (deleteError) {
    const errors = [];

    if (attributeError) {
      errors.push(
        `attribute update failed: ${formatSyncError(attributeError)}`
      );
    }

    errors.push(formatSyncError(deleteError));
    throw new Error(errors.join(" | "));
  }
}

function formatSyncError(error: unknown) {
  const metadata = getErrorMetadata(error);
  const parts = [
    metadata.message ||
      "خطای نامشخص در همگام‌سازی دانش",
  ];

  if (metadata.code) {
    parts.push(`code=${metadata.code}`);
  }

  if (metadata.requestId) {
    parts.push(`request_id=${metadata.requestId}`);
  }

  return parts
    .join(" | ")
    .slice(0, MAX_SYNC_ERROR_LENGTH);
}

function getErrorMetadata(error: unknown) {
  if (typeof error !== "object" || error === null) {
    return {
      message: String(error),
    };
  }

  const value = error as {
    message?: unknown;
    status?: unknown;
    code?: unknown;
    request_id?: unknown;
  };

  return {
    message:
      typeof value.message === "string"
        ? value.message
        : undefined,
    status:
      typeof value.status === "number"
        ? value.status
        : undefined,
    code:
      typeof value.code === "string"
        ? value.code
        : undefined,
    requestId:
      typeof value.request_id === "string"
        ? value.request_id
        : undefined,
  };
}
