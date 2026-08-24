import PocketBase from "pocketbase";

const url = process.env.POCKETBASE_URL?.trim();
const token =
  process.env.POCKETBASE_SUPERUSER_TOKEN?.trim();
const email =
  process.env.POCKETBASE_SUPERUSER_EMAIL?.trim();
const password =
  process.env.POCKETBASE_SUPERUSER_PASSWORD;

if (!url) {
  throw new Error("POCKETBASE_URL is not defined");
}

const pb = new PocketBase(url);
pb.autoCancellation(false);

if (token) {
  pb.authStore.save(token, null);
} else {
  if (!email || !password) {
    throw new Error(
      "Set POCKETBASE_SUPERUSER_TOKEN or POCKETBASE_SUPERUSER_EMAIL and POCKETBASE_SUPERUSER_PASSWORD"
    );
  }

  await pb
    .collection("_superusers")
    .authWithPassword(email, password);
}

const [messagesCollection, topicsCollection] =
  await Promise.all([
    pb.collections.getOne("messages"),
    pb.collections.getOne("topics"),
  ]);
const messageFields = [...messagesCollection.fields];
const addedFields = [];

addFieldIfMissing(messageFields, addedFields, {
  name: "topic",
  type: "relation",
  required: false,
  hidden: false,
  presentable: false,
  collectionId: topicsCollection.id,
  cascadeDelete: false,
  maxSelect: 1,
  minSelect: 0,
});

addFieldIfMissing(messageFields, addedFields, {
  name: "topic_confidence",
  type: "number",
  required: false,
  hidden: false,
  presentable: false,
  onlyInt: false,
  min: 0,
  max: 1,
});

addFieldIfMissing(messageFields, addedFields, {
  name: "classification_status",
  type: "select",
  required: false,
  hidden: false,
  presentable: false,
  maxSelect: 1,
  values: [
    "pending",
    "classified",
    "unclassified",
    "error",
  ],
});

const topicField = messageFields.find(
  (field) => field.name === "topic"
);
const confidenceField = messageFields.find(
  (field) => field.name === "topic_confidence"
);
const statusField = messageFields.find(
  (field) => field.name === "classification_status"
);

if (
  topicField?.type !== "relation" ||
  topicField.collectionId !== topicsCollection.id
) {
  throw new Error(
    "messages.topic must be a relation to topics"
  );
}

if (confidenceField?.type !== "number") {
  throw new Error(
    "messages.topic_confidence must be a Number field"
  );
}

if (statusField?.type !== "select") {
  throw new Error(
    "messages.classification_status must be a Select field"
  );
}

statusField.values = [
  ...new Set([
    ...(statusField.values || []),
    "pending",
    "classified",
    "unclassified",
    "error",
  ]),
];

const createGuard =
  "(@request.body.role != 'user' || (@request.body.topic = '' && @request.body.topic_confidence = 0 && @request.body.classification_status = 'pending'))";
const createRule = appendRule(
  messagesCollection.createRule,
  createGuard
);

await pb.collections.update(messagesCollection.id, {
  fields: messageFields,
  createRule,
  updateRule: null,
});

const usageCollection =
  await pb.collections.getOne("ai_usage");
const usageFields = [...usageCollection.fields];
const requestTypeField = usageFields.find(
  (field) => field.name === "request_type"
);

if (
  requestTypeField?.type === "select" &&
  Array.isArray(requestTypeField.values) &&
  !requestTypeField.values.includes("classification")
) {
  requestTypeField.values = [
    ...requestTypeField.values,
    "classification",
  ];

  await pb.collections.update(usageCollection.id, {
    fields: usageFields,
  });
}

console.log(
  JSON.stringify(
    {
      success: true,
      collection: "messages",
      addedFields,
      classificationStatuses: [
        "pending",
        "classified",
        "unclassified",
        "error",
      ],
      directMessageUpdatesLocked: true,
      classificationUsageEnabled: true,
    },
    null,
    2
  )
);

function addFieldIfMissing(
  fields,
  addedFields,
  field
) {
  if (fields.some((item) => item.name === field.name)) {
    return;
  }

  fields.push(field);
  addedFields.push(field.name);
}

function appendRule(currentRule, additionalRule) {
  if (currentRule === null) {
    return null;
  }

  const normalized = String(currentRule || "").trim();

  if (!normalized) {
    return additionalRule;
  }

  if (normalized.includes(additionalRule)) {
    return normalized;
  }

  return `(${normalized}) && ${additionalRule}`;
}
