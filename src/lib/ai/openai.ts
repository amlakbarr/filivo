import OpenAI from "openai";

let openaiClient: OpenAI | null = null;
const OPENAI_TIMEOUT_MS = 90_000;

export function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not defined"
    );
  }

  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey,
      timeout: OPENAI_TIMEOUT_MS,
      maxRetries: 2,
    });
  }

  return openaiClient;
}

export function getOpenAIModel() {
  return (
    process.env.OPENAI_MODEL ||
    "gpt-5.6-luna"
  );
}

export function getOpenAIClassifierModel() {
  return (
    process.env.OPENAI_CLASSIFIER_MODEL?.trim() ||
    getOpenAIModel()
  );
}

export function getOpenAIVectorStoreId() {
  const vectorStoreId =
    process.env.OPENAI_VECTOR_STORE_ID?.trim();

  if (!vectorStoreId) {
    throw new Error(
      "OPENAI_VECTOR_STORE_ID is not defined"
    );
  }

  return vectorStoreId;
}
