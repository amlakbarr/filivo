import {
  NextResponse,
  type NextRequest,
} from "next/server";

const UNSAFE_METHODS =
  new Set([
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
  ]);

/*
 * ============================================
 * Proxy
 * ============================================
 */

export function proxy(
  request: NextRequest
) {
  const pathname =
    request.nextUrl.pathname;

  const isApi =
    pathname === "/api" ||
    pathname.startsWith(
      "/api/"
    );

  /*
   * ==========================================
   * CSRF / Origin Protection
   * ==========================================
   */

  if (
    isApi &&
    UNSAFE_METHODS.has(
      request.method.toUpperCase()
    )
  ) {
    const csrfFailure =
      validateMutationOrigin(
        request
      );

    if (csrfFailure) {
      return csrfFailure;
    }
  }

  /*
   * APIها به CSP nonce نیازی ندارند.
   */
  if (isApi) {
    return NextResponse.next();
  }

  /*
   * ==========================================
   * CSP Nonce
   * ==========================================
   */

  const nonce =
    crypto.randomUUID();

  const isDev =
    process.env.NODE_ENV ===
    "development";

  const csp =
    buildContentSecurityPolicy(
      nonce,
      isDev
    );

  /*
   * Next.js nonce را از Request CSP
   * استخراج می‌کند.
   */
  const requestHeaders =
    new Headers(
      request.headers
    );

  requestHeaders.set(
    "x-nonce",
    nonce
  );

  requestHeaders.set(
    "Content-Security-Policy",
    csp
  );

  const response =
    NextResponse.next({
      request: {
        headers:
          requestHeaders,
      },
    });

  /*
   * ==========================================
   * Report Only → Enforce
   *
   * در مرحله اول:
   * CSP_ENFORCE=false
   *
   * بعد از تست:
   * CSP_ENFORCE=true
   * ==========================================
   */

  const enforce =
    process.env
      .CSP_ENFORCE ===
    "true";

  response.headers.set(
    enforce
      ? "Content-Security-Policy"
      : "Content-Security-Policy-Report-Only",
    csp
  );

  return response;
}

/*
 * ============================================
 * CSP
 * ============================================
 */

function buildContentSecurityPolicy(
  nonce: string,
  isDev: boolean
) {
  const directives = [
    "default-src 'self'",

    [
      "script-src",
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(isDev
        ? [
            "'unsafe-eval'",
          ]
        : []),
    ].join(" "),

    /*
     * Next.js در Development برای Styleها
     * به unsafe-inline نیاز پیدا می‌کند.
     *
     * Production از nonce استفاده می‌کند.
     */
    [
      "style-src",
      "'self'",
      isDev
        ? "'unsafe-inline'"
        : `'nonce-${nonce}'`,
    ].join(" "),

    "img-src 'self' data: blob:",

    "font-src 'self' data:",

    /*
     * تمام APIهای Browser فعلی Same-Origin
     * هستند.
     *
     * ws/wss فقط برای HMR محیط Development.
     */
    [
      "connect-src",
      "'self'",
      ...(isDev
        ? [
            "ws:",
            "wss:",
          ]
        : []),
    ].join(" "),

    "media-src 'self' blob:",

    "worker-src 'self' blob:",

    "object-src 'none'",

    "base-uri 'self'",

    "form-action 'self'",

    /*
     * با X-Frame-Options: SAMEORIGIN
     * مرحله قبل هماهنگ است.
     */
    "frame-ancestors 'self'",

    "manifest-src 'self'",

    /*
     * Local Development روی HTTP است،
     * بنابراین فقط Production فعال می‌شود.
     */
    ...(!isDev
      ? [
          "upgrade-insecure-requests",
        ]
      : []),
  ];

  return `${directives.join(
    "; "
  )};`;
}

/*
 * ============================================
 * CSRF Validation
 * ============================================
 */

function validateMutationOrigin(
  request: NextRequest
): NextResponse | null {
  /*
   * Fetch Metadata
   */
  const fetchSite =
    request.headers.get(
      "sec-fetch-site"
    );

  if (
    fetchSite ===
    "cross-site"
  ) {
    return csrfError(
      "CROSS_SITE_REQUEST"
    );
  }

  /*
   * Origin
   */
  const origin =
    normalizeOrigin(
      request.headers.get(
        "origin"
      )
    );

  /*
   * Referer fallback
   */
  const refererOrigin =
    getRefererOrigin(
      request.headers.get(
        "referer"
      )
    );

  const requestOrigin =
    origin ||
    refererOrigin;

  if (!requestOrigin) {
    return csrfError(
      "ORIGIN_REQUIRED"
    );
  }

  const allowedOrigins =
    getAllowedOrigins();

  if (
    !allowedOrigins.has(
      requestOrigin
    )
  ) {
    return csrfError(
      "ORIGIN_NOT_ALLOWED"
    );
  }

  return null;
}

/*
 * ============================================
 * Allowed Origins
 * ============================================
 */

function getAllowedOrigins() {
  const origins =
    new Set<string>();

  /*
   * Canonical Application Origin
   */
  addOrigin(
    origins,
    process.env.APP_ORIGIN
  );

  /*
   * Optional additional origins.
   *
   * مثال:
   * CSRF_ALLOWED_ORIGINS=
   * https://preview.example.com,
   * https://staging.example.com
   */
  const additional =
    String(
      process.env
        .CSRF_ALLOWED_ORIGINS ||
        ""
    )
      .split(",")
      .map(
        (
          value
        ) =>
          value.trim()
      )
      .filter(Boolean);

  for (
    const origin of
    additional
  ) {
    addOrigin(
      origins,
      origin
    );
  }

  /*
   * Development فقط
   */
  if (
    process.env.NODE_ENV !==
    "production"
  ) {
    addOrigin(
      origins,
      "http://localhost:3000"
    );

    addOrigin(
      origins,
      "http://127.0.0.1:3000"
    );
  }

  return origins;
}

function addOrigin(
  origins: Set<string>,
  value:
    string |
    null |
    undefined
) {
  const normalized =
    normalizeOrigin(
      value
    );

  if (normalized) {
    origins.add(
      normalized
    );
  }
}

function normalizeOrigin(
  value:
    string |
    null |
    undefined
) {
  if (!value) {
    return "";
  }

  try {
    const url =
      new URL(
        value
      );

    if (
      url.protocol !==
        "http:" &&
      url.protocol !==
        "https:"
    ) {
      return "";
    }

    return url.origin;
  } catch {
    return "";
  }
}

function getRefererOrigin(
  value:
    string |
    null
) {
  if (!value) {
    return "";
  }

  try {
    return normalizeOrigin(
      new URL(
        value
      ).origin
    );
  } catch {
    return "";
  }
}

/*
 * ============================================
 * CSRF Error
 * ============================================
 */

function csrfError(
  reason: string
) {
  const requestId =
    crypto.randomUUID();

  return NextResponse.json(
    {
      success:
        false,

      code:
        "CSRF_VALIDATION_FAILED",

      reason,

      message:
        "مبدأ درخواست معتبر نیست.",

      requestId,
    },
    {
      status:
        403,

      headers: {
        "Cache-Control":
          "no-store",

        "X-Request-Id":
          requestId,
      },
    }
  );
}

/*
 * ============================================
 * Matcher
 *
 * 1. تمام APIها برای CSRF
 * 2. صفحات برای CSP
 * 3. Static assets / prefetch حذف می‌شوند
 * ============================================
 */

export const config = {
  matcher: [
    "/api/:path*",

    {
      source:
        "/((?!api|_next/static|_next/image|favicon.ico).*)",

      missing: [
        {
          type:
            "header",

          key:
            "next-router-prefetch",
        },

        {
          type:
            "header",

          key:
            "purpose",

          value:
            "prefetch",
        },
      ],
    },
  ],
};