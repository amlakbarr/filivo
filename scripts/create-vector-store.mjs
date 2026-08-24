import OpenAI from "openai";

const VECTOR_STORE_NAME =
  "Callcenter Company Knowledge";

process.loadEnvFile(".env.local");

const apiKey = process.env.OPENAI_API_KEY;
const configuredId =
  process.env.OPENAI_VECTOR_STORE_ID?.trim();

if (!apiKey) {
  throw new Error(
    "OPENAI_API_KEY is not defined in .env.local"
  );
}

const openai = new OpenAI({
  apiKey,
  timeout: 90_000,
  maxRetries: 2,
});

if (configuredId) {
  const vectorStore =
    await openai.vectorStores.retrieve(
      configuredId
    );

  console.log(
    JSON.stringify({
      action: "reused-configured",
      id: vectorStore.id,
      name: vectorStore.name,
      status: vectorStore.status,
    })
  );

  process.exit(0);
}

let existingVectorStore;

for await (const vectorStore of openai.vectorStores.list({
  limit: 100,
  order: "desc",
})) {
  if (vectorStore.name === VECTOR_STORE_NAME) {
    existingVectorStore = vectorStore;
    break;
  }
}

if (existingVectorStore) {
  console.log(
    JSON.stringify({
      action: "reused-by-name",
      id: existingVectorStore.id,
      name: existingVectorStore.name,
      status: existingVectorStore.status,
    })
  );

  process.exit(0);
}

const vectorStore =
  await openai.vectorStores.create({
    name: VECTOR_STORE_NAME,
    description:
      "Published company knowledge for the callcenter RAG system",
    metadata: {
      application: "callcenter-ai",
      purpose: "company-knowledge",
    },
  });

console.log(
  JSON.stringify({
    action: "created",
    id: vectorStore.id,
    name: vectorStore.name,
    status: vectorStore.status,
  })
);
