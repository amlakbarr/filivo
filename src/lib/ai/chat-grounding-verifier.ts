import type OpenAI from "openai";

import {
  checkAIBudgetGuard,
} from "@/lib/ai/budget-guard";

import {
  completeAIBudgetReservation,
  createAIBudgetReservation,
} from "@/lib/ai/budget-reservation";

import type {
  ChatRetrievalResult,
} from "@/lib/ai/chat-retrieval";

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

import type {
  ChatSource,
} from "@/types/chat";

import {
  after,
} from "next/server";

const VERIFIER_MAX_OUTPUT_TOKENS = 140;
const VERIFIER_RESERVATION_OVERHEAD_TOKENS = 256;
const MAX_EVIDENCE_CHUNKS = 5;
const MAX_EVIDENCE_TOTAL_CHARACTERS = 12_000;
const MAX_EVIDENCE_CHUNK_CHARACTERS = 3_000;
const MAX_UNSUPPORTED_CLAIMS = 8;

export type GroundingVerificationReason =
  | "supported"
  | "unsupported_claims"
  | "no_evidence"
  | "budget_blocked"
  | "verifier_unavailable"
  | "invalid_verifier_response";

export type GroundingVerificationResult = {
  verified: boolean;
  reason: GroundingVerificationReason;
  unsupportedClaims: string[];
  verifierReason?: string;
  verifierRequestId?: string;
  model?: string;
};

type VerifierPayload = {
  supported: boolean;
  unsupported_claims: string[];
  reason: string;
};

const VERIFIER_INSTRUCTIONS = `
تو یک ممیز سخت‌گیر Grounding هستی.

وظیفه:
بررسی کن که تمام ادعاهای مهم پاسخ فقط و فقط از EVIDENCE ارائه‌شده پشتیبانی شوند.

قوانین:
- از دانش عمومی یا حافظه خودت استفاده نکن.
- هر عدد، مبلغ، درصد، تاریخ، مدت، شرط، استثنا، الزام، ممنوعیت، مرحله فرایند و نتیجه عملیاتی باید در Evidence پشتیبانی مستقیم داشته باشد.
- بازنویسی و خلاصه‌سازی مجاز است، اما اضافه کردن واقعیت جدید مجاز نیست.
- اگر پاسخ چند ادعا دارد و حتی یکی از آن‌ها پشتیبانی نمی‌شود، supported=false است.
- اگر Evidence مبهم، ناقص یا متناقض است، supported=false است.
- لینک یا URL نیز اگر به‌عنوان اطلاعات واقعی در پاسخ آمده باید از Evidence قابل پشتیبانی باشد.
- فقط JSON مطابق Schema برگردان.
`;

export async function verifyGroundedAnswer({
  question,
  answer,
  retrievalResults,
  citedFileIds,
  sources,
  minScore,
  userId,
  conversationId,
  messageId,
  baseRequestId,
}: {
  question: string;
  answer: string;
  retrievalResults: ChatRetrievalResult[];
  citedFileIds: ReadonlySet<string>;
  sources: ChatSource[];
  minScore: number;
  userId: string;
  conversationId: string;
  messageId: string;
  baseRequestId: string;
}): Promise<GroundingVerificationResult> {
  const evidence = buildEvidence({
    retrievalResults,
    citedFileIds,
    sources,
    minScore,
  });

  if (!evidence) {
    return {
      verified: false,
      reason: "no_evidence",
      unsupportedClaims: [],
    };
  }

  const verifierRequestId = createVerifierRequestId(
    baseRequestId
  );
  const model = getGroundingVerifierModel();
  const verifierInput = buildVerifierInput({
    question,
    answer,
    evidence,
  });

  const estimatedInputTokens = Math.min(
    Number.MAX_SAFE_INTEGER,
    estimateUtf8TokenUpperBound(verifierInput) +
      VERIFIER_RESERVATION_OVERHEAD_TOKENS
  );

  logVerifierDiagnostics(
    "prepared",
    {
      verifierRequestId,
      model,
      evidenceCharacters:
        evidence.length,
      inputCharacters:
        verifierInput.length,
      estimatedInputTokens,
      citedFileCount:
        citedFileIds.size,
      sourceCount:
        sources.length,
    }
  );

  try {
    const guard = await checkAIBudgetGuard({
      userId,
      reservation: {
        model,
        inputTokens: estimatedInputTokens,
        outputTokens: VERIFIER_MAX_OUTPUT_TOKENS,
      },
      excludeReservationRequestId: verifierRequestId,
    });

    if (!guard.allowed) {
      console.warn(
        "Grounding verifier blocked by AI budget guard",
        {
          verifierRequestId,
          userId,
          conversationId,
          code: guard.code,
        }
      );

      return {
        verified: false,
        reason: "budget_blocked",
        unsupportedClaims: [],
        verifierRequestId,
        model,
      };
    }
  } catch (error) {
    console.error("Grounding verifier budget guard failed", {
      verifierRequestId,
      userId,
      conversationId,
      error: safeErrorMetadata(error),
    });

    return {
      verified: false,
      reason: "verifier_unavailable",
      unsupportedClaims: [],
      verifierRequestId,
      model,
    };
  }

  const reservedTokens = safeBudgetInteger(
    estimatedInputTokens + VERIFIER_MAX_OUTPUT_TOKENS
  );

  let reservedCostUsd = 0;

  try {
    const pricing = await getActiveModelPricing(model);

    if (pricing) {
      reservedCostUsd = calculateReservedTokenCost(
        {
          inputTokens: estimatedInputTokens,
          outputTokens: VERIFIER_MAX_OUTPUT_TOKENS,
        },
        pricing
      );
    }
  } catch (error) {
    console.error("Grounding verifier pricing lookup failed", {
      verifierRequestId,
      model,
      error: safeErrorMetadata(error),
    });

    return {
      verified: false,
      reason: "verifier_unavailable",
      unsupportedClaims: [],
      verifierRequestId,
      model,
    };
  }

  try {
    const reservationResult =
      await createAIBudgetReservation({
        userId,
        conversationId,
        requestId: verifierRequestId,
        requestType: "chat",
        model,
        reservedTokens,
        reservedCostUsd,
      });

    if (
      !reservationResult.created &&
      reservationResult.reservation.status === "completed"
    ) {
      return {
        verified: false,
        reason: "verifier_unavailable",
        unsupportedClaims: [],
        verifierRequestId,
        model,
      };
    }
  } catch (error) {
    console.error("Grounding verifier reservation failed", {
      verifierRequestId,
      userId,
      conversationId,
      error: safeErrorMetadata(error),
    });

    return {
      verified: false,
      reason: "verifier_unavailable",
      unsupportedClaims: [],
      verifierRequestId,
      model,
    };
  }

  const startedAt = Date.now();
  let response: OpenAI.Responses.Response;

  try {
    response = await getOpenAIClient().responses.create({
      model,
      instructions: VERIFIER_INSTRUCTIONS,
      input: verifierInput,
      reasoning: {
  effort:
    getVerifierReasoningEffort(
      model
    ),
},
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "grounding_verdict",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              supported: {
                type: "boolean",
              },
              unsupported_claims: {
                type: "array",
                maxItems: MAX_UNSUPPORTED_CLAIMS,
                items: {
                  type: "string",
                },
              },
              reason: {
                type: "string",
              },
            },
            required: [
              "supported",
              "unsupported_claims",
              "reason",
            ],
          },
        },
      },
      max_output_tokens: VERIFIER_MAX_OUTPUT_TOKENS,
      store: false,
    });
  } catch (error) {
    // مصرف upstream در Exception ممکن است نامشخص باشد؛
    // Reservation عمداً pending می‌ماند تا TTL.
    console.error("Grounding verifier OpenAI call failed", {
      verifierRequestId,
      userId,
      conversationId,
      latencyMs: Date.now() - startedAt,
      error: safeErrorMetadata(error),
    });

    return {
      verified: false,
      reason: "verifier_unavailable",
      unsupportedClaims: [],
      verifierRequestId,
      model,
    };
  }

  const latencyMs = Date.now() - startedAt;

  logVerifierDiagnostics(
    "openai_completed",
    {
      verifierRequestId,
      model,
      latencyMs,
      responseStatus:
        response.status,
    }
  );

  after(async () => {
  try {
    const usageResult =
      await recordVerifierUsage({
        userId,
        conversationId,
        messageId,
        verifierRequestId,
        model,
        latencyMs,
        response,
        success:
          response.status ===
          "completed",
      });

    if (
      !usageResult?.ok
    ) {
      return;
    }

    try {
      await completeAIBudgetReservation({
        userId,

        requestId:
          verifierRequestId,

        actualTokens:
          usageResult.snapshot
            .totalTokens,

        actualCostUsd:
          usageResult
            .estimatedCostUsd,

        usageRecordId:
          usageResult.recordId,
      });
    } catch (error) {
      console.error(
        "Grounding verifier reservation completion failed",
        {
          verifierRequestId,

          userId,

          usageRecordId:
            usageResult.recordId,

          error:
            safeErrorMetadata(
              error
            ),
        }
      );
    }
  } catch (error) {
    console.error(
      "Grounding verifier background accounting failed",
      {
        verifierRequestId,

        userId,

        conversationId,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );
  }
});

  if (
    response.status !== "completed" ||
    !response.output_text.trim()
  ) {
    return {
      verified: false,
      reason: "invalid_verifier_response",
      unsupportedClaims: [],
      verifierRequestId,
      model,
    };
  }

  const parsed = parseVerifierPayload(response.output_text);

  if (!parsed) {
    return {
      verified: false,
      reason: "invalid_verifier_response",
      unsupportedClaims: [],
      verifierRequestId,
      model,
    };
  }

  if (!parsed.supported) {
    return {
      verified: false,
      reason: "unsupported_claims",
      unsupportedClaims: parsed.unsupported_claims,
      verifierReason: parsed.reason,
      verifierRequestId,
      model,
    };
  }

  return {
    verified: true,
    reason: "supported",
    unsupportedClaims: [],
    verifierReason: parsed.reason,
    verifierRequestId,
    model,
  };
}

function buildEvidence({
  retrievalResults,
  citedFileIds,
  sources,
  minScore,
}: {
  retrievalResults: ChatRetrievalResult[];
  citedFileIds: ReadonlySet<string>;
  sources: ChatSource[];
  minScore: number;
}) {
  const allowedKnowledgeIds = new Set(
    sources
      .map((source) => cleanRecordId(source.knowledgeId))
      .filter(Boolean)
  );

  if (allowedKnowledgeIds.size === 0) {
    return "";
  }

  const requireCitation =
    citedFileIds.size > 0;

  const chunks = retrievalResults
    .filter((result) =>
      result.attributes.status === "published" &&
      result.score >= minScore &&
      Boolean(result.text.trim()) &&
      Boolean(result.knowledgeId) &&
      allowedKnowledgeIds.has(
        cleanRecordId(result.knowledgeId)
      ) &&
      (
        !requireCitation ||
        citedFileIds.has(result.fileId)
      )
    )
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_EVIDENCE_CHUNKS);

  if (chunks.length === 0) {
    return "";
  }

  const parts: string[] = [];
  let totalCharacters = 0;

  for (const [index, chunk] of chunks.entries()) {
    const remaining =
      MAX_EVIDENCE_TOTAL_CHARACTERS - totalCharacters;

    if (remaining <= 0) {
      break;
    }

    const text = chunk.text
      .trim()
      .slice(
        0,
        Math.min(
          MAX_EVIDENCE_CHUNK_CHARACTERS,
          remaining
        )
      );

    if (!text) {
      continue;
    }

    const block = [
      `EVIDENCE ${index + 1}`,
      `knowledge_id: ${chunk.knowledgeId || ""}`,
      `filename: ${chunk.filename || ""}`,
      `score: ${chunk.score}`,
      "text:",
      text,
    ].join("\n");

    parts.push(block);
    totalCharacters += block.length;
  }

  return parts.join("\n\n---\n\n");
}

function buildVerifierInput({
  question,
  answer,
  evidence,
}: {
  question: string;
  answer: string;
  evidence: string;
}) {
  return [
    "QUESTION:",
    String(question || "").trim(),
    "",
    "ANSWER TO VERIFY:",
    String(answer || "").trim(),
    "",
    "EVIDENCE:",
    evidence,
  ].join("\n");
}

function parseVerifierPayload(
  value: string
): VerifierPayload | null {
  try {
    const parsed: unknown = JSON.parse(value);

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return null;
    }

    const object = parsed as {
      supported?: unknown;
      unsupported_claims?: unknown;
      reason?: unknown;
    };

    if (
      typeof object.supported !== "boolean" ||
      !Array.isArray(object.unsupported_claims) ||
      !object.unsupported_claims.every(
        (item) => typeof item === "string"
      ) ||
      typeof object.reason !== "string"
    ) {
      return null;
    }

    return {
      supported: object.supported,
      unsupported_claims: object.unsupported_claims
        .map((item) =>
          item.replace(/\s+/g, " ").trim().slice(0, 500)
        )
        .filter(Boolean)
        .slice(0, MAX_UNSUPPORTED_CLAIMS),
      reason: object.reason
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 800),
    };
  } catch {
    return null;
  }
}

async function recordVerifierUsage({
  userId,
  conversationId,
  messageId,
  verifierRequestId,
  model,
  latencyMs,
  response,
  success,
}: {
  userId: string;
  conversationId: string;
  messageId: string;
  verifierRequestId: string;
  model: string;
  latencyMs: number;
  response: OpenAI.Responses.Response;
  success: boolean;
}) {
  try {
    const result = await recordAIUsage({
      userId,
      conversationId,
      messageId,
      requestType: "chat",
      reservationRequestId: verifierRequestId,
      model,
      latencyMs,
      success,
      response,
      ...(success
        ? {}
        : {
            errorMessage:
              "Grounding verifier response was incomplete or invalid",
          }),
    });

    if (!result.ok) {
      console.error(
        "Grounding verifier usage accounting failed",
        {
          verifierRequestId,
          userId,
          conversationId,
          error: safeErrorMetadata(result.error),
        }
      );
    }

    return result;
  } catch (error) {
    console.error("Grounding verifier usage accounting threw", {
      verifierRequestId,
      userId,
      conversationId,
      error: safeErrorMetadata(error),
    });

    return null;
  }
}

function getGroundingVerifierModel() {
  return (
    process.env.OPENAI_GROUNDING_VERIFIER_MODEL?.trim() ||
    getOpenAIClassifierModel()
  );
}

function createVerifierRequestId(baseRequestId: string) {
  const base = String(baseRequestId || "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 110);

  return `${base || crypto.randomUUID()}_gv`;
}

function cleanRecordId(value: unknown) {
  const id = String(value || "").trim();

  return /^[a-zA-Z0-9_-]{1,64}$/.test(id)
    ? id
    : "";
}

function safeBudgetInteger(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(
    0,
    Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(value))
  );
}

function logVerifierDiagnostics(
  event:
    string,

  metadata:
    Record<
      string,
      unknown
    >
) {
  if (
    process.env
      .GROUNDING_VERIFIER_DIAGNOSTICS_ENABLED
      ?.trim()
      .toLowerCase() !==
    "true"
  ) {
    return;
  }

  console.info(
    "Grounding verifier diagnostics",
    {
      event,
      ...metadata,
    }
  );
}

function safeErrorMetadata(error: unknown) {
  if (typeof error !== "object" || error === null) {
    return {
      message: String(error),
    };
  }

  const value = error as {
    name?: unknown;
    message?: unknown;
    status?: unknown;
    code?: unknown;
    request_id?: unknown;
  };

  return {
    name:
      typeof value.name === "string"
        ? value.name
        : undefined,
    message:
      typeof value.message === "string"
        ? value.message
        : undefined,
    status:
      typeof value.status === "number"
        ? value.status
        : undefined,
    code:
      typeof value.code === "string" ||
      typeof value.code === "number"
        ? value.code
        : undefined,
    requestId:
      typeof value.request_id === "string"
        ? value.request_id
        : undefined,
  };
}

function getVerifierReasoningEffort(
  model:
    string
) {
  const normalized =
    model
      .trim()
      .toLowerCase();

  if (
    normalized.includes(
      "gpt-5-mini"
    )
  ) {
    return "minimal" as const;
  }

  return "none" as const;
}