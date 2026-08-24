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

const collection = await pb.collections.getOne("knowledge_items");
const requiredFields = {
  title: "text",
  content: "text",
  topic: "relation",
  departments: "relation",
  tags: "json",
  source_type: "select",
  attachment: "file",
  status: "select",
  version: "number",
  sync_status: "select",
  openai_file_id: "text",
  sync_error: "text",
  created_by: "relation",
  updated_by: "relation",
};

for (const [name, expectedType] of Object.entries(requiredFields)) {
  const field = collection.fields.find((candidate) => candidate.name === name);
  if (!field) throw new Error(`knowledge_items.${name} is missing`);
  if (field.type !== expectedType) throw new Error(`knowledge_items.${name} must be ${expectedType}, received ${field.type}`);
}

const adminGuard = "@request.auth.id != '' && @request.auth.role = 'admin'";
const createRule = `${adminGuard} && @request.body.created_by = @request.auth.id && @request.body.updated_by = @request.auth.id && @request.body.version = 1 && @request.body.sync_status = 'pending' && @request.body.openai_file_id = ''`;
const updateRule = `${adminGuard} && @request.body.created_by:changed = false && (@request.body.updated_by:changed = false || @request.body.updated_by = @request.auth.id)`;
const deleteRule = `${adminGuard} && status = 'draft'`;

await pb.collections.update(collection.id, {
  createRule,
  updateRule,
  deleteRule,
});

console.log(JSON.stringify({ success: true, collection: "knowledge_items", schemaValidated: true, employeeMutationsBlocked: true, auditFieldsProtected: true, permanentDeleteLimitedToDraft: true }, null, 2));
