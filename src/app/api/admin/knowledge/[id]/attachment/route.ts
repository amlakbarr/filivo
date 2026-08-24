import type {
  KnowledgeItemRecord,
} from "@/lib/ai/knowledge";

import {
  getKnowledgeUploadLimitBytes,
  getPocketBaseError,
} from "@/lib/knowledge/admin";

import {
  knowledgeApiError,
} from "@/lib/knowledge/response";

import {
  getAdminSession,
} from "@/lib/pocketbase/admin";

import {
  getPocketBaseServiceClient,
} from "@/lib/pocketbase/service";

/*
 * ============================================
 * Constants
 * ============================================
 */

const RECORD_ID_PATTERN =
  /^[a-zA-Z0-9_-]{1,64}$/;

const FILE_FETCH_TIMEOUT_MS =
  15_000;

const DOWNLOAD_OVERHEAD_BYTES =
  256 * 1024;

const FILE_TYPES:
  Record<
    string,
    string
  > = {
  ".pdf":
    "application/pdf",

  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",

  ".txt":
    "text/plain; charset=utf-8",

  ".md":
    "text/plain; charset=utf-8",
};

/*
 * ============================================
 * GET
 *
 * Load Knowledge Attachment
 * ============================================
 */

export async function GET(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{
      id: string;
    }>;
  }
) {
  const requestId =
    crypto.randomUUID();

  /*
   * ==========================================
   * Admin Authorization
   * ==========================================
   */

  const admin =
    await getAdminSession();

  if (!admin.ok) {
    return knowledgeApiError(
      requestId,
      admin.status,
      admin.code,
      admin.message
    );
  }

  /*
   * ==========================================
   * Knowledge ID
   * ==========================================
   */

  const {
    id,
  } = await params;

  if (
    !RECORD_ID_PATTERN.test(
      id
    )
  ) {
    return knowledgeApiError(
      requestId,
      400,
      "INVALID_KNOWLEDGE_ID",
      "شناسه مطلب معتبر نیست."
    );
  }

  /*
   * ==========================================
   * Service Client
   * ==========================================
   */

  let pb;

  try {
    pb =
      await getPocketBaseServiceClient();
  } catch (error) {
    console.error(
      "Knowledge attachment service unavailable",
      {
        requestId,

        adminId:
          admin.account.id,

        knowledgeId:
          id,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return knowledgeApiError(
      requestId,
      503,
      "KNOWLEDGE_SERVICE_UNAVAILABLE",
      "سرویس پایگاه دانش موقتاً در دسترس نیست."
    );
  }

  /*
   * ==========================================
   * Load Knowledge Item
   * ==========================================
   */

  let item:
    KnowledgeItemRecord;

  try {
    item =
      await pb
        .collection(
          "knowledge_items"
        )
        .getOne<KnowledgeItemRecord>(
          id
        );
  } catch (error) {
    const metadata =
      getPocketBaseError(
        error
      );

    return knowledgeApiError(
      requestId,

      metadata.status ===
        404
        ? 404
        : 503,

      metadata.status ===
        404
        ? "KNOWLEDGE_NOT_FOUND"
        : "KNOWLEDGE_LOAD_FAILED",

      metadata.status ===
        404
        ? "مطلب موردنظر پیدا نشد."
        : "دریافت مطلب ناموفق بود."
    );
  }

  /*
   * ==========================================
   * Attachment Filename
   * ==========================================
   */

  const filename =
    Array.isArray(
      item.attachment
    )
      ? String(
          item.attachment[0] ||
            ""
        ).trim()
      : String(
          item.attachment ||
            ""
        ).trim();

  if (
    !filename
  ) {
    return knowledgeApiError(
      requestId,
      404,
      "ATTACHMENT_NOT_FOUND",
      "فایل این مطلب پیدا نشد."
    );
  }

  /*
   * ==========================================
   * Extension Allow-list
   *
   * حتی فایل Legacy یا فایل دستکاری‌شده نیز
   * فقط اگر پسوند مجاز داشته باشد قابل دریافت
   * است.
   * ==========================================
   */

  const extension =
    getFileExtension(
      filename
    );

  const contentType =
    FILE_TYPES[
      extension
    ];

  if (
    !contentType
  ) {
    console.error(
      "Knowledge attachment has unsupported extension",
      {
        requestId,

        adminId:
          admin.account.id,

        knowledgeId:
          id,

        extension,
      }
    );

    return knowledgeApiError(
      requestId,
      415,
      "ATTACHMENT_TYPE_NOT_ALLOWED",
      "نوع فایل این مطلب مجاز نیست."
    );
  }

  /*
   * ==========================================
   * Safe Filename
   * ==========================================
   */

  const safeFilename =
    sanitizeFilename(
      filename,
      extension
    );

  /*
   * ==========================================
   * PocketBase File Token
   *
   * Token فقط Server-side استفاده می‌شود.
   * ==========================================
   */

  let token:
    string;

  try {
    token =
      await pb.files
        .getToken();
  } catch (error) {
    console.error(
      "Knowledge attachment token failed",
      {
        requestId,

        adminId:
          admin.account.id,

        knowledgeId:
          id,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return knowledgeApiError(
      requestId,
      503,
      "ATTACHMENT_TOKEN_FAILED",
      "دسترسی امن به فایل مطلب برقرار نشد."
    );
  }

  /*
   * ==========================================
   * Generate Server-side File URL
   * ==========================================
   */

  const fileUrl =
    pb.files.getURL(
      item,
      filename,
      {
        token,
      }
    );

  /*
   * ==========================================
   * Download from PocketBase
   *
   * Timeout جلوی Request معلق نامحدود را
   * می‌گیرد.
   * ==========================================
   */

  let fileResponse:
    Response;

  try {
    fileResponse =
      await fetch(
        fileUrl,
        {
          cache:
            "no-store",

          redirect:
            "error",

          signal:
            AbortSignal.timeout(
              FILE_FETCH_TIMEOUT_MS
            ),
        }
      );
  } catch (error) {
    console.error(
      "Knowledge attachment fetch failed",
      {
        requestId,

        adminId:
          admin.account.id,

        knowledgeId:
          id,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return knowledgeApiError(
      requestId,
      503,
      "ATTACHMENT_LOAD_FAILED",
      "دریافت فایل مطلب ناموفق بود."
    );
  }

  /*
   * ==========================================
   * Validate PocketBase Response
   * ==========================================
   */

  if (
    !fileResponse.ok ||
    !fileResponse.body
  ) {
    console.error(
      "PocketBase attachment response failed",
      {
        requestId,

        adminId:
          admin.account.id,

        knowledgeId:
          id,

        upstreamStatus:
          fileResponse.status,
      }
    );

    return knowledgeApiError(
      requestId,

      fileResponse.status ===
        404
        ? 404
        : 503,

      fileResponse.status ===
        404
        ? "ATTACHMENT_NOT_FOUND"
        : "ATTACHMENT_LOAD_FAILED",

      fileResponse.status ===
        404
        ? "فایل این مطلب پیدا نشد."
        : "دریافت فایل مطلب ناموفق بود."
    );
  }

  /*
   * ==========================================
   * Upstream Size Guard
   *
   * فایل‌های Legacy نیز نباید بتوانند
   * Download بسیار بزرگ ایجاد کنند.
   * ==========================================
   */

  const upstreamLength =
    parseContentLength(
      fileResponse.headers.get(
        "content-length"
      )
    );

  const maximumDownloadBytes =
    getKnowledgeUploadLimitBytes() +
    DOWNLOAD_OVERHEAD_BYTES;

  if (
    upstreamLength !==
      null &&
    upstreamLength >
      maximumDownloadBytes
  ) {
    try {
      await fileResponse.body
        .cancel();
    } catch {
      // Ignore cancellation error.
    }

    console.error(
      "Knowledge attachment exceeded download limit",
      {
        requestId,

        adminId:
          admin.account.id,

        knowledgeId:
          id,

        upstreamLength,

        maximumDownloadBytes,
      }
    );

    return knowledgeApiError(
      requestId,
      413,
      "ATTACHMENT_TOO_LARGE",
      "حجم فایل بیش از حد مجاز است."
    );
  }

  /*
   * ==========================================
   * Content-Disposition
   *
   * PDF برای مشاهده داخل Browser.
   *
   * بقیه فرمت‌ها Download می‌شوند تا Browser
   * محتوای Office/Text را به شکل فعال Render
   * نکند.
   * ==========================================
   */

  const disposition =
    extension ===
    ".pdf"
      ? "inline"
      : "attachment";

  /*
   * ==========================================
   * Response
   *
   * Content-Type از Allow-list داخلی تعیین
   * می‌شود، نه Header برگشتی PocketBase.
   * ==========================================
   */

  return new Response(
    fileResponse.body,
    {
      status:
        200,

      headers: {
        "Content-Type":
          contentType,

        "Content-Disposition":
          `${disposition}; filename="${toAsciiFilename(
            safeFilename
          )}"; filename*=UTF-8''${encodeURIComponent(
            safeFilename
          )}`,

        /*
         * فایل Knowledge محرمانه است.
         */
        "Cache-Control":
          "private, no-store, no-cache, max-age=0, must-revalidate",

        "Pragma":
          "no-cache",

        "Expires":
          "0",

        /*
         * جلوگیری از MIME Sniffing.
         */
        "X-Content-Type-Options":
          "nosniff",

        /*
         * فایل توسط Origin دیگر Embedding نشود.
         */
        "Cross-Origin-Resource-Policy":
          "same-origin",

        /*
         * Referer به مقصد دیگری ارسال نشود.
         */
        "Referrer-Policy":
          "no-referrer",

        /*
         * قابلیت‌های Browser برای این Response
         * کاربردی ندارند.
         */
        "Permissions-Policy":
          "camera=(), microphone=(), geolocation=(), payment=(), usb=()",

        /*
         * برای نمایش inline PDF فقط Origin خود
         * برنامه مجاز است.
         */
        "X-Frame-Options":
          "SAMEORIGIN",

        "X-Request-Id":
          requestId,
      },
    }
  );
}

/*
 * ============================================
 * File Extension
 * ============================================
 */

function getFileExtension(
  filename:
    string
) {
  const normalized =
    String(
      filename ||
        ""
    ).trim();

  const index =
    normalized.lastIndexOf(
      "."
    );

  if (
    index <=
      0 ||
    index ===
      normalized.length -
        1
  ) {
    return "";
  }

  return normalized
    .slice(
      index
    )
    .toLowerCase();
}

/*
 * ============================================
 * Safe Filename
 * ============================================
 */

function sanitizeFilename(
  filename:
    string,

  extension:
    string
) {
  const cleaned =
    String(
      filename ||
        ""
    )
      .replace(
        /[\u0000-\u001f\u007f]/g,
        ""
      )
      .replace(
        /[\\/:*?"<>|]/g,
        "_"
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim();

  const rawBaseName =
    cleaned
      .slice(
        0,
        Math.max(
          0,
          cleaned.length -
            extension.length
        )
      )
      .replace(
        /^\.+|\.+$/g,
        ""
      )
      .trim();

  const maxLength =
    180;

  const maxBaseLength =
    Math.max(
      20,
      maxLength -
        extension.length
    );

  const baseName =
    (
      rawBaseName ||
      "attachment"
    )
      .slice(
        0,
        maxBaseLength
      )
      .trim();

  return `${baseName}${extension}`;
}

/*
 * ============================================
 * ASCII Fallback Filename
 * ============================================
 */

function toAsciiFilename(
  value:
    string
) {
  const ascii =
    value
      .replace(
        /[^\x20-\x7E]/g,
        "_"
      )
      .replace(
        /[\\/:*?"<>|]/g,
        "_"
      )
      .replace(
        /[\r\n]/g,
        "_"
      )
      .trim()
      .slice(
        0,
        180
      );

  return (
    ascii ||
    "attachment"
  );
}

/*
 * ============================================
 * Content Length
 * ============================================
 */

function parseContentLength(
  value:
    string |
    null
) {
  if (
    !value
  ) {
    return null;
  }

  const parsed =
    Number(
      value
    );

  if (
    !Number.isSafeInteger(
      parsed
    ) ||
    parsed <
      0
  ) {
    return null;
  }

  return parsed;
}

/*
 * ============================================
 * Safe Error Metadata
 * ============================================
 */

function safeErrorMetadata(
  error:
    unknown
) {
  if (
    typeof error !==
      "object" ||
    error ===
      null
  ) {
    return {
      name:
        "UnknownError",
    };
  }

  const value =
    error as {
      name?:
        unknown;

      status?:
        unknown;

      code?:
        unknown;
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