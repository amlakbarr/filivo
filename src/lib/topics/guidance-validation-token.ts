import "server-only";

import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

const TOKEN_VERSION =
  3;

const DEFAULT_TTL_SECONDS =
  10 *
  60;

const MAX_TOKEN_LENGTH =
  8_000;

export type GuidanceValidationDraft = {
  keywords:
    string;

  examples:
    string;

  negativeExamples:
    string;

  classificationNote:
    string;
};

export type GuidanceValidationMetrics = {
  accuracy:
    number;

  failed:
    number;

  errors:
    number;

  regressed:
    number;

  improved:
    number;

  compared:
    number;
};

export type GuidanceValidationClaims = {
  v:
    3;

  jti:
    string;

  adminId:
    string;

  topicId:
    string;

  topicUpdated:
    string;

  /*
   * Shared Baseline revision used during Validation.
   * Empty strings mean no baseline existed.
   */
  baselineId:
    string;

  baselineUpdated:
    string;

  evidenceRevision:
    string;

  fingerprint:
    string;

  issuedAt:
    number;

  expiresAt:
    number;

  metrics:
    GuidanceValidationMetrics;
};

export type GuidanceValidationVerifyResult =
  | {
      ok:
        true;

      claims:
        GuidanceValidationClaims;
    }
  | {
      ok:
        false;

      code:
        string;

      message:
        string;
    };

/*
 * ============================================
 * Fingerprint
 *
 * Must use the same normalized values that will
 * finally be persisted by the Topic PATCH route.
 * ============================================
 */

export function guidanceValidationFingerprint({
  topicId,
  draft,
}: {
  topicId:
    string;

  draft:
    GuidanceValidationDraft;
}) {
  const serialized =
    JSON.stringify({
      topicId:
        String(
          topicId ||
            ""
        ).trim(),

      keywords:
        normalizeGuidanceText(
          draft.keywords
        ),

      examples:
        normalizeGuidanceText(
          draft.examples
        ),

      negativeExamples:
        normalizeGuidanceText(
          draft.negativeExamples
        ),

      classificationNote:
        normalizeGuidanceText(
          draft.classificationNote
        ),
    });

  return createHash(
    "sha256"
  )
    .update(
      serialized,
      "utf8"
    )
    .digest(
      "base64url"
    );
}

/*
 * ============================================
 * Issue Certificate
 * ============================================
 */

export function issueGuidanceValidationToken({
  adminId,
  topicId,
  topicUpdated,
  baselineId,
  baselineUpdated,
  evidenceRevision,
  draft,
  metrics,
  ttlSeconds =
    DEFAULT_TTL_SECONDS,
}: {
  adminId:
    string;

  topicId:
    string;

  topicUpdated:
    string;

  baselineId:
    string;

  baselineUpdated:
    string;

  evidenceRevision:
    string;

  draft:
    GuidanceValidationDraft;

  metrics:
    GuidanceValidationMetrics;

  ttlSeconds?:
    number;
}) {
  const now =
    Math.floor(
      Date.now() /
        1000
    );

  const claims:
    GuidanceValidationClaims = {
      v:
        TOKEN_VERSION,

      jti:
        randomUUID(),

      adminId:
        cleanId(
          adminId
        ),

      topicId:
        cleanId(
          topicId
        ),

      topicUpdated:
        String(
          topicUpdated ||
            ""
        ).trim(),

      baselineId:
        cleanId(
          baselineId
        ),

      baselineUpdated:
        String(
          baselineUpdated ||
            ""
        ).trim(),

      evidenceRevision:
        String(
          evidenceRevision ||
            ""
        ).trim(),

      fingerprint:
        guidanceValidationFingerprint({
          topicId,

          draft,
        }),

      issuedAt:
        now,

      expiresAt:
        now +
        Math.max(
          60,
          Math.min(
            30 *
              60,
            Math.trunc(
              ttlSeconds
            ) ||
              DEFAULT_TTL_SECONDS
          )
        ),

      metrics: {
        accuracy:
          clampRatio(
            metrics.accuracy
          ),

        failed:
          safeCount(
            metrics.failed
          ),

        errors:
          safeCount(
            metrics.errors
          ),

        regressed:
          safeCount(
            metrics.regressed
          ),

        improved:
          safeCount(
            metrics.improved
          ),

        compared:
          safeCount(
            metrics.compared
          ),
      },
    };

  if (
    !claims.adminId ||
    !claims.topicId ||
    !claims.topicUpdated
  ) {
    throw new Error(
      "Guidance validation claims are incomplete"
    );
  }

  const payload =
    Buffer.from(
      JSON.stringify(
        claims
      ),
      "utf8"
    ).toString(
      "base64url"
    );

  const signature =
    sign(
      payload
    );

  return {
    token:
      `${payload}.${signature}`,

    claims,
  };
}

/*
 * ============================================
 * Verify Certificate
 * ============================================
 */

export function verifyGuidanceValidationToken({
  token,
  adminId,
  topicId,
  topicUpdated,
  baselineId,
  baselineUpdated,
  evidenceRevision,
  draft,
}: {
  token:
    string;

  adminId:
    string;

  topicId:
    string;

  topicUpdated:
    string;

  baselineId:
    string;

  baselineUpdated:
    string;

  evidenceRevision:
    string;

  draft:
    GuidanceValidationDraft;
}):
  GuidanceValidationVerifyResult {
  const safeToken =
    String(
      token ||
        ""
    ).trim();

  if (
    !safeToken ||
    safeToken.length >
      MAX_TOKEN_LENGTH
  ) {
    return invalid(
      "TOPIC_GUIDANCE_VALIDATION_REQUIRED",
      "برای تغییر Guidance یک Validation معتبر لازم است."
    );
  }

  const parts =
    safeToken.split(
      "."
    );

  if (
    parts.length !==
    2
  ) {
    return invalid(
      "TOPIC_GUIDANCE_VALIDATION_TOKEN_INVALID",
      "گواهی Validation معتبر نیست."
    );
  }

  const [
    payload,
    providedSignature,
  ] =
    parts;

  const expectedSignature =
    sign(
      payload
    );

  if (
    !safeEqual(
      providedSignature,
      expectedSignature
    )
  ) {
    return invalid(
      "TOPIC_GUIDANCE_VALIDATION_TOKEN_INVALID",
      "گواهی Validation معتبر نیست."
    );
  }

  let claims:
    GuidanceValidationClaims;

  try {
    claims =
      JSON.parse(
        Buffer.from(
          payload,
          "base64url"
        ).toString(
          "utf8"
        )
      ) as
        GuidanceValidationClaims;
  } catch {
    return invalid(
      "TOPIC_GUIDANCE_VALIDATION_TOKEN_INVALID",
      "گواهی Validation قابل خواندن نیست."
    );
  }

  if (
    claims.v !==
      TOKEN_VERSION ||
    !claims.jti ||
    !claims.adminId ||
    !claims.topicId ||
    !claims.topicUpdated ||
    typeof claims.baselineId !==
      "string" ||
    typeof claims.baselineUpdated !==
      "string" ||
    typeof claims.evidenceRevision !==
      "string" ||
    !claims.fingerprint
  ) {
    return invalid(
      "TOPIC_GUIDANCE_VALIDATION_TOKEN_INVALID",
      "ساختار گواهی Validation معتبر نیست."
    );
  }

  const now =
    Math.floor(
      Date.now() /
        1000
    );

  if (
    !Number.isFinite(
      claims.expiresAt
    ) ||
    claims.expiresAt <=
      now
  ) {
    return invalid(
      "TOPIC_GUIDANCE_VALIDATION_EXPIRED",
      "اعتبار Validation منقضی شده است؛ Draft را دوباره Validation کنید."
    );
  }

  if (
    claims.issuedAt >
      now +
        30
  ) {
    return invalid(
      "TOPIC_GUIDANCE_VALIDATION_TOKEN_INVALID",
      "زمان گواهی Validation معتبر نیست."
    );
  }

  if (
    claims.adminId !==
    cleanId(
      adminId
    )
  ) {
    return invalid(
      "TOPIC_GUIDANCE_VALIDATION_ADMIN_MISMATCH",
      "این Validation توسط Admin دیگری صادر شده است."
    );
  }

  if (
    claims.topicId !==
    cleanId(
      topicId
    )
  ) {
    return invalid(
      "TOPIC_GUIDANCE_VALIDATION_TOPIC_MISMATCH",
      "Validation متعلق به Topic دیگری است."
    );
  }

  if (
    claims.topicUpdated !==
    String(
      topicUpdated ||
        ""
    ).trim()
  ) {
    return invalid(
      "TOPIC_GUIDANCE_VALIDATION_STALE_TOPIC",
      "Topic بعد از Validation تغییر کرده است؛ Validation را دوباره اجرا کنید."
    );
  }

  if (
    claims.baselineId !==
      cleanId(
        baselineId
      ) ||
    claims.baselineUpdated !==
      String(
        baselineUpdated ||
          ""
      ).trim()
  ) {
    return invalid(
      "TOPIC_GUIDANCE_VALIDATION_STALE_BASELINE",
      "Shared Baseline بعد از Validation تغییر کرده است؛ Draft را دوباره Validation کنید."
    );
  }

  if (
    claims.evidenceRevision !==
    String(
      evidenceRevision ||
        ""
    ).trim()
  ) {
    return invalid(
      "TOPIC_GUIDANCE_VALIDATION_STALE_EVIDENCE",
      "Human Review جدید بعد از Validation ثبت شده است؛ Draft را دوباره Validation کنید."
    );
  }

  const fingerprint =
    guidanceValidationFingerprint({
      topicId,

      draft,
    });

  if (
    claims.fingerprint !==
    fingerprint
  ) {
    return invalid(
      "TOPIC_GUIDANCE_VALIDATION_DRAFT_MISMATCH",
      "Guidance فعلی با Draft تأییدشده یکسان نیست؛ Validation را دوباره اجرا کنید."
    );
  }

  if (
    claims.metrics.errors >
      0 ||
    claims.metrics.regressed >
      0
  ) {
    return invalid(
      "TOPIC_GUIDANCE_VALIDATION_NOT_APPROVED",
      "Validation ثبت‌شده شرایط لازم برای انتشار Guidance را ندارد."
    );
  }

  return {
    ok:
      true,

    claims,
  };
}

/*
 * ============================================
 * Helpers
 * ============================================
 */

function sign(
  payload:
    string
) {
  return createHmac(
    "sha256",
    getSecret()
  )
    .update(
      payload,
      "utf8"
    )
    .digest(
      "base64url"
    );
}

function getSecret() {
  const secret =
    String(
      process.env
        .GUIDANCE_VALIDATION_TOKEN_SECRET ||
        ""
    ).trim();

  if (
    secret.length <
    32
  ) {
    throw new Error(
      "GUIDANCE_VALIDATION_TOKEN_SECRET must contain at least 32 characters"
    );
  }

  return secret;
}

function normalizeGuidanceText(
  value:
    unknown
) {
  if (
    typeof value !==
    "string"
  ) {
    return "";
  }

  return value
    .replace(
      /\r\n?/g,
      "\n"
    )
    .split(
      "\n"
    )
    .map(
      (
        line
      ) =>
        line.trim()
    )
    .filter(
      (
        line,
        index,
        lines
      ) =>
        Boolean(
          line
        ) &&
        lines.indexOf(
          line
        ) ===
          index
    )
    .join(
      "\n"
    )
    .trim();
}

function safeEqual(
  first:
    string,

  second:
    string
) {
  try {
    const firstBuffer =
      Buffer.from(
        first,
        "utf8"
      );

    const secondBuffer =
      Buffer.from(
        second,
        "utf8"
      );

    return (
      firstBuffer.length ===
        secondBuffer.length &&
      timingSafeEqual(
        firstBuffer,
        secondBuffer
      )
    );
  } catch {
    return false;
  }
}

function cleanId(
  value:
    unknown
) {
  const id =
    String(
      value ||
        ""
    ).trim();

  return /^[a-zA-Z0-9_-]{1,64}$/.test(
    id
  )
    ? id
    : "";
}

function clampRatio(
  value:
    unknown
) {
  const number =
    Number(
      value
    );

  if (
    !Number.isFinite(
      number
    )
  ) {
    return 0;
  }

  return Math.max(
    0,
    Math.min(
      1,
      number
    )
  );
}

function safeCount(
  value:
    unknown
) {
  const number =
    Number(
      value
    );

  if (
    !Number.isFinite(
      number
    )
  ) {
    return 0;
  }

  return Math.max(
    0,
    Math.trunc(
      number
    )
  );
}

function invalid(
  code:
    string,

  message:
    string
):
  GuidanceValidationVerifyResult {
  return {
    ok:
      false,

    code,

    message,
  };
}
