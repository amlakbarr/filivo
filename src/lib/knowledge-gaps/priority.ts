/*
 * ============================================
 * Knowledge Gap Priority
 *
 * این فایل تنها Source of Truth برای:
 *
 * - محاسبه priority_score
 * - توضیح سهم هر عامل
 * - تشخیص Grounding Risk
 *
 * است.
 * ============================================
 */

export type KnowledgeGapPriorityInput = {
  occurrenceCount:
    number;

  uniqueUsers:
    number;

  uniqueDepartments:
    number;

  noEvidenceBlockedCount:
    number;

  verifierBlockedCount:
    number;

  unsupportedClaimsCount:
    number;
};

export type KnowledgeGapPriorityFactorKey =
  | "occurrence"
  | "unique_users"
  | "unique_departments"
  | "no_evidence_block"
  | "verifier_block"
  | "unsupported_claim";

export type KnowledgeGapPriorityFactor = {
  key:
    KnowledgeGapPriorityFactorKey;

  label:
    string;

  count:
    number;

  weight:
    number;

  score:
    number;
};

export type KnowledgeGapPriorityBreakdown = {
  totalScore:
    number;

  factors:
    KnowledgeGapPriorityFactor[];

  dominantFactors:
    KnowledgeGapPriorityFactor[];
};

export type KnowledgeGapGroundingRiskSummary = {
  noEvidenceBlockedCount:
    number;

  verifierBlockedCount:
    number;

  unsupportedClaimsCount:
    number;
};

export type KnowledgeGapGroundingMessage = {
  grounding_gate_reason?:
    unknown;

  grounding_verifier_status?:
    unknown;

  grounding_unsupported_claims?:
    unknown;
};

/*
 * ============================================
 * Weights
 * ============================================
 */

const PRIORITY_WEIGHTS = {
  occurrence:
    2,

  uniqueUsers:
    3,

  uniqueDepartments:
    5,

  noEvidenceBlocked:
    4,

  verifierBlocked:
    12,

  unsupportedClaim:
    3,
} as const;

/*
 * ============================================
 * Priority Calculation
 * ============================================
 */

export function calculateKnowledgeGapPriority(
  input:
    KnowledgeGapPriorityInput
) {
  return calculateKnowledgeGapPriorityBreakdown(
    input
  ).totalScore;
}

export function calculateKnowledgeGapPriorityBreakdown(
  input:
    KnowledgeGapPriorityInput
): KnowledgeGapPriorityBreakdown {
  const normalized =
    normalizePriorityInput(
      input
    );

  const factors:
    KnowledgeGapPriorityFactor[] = [
      createFactor(
        "occurrence",
        "تکرار سؤال",
        normalized.occurrenceCount,
        PRIORITY_WEIGHTS.occurrence
      ),

      createFactor(
        "unique_users",
        "کاربران یکتا",
        normalized.uniqueUsers,
        PRIORITY_WEIGHTS.uniqueUsers
      ),

      createFactor(
        "unique_departments",
        "واحدهای سازمانی",
        normalized.uniqueDepartments,
        PRIORITY_WEIGHTS.uniqueDepartments
      ),

      createFactor(
        "no_evidence_block",
        "Block بدون Evidence",
        normalized.noEvidenceBlockedCount,
        PRIORITY_WEIGHTS.noEvidenceBlocked
      ),

      createFactor(
        "verifier_block",
        "Block توسط Verifier",
        normalized.verifierBlockedCount,
        PRIORITY_WEIGHTS.verifierBlocked
      ),

      createFactor(
        "unsupported_claim",
        "Claim بدون مدرک",
        normalized.unsupportedClaimsCount,
        PRIORITY_WEIGHTS.unsupportedClaim
      ),
    ];

  const totalScore =
    clampScore(
      factors.reduce(
        (
          total,
          factor
        ) =>
          total +
          factor.score,
        0
      )
    );

  const dominantFactors =
    factors
      .filter(
        (
          factor
        ) =>
          factor.score >
          0
      )
      .sort(
        (
          left,
          right
        ) =>
          right.score -
          left.score ||
          right.count -
          left.count
      )
      .slice(
        0,
        3
      );

  return {
    totalScore,

    factors,

    dominantFactors,
  };
}

/*
 * ============================================
 * Grounding Risk Summary
 * ============================================
 */

export function summarizeKnowledgeGapGroundingRisk(
  messages:
    KnowledgeGapGroundingMessage[]
): KnowledgeGapGroundingRiskSummary {
  let noEvidenceBlockedCount =
    0;

  let verifierBlockedCount =
    0;

  let unsupportedClaimsCount =
    0;

  for (
    const message of
    messages
  ) {
    if (
      isOperationalKnowledgeGapGroundingBlock(
        message
      )
    ) {
      continue;
    }

    const gateReason =
      String(
        message
          .grounding_gate_reason ||
          ""
      );

    const verifierStatus =
      String(
        message
          .grounding_verifier_status ||
          ""
      );

    if (
      gateReason ===
        "missing_verified_knowledge" ||
      gateReason ===
        "model_declared_insufficient" ||
      verifierStatus ===
        "no_evidence"
    ) {
      noEvidenceBlockedCount +=
        1;
    }

    if (
      verifierStatus ===
      "unsupported_claims"
    ) {
      verifierBlockedCount +=
        1;

      unsupportedClaimsCount +=
        parseKnowledgeGapUnsupportedClaims(
          message
            .grounding_unsupported_claims
        ).length;
    }
  }

  return {
    noEvidenceBlockedCount,

    verifierBlockedCount,

    unsupportedClaimsCount,
  };
}

/*
 * ============================================
 * Operational Block
 *
 * این موارد مشکل Knowledge نیستند و نباید
 * Priority محتوایی Gap را بالا ببرند.
 * ============================================
 */

export function isOperationalKnowledgeGapGroundingBlock(
  message:
    KnowledgeGapGroundingMessage
) {
  const verifierStatus =
    String(
      message
        .grounding_verifier_status ||
        ""
    );

  return (
    verifierStatus ===
      "verifier_unavailable" ||
    verifierStatus ===
      "budget_blocked" ||
    verifierStatus ===
      "invalid_verifier_response"
  );
}

/*
 * ============================================
 * Unsupported Claims
 * ============================================
 */

export function parseKnowledgeGapUnsupportedClaims(
  value:
    unknown
) {
  if (
    typeof value !==
    "string"
  ) {
    return [];
  }

  const text =
    value.trim();

  if (
    !text
  ) {
    return [];
  }

  try {
    const parsed:
      unknown =
        JSON.parse(
          text
        );

    if (
      !Array.isArray(
        parsed
      )
    ) {
      return [];
    }

    return parsed
      .filter(
        (
          item
        ): item is string =>
          typeof item ===
          "string"
      )
      .map(
        (
          item
        ) =>
          item
            .replace(
              /\s+/g,
              " "
            )
            .trim()
            .slice(
              0,
              500
            )
      )
      .filter(
        Boolean
      )
      .slice(
        0,
        8
      );
  } catch {
    return [];
  }
}

/*
 * ============================================
 * Helpers
 * ============================================
 */

function createFactor(
  key:
    KnowledgeGapPriorityFactorKey,

  label:
    string,

  count:
    number,

  weight:
    number
): KnowledgeGapPriorityFactor {
  const safeCount =
    positiveInteger(
      count
    );

  return {
    key,

    label,

    count:
      safeCount,

    weight,

    score:
      safeCount *
      weight,
  };
}

function normalizePriorityInput(
  input:
    KnowledgeGapPriorityInput
): KnowledgeGapPriorityInput {
  return {
    occurrenceCount:
      positiveInteger(
        input.occurrenceCount
      ),

    uniqueUsers:
      positiveInteger(
        input.uniqueUsers
      ),

    uniqueDepartments:
      positiveInteger(
        input.uniqueDepartments
      ),

    noEvidenceBlockedCount:
      positiveInteger(
        input.noEvidenceBlockedCount
      ),

    verifierBlockedCount:
      positiveInteger(
        input.verifierBlockedCount
      ),

    unsupportedClaimsCount:
      positiveInteger(
        input.unsupportedClaimsCount
      ),
  };
}

function positiveInteger(
  value:
    number
) {
  if (
    !Number.isFinite(
      value
    )
  ) {
    return 0;
  }

  return Math.max(
    0,
    Math.trunc(
      value
    )
  );
}

function clampScore(
  value:
    number
) {
  return Math.max(
    0,
    Math.min(
      1_000_000,
      Math.round(
        value
      )
    )
  );
}
