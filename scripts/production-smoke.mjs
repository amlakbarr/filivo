#!/usr/bin/env node

/*
 * ============================================
 * Production Smoke Test
 *
 * Usage:
 *
 * BASE_URL=https://your-domain.example \
 * node scripts/production-smoke.mjs
 *
 * Windows PowerShell:
 *
 * $env:BASE_URL="https://..."
 * node scripts/production-smoke.mjs
 *
 * این تست Login انجام نمی‌دهد و Secret یا Cookie
 * نمی‌خواهد. هدف:
 *
 * 1. App reachable
 * 2. Login page reachable
 * 3. Admin pages protected
 * 4. Admin APIs protected
 * 5. OpenAI diagnostic endpoint protected
 * ============================================
 */

const rawBaseUrl =
  String(
    process.env
      .BASE_URL ||
      ""
  ).trim();

if (
  !rawBaseUrl
) {
  console.error(
    "BASE_URL تنظیم نشده است."
  );

  process.exit(
    2
  );
}

let baseUrl;

try {
  baseUrl =
    new URL(
      rawBaseUrl
    );

  if (
    ![
      "http:",
      "https:",
    ].includes(
      baseUrl.protocol
    )
  ) {
    throw new Error(
      "Unsupported protocol"
    );
  }
} catch {
  console.error(
    "BASE_URL معتبر نیست."
  );

  process.exit(
    2
  );
}

const timeoutMs =
  environmentInteger(
    process.env
      .SMOKE_TIMEOUT_MS,
    1_000,
    60_000,
    12_000
  );

const results =
  [];

await main();

async function main() {
  console.log(
    `Production smoke: ${baseUrl.origin}`
  );

  /*
   * Public page.
   */
  await expectStatus({
    name:
      "Login page",

    path:
      "/login",

    method:
      "GET",

    accepted:
      [
        200,
      ],

    redirect:
      "manual",
  });

  /*
   * Protected Admin page:
   * Next redirect may be 307/308 or middleware can
   * produce another standard redirect.
   */
  await expectStatus({
    name:
      "Admin page requires login",

    path:
      "/admin",

    method:
      "GET",

    accepted:
      [
        301,
        302,
        303,
        307,
        308,
      ],

    redirect:
      "manual",

    validate:
      (
        response
      ) => {
        const location =
          response.headers.get(
            "location"
          ) ||
          "";

        return location.includes(
          "/login"
        )
          ? null
          : `redirect location=${location || "missing"}`;
      },
  });

  /*
   * Protected Admin APIs.
   *
   * 401 is preferred. 403 is accepted if deployment
   * policy intentionally maps unauthenticated access
   * to forbidden.
   */
  for (
    const path of
    [
      "/api/admin/health-dashboard",
      "/api/admin/evals/release-gate",
      "/api/admin/evals/coverage",
      "/api/admin/evals/alerts",
    ]
  ) {
    await expectStatus({
      name:
        `Protected ${path}`,

      path,

      method:
        "GET",

      accepted:
        [
          401,
          403,
        ],

      redirect:
        "manual",
    });
  }

  /*
   * Diagnostic OpenAI endpoint must not be publicly
   * callable because it can spend tokens.
   */
  await expectStatus({
    name:
      "OpenAI test endpoint protected",

    path:
      "/api/ai/test",

    method:
      "GET",

    accepted:
      [
        401,
        403,
      ],

    redirect:
      "manual",
  });

  finish();
}

async function expectStatus({
  name,
  path,
  method,
  accepted,
  redirect,
  validate,
}) {
  const url =
    new URL(
      path,
      baseUrl
    );

  const started =
    Date.now();

  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      timeoutMs
    );

  try {
    const response =
      await fetch(
        url,
        {
          method,

          redirect,

          signal:
            controller.signal,

          headers: {
            "User-Agent":
              "callcenter-production-smoke/1.0",

            "Cache-Control":
              "no-cache",
          },
        }
      );

    const latencyMs =
      Date.now() -
      started;

    let validationError =
      null;

    if (
      typeof validate ===
      "function"
    ) {
      validationError =
        validate(
          response
        );
    }

    const ok =
      accepted.includes(
        response.status
      ) &&
      !validationError;

    results.push({
      name,

      path,

      ok,

      status:
        response.status,

      latencyMs,

      error:
        validationError,
    });

    console.log(
      `${
        ok
          ? "✓"
          : "✗"
      } ${name}: HTTP ${response.status} (${latencyMs}ms)${
        validationError
          ? ` · ${validationError}`
          : ""
      }`
    );
  } catch (
    error
  ) {
    const latencyMs =
      Date.now() -
      started;

    const message =
      error instanceof
      Error
        ? error.name ===
            "AbortError"
          ? `timeout after ${timeoutMs}ms`
          : error.message
        : String(
            error
          );

    results.push({
      name,

      path,

      ok:
        false,

      status:
        0,

      latencyMs,

      error:
        message,
    });

    console.log(
      `✗ ${name}: ${message}`
    );
  } finally {
    clearTimeout(
      timer
    );
  }
}

function finish() {
  const failed =
    results.filter(
      (
        item
      ) =>
        !item.ok
    );

  console.log();

  if (
    failed.length >
    0
  ) {
    console.log(
      `NO-GO: ${failed.length} smoke check failed.`
    );

    process.exitCode =
      1;

    return;
  }

  console.log(
    `GO: ${results.length} production smoke checks passed.`
  );
}

function environmentInteger(
  value,
  minimum,
  maximum,
  fallback
) {
  const number =
    Number(
      value
    );

  if (
    !Number.isInteger(
      number
    )
  ) {
    return fallback;
  }

  return Math.min(
    maximum,
    Math.max(
      minimum,
      number
    )
  );
}
