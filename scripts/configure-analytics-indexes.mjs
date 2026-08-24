import PocketBase from "pocketbase";

const url = process.env.POCKETBASE_URL?.trim();
const token = process.env.POCKETBASE_SUPERUSER_TOKEN?.trim();
const email = process.env.POCKETBASE_SUPERUSER_EMAIL?.trim();
const password = process.env.POCKETBASE_SUPERUSER_PASSWORD;

if (!url) throw new Error("POCKETBASE_URL is not defined");

const pb = new PocketBase(url);
pb.autoCancellation(false);

if (token) {
  pb.authStore.save(token, null);
} else {
  if (!email || !password) {
    throw new Error("Set POCKETBASE_SUPERUSER_TOKEN or POCKETBASE_SUPERUSER_EMAIL and POCKETBASE_SUPERUSER_PASSWORD");
  }
  await pb.collection("_superusers").authWithPassword(email, password);
}

const configurations = [
  {
    collection: "messages",
    indexes: [
      "CREATE INDEX idx_messages_role_created ON messages (role, created)",
      "CREATE INDEX idx_messages_user_created ON messages (user, created)",
      "CREATE INDEX idx_messages_topic_created ON messages (topic, created)",
      "CREATE INDEX idx_messages_classification_created ON messages (classification_status, created)",
      "CREATE INDEX idx_messages_user_topic_created ON messages (user, topic, created)",
    ],
  },
  {
    collection: "ai_usage",
    indexes: [
      "CREATE INDEX idx_ai_usage_created ON ai_usage (created)",
      "CREATE INDEX idx_ai_usage_user_created ON ai_usage (user, created)",
      "CREATE INDEX idx_ai_usage_type_created ON ai_usage (request_type, created)",
      "CREATE INDEX idx_ai_usage_success_created ON ai_usage (success, created)",
      "CREATE INDEX idx_ai_usage_model_created ON ai_usage (model, created)",
    ],
  },
  {
    collection: "conversations",
    indexes: [
      "CREATE INDEX idx_conversations_created ON conversations (created)",
      "CREATE INDEX idx_conversations_user_created ON conversations (user, created)",
    ],
  },
];
const added = [];

for (const configuration of configurations) {
  const collection = await pb.collections.getOne(configuration.collection);
  const indexes = [...(collection.indexes || [])];

  for (const index of configuration.indexes) {
    const name = index.match(/INDEX\s+(\w+)/i)?.[1];
    if (name && !indexes.some((current) => current.includes(name))) {
      indexes.push(index);
      added.push(name);
    }
  }

  await pb.collections.update(collection.id, { indexes });
}

console.log(JSON.stringify({ success: true, addedIndexes: added }, null, 2));
