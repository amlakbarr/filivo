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

const [accounts, departments] = await Promise.all([
  pb.collections.getOne("accounts"),
  pb.collections.getOne("departments"),
]);
const requiredFields = {
  name: "text",
  email: "email",
  employee_code: "text",
  department: "relation",
  job_title: "text",
  role: "select",
  active: "bool",
};

for (const [name, expectedType] of Object.entries(requiredFields)) {
  const field = accounts.fields.find((candidate) => candidate.name === name);
  if (!field) throw new Error(`accounts.${name} is missing`);
  if (field.type !== expectedType) throw new Error(`accounts.${name} must be ${expectedType}, received ${field.type}`);
}

const departmentField = accounts.fields.find((field) => field.name === "department");
if (departmentField.collectionId !== departments.id) {
  throw new Error("accounts.department must be a relation to departments");
}

const roleField = accounts.fields.find((field) => field.name === "role");
for (const role of ["employee", "admin"]) {
  if (!roleField.values?.includes(role)) {
    throw new Error(`accounts.role must include ${role}`);
  }
}

const indexes = [...(accounts.indexes || [])];
if (!indexes.some((index) => /unique[\s\S]*employee_code/i.test(index))) {
  indexes.push("CREATE UNIQUE INDEX idx_accounts_employee_code ON accounts (employee_code) WHERE employee_code != ''");
}

await pb.collections.update(accounts.id, {
  indexes,
  createRule: null,
  updateRule: null,
  deleteRule: null,
});

console.log(JSON.stringify({ success: true, collection: "accounts", schemaValidated: true, uniqueEmployeeCode: true, directCreateUpdateDeleteLocked: true }, null, 2));
