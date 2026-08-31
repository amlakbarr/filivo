#!/usr/bin/env node


import {
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import {
  basename,
  dirname,
  extname,
  join,
  relative,
  sep,
} from "node:path";

import {
  execFileSync,
  execSync,
} from "node:child_process";

const ROOT =
  process.cwd();

const STRICT =
  process.argv.includes(
    "--strict"
  );

const RUN_BUILD =
  process.argv.includes(
    "--build"
  );

const RUN_LINT =
  process.argv.includes(
    "--lint"
  );

const JSON_OUTPUT =
  process.argv.includes(
    "--json"
  );

const results =
  [];

/*
 * مهم:
 * باید قبل از main مقداردهی شود،
 * چون main بلافاصله loadLocalEnvironment
 * را اجرا می‌کند.
 */
let cachedEnv =
  null;

const criticalFiles = [
  "package.json",
  "src/lib/ai/openai.ts",
  "src/lib/pocketbase/service.ts",
  "src/lib/ai/eval-execution-lock.ts",
  "src/lib/ai/eval-release-gate.ts",
  "src/lib/ai/eval-coverage.ts",
  "src/app/api/admin/evals/run/route.ts",
  "src/app/api/admin/evals/release-gate/route.ts",
  "src/app/admin/evals/release/page.tsx",
];

const recommendedFiles = [
  "src/lib/ai/knowledge-eval-trigger.ts",
  "src/lib/ai/topic-eval-trigger.ts",
  "src/components/admin/AdminEvalAlerts.tsx",
  "src/components/admin/AdminAIHealthDashboard.tsx",
  "src/app/admin/evals/coverage/page.tsx",
];

main();

/*
 * ============================================
 * Main
 * ============================================
 */

function main() {
  section(
    "Callcenter AI · Production Readiness"
  );

  checkNodeVersion();

  checkPackageJson();

  checkCoreFiles();

  checkRouteConflicts();

  checkSourceBackups();

  checkGitHygiene();

  checkEnvironment();

  checkPublicEnvSecrets();

  checkEvalHardening();

  checkProductionFlags();

  if (
    RUN_LINT
  ) {
    runNpmScript(
      "lint"
    );
  }

  if (
    RUN_BUILD
  ) {
    runNpmScript(
      "build"
    );
  }

  finish();
}

/*
 * ============================================
 * Node
 * ============================================
 */

function checkNodeVersion() {
  const major =
    Number(
      process
        .versions
        .node
        .split(
          "."
        )[0]
    );

  const ok =
    Number.isInteger(
      major
    ) &&
    major >=
      20;

  add(
    ok
      ? "pass"
      : "fail",

    "NODE_VERSION",

    `Node.js ${process.versions.node}`,

    ok
      ? "Node runtime is suitable for this Next.js project."
      : "Use Node.js 20 or newer."
  );
}

/*
 * ============================================
 * package.json
 * ============================================
 */

function checkPackageJson() {
  const path =
    join(
      ROOT,
      "package.json"
    );

  if (
    !existsSync(
      path
    )
  ) {
    add(
      "fail",

      "PACKAGE_JSON",

      "package.json پیدا نشد",

      "این Script باید از Root پروژه اجرا شود."
    );

    return;
  }

  let pkg;

  try {
    pkg =
      JSON.parse(
        readFileSync(
          path,
          "utf8"
        )
      );
  } catch {
    add(
      "fail",

      "PACKAGE_JSON_INVALID",

      "package.json معتبر نیست",

      "JSON package.json را اصلاح کنید."
    );

    return;
  }

  const nextVersion =
    String(
      pkg
        .dependencies
        ?.next ||
        ""
    );

  add(
    nextVersion
      ? "pass"
      : "fail",

    "NEXT_DEPENDENCY",

    nextVersion
      ? `Next.js ${nextVersion}`
      : "Next.js dependency پیدا نشد",

    ""
  );

  const scripts =
    pkg.scripts ||
    {};

  for (
    const name of [
      "build",
      "start",
      "lint",
    ]
  ) {
    const ok =
      typeof scripts[
        name
      ] ===
      "string";

    add(
      ok
        ? "pass"
        : "warn",

      `NPM_SCRIPT_${name.toUpperCase()}`,

      `npm script: ${name}`,

      ok
        ? scripts[
            name
          ]
        : "این Script در package.json تعریف نشده است."
    );
  }

  const lockfiles = [
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lock",
    "bun.lockb",
  ];

  const lockfile =
    lockfiles.find(
      (
        name
      ) =>
        existsSync(
          join(
            ROOT,
            name
          )
        )
    );

  add(
    lockfile
      ? "pass"
      : "warn",

    "LOCKFILE",

    lockfile ||
      "Dependency lockfile پیدا نشد",

    lockfile
      ? "Dependency versions are reproducible."
      : "برای Deploy قابل تکرار یک lockfile نگه دارید."
  );
}

/*
 * ============================================
 * Files
 * ============================================
 */

function checkCoreFiles() {
  for (
    const file of
    criticalFiles
  ) {
    const ok =
      existsSync(
        join(
          ROOT,
          file
        )
      );

    add(
      ok
        ? "pass"
        : "fail",

      "CORE_FILE",

      file,

      ok
        ? "موجود است."
        : "فایل حیاتی Production پیدا نشد."
    );
  }

  for (
    const file of
    recommendedFiles
  ) {
    const ok =
      existsSync(
        join(
          ROOT,
          file
        )
      );

    add(
      ok
        ? "pass"
        : "warn",

      "RECOMMENDED_FILE",

      file,

      ok
        ? "موجود است."
        : "این بخش از Observability / Auto Eval فعال نیست یا مسیر فایل تغییر کرده است."
    );
  }
}

/*
 * ============================================
 * Route Conflicts
 * ============================================
 */

function checkRouteConflicts() {
  const appDir =
    join(
      ROOT,
      "src",
      "app"
    );

  if (
    !existsSync(
      appDir
    )
  ) {
    add(
      "fail",

      "APP_DIR",

      "src/app پیدا نشد",

      ""
    );

    return;
  }

  const routes =
    new Map();

  for (
    const file of
    walkFiles(
      appDir
    )
  ) {
    const name =
      basename(
        file
      );

    const page =
      /^page\.(ts|tsx|js|jsx)$/.test(
        name
      );

    const route =
      /^route\.(ts|tsx|js|jsx)$/.test(
        name
      );

    if (
      !page &&
      !route
    ) {
      continue;
    }

    const routeKey =
      relative(
        appDir,
        dirname(
          file
        )
      )
        .split(
          sep
        )
        .filter(
          (
            segment
          ) =>
            !segment.startsWith(
              "("
            ) &&
            !segment.startsWith(
              "@"
            )
        )
        .join(
          "/"
        );

    const entries =
      routes.get(
        routeKey
      ) ||
      [];

    entries.push({
      file:
        relative(
          ROOT,
          file
        ),

      kind:
        page
          ? "page"
          : "route",
    });

    routes.set(
      routeKey,
      entries
    );
  }

  let found =
    false;

  for (
    const [
      routeKey,
      entries,
    ] of
    routes
  ) {
    const kinds =
      new Set(
        entries.map(
          (
            entry
          ) =>
            entry.kind
        )
      );

    if (
      !kinds.has(
        "page"
      ) ||
      !kinds.has(
        "route"
      )
    ) {
      continue;
    }

    found =
      true;

    add(
      "fail",

      "ROUTE_CONFLICT",

      `/${routeKey}`,

      entries
        .map(
          (
            entry
          ) =>
            entry.file
        )
        .join(
          " | "
        )
    );
  }

  if (
    !found
  ) {
    add(
      "pass",

      "ROUTE_CONFLICTS",

      "Next.js route/page conflict",

      "هیچ Conflict مستقیمی پیدا نشد."
    );
  }
}

/*
 * ============================================
 * Backup Files
 * ============================================
 */

function checkSourceBackups() {
  const srcDir =
    join(
      ROOT,
      "src"
    );

  if (
    !existsSync(
      srcDir
    )
  ) {
    return;
  }

  const pattern =
    /(\.bak|\.backup|\.old|\.orig|\.tmp)$/i;

  const backups =
    walkFiles(
      srcDir
    )
      .filter(
        (
          file
        ) =>
          pattern.test(
            file
          )
      )
      .map(
        (
          file
        ) =>
          relative(
            ROOT,
            file
          )
      );

  add(
    backups.length ===
      0
      ? "pass"
      : "warn",

    "SOURCE_BACKUPS",

    "Backup files داخل src",

    backups.length ===
      0
      ? "فایل Backup داخل source tree پیدا نشد."
      : `بهتر است قبل از Production حذف شوند: ${backups
          .slice(
            0,
            12
          )
          .join(
            ", "
          )}${
          backups.length >
          12
            ? " ..."
            : ""
        }`
  );
}

/*
 * ============================================
 * Git
 * ============================================
 */

function checkGitHygiene() {
  if (
    !existsSync(
      join(
        ROOT,
        ".git"
      )
    )
  ) {
    add(
      "warn",

      "GIT_REPOSITORY",

      "Git metadata پیدا نشد",

      "بررسی tracked secretها انجام نشد."
    );

    return;
  }

  for (
    const file of [
      ".env",
      ".env.local",
      ".env.production",
      ".env.production.local",
    ]
  ) {
    const tracked =
      gitTracked(
        file
      );

    add(
      tracked
        ? "fail"
        : "pass",

      "ENV_GIT_TRACKING",

      `${file} tracked`,

      tracked
        ? "فایل Environment حساس نباید داخل Git Commit شود."
        : "tracked نیست."
    );
  }

  const status =
    runGit([
      "status",
      "--porcelain",
    ]);

  add(
    status.trim()
      ? "warn"
      : "pass",

    "GIT_WORKTREE",

    "Git working tree",

    status.trim()
      ? "تغییرات Commit‌نشده وجود دارد؛ قبل از Production مشخص کنید چه چیزی باید Deploy شود."
      : "Working tree clean است."
  );
}

/*
 * ============================================
 * Environment
 * ============================================
 */

function checkEnvironment() {
  const env =
    loadLocalEnvironment();

  const names =
    collectProcessEnvNames();

  const configured =
    names.filter(
      (
        name
      ) =>
        isConfigured(
          env[
            name
          ]
        )
    );

  const missing =
    names.filter(
      (
        name
      ) =>
        !isConfigured(
          env[
            name
          ]
        )
    );

  add(
    names.length >
      0
      ? "pass"
      : "warn",

    "ENV_DISCOVERY",

    "Environment variables referenced in source",

    `${names.length} نام پیدا شد؛ ${configured.length} مقدار محلی دارند.`
  );

  if (
    missing.length >
    0
  ) {
    add(
      "info",

      "ENV_OPTIONAL_MISSING",

      "Envهای بدون مقدار محلی",

      `${missing
        .slice(
          0,
          30
        )
        .join(
          ", "
        )}${
        missing.length >
        30
          ? " ..."
          : ""
      }`
    );
  }

  const production =
    env.NODE_ENV ===
      "production" ||
    process.env
      .NODE_ENV ===
      "production";

  if (
    production
  ) {
    const ok =
      isConfigured(
        env
          .AUTH_RATE_LIMIT_PEPPER
      );

    add(
      ok
        ? "pass"
        : "fail",

      "AUTH_RATE_LIMIT_PEPPER",

      "AUTH_RATE_LIMIT_PEPPER",

      ok
        ? "Production secret configured."
        : "در Production باید یک Secret تصادفی و قوی تنظیم شود."
    );
  }

  const required =
    String(
      process.env
        .READINESS_REQUIRED_ENVS ||
        env
          .READINESS_REQUIRED_ENVS ||
        ""
    )
      .split(
        ","
      )
      .map(
        (
          value
        ) =>
          value.trim()
      )
      .filter(
        Boolean
      );

  for (
    const name of
    required
  ) {
    const ok =
      isConfigured(
        env[
          name
        ]
      );

    add(
      ok
        ? "pass"
        : "fail",

      "REQUIRED_ENV",

      name,

      ok
        ? "Configured."
        : "READINESS_REQUIRED_ENVS این مقدار را الزامی کرده است."
    );
  }
}

/*
 * ============================================
 * Public Secrets
 * ============================================
 */

function checkPublicEnvSecrets() {
  const env =
    loadLocalEnvironment();

  const suspicious =
    Object.keys(
      env
    ).filter(
      (
        name
      ) =>
        name.startsWith(
          "NEXT_PUBLIC_"
        ) &&
        /(SECRET|PASSWORD|TOKEN|PRIVATE|API_KEY|PEPPER|SUPERUSER)/i.test(
          name
        ) &&
        isConfigured(
          env[
            name
          ]
        )
    );

  add(
    suspicious.length ===
      0
      ? "pass"
      : "fail",

    "PUBLIC_SECRET_ENV",

    "NEXT_PUBLIC_ secret exposure",

    suspicious.length ===
      0
      ? "Secret-like public environment variable پیدا نشد."
      : `این متغیرها ممکن است Secret را به Browser بفرستند: ${suspicious.join(
          ", "
        )}`
  );
}

/*
 * ============================================
 * Eval Hardening
 * ============================================
 */

function checkEvalHardening() {
  const path =
    join(
      ROOT,
      "src",
      "lib",
      "ai",
      "eval-execution-lock.ts"
    );

  if (
    !existsSync(
      path
    )
  ) {
    add(
      "fail",

      "EVAL_LOCK",

      "Eval distributed lock",

      "src/lib/ai/eval-execution-lock.ts پیدا نشد."
    );

    return;
  }

  const content =
    readFileSync(
      path,
      "utf8"
    );

  add(
    content.includes(
      "admin_rate_limit_locks"
    )
      ? "pass"
      : "warn",

    "EVAL_DISTRIBUTED_LOCK",

    "Eval lock storage",

    content.includes(
      "admin_rate_limit_locks"
    )
      ? "Distributed PocketBase lock detected."
      : "Lock collection قابل تشخیص نیست."
  );

  add(
    content.includes(
      "AI_AUTO_EVAL_ENABLED"
    ) &&
      content.includes(
        "AI_MANUAL_EVAL_ENABLED"
      )
      ? "pass"
      : "warn",

    "EVAL_KILL_SWITCH",

    "Eval emergency switches",

    "AI_AUTO_EVAL_ENABLED / AI_MANUAL_EVAL_ENABLED"
  );
}

/*
 * ============================================
 * Production Flags
 * ============================================
 */

function checkProductionFlags() {
  const env =
    loadLocalEnvironment();

  const coverageMode =
    String(
      env
        .AI_EVAL_COVERAGE_GATE_MODE ||
        process.env
          .AI_EVAL_COVERAGE_GATE_MODE ||
        ""
    )
      .trim()
      .toLowerCase();

  add(
    coverageMode ===
      "strict"
      ? "pass"
      : coverageMode ===
            "warn" ||
          coverageMode ===
            "off"
        ? "warn"
        : "info",

    "COVERAGE_GATE_MODE",

    "AI_EVAL_COVERAGE_GATE_MODE",

    coverageMode
      ? `mode=${coverageMode}`
      : "مقدار صریح ندارد؛ کد فعلی باید Default خود را اعمال کند."
  );

  for (
    const name of [
      "AI_AUTO_EVAL_ENABLED",
      "AI_MANUAL_EVAL_ENABLED",
    ]
  ) {
    const value =
      String(
        env[
          name
        ] ??
          process.env[
            name
          ] ??
          ""
      )
        .trim()
        .toLowerCase();

    if (
      !value
    ) {
      add(
        "info",

        "PRODUCTION_FLAG",

        name,

        "مقدار صریح ندارد؛ Default کد استفاده می‌شود."
      );

      continue;
    }

    add(
      value ===
        "true"
        ? "pass"
        : "warn",

      "PRODUCTION_FLAG",

      name,

      `${name}=${value}`
    );
  }
}

/*
 * ============================================
 * npm
 * ============================================
 */

function runNpmScript(
  name
) {
  section(
    `npm run ${name}`
  );

  try {
    execSync(
      `npm run ${name}`,
      {
        cwd:
          ROOT,

        stdio:
          JSON_OUTPUT
            ? "pipe"
            : "inherit",

        env:
          process.env,
      }
    );

    add(
      "pass",

      `NPM_${name.toUpperCase()}`,

      `npm run ${name}`,

      "completed successfully"
    );
  } catch (
    error
  ) {
    add(
      "fail",

      `NPM_${name.toUpperCase()}`,

      `npm run ${name}`,

      `exit=${
        typeof error.status ===
        "number"
          ? error.status
          : "unknown"
      }`
    );
  }
}

/*
 * ============================================
 * Final Result
 * ============================================
 */

function finish() {
  const counts = {
    pass:
      results.filter(
        (
          item
        ) =>
          item.level ===
          "pass"
      ).length,

    fail:
      results.filter(
        (
          item
        ) =>
          item.level ===
          "fail"
      ).length,

    warn:
      results.filter(
        (
          item
        ) =>
          item.level ===
          "warn"
      ).length,

    info:
      results.filter(
        (
          item
        ) =>
          item.level ===
          "info"
      ).length,
  };

  const blocked =
    counts.fail >
      0 ||
    (
      STRICT &&
      counts.warn >
        0
    );

  if (
    JSON_OUTPUT
  ) {
    console.log(
      JSON.stringify(
        {
          ready:
            !blocked,

          strict:
            STRICT,

          counts,

          results,
        },
        null,
        2
      )
    );
  } else {
    section(
      "نتیجه"
    );

    console.log(
      `PASS=${counts.pass}  FAIL=${counts.fail}  WARN=${counts.warn}  INFO=${counts.info}`
    );

    console.log();

    console.log(
      blocked
        ? "NO-GO: Production Readiness عبور نکرد."
        : "GO: Static Production Readiness عبور کرد."
    );
  }

  process.exitCode =
    blocked
      ? 1
      : 0;
}

/*
 * ============================================
 * Result Logging
 * ============================================
 */

function add(
  level,
  code,
  title,
  detail
) {
  const item = {
    level,
    code,
    title,
    detail,
  };

  results.push(
    item
  );

  if (
    JSON_OUTPUT
  ) {
    return;
  }

  const icon =
    level ===
    "pass"
      ? "✓"
      : level ===
          "fail"
        ? "✗"
        : level ===
            "warn"
          ? "!"
          : "i";

  console.log(
    `${icon} [${level.toUpperCase()}] ${title}`
  );

  if (
    detail
  ) {
    console.log(
      `    ${detail}`
    );
  }
}

function section(
  title
) {
  if (
    JSON_OUTPUT
  ) {
    return;
  }

  console.log();

  console.log(
    `=== ${title} ===`
  );
}

/*
 * ============================================
 * Source Env Scan
 * ============================================
 */

function collectProcessEnvNames() {
  const roots = [
    join(
      ROOT,
      "src"
    ),

    join(
      ROOT,
      "scripts"
    ),
  ].filter(
    (
      path
    ) =>
      existsSync(
        path
      )
  );

  const names =
    new Set();

  const patterns = [
    /process\.env\.([A-Z0-9_]+)/g,
    /process\s*\.\s*env\s*\.\s*([A-Z0-9_]+)/g,
  ];

  for (
    const root of
    roots
  ) {
    for (
      const file of
      walkFiles(
        root
      )
    ) {
      if (
        ![
          ".ts",
          ".tsx",
          ".js",
          ".jsx",
          ".mjs",
          ".cjs",
        ].includes(
          extname(
            file
          )
        )
      ) {
        continue;
      }

      let text;

      try {
        text =
          readFileSync(
            file,
            "utf8"
          );
      } catch {
        continue;
      }

      for (
        const pattern of
        patterns
      ) {
        pattern.lastIndex =
          0;

        let match;

        while (
          (
            match =
              pattern.exec(
                text
              )
          )
        ) {
          names.add(
            match[
              1
            ]
          );
        }
      }
    }
  }

  return [
    ...names,
  ].sort();
}

/*
 * ============================================
 * File Walker
 * ============================================
 */

function walkFiles(
  root
) {
  const output =
    [];

  const stack = [
    root,
  ];

  while (
    stack.length >
    0
  ) {
    const current =
      stack.pop();

    let entries;

    try {
      entries =
        readdirSync(
          current,
          {
            withFileTypes:
              true,
          }
        );
    } catch {
      continue;
    }

    for (
      const entry of
      entries
    ) {
      if (
        [
          "node_modules",
          ".next",
          ".git",
          "dist",
          "build",
          "coverage",
        ].includes(
          entry.name
        )
      ) {
        continue;
      }

      const full =
        join(
          current,
          entry.name
        );

      if (
        entry.isDirectory()
      ) {
        stack.push(
          full
        );
      } else if (
        entry.isFile()
      ) {
        output.push(
          full
        );
      }
    }
  }

  return output;
}

/*
 * ============================================
 * Local Environment
 * ============================================
 */

function loadLocalEnvironment() {
  if (
    cachedEnv
  ) {
    return cachedEnv;
  }

  const env = {
    ...process.env,
  };

  /*
   * ترتیب شبیه Next.js:
   * فایل‌های بعدی مقدار قبلی را Override می‌کنند.
   *
   * هیچ Secretی چاپ نمی‌شود.
   */
  for (
    const file of [
      ".env",
      ".env.local",
      ".env.production",
      ".env.production.local",
    ]
  ) {
    const path =
      join(
        ROOT,
        file
      );

    if (
      !existsSync(
        path
      )
    ) {
      continue;
    }

    Object.assign(
      env,
      parseDotEnv(
        readFileSync(
          path,
          "utf8"
        )
      )
    );
  }

  cachedEnv =
    env;

  return env;
}

/*
 * ============================================
 * dotenv parser
 * ============================================
 */

function parseDotEnv(
  text
) {
  const result =
    {};

  for (
    const rawLine of
    text.split(
      /\r?\n/
    )
  ) {
    const line =
      rawLine.trim();

    if (
      !line ||
      line.startsWith(
        "#"
      )
    ) {
      continue;
    }

    const clean =
      line.startsWith(
        "export "
      )
        ? line.slice(
            7
          )
        : line;

    const index =
      clean.indexOf(
        "="
      );

    if (
      index <=
      0
    ) {
      continue;
    }

    const key =
      clean
        .slice(
          0,
          index
        )
        .trim();

    let value =
      clean
        .slice(
          index +
            1
        )
        .trim();

    if (
      (
        value.startsWith(
          '"'
        ) &&
        value.endsWith(
          '"'
        )
      ) ||
      (
        value.startsWith(
          "'"
        ) &&
        value.endsWith(
          "'"
        )
      )
    ) {
      value =
        value.slice(
          1,
          -1
        );
    }

    result[
      key
    ] =
      value;
  }

  return result;
}

function isConfigured(
  value
) {
  return (
    typeof value ===
      "string" &&
    value.trim() !==
      ""
  );
}

/*
 * ============================================
 * Git Helpers
 * ============================================
 */

function gitTracked(
  file
) {
  try {
    const output =
      execFileSync(
        "git",
        [
          "ls-files",
          "--error-unmatch",
          file,
        ],
        {
          cwd:
            ROOT,

          encoding:
            "utf8",

          stdio: [
            "ignore",
            "pipe",
            "ignore",
          ],
        }
      );

    return Boolean(
      output.trim()
    );
  } catch {
    return false;
  }
}

function runGit(
  args
) {
  try {
    return execFileSync(
      "git",
      args,
      {
        cwd:
          ROOT,

        encoding:
          "utf8",

        stdio: [
          "ignore",
          "pipe",
          "ignore",
        ],
      }
    );
  } catch {
    return "";
  }
}

