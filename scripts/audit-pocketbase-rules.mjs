import "dotenv/config";
import PocketBase from "pocketbase";

/*
 * ============================================
 * PocketBase configuration
 * ============================================
 */

const url =
  process.env.POCKETBASE_URL?.trim();

const token =
  process.env.POCKETBASE_SUPERUSER_TOKEN?.trim();

const email =
  process.env.POCKETBASE_SUPERUSER_EMAIL?.trim();

const password =
  process.env.POCKETBASE_SUPERUSER_PASSWORD;

if (!url) {
  throw new Error(
    "POCKETBASE_URL is not defined"
  );
}

/*
 * ============================================
 * Authenticate
 * ============================================
 */

const pb =
  new PocketBase(
    url
  );

pb.autoCancellation(
  false
);

if (token) {
  pb.authStore.save(
    token,
    null
  );
} else {
  if (
    !email ||
    !password
  ) {
    throw new Error(
      "PocketBase superuser credentials are not configured"
    );
  }

  await pb
    .collection(
      "_superusers"
    )
    .authWithPassword(
      email,
      password
    );
}

/*
 * ============================================
 * Load Collections
 * ============================================
 */

const collections =
  await pb
    .collections
    .getFullList({
      sort:
        "name",
    });

/*
 * ============================================
 * Print Rules
 * ============================================
 */

console.log(
  "\n=== PocketBase API Rules Audit ===\n"
);

for (
  const collection of
  collections
) {
  /*
   * Skip PocketBase internal collections
   * except when useful for awareness.
   */

  console.log(
    `\n[${collection.name}]`
  );

  console.log(
    `type: ${collection.type}`
  );

  console.log(
    `list:   ${formatRule(
      collection.listRule
    )}`
  );

  console.log(
    `view:   ${formatRule(
      collection.viewRule
    )}`
  );

  console.log(
    `create: ${formatRule(
      collection.createRule
    )}`
  );

  console.log(
    `update: ${formatRule(
      collection.updateRule
    )}`
  );

  console.log(
    `delete: ${formatRule(
      collection.deleteRule
    )}`
  );

  if (
    collection.type ===
    "auth"
  ) {
    console.log(
      `auth:   ${formatRule(
        collection.authRule
      )}`
    );

    console.log(
      `manage: ${formatRule(
        collection.manageRule
      )}`
    );
  }
}

/*
 * ============================================
 * Summary
 * ============================================
 */

const applicationCollections =
  collections.filter(
    (
      collection
    ) =>
      !collection.name.startsWith(
        "_"
      )
  );

const publicRules = [];

for (
  const collection of
  applicationCollections
) {
  const rules = {
    list:
      collection.listRule,

    view:
      collection.viewRule,

    create:
      collection.createRule,

    update:
      collection.updateRule,

    delete:
      collection.deleteRule,
  };

  for (
    const [
      operation,
      rule,
    ] of Object.entries(
      rules
    )
  ) {
    if (
      rule ===
      ""
    ) {
      publicRules.push(
        `${collection.name}.${operation}`
      );
    }
  }
}

console.log(
  "\n\n=== Summary ==="
);

console.log(
  `Application collections: ${applicationCollections.length}`
);

console.log(
  `Public/empty rules: ${publicRules.length}`
);

if (
  publicRules.length
) {
  console.log(
    "\nWARNING: Empty rules allow public access:"
  );

  for (
    const item of
    publicRules
  ) {
    console.log(
      `  - ${item}`
    );
  }
} else {
  console.log(
    "\nNo empty public CRUD rules detected."
  );
}

/*
 * ============================================
 * Helpers
 * ============================================
 */

function formatRule(
  value
) {
  if (
    value ===
    null ||
    value ===
    undefined
  ) {
    return "[LOCKED]";
  }

  if (
    value ===
    ""
  ) {
    return "[PUBLIC / EMPTY]";
  }

  return value;
}