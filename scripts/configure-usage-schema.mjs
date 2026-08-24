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

const usageCollection =
  await pb.collections.getOne("ai_usage");
const fields = [...usageCollection.fields];
const addedFields = [];

addFieldIfMissing(fields, addedFields, {
  name: "reasoning_tokens",
  type: "number",
  required: false,
  hidden: false,
  presentable: false,
  onlyInt: true,
  min: 0,
});

addFieldIfMissing(fields, addedFields, {
  name: "file_search_calls",
  type: "number",
  required: false,
  hidden: false,
  presentable: false,
  onlyInt: true,
  min: 0,
});

addFieldIfMissing(fields, addedFields, {
  name: "cost_available",
  type: "bool",
  required: false,
  hidden: false,
  presentable: false,
});

const uniqueRequestIndexName =
  "idx_ai_usage_request_id";
const indexes = [...(usageCollection.indexes || [])];

if (
  !indexes.some((index) =>
    index.includes(uniqueRequestIndexName)
  )
) {
  indexes.push(
    "CREATE UNIQUE INDEX `idx_ai_usage_request_id` ON `ai_usage` (`request_id`) WHERE `request_id` != ''"
  );
}

await pb.collections.update(usageCollection.id, {
  fields,
  indexes,
  listRule: null,
  viewRule: null,
  createRule: null,
  updateRule: null,
  deleteRule: null,
});

const pricingCollection =
  await pb.collections.getOne("model_pricing");

await pb.collections.update(pricingCollection.id, {
  listRule: null,
  viewRule: null,
  createRule: null,
  updateRule: null,
  deleteRule: null,
});

console.log(
  JSON.stringify(
    {
      success: true,
      collection: "ai_usage",
      addedFields,
      uniqueRequestId: true,
      directAccountAccessLocked: true,
      pricingRecordsCreated: 0,
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
