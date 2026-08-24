import "server-only";

import { Buffer } from "node:buffer";

import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";

import type { KnowledgeItemRecord } from "@/lib/ai/knowledge";

/*
 * ============================================
 * Constants
 * ============================================
 */

export const KNOWLEDGE_STATUSES = [
  "draft",
  "published",
  "archived",
] as const;

export const KNOWLEDGE_SYNC_STATUSES = [
  "pending",
  "synced",
  "error",
] as const;

export const KNOWLEDGE_SOURCE_TYPES = [
  "text",
  "file",
] as const;

/*
 * ============================================
 * Types
 * ============================================
 */

export type KnowledgeStatus =
  (typeof KNOWLEDGE_STATUSES)[number];

export type KnowledgeSyncStatus =
  (typeof KNOWLEDGE_SYNC_STATUSES)[number];

export type KnowledgeSourceType =
  (typeof KNOWLEDGE_SOURCE_TYPES)[number];

export type KnowledgeInput = {
  title: string;

  content: string;

  topic: string;

  departments: string[];

  tags: string[];

  sourceType: KnowledgeSourceType;

  status:
    | "draft"
    | "published";

  attachment?: File;
};

export type KnowledgeValidationResult =
  | {
      success: true;

      data:
        KnowledgeInput;
    }
  | {
      success: false;

      code:
        "VALIDATION_ERROR";

      message:
        string;

      fieldErrors:
        Record<
          string,
          string
        >;
    };

type MultipartReadResult =
  | {
      success: true;

      formData:
        FormData;
    }
  | {
      success: false;

      message:
        string;
    };

type StringArrayParseResult =
  | {
      valid: true;

      values:
        string[];
    }
  | {
      valid: false;

      values:
        [];
    };

type FileValidationResult =
  | {
      success: true;

      file:
        File;
    }
  | {
      success: false;

      message:
        string;
    };

/*
 * ============================================
 * Limits
 * ============================================
 */

const TITLE_MAX_LENGTH =
  200;

const CONTENT_MAX_LENGTH =
  200_000;

const TAG_MAX_LENGTH =
  50;

const TAG_MAX_COUNT =
  20;

const DEPARTMENT_MAX_COUNT =
  50;

const FILE_NAME_MAX_LENGTH =
  160;

const MULTIPART_OVERHEAD_BYTES =
  1024 * 1024;

const RELATION_ID_PATTERN =
  /^[a-zA-Z0-9_-]{1,64}$/;

/*
 * ============================================
 * File Rules
 * ============================================
 */

const FILE_RULES:
  Record<
    string,
    ReadonlySet<string>
  > = {
  ".pdf":
    new Set([
      "application/pdf",

      /*
       * بعضی Browserها / OSها فایل را بدون
       * MIME دقیق ارسال می‌کنند.
       *
       * در این حالت Signature نیز بررسی
       * می‌شود.
       */
      "application/octet-stream",
      "",
    ]),

  ".docx":
    new Set([
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/octet-stream",
      "application/zip",
      "",
    ]),

  ".txt":
    new Set([
      "text/plain",
      "application/octet-stream",
      "",
    ]),

  ".md":
    new Set([
      "text/markdown",
      "text/plain",
      "application/octet-stream",
      "",
    ]),
};

/*
 * ============================================
 * Upload Limits
 * ============================================
 */

export function getKnowledgeUploadLimitBytes() {
  const configured =
    Number(
      process.env
        .KNOWLEDGE_MAX_UPLOAD_MB
    );

  const megabytes =
    Number.isFinite(
      configured
    ) &&
    configured >
      0 &&
    configured <=
      50
      ? configured
      : 10;

  return Math.floor(
    megabytes *
      1024 *
      1024
  );
}

/*
 * Multipart علاوه بر فایل شامل:
 *
 * content
 * title
 * tags
 * departments
 * boundary overhead
 *
 * است.
 */
export function getKnowledgeMultipartLimitBytes() {
  return (
    getKnowledgeUploadLimitBytes() +
    MULTIPART_OVERHEAD_BYTES
  );
}

/*
 * ============================================
 * Parse Knowledge Request
 * ============================================
 */

export async function parseKnowledgeRequest(
  request:
    Request,

  options?: {
    existingAttachment?:
      string;
  }
): Promise<KnowledgeValidationResult> {
  /*
   * ==========================================
   * Bounded Multipart Read
   *
   * request.formData() مستقیماً استفاده
   * نمی‌شود تا Requestهای بسیار بزرگ قبل از
   * Parse کامل متوقف شوند.
   * ==========================================
   */

  const multipart =
    await readMultipartFormDataWithLimit(
      request,
      getKnowledgeMultipartLimitBytes()
    );

  if (
    !multipart.success
  ) {
    return validationFailure({
      form:
        multipart.message,
    });
  }

  const {
    formData,
  } = multipart;

  const fieldErrors:
    Record<
      string,
      string
    > = {};

  /*
   * ==========================================
   * Duplicate Field Protection
   * ==========================================
   */

  const singleValueFields = [
    "title",
    "content",
    "topic",
    "departments",
    "tags",
    "source_type",
    "status",
    "attachment",
  ];

  for (
    const field of
    singleValueFields
  ) {
    if (
      formData.getAll(
        field
      ).length >
      1
    ) {
      fieldErrors.form =
        "ساختار فرم ارسالی معتبر نیست.";

      break;
    }
  }

  /*
   * ==========================================
   * Raw Fields
   * ==========================================
   */

  const titleValue =
    formData.get(
      "title"
    );

  const contentValue =
    formData.get(
      "content"
    );

  const topicValue =
    formData.get(
      "topic"
    );

  const departmentsValue =
    formData.get(
      "departments"
    );

  const tagsValue =
    formData.get(
      "tags"
    );

  const sourceTypeValue =
    formData.get(
      "source_type"
    );

  const statusValue =
    formData.get(
      "status"
    );

  /*
   * Text fields نباید File باشند.
   */

  if (
    titleValue !==
      null &&
    typeof titleValue !==
      "string"
  ) {
    fieldErrors.title =
      "عنوان معتبر نیست.";
  }

  if (
    contentValue !==
      null &&
    typeof contentValue !==
      "string"
  ) {
    fieldErrors.content =
      "محتوا معتبر نیست.";
  }

  if (
    topicValue !==
      null &&
    typeof topicValue !==
      "string"
  ) {
    fieldErrors.topic =
      "موضوع انتخاب‌شده معتبر نیست.";
  }

  if (
    departmentsValue !==
      null &&
    typeof departmentsValue !==
      "string"
  ) {
    fieldErrors.departments =
      "واحدهای انتخاب‌شده معتبر نیستند.";
  }

  if (
    tagsValue !==
      null &&
    typeof tagsValue !==
      "string"
  ) {
    fieldErrors.tags =
      "برچسب‌ها معتبر نیستند.";
  }

  if (
    sourceTypeValue !==
      null &&
    typeof sourceTypeValue !==
      "string"
  ) {
    fieldErrors.source_type =
      "نوع منبع معتبر نیست.";
  }

  if (
    statusValue !==
      null &&
    typeof statusValue !==
      "string"
  ) {
    fieldErrors.status =
      "وضعیت انتخاب‌شده معتبر نیست.";
  }

  /*
   * ==========================================
   * Normalized Values
   * ==========================================
   */

  const rawTitle =
    typeof titleValue ===
    "string"
      ? titleValue
      : "";

  const title =
    cleanSingleLine(
      rawTitle,
      TITLE_MAX_LENGTH
    );

  const rawContent =
    typeof contentValue ===
    "string"
      ? contentValue
      : "";

  const content =
    cleanContent(
      rawContent
    );

  const rawTopic =
    typeof topicValue ===
    "string"
      ? topicValue
      : "";

  const topic =
    cleanRelationId(
      rawTopic
    );

  const departmentsResult =
    parseStringArray(
      departmentsValue
    );

  const tagsResult =
    parseStringArray(
      tagsValue
    );

  const rawDepartments =
    departmentsResult.valid
      ? departmentsResult.values
      : [];

  const departments =
    rawDepartments.filter(
      isRelationId
    );

  const rawTags =
    tagsResult.valid
      ? tagsResult.values
      : [];

  const tags =
    normalizeTags(
      rawTags
    );

  const sourceType =
    (
      typeof sourceTypeValue ===
      "string"
        ? sourceTypeValue.trim()
        : ""
    ) as KnowledgeSourceType;

  const status =
    (
      typeof statusValue ===
      "string"
        ? statusValue.trim()
        : ""
    ) as
      | "draft"
      | "published";

  /*
   * ==========================================
   * Attachment
   * ==========================================
   */

  const attachmentEntries =
    formData.getAll(
      "attachment"
    );

  const attachmentValue =
    attachmentEntries[0];

  let attachment:
    File |
    undefined;

  if (
    attachmentValue instanceof
      File
  ) {
    /*
     * Browser هنگام عدم انتخاب فایل ممکن است
     * File خالی با name خالی ارسال کند.
     */
    if (
      attachmentValue.size >
      0
    ) {
      const result =
        await validateAndNormalizeKnowledgeFile(
          attachmentValue
        );

      if (
        result.success
      ) {
        attachment =
          result.file;
      } else {
        fieldErrors.attachment =
          result.message;
      }
    } else if (
      attachmentValue.name
        .trim()
    ) {
      fieldErrors.attachment =
        "فایل انتخاب‌شده خالی است.";
    }
  } else if (
    attachmentValue !==
      undefined &&
    String(
      attachmentValue
    ).trim()
  ) {
    fieldErrors.attachment =
      "فایل انتخاب‌شده معتبر نیست.";
  }

  /*
   * ==========================================
   * Title
   * ==========================================
   */

  if (
    !title
  ) {
    fieldErrors.title =
      "عنوان الزامی است.";
  }

  if (
    normalizeSingleLine(
      rawTitle
    ).length >
    TITLE_MAX_LENGTH
  ) {
    fieldErrors.title =
      `عنوان نباید بیشتر از ${TITLE_MAX_LENGTH} نویسه باشد.`;
  }

  /*
   * ==========================================
   * Source Type
   * ==========================================
   */

  if (
    !KNOWLEDGE_SOURCE_TYPES.includes(
      sourceType
    )
  ) {
    fieldErrors.source_type =
      "نوع منبع معتبر نیست.";
  }

  /*
   * ==========================================
   * Content
   * ==========================================
   */

  if (
    sourceType ===
      "text" &&
    !content
  ) {
    fieldErrors.content =
      "برای منبع متنی، وارد کردن محتوا الزامی است.";
  }

  if (
    content.length >
    CONTENT_MAX_LENGTH
  ) {
    fieldErrors.content =
      `محتوا نباید بیشتر از ${CONTENT_MAX_LENGTH.toLocaleString(
        "fa-IR"
      )} نویسه باشد.`;
  }

  /*
   * ==========================================
   * Attachment / Source Relationship
   * ==========================================
   */

  if (
    sourceType ===
      "file" &&
    !attachment &&
    !options?.existingAttachment &&
    !fieldErrors.attachment
  ) {
    fieldErrors.attachment =
      "برای منبع فایل، انتخاب فایل الزامی است.";
  }

  /*
   * فایل جدید همراه source_type=text نباید
   * مخفیانه ذخیره شود.
   */
  if (
    sourceType ===
      "text" &&
    attachment
  ) {
    fieldErrors.attachment =
      "برای منبع متنی نباید فایل ارسال شود.";
  }

  /*
   * ==========================================
   * Status
   * ==========================================
   */

  if (
    !(
      [
        "draft",
        "published",
      ] as const
    ).includes(
      status
    )
  ) {
    fieldErrors.status =
      "وضعیت انتخاب‌شده معتبر نیست.";
  }

  /*
   * ==========================================
   * Topic
   * ==========================================
   */

  if (
    rawTopic.trim() &&
    !topic
  ) {
    fieldErrors.topic =
      "موضوع انتخاب‌شده معتبر نیست.";
  }

  /*
   * ==========================================
   * Departments
   * ==========================================
   */

  if (
    !departmentsResult.valid
  ) {
    fieldErrors.departments =
      "ساختار واحدهای انتخاب‌شده معتبر نیست.";
  } else if (
    rawDepartments.length >
    DEPARTMENT_MAX_COUNT
  ) {
    fieldErrors.departments =
      `حداکثر ${DEPARTMENT_MAX_COUNT.toLocaleString(
        "fa-IR"
      )} واحد قابل انتخاب است.`;
  } else if (
    rawDepartments.length !==
    departments.length
  ) {
    fieldErrors.departments =
      "شناسه یک یا چند واحد معتبر نیست.";
  }

  /*
   * ==========================================
   * Tags
   * ==========================================
   */

  if (
    !tagsResult.valid
  ) {
    fieldErrors.tags =
      "ساختار برچسب‌ها معتبر نیست.";
  } else if (
    rawTags.length >
    TAG_MAX_COUNT
  ) {
    fieldErrors.tags =
      `حداکثر ${TAG_MAX_COUNT.toLocaleString(
        "fa-IR"
      )} برچسب قابل ثبت است.`;
  } else if (
    rawTags.some(
      (
        tag
      ) =>
        normalizeSingleLine(
          tag
        ).length >
        TAG_MAX_LENGTH
    )
  ) {
    fieldErrors.tags =
      `طول هر برچسب نباید بیشتر از ${TAG_MAX_LENGTH.toLocaleString(
        "fa-IR"
      )} نویسه باشد.`;
  }

  /*
   * ==========================================
   * Validation Result
   * ==========================================
   */

  if (
    Object.keys(
      fieldErrors
    ).length >
    0
  ) {
    return validationFailure(
      fieldErrors
    );
  }

  return {
    success:
      true,

    data: {
      title,

      content,

      topic,

      departments: [
        ...new Set(
          departments
        ),
      ],

      tags,

      sourceType,

      status,

      attachment,
    },
  };
}

/*
 * ============================================
 * Relations Validation
 * ============================================
 */

export async function validateKnowledgeRelations(
  pb:
    PocketBase,

  input:
    KnowledgeInput
) {
  const errors:
    Record<
      string,
      string
    > = {};

  /*
   * ==========================================
   * Topic
   * ==========================================
   */

  if (
    input.topic
  ) {
    try {
      await pb
        .collection(
          "topics"
        )
        .getOne(
          input.topic,
          {
            fields:
              "id",
          }
        );
    } catch {
      errors.topic =
        "موضوع انتخاب‌شده وجود ندارد.";
    }
  }

  /*
   * ==========================================
   * Departments
   * ==========================================
   */

  if (
    input.departments.length >
    0
  ) {
    const filterValues:
      Record<
        string,
        string
      > = {};

    const clauses =
      input.departments.map(
        (
          id,
          index
        ) => {
          const key =
            `department${index}`;

          filterValues[
            key
          ] =
            id;

          return `id = {:${key}}`;
        }
      );

    try {
      const records =
        await pb
          .collection(
            "departments"
          )
          .getFullList({
            filter:
              pb.filter(
                clauses.join(
                  " || "
                ),
                filterValues
              ),

            fields:
              "id",
          });

      if (
        records.length !==
        input.departments.length
      ) {
        errors.departments =
          "یک یا چند واحد انتخاب‌شده وجود ندارد.";
      }
    } catch {
      errors.departments =
        "اعتبارسنجی واحدهای انتخاب‌شده ناموفق بود.";
    }
  }

  return errors;
}

/*
 * ============================================
 * Build PocketBase Payload
 * ============================================
 */

export function buildKnowledgePayload(
  input:
    KnowledgeInput,

  audit: {
    createdBy?:
      string;

    updatedBy:
      string;
  },

  options: {
    version:
      number;

    syncStatus:
      KnowledgeSyncStatus;

    clearAttachment?:
      boolean;
  }
) {
  const payload =
    new FormData();

  payload.set(
    "title",
    input.title
  );

  payload.set(
    "content",
    input.content
  );

  payload.set(
    "topic",
    input.topic
  );

  payload.set(
    "departments",
    JSON.stringify(
      input.departments
    )
  );

  payload.set(
    "tags",
    JSON.stringify(
      input.tags
    )
  );

  payload.set(
    "source_type",
    input.sourceType
  );

  payload.set(
    "status",
    input.status
  );

  payload.set(
    "version",
    String(
      options.version
    )
  );

  payload.set(
    "sync_status",
    options.syncStatus
  );

  payload.set(
    "sync_error",
    ""
  );

  payload.set(
    "updated_by",
    audit.updatedBy
  );

  if (
    audit.createdBy
  ) {
    payload.set(
      "created_by",
      audit.createdBy
    );

    payload.set(
      "openai_file_id",
      ""
    );
  }

  if (
    input.attachment
  ) {
    payload.set(
      "attachment",
      input.attachment
    );
  } else if (
    options.clearAttachment
  ) {
    payload.set(
      "attachment",
      ""
    );
  }

  return payload;
}

/*
 * ============================================
 * Content Change Detection
 * ============================================
 */

export function hasKnowledgeContentChanged(
  existing:
    KnowledgeItemRecord,

  input:
    KnowledgeInput
) {
  return (
    cleanSingleLine(
      existing.title,
      TITLE_MAX_LENGTH
    ) !==
      input.title ||
    cleanContent(
      existing.content
    ) !==
      input.content ||
    normalizeRelation(
      existing.topic
    ) !==
      input.topic ||
    !sameStringSet(
      normalizeStringList(
        existing.departments
      ),
      input.departments
    ) ||
    !sameStringSet(
      normalizeStringList(
        existing.tags
      ),
      input.tags
    ) ||
    String(
      existing.source_type ||
        "text"
    ) !==
      input.sourceType ||
    Boolean(
      input.attachment
    )
  );
}

/*
 * ============================================
 * Serialization
 * ============================================
 */

export function serializeKnowledgeItem(
  record:
    KnowledgeItemRecord
) {
  const topic =
    getExpandedRecord(
      record,
      "topic"
    );

  const parent =
    topic
      ? getExpandedRecord(
          topic,
          "parent"
        )
      : undefined;

  const departments =
    getExpandedRecords(
      record,
      "departments"
    );

  const attachment =
    normalizeStringList(
      record.attachment
    )[0];

  return {
    id:
      record.id,

    title:
      String(
        record.title ||
          ""
      ),

    content:
      String(
        record.content ||
          ""
      ),

    topic:
      normalizeRelation(
        record.topic
      ),

    topic_name:
      topic
        ? [
            parent?.name,
            topic.name,
          ]
            .map(
              (
                value
              ) =>
                String(
                  value ||
                    ""
                ).trim()
            )
            .filter(
              Boolean
            )
            .join(
              " > "
            )
        : "",

    departments:
      normalizeStringList(
        record.departments
      ),

    department_names:
      departments
        .map(
          (
            department
          ) =>
            String(
              department.name ||
                ""
            ).trim()
        )
        .filter(
          Boolean
        ),

    tags:
      normalizeStringList(
        record.tags
      ),

    source_type:
      String(
        record.source_type ||
          "text"
      ) as KnowledgeSourceType,

    attachment:
      attachment ||
      "",

    attachment_url:
      attachment
        ? `/api/admin/knowledge/${record.id}/attachment`
        : "",

    status:
      String(
        record.status ||
          "draft"
      ) as KnowledgeStatus,

    version:
      toPositiveInteger(
        record.version,
        1
      ),

    sync_status:
      String(
        record.sync_status ||
          "pending"
      ) as KnowledgeSyncStatus,

    sync_error:
      String(
        record.sync_error ||
          ""
      ),

    openai_file_id:
      String(
        record.openai_file_id ||
          ""
      ),

    created_by:
      String(
        record.created_by ||
          ""
      ),

    updated_by:
      String(
        record.updated_by ||
          ""
      ),

    created:
      String(
        record.created ||
          ""
      ),

    updated:
      String(
        record.updated ||
          ""
      ),
  };
}

/*
 * ============================================
 * Positive Integer
 * ============================================
 */

export function toPositiveInteger(
  value:
    unknown,

  fallback:
    number
) {
  const number =
    Number(
      value
    );

  return (
    Number.isInteger(
      number
    ) &&
    number >
      0
  )
    ? number
    : fallback;
}

/*
 * ============================================
 * PocketBase Error
 * ============================================
 */

export function getPocketBaseError(
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
      status:
        500,

      message:
        String(
          error
        ),
    };
  }

  const value =
    error as {
      status?:
        unknown;

      message?:
        unknown;

      response?: {
        message?:
          unknown;

        data?:
          unknown;
      };
    };

  return {
    status:
      typeof value.status ===
      "number"
        ? value.status
        : 500,

    message:
      typeof value.response
        ?.message ===
      "string"
        ? value.response.message
        : typeof value.message ===
          "string"
          ? value.message
          : "خطای نامشخص",

    data:
      value.response
        ?.data,
  };
}

/*
 * ============================================
 * Bounded Multipart Parser
 * ============================================
 */

async function readMultipartFormDataWithLimit(
  request:
    Request,

  maximumBytes:
    number
): Promise<MultipartReadResult> {
  const contentType =
    String(
      request.headers.get(
        "content-type"
      ) ||
        ""
    ).trim();

  if (
    !contentType
      .toLowerCase()
      .startsWith(
        "multipart/form-data"
      )
  ) {
    return {
      success:
        false,

      message:
        "نوع محتوای فرم معتبر نیست.",
    };
  }

  /*
   * Multipart بدون Boundary قابل Parse نیست.
   */

  if (
    !/boundary=/i.test(
      contentType
    )
  ) {
    return {
      success:
        false,

      message:
        "ساختار فرم ارسالی معتبر نیست.",
    };
  }

  /*
   * ==========================================
   * Content-Length Fast Reject
   * ==========================================
   */

  const rawContentLength =
    request.headers.get(
      "content-length"
    );

  if (
    rawContentLength
  ) {
    const contentLength =
      Number(
        rawContentLength
      );

    if (
      Number.isFinite(
        contentLength
      ) &&
      contentLength >
        maximumBytes
    ) {
      return {
        success:
          false,

        message:
          getMultipartTooLargeMessage(),
      };
    }
  }

  if (
    !request.body
  ) {
    return {
      success:
        false,

      message:
        "ساختار فرم ارسالی معتبر نیست.",
    };
  }

  /*
   * ==========================================
   * Stream Read
   *
   * حتی اگر Content-Length وجود نداشته باشد،
   * بیشتر از limit خوانده نمی‌شود.
   * ==========================================
   */

  const reader =
    request.body.getReader();

  const chunks:
    Uint8Array[] = [];

  let totalBytes =
    0;

  try {
    while (
      true
    ) {
      const {
        done,
        value,
      } =
        await reader.read();

      if (
        done
      ) {
        break;
      }

      if (
        !value
      ) {
        continue;
      }

      totalBytes +=
        value.byteLength;

      if (
        totalBytes >
        maximumBytes
      ) {
        try {
          await reader.cancel();
        } catch {
          // Ignore cancel failure.
        }

        return {
          success:
            false,

          message:
            getMultipartTooLargeMessage(),
        };
      }

      chunks.push(
        value
      );
    }
  } catch {
    return {
      success:
        false,

      message:
        "خواندن فرم ارسالی ناموفق بود.",
    };
  }

  if (
    totalBytes ===
    0
  ) {
    return {
      success:
        false,

      message:
        "ساختار فرم ارسالی معتبر نیست.",
    };
  }

  /*
   * ==========================================
   * Merge Chunks
   * ==========================================
   */

  const body =
    new ArrayBuffer(
      totalBytes
    );

  const merged =
    new Uint8Array(
      body
    );

  let offset =
    0;

  for (
    const chunk of
    chunks
  ) {
    merged.set(
      chunk,
      offset
    );

    offset +=
      chunk.byteLength;
  }

  /*
   * ==========================================
   * Parse Bounded Copy
   * ==========================================
   */

  try {
    const boundedRequest =
      new Request(
        "http://localhost/internal-knowledge-upload",
        {
          method:
            "POST",

          headers: {
            "content-type":
              contentType,
          },

          body,
        }
      );

    const formData =
      await boundedRequest
        .formData();

    return {
      success:
        true,

      formData,
    };
  } catch {
    return {
      success:
        false,

      message:
        "ساختار فرم ارسالی معتبر نیست.",
    };
  }
}

/*
 * ============================================
 * Multipart Limit Message
 * ============================================
 */

function getMultipartTooLargeMessage() {
  const uploadLimitMb =
    Math.floor(
      getKnowledgeUploadLimitBytes() /
        1024 /
        1024
    );

  return `حجم درخواست بیش از حد مجاز است. حداکثر حجم فایل ${uploadLimitMb.toLocaleString(
    "fa-IR"
  )} مگابایت است.`;
}

/*
 * ============================================
 * File Validation
 * ============================================
 */

async function validateAndNormalizeKnowledgeFile(
  file:
    File
): Promise<FileValidationResult> {
  /*
   * ==========================================
   * Empty
   * ==========================================
   */

  if (
    file.size <=
    0
  ) {
    return {
      success:
        false,

      message:
        "فایل انتخاب‌شده خالی است.",
    };
  }

  /*
   * ==========================================
   * Size
   * ==========================================
   */

  const uploadLimit =
    getKnowledgeUploadLimitBytes();

  if (
    file.size >
    uploadLimit
  ) {
    const limitMb =
      Math.floor(
        uploadLimit /
          1024 /
          1024
      );

    return {
      success:
        false,

      message:
        `حجم فایل نباید بیشتر از ${limitMb.toLocaleString(
          "fa-IR"
        )} مگابایت باشد.`,
    };
  }

  /*
   * ==========================================
   * Extension
   * ==========================================
   */

  const extension =
    getFileExtension(
      file.name
    );

  const allowedMimeTypes =
    FILE_RULES[
      extension
    ];

  if (
    !allowedMimeTypes
  ) {
    return {
      success:
        false,

      message:
        "فقط فایل‌های PDF، DOCX، TXT و MD مجاز هستند.",
    };
  }

  /*
   * ==========================================
   * MIME ↔ Extension
   * ==========================================
   */

  const mimeType =
    String(
      file.type ||
        ""
    )
      .trim()
      .toLowerCase();

  if (
    !allowedMimeTypes.has(
      mimeType
    )
  ) {
    return {
      success:
        false,

      message:
        "نوع فایل با پسوند انتخاب‌شده سازگار نیست.",
    };
  }

  /*
   * ==========================================
   * Content Validation
   * ==========================================
   */

  if (
    extension ===
    ".pdf"
  ) {
    const error =
      await validatePdfFile(
        file
      );

    if (
      error
    ) {
      return {
        success:
          false,

        message:
          error,
      };
    }
  }

  if (
    extension ===
    ".docx"
  ) {
    const error =
      await validateDocxFile(
        file
      );

    if (
      error
    ) {
      return {
        success:
          false,

        message:
          error,
      };
    }
  }

  if (
    extension ===
      ".txt" ||
    extension ===
      ".md"
  ) {
    const error =
      await validateTextFile(
        file
      );

    if (
      error
    ) {
      return {
        success:
          false,

        message:
          error,
      };
    }
  }

  /*
   * ==========================================
   * Safe Filename
   * ==========================================
   */

  const safeName =
    sanitizeFileName(
      file.name,
      extension
    );

  const normalizedFile =
    safeName ===
    file.name
      ? file
      : new File(
          [
            file,
          ],
          safeName,
          {
            type:
              file.type,

            lastModified:
              file.lastModified,
          }
        );

  return {
    success:
      true,

    file:
      normalizedFile,
  };
}

/*
 * ============================================
 * PDF Validation
 * ============================================
 */

async function validatePdfFile(
  file:
    File
) {
  const signature =
    new Uint8Array(
      await file
        .slice(
          0,
          8
        )
        .arrayBuffer()
    );

  if (
    signature.length <
      5 ||
    signature[0] !==
      0x25 ||
    signature[1] !==
      0x50 ||
    signature[2] !==
      0x44 ||
    signature[3] !==
      0x46 ||
    signature[4] !==
      0x2d
  ) {
    return "محتوای فایل با ساختار PDF سازگار نیست.";
  }

  /*
   * بررسی انتهای PDF.
   *
   * %%EOF معمولاً در انتهای فایل قرار دارد.
   */

  const tailSize =
    Math.min(
      file.size,
      4096
    );

  const tail =
    Buffer.from(
      await file
        .slice(
          file.size -
            tailSize
        )
        .arrayBuffer()
    );

  if (
    !tail.includes(
      Buffer.from(
        "%%EOF",
        "ascii"
      )
    )
  ) {
    return "ساختار فایل PDF کامل یا معتبر نیست.";
  }

  return "";
}

/*
 * ============================================
 * DOCX Validation
 * ============================================
 */

async function validateDocxFile(
  file:
    File
) {
  const bytes =
    Buffer.from(
      await file.arrayBuffer()
    );

  /*
   * DOCX یک ZIP container است.
   */

  if (
    bytes.length <
      4 ||
    bytes[0] !==
      0x50 ||
    bytes[1] !==
      0x4b
  ) {
    return "محتوای فایل با ساختار DOCX سازگار نیست.";
  }

  /*
   * صرف PK بودن کافی نیست؛ ZIP معمولی نیز
   * PK دارد.
   *
   * وجود فایل‌های اصلی DOCX را در container
   * بررسی می‌کنیم.
   */

  const contentTypes =
    Buffer.from(
      "[Content_Types].xml",
      "utf8"
    );

  const documentXml =
    Buffer.from(
      "word/document.xml",
      "utf8"
    );

  if (
    !bytes.includes(
      contentTypes
    ) ||
    !bytes.includes(
      documentXml
    )
  ) {
    return "فایل ZIP ارسال‌شده یک سند DOCX معتبر نیست.";
  }

  return "";
}

/*
 * ============================================
 * TXT / MD Validation
 * ============================================
 */

async function validateTextFile(
  file:
    File
) {
  const bytes =
    new Uint8Array(
      await file.arrayBuffer()
    );

  /*
   * NUL معمولاً نشانه محتوای باینری است.
   */

  if (
    bytes.includes(
      0
    )
  ) {
    return "فایل متنی دارای داده باینری نامعتبر است.";
  }

  /*
   * UTF-8 معتبر.
   */

  try {
    new TextDecoder(
      "utf-8",
      {
        fatal:
          true,
      }
    ).decode(
      bytes
    );
  } catch {
    return "فایل متنی باید دارای محتوای UTF-8 معتبر باشد.";
  }

  return "";
}

/*
 * ============================================
 * Filename
 * ============================================
 */

function sanitizeFileName(
  name:
    string,

  extension:
    string
) {
  const rawName =
    String(
      name ||
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
    rawName
      .slice(
        0,
        Math.max(
          0,
          rawName.length -
            extension.length
        )
      )
      .replace(
        /^\.+|\.+$/g,
        ""
      )
      .trim();

  const maxBaseLength =
    Math.max(
      20,
      FILE_NAME_MAX_LENGTH -
        extension.length
    );

  const baseName =
    (
      rawBaseName ||
      "knowledge"
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
 * File Extension
 * ============================================
 */

function getFileExtension(
  name:
    string
) {
  const normalized =
    String(
      name ||
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
 * Validation Failure
 * ============================================
 */

function validationFailure(
  fieldErrors:
    Record<
      string,
      string
    >
): KnowledgeValidationResult {
  return {
    success:
      false,

    code:
      "VALIDATION_ERROR",

    message:
      Object.values(
        fieldErrors
      )[0] ||
      "اطلاعات ارسالی معتبر نیست.",

    fieldErrors,
  };
}

/*
 * ============================================
 * Text Helpers
 * ============================================
 */

function normalizeSingleLine(
  value:
    unknown
) {
  return String(
    value ||
      ""
  )
    .replace(
      /[\u0000-\u001f\u007f]/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

function cleanSingleLine(
  value:
    unknown,

  maxLength:
    number
) {
  return normalizeSingleLine(
    value
  ).slice(
    0,
    maxLength
  );
}

function cleanContent(
  value:
    unknown
) {
  return String(
    value ||
      ""
  )
    .replace(
      /\u0000/g,
      ""
    )
    .replace(
      /\r\n/g,
      "\n"
    )
    .trim();
}

/*
 * ============================================
 * Relations
 * ============================================
 */

function cleanRelationId(
  value:
    unknown
) {
  const id =
    String(
      value ||
        ""
    ).trim();

  return isRelationId(
    id
  )
    ? id
    : "";
}

function isRelationId(
  value:
    string
) {
  return RELATION_ID_PATTERN.test(
    value
  );
}

/*
 * ============================================
 * String Array Parser
 * ============================================
 */

function parseStringArray(
  value:
    FormDataEntryValue |
    null
): StringArrayParseResult {
  if (
    value ===
    null
  ) {
    return {
      valid:
        true,

      values:
        [],
    };
  }

  if (
    typeof value !==
    "string"
  ) {
    return {
      valid:
        false,

      values:
        [],
    };
  }

  const trimmed =
    value.trim();

  if (
    !trimmed
  ) {
    return {
      valid:
        true,

      values:
        [],
    };
  }

  try {
    const parsed:
      unknown =
        JSON.parse(
          trimmed
        );

    if (
      Array.isArray(
        parsed
      ) &&
      parsed.every(
        (
          item
        ) =>
          typeof item ===
          "string"
      )
    ) {
      return {
        valid:
          true,

        values:
          parsed,
      };
    }

    return {
      valid:
        false,

      values:
        [],
    };
  } catch {
    /*
     * Compatibility برای Clientهای قدیمی که
     * comma-separated ارسال می‌کنند.
     */

    return {
      valid:
        true,

      values:
        trimmed
          .split(
            ","
          )
          .map(
            (
              item
            ) =>
              item.trim()
          )
          .filter(
            Boolean
          ),
    };
  }
}

/*
 * ============================================
 * Tags
 * ============================================
 */

function normalizeTags(
  values:
    string[]
) {
  const unique =
    new Map<
      string,
      string
    >();

  for (
    const rawValue of
    values
  ) {
    const value =
      normalizeSingleLine(
        rawValue
      );

    const key =
      value.toLocaleLowerCase(
        "fa-IR"
      );

    if (
      value &&
      !unique.has(
        key
      )
    ) {
      unique.set(
        key,
        value
      );
    }
  }

  return [
    ...unique.values(),
  ];
}

/*
 * ============================================
 * Normalization
 * ============================================
 */

function normalizeRelation(
  value:
    unknown
) {
  return (
    normalizeStringList(
      value
    )[0] ||
    ""
  );
}

function normalizeStringList(
  value:
    unknown
) {
  if (
    Array.isArray(
      value
    )
  ) {
    return value
      .map(
        (
          item
        ) =>
          String(
            item
          ).trim()
      )
      .filter(
        Boolean
      );
  }

  if (
    typeof value ===
    "string"
  ) {
    const trimmed =
      value.trim();

    if (
      !trimmed
    ) {
      return [];
    }

    try {
      const parsed:
        unknown =
          JSON.parse(
            trimmed
          );

      if (
        Array.isArray(
          parsed
        )
      ) {
        return parsed
          .map(
            (
              item
            ) =>
              String(
                item
              ).trim()
          )
          .filter(
            Boolean
          );
      }
    } catch {
      return trimmed
        .split(
          ","
        )
        .map(
          (
            item
          ) =>
            item.trim()
        )
        .filter(
          Boolean
        );
    }
  }

  return [];
}

/*
 * ============================================
 * Set Comparison
 * ============================================
 */

function sameStringSet(
  left:
    string[],

  right:
    string[]
) {
  return (
    [
      ...new Set(
        left
      ),
    ]
      .sort()
      .join(
        "\u0000"
      ) ===
    [
      ...new Set(
        right
      ),
    ]
      .sort()
      .join(
        "\u0000"
      )
  );
}

/*
 * ============================================
 * Expanded Records
 * ============================================
 */

function getExpandedRecord(
  record:
    RecordModel,

  key:
    string
) {
  const value =
    record.expand?.[
      key
    ];

  return Array.isArray(
    value
  )
    ? value[0]
    : value;
}

function getExpandedRecords(
  record:
    RecordModel,

  key:
    string
) {
  const value =
    record.expand?.[
      key
    ];

  return Array.isArray(
    value
  )
    ? value
    : value
      ? [
          value,
        ]
      : [];
}