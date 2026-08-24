import {
  createHmac,
  randomUUID,
} from "node:crypto";

import { getPocketBaseServiceClient } from "@/lib/pocketbase/service";

/*
 * ============================================
 * Types
 * ============================================
 */

export type AuditActorRole =
  | "employee"
  | "admin"
  | "system";

export type AuditResult =
  | "success"
  | "failure"
  | "blocked";

export type AuditMetadata =
  Record<string, unknown>;

export type AuditLogInput = {
  /*
   * نمونه:
   *
   * auth.login.success
   * knowledge.publish
   * gap.resolve
   */
  action: string;

  result: AuditResult;

  /*
   * Account انجام‌دهنده عملیات.
   *
   * برای Login failure ممکن است
   * actor وجود نداشته باشد.
   */
  actorId?: string;

  actorRole?:
    AuditActorRole;

  /*
   * موجودیتی که عملیات روی آن انجام شده.
   */
  entityType?: string;

  entityId?: string;

  /*
   * اگر Admin روی Account دیگری
   * عملیاتی انجام داده باشد.
   */
  targetUserId?: string;

  /*
   * Request ID موجود را می‌توانیم
   * از Route وارد کنیم.
   */
  requestId?: string;

  /*
   * اگر Request وجود داشته باشد،
   * IP فقط Hash می‌شود.
   */
  request?: Request;

  metadata?:
    AuditMetadata;

  errorCode?: string;
};

export type AuditWriteResult =
  | {
      success: true;
      auditLogId: string;
    }
  | {
      success: false;
    };

/*
 * ============================================
 * Safe public logger
 *
 * این تابع برای استفاده معمول در Routeهاست.
 *
 * خرابی Audit Log نباید عملیات اصلی
 * کاربر را Fail کند.
 * ============================================
 */

export async function recordAuditLog(
  input: AuditLogInput
): Promise<AuditWriteResult> {
  try {
    const id =
      await writeAuditLog(
        input
      );

    return {
      success:
        true,

      auditLogId:
        id,
    };
  } catch (error) {
    /*
     * هیچ Metadata اصلی را Log نمی‌کنیم
     * چون ممکن است اطلاعات حساس داشته باشد.
     */

    console.error(
      "Audit log write failed",
      {
        action:
          sanitizeActionForLog(
            input.action
          ),

        result:
          input.result,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return {
      success:
        false,
    };
  }
}

/*
 * ============================================
 * Strict writer
 *
 * در صورت خطا Exception می‌دهد.
 *
 * معمولاً recordAuditLog را استفاده خواهیم کرد،
 * ولی این تابع برای مواردی که Audit باید
 * حتماً موفق باشد Export شده است.
 * ============================================
 */

export async function writeAuditLog(
  input: AuditLogInput
): Promise<string> {
  validateAuditInput(
    input
  );

  const pb =
    await getPocketBaseServiceClient();

  const requestId =
    sanitizeText(
      input.requestId ||
        getRequestIdFromRequest(
          input.request
        ) ||
        randomUUID(),
      150
    );

  const ip =
    input.request
      ? getAuditClientIp(
          input.request
        )
      : "";

  const ipHash =
    ip
      ? hashAuditIp(
          ip
        )
      : "";

  const metadata =
    sanitizeAuditMetadata(
      input.metadata ||
        {}
    );

  /*
   * فقط فیلدهایی که واقعاً مقدار دارند
   * برای Relationها ارسال می‌کنیم.
   */
  const data: Record<
    string,
    unknown
  > = {
    action:
      normalizeAction(
        input.action
      ),

    result:
      input.result,

    actor_role:
      input.actorRole ||
      "system",

    request_id:
      requestId,

    metadata,

    ...(input.actorId
      ? {
          actor:
            sanitizeId(
              input.actorId
            ),
        }
      : {}),

    ...(input.entityType
      ? {
          entity_type:
            sanitizeText(
              input.entityType,
              100
            ),
        }
      : {}),

    ...(input.entityId
      ? {
          entity_id:
            sanitizeId(
              input.entityId
            ),
        }
      : {}),

    ...(input.targetUserId
      ? {
          target_user:
            sanitizeId(
              input.targetUserId
            ),
        }
      : {}),

    ...(ipHash
      ? {
          ip_hash:
            ipHash,
        }
      : {}),

    ...(input.errorCode
      ? {
          error_code:
            sanitizeText(
              input.errorCode,
              120
            ),
        }
      : {}),
  };

  const record =
    await pb
      .collection(
        "audit_logs"
      )
      .create(
        data
      );

  return record.id;
}

/*
 * ============================================
 * Validation
 * ============================================
 */

function validateAuditInput(
  input: AuditLogInput
) {
  if (
    !input.action ||
    !input.action.trim()
  ) {
    throw new Error(
      "Audit action is required"
    );
  }

  if (
    ![
      "success",
      "failure",
      "blocked",
    ].includes(
      input.result
    )
  ) {
    throw new Error(
      "Invalid audit result"
    );
  }

  if (
    input.actorRole &&
    ![
      "employee",
      "admin",
      "system",
    ].includes(
      input.actorRole
    )
  ) {
    throw new Error(
      "Invalid audit actor role"
    );
  }
}

/*
 * ============================================
 * Action normalization
 * ============================================
 */

function normalizeAction(
  value: string
) {
  const normalized =
    value
      .trim()
      .toLowerCase()
      .replace(
        /[^a-z0-9._-]/g,
        "_"
      )
      .replace(
        /_+/g,
        "_"
      )
      .slice(
        0,
        120
      );

  if (!normalized) {
    throw new Error(
      "Invalid audit action"
    );
  }

  return normalized;
}

/*
 * ============================================
 * Request ID
 * ============================================
 */

function getRequestIdFromRequest(
  request?: Request
) {
  if (!request) {
    return "";
  }

  /*
   * اگر Proxy یا لایه بالاتر
   * Request ID ساخته باشد استفاده می‌کنیم.
   */

  const candidates = [
    request.headers.get(
      "x-request-id"
    ),

    request.headers.get(
      "x-vercel-id"
    ),

    request.headers.get(
      "cf-ray"
    ),
  ];

  for (
    const value of
    candidates
  ) {
    if (
      value?.trim()
    ) {
      return value.trim();
    }
  }

  return "";
}

/*
 * ============================================
 * IP extraction
 * ============================================
 */

export function getAuditClientIp(
  request: Request
) {
  /*
   * در استقرار پشت Reverse Proxy،
   * معمولاً x-forwarded-for شامل
   * IP اصلی Client است.
   */

  const forwarded =
    request.headers.get(
      "x-forwarded-for"
    );

  if (forwarded) {
    const first =
      forwarded
        .split(
          ","
        )[0]
        ?.trim();

    if (first) {
      return normalizeIp(
        first
      );
    }
  }

  const realIp =
    request.headers
      .get(
        "x-real-ip"
      )
      ?.trim();

  if (realIp) {
    return normalizeIp(
      realIp
    );
  }

  const cloudflareIp =
    request.headers
      .get(
        "cf-connecting-ip"
      )
      ?.trim();

  if (cloudflareIp) {
    return normalizeIp(
      cloudflareIp
    );
  }

  return "";
}

/*
 * ============================================
 * IP hashing
 * ============================================
 */

export function hashAuditIp(
  ip: string
) {
  const pepper =
    process.env
      .AUDIT_IP_PEPPER
      ?.trim();

  /*
   * Production بدون Pepper اجرا نشود.
   */
  if (
    !pepper &&
    process.env.NODE_ENV ===
      "production"
  ) {
    throw new Error(
      "AUDIT_IP_PEPPER is not configured"
    );
  }

  const secret =
    pepper ||
    "development-only-audit-pepper";

  return createHmac(
    "sha256",
    secret
  )
    .update(
      normalizeIp(
        ip
      )
    )
    .digest(
      "hex"
    );
}

/*
 * ============================================
 * Metadata sanitization
 * ============================================
 */

function sanitizeAuditMetadata(
  metadata: AuditMetadata
): AuditMetadata {
  const sanitized =
    sanitizeMetadataValue(
      metadata,
      0
    );

  if (
    typeof sanitized !==
      "object" ||
    sanitized === null ||
    Array.isArray(
      sanitized
    )
  ) {
    return {};
  }

  const object =
    sanitized as AuditMetadata;

  /*
   * از ذخیره JSON بسیار بزرگ جلوگیری می‌کنیم.
   */
  try {
    const serialized =
      JSON.stringify(
        object
      );

    if (
      serialized.length <=
      12_000
    ) {
      return object;
    }

    /*
     * Preview فقط از نسخه Sanitized
     * ساخته می‌شود؛ بنابراین Secret خام
     * وارد آن نشده است.
     */

    return {
      audit_metadata_truncated:
        true,

      preview:
        serialized.slice(
          0,
          10_000
        ),
    };
  } catch {
    return {
      audit_metadata_invalid:
        true,
    };
  }
}

function sanitizeMetadataValue(
  value: unknown,
  depth: number
): unknown {
  /*
   * جلوگیری از ساختارهای خیلی عمیق.
   */
  if (
    depth >
    5
  ) {
    return "[MAX_DEPTH]";
  }

  if (
    value ===
      null ||
    value ===
      undefined
  ) {
    return value ??
      null;
  }

  if (
    typeof value ===
    "string"
  ) {
    return value.slice(
      0,
      1000
    );
  }

  if (
    typeof value ===
      "number" ||
    typeof value ===
      "boolean"
  ) {
    return value;
  }

  if (
    value instanceof
    Date
  ) {
    return value.toISOString();
  }

  if (
    Array.isArray(
      value
    )
  ) {
    return value
      .slice(
        0,
        50
      )
      .map(
        (
          item
        ) =>
          sanitizeMetadataValue(
            item,
            depth +
              1
          )
      );
  }

  if (
    typeof value ===
    "object"
  ) {
    const result: Record<
      string,
      unknown
    > = {};

    /*
     * تعداد Keyها را محدود می‌کنیم.
     */
    const entries =
      Object.entries(
        value as Record<
          string,
          unknown
        >
      ).slice(
        0,
        100
      );

    for (
      const [
        rawKey,
        rawValue,
      ] of entries
    ) {
      const key =
        rawKey.slice(
          0,
          100
        );

      /*
       * اطلاعات حساس هیچ‌وقت ذخیره نشوند.
       */
      if (
        isSensitiveMetadataKey(
          key
        )
      ) {
        result[
          key
        ] =
          "[REDACTED]";

        continue;
      }

      result[
        key
      ] =
        sanitizeMetadataValue(
          rawValue,
          depth +
            1
        );
    }

    return result;
  }

  /*
   * Function / Symbol / BigInt و موارد مشابه
   * وارد JSON نمی‌شوند.
   */
  return String(
    value
  ).slice(
    0,
    500
  );
}

/*
 * ============================================
 * Sensitive keys
 * ============================================
 */

function isSensitiveMetadataKey(
  key: string
) {
  const normalized =
    key
      .trim()
      .toLowerCase()
      .replace(
        /[^a-z0-9]/g,
        ""
      );

  const sensitiveFragments = [
    "password",
    "passwd",

    "token",
    "authtoken",

    "secret",

    "cookie",

    "authorization",

    "apikey",
    "openaiapikey",

    "superuser",

    "credential",

    "session",

    "bearer",
  ];

  return sensitiveFragments.some(
    (
      fragment
    ) =>
      normalized.includes(
        fragment
      )
  );
}

/*
 * ============================================
 * Text / ID
 * ============================================
 */

function sanitizeText(
  value: string,
  maxLength: number
) {
  return String(
    value ||
      ""
  )
    .trim()
    .slice(
      0,
      maxLength
    );
}

function sanitizeId(
  value: string
) {
  return sanitizeText(
    value,
    100
  );
}

function normalizeIp(
  value: string
) {
  return String(
    value ||
      ""
  )
    .trim()
    .slice(
      0,
      100
    );
}

/*
 * ============================================
 * Console metadata
 * ============================================
 */

function sanitizeActionForLog(
  value: string
) {
  try {
    return normalizeAction(
      value
    );
  } catch {
    return "invalid_action";
  }
}

function safeErrorMetadata(
  error: unknown
) {
  if (
    typeof error !==
      "object" ||
    error === null
  ) {
    return {
      name:
        "UnknownError",
    };
  }

  const value =
    error as {
      name?: unknown;
      status?: unknown;
      code?: unknown;
    };

  return {
    name:
      typeof value.name ===
      "string"
        ? value.name
        : undefined,

    status:
      typeof value.status ===
      "number"
        ? value.status
        : undefined,

    code:
      typeof value.code ===
        "string" ||
      typeof value.code ===
        "number"
        ? value.code
        : undefined,
  };
}