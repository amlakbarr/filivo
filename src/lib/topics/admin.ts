import "server-only";

import type PocketBase from "pocketbase";

import type {
  RecordModel,
} from "pocketbase";

/*
 * ============================================
 * Topic Types
 * ============================================
 */

export type TopicRecord =
  RecordModel & {
    name?:
      string;

    code?:
      string;

    description?:
      string;

    keywords?:
      string;

    examples?:
      string;

    negative_examples?:
      string;

    classification_note?:
      string;

    active?:
      boolean;

    sort_order?:
      number;

    created?:
      string;

    updated?:
      string;
  };

export type TopicStatusFilter =
  | ""
  | "active"
  | "inactive";

export type TopicWritePayload = {
  name:
    string;

  code:
    string;

  description:
    string;

  keywords:
    string;

  examples:
    string;

  negative_examples:
    string;

  classification_note:
    string;

  active:
    boolean;

  sort_order:
    number;
};

export type TopicUpdatePayload =
  Partial<
    TopicWritePayload
  >;

/*
 * ============================================
 * Limits
 * ============================================
 */

const MAX_TOPIC_NAME_LENGTH =
  120;

const MAX_TOPIC_CODE_LENGTH =
  80;

const MAX_TOPIC_DESCRIPTION_LENGTH =
  2_000;

const MAX_TOPIC_KEYWORDS_LENGTH =
  1_000;

const MAX_TOPIC_EXAMPLES_LENGTH =
  4_000;

const MAX_TOPIC_NEGATIVE_EXAMPLES_LENGTH =
  4_000;

const MAX_TOPIC_CLASSIFICATION_NOTE_LENGTH =
  2_000;

const MAX_TOPIC_SORT_ORDER =
  1_000_000;

const TOPIC_CODE_PATTERN =
  /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/;

const RECORD_ID_PATTERN =
  /^[a-zA-Z0-9_-]{1,64}$/;

/*
 * ============================================
 * Validation Error
 * ============================================
 */

export class TopicValidationError
  extends Error {
  readonly code:
    string;

  readonly field?:
    string;

  constructor({
    code,
    message,
    field,
  }: {
    code:
      string;

    message:
      string;

    field?:
      string;
  }) {
    super(
      message
    );

    this.name =
      "TopicValidationError";

    this.code =
      code;

    this.field =
      field;
  }
}

/*
 * ============================================
 * Parse Create
 * ============================================
 */

export function parseTopicCreateInput(
  value:
    unknown
): TopicWritePayload {
  const input =
    requireObject(
      value
    );

  const name =
    parseRequiredName(
      input.name
    );

  const code =
    parseRequiredCode(
      input.code
    );

  const description =
    parseDescription(
      input.description
    );

  const keywords =
    parseGuidanceText(
      input.keywords,
      MAX_TOPIC_KEYWORDS_LENGTH,
      "keywords"
    );

  const examples =
    parseGuidanceText(
      input.examples,
      MAX_TOPIC_EXAMPLES_LENGTH,
      "examples"
    );

  const negativeExamples =
    parseGuidanceText(
      input.negative_examples ??
        input.negativeExamples,
      MAX_TOPIC_NEGATIVE_EXAMPLES_LENGTH,
      "negative_examples"
    );

  const classificationNote =
    parseGuidanceText(
      input.classification_note ??
        input.classificationNote,
      MAX_TOPIC_CLASSIFICATION_NOTE_LENGTH,
      "classification_note"
    );

  const active =
    input.active ===
      undefined
      ? true
      : parseBoolean(
          input.active,
          "active"
        );

  const sortOrder =
    parseSortOrder(
      input.sort_order ??
        input.sortOrder ??
        0
    );

  return {
    name,

    code,

    description,

    keywords,

    examples,

    negative_examples:
      negativeExamples,

    classification_note:
      classificationNote,

    active,

    sort_order:
      sortOrder,
  };
}

/*
 * ============================================
 * Parse Update
 * ============================================
 */

export function parseTopicUpdateInput(
  value:
    unknown
): TopicUpdatePayload {
  const input =
    requireObject(
      value
    );

  const payload:
    TopicUpdatePayload = {};

  if (
    Object.prototype.hasOwnProperty.call(
      input,
      "name"
    )
  ) {
    payload.name =
      parseRequiredName(
        input.name
      );
  }

  if (
    Object.prototype.hasOwnProperty.call(
      input,
      "code"
    )
  ) {
    payload.code =
      parseRequiredCode(
        input.code
      );
  }

  if (
    Object.prototype.hasOwnProperty.call(
      input,
      "description"
    )
  ) {
    payload.description =
      parseDescription(
        input.description
      );
  }

  if (
    Object.prototype.hasOwnProperty.call(
      input,
      "keywords"
    )
  ) {
    payload.keywords =
      parseGuidanceText(
        input.keywords,
        MAX_TOPIC_KEYWORDS_LENGTH,
        "keywords"
      );
  }

  if (
    Object.prototype.hasOwnProperty.call(
      input,
      "examples"
    )
  ) {
    payload.examples =
      parseGuidanceText(
        input.examples,
        MAX_TOPIC_EXAMPLES_LENGTH,
        "examples"
      );
  }

  if (
    Object.prototype.hasOwnProperty.call(
      input,
      "negative_examples"
    ) ||
    Object.prototype.hasOwnProperty.call(
      input,
      "negativeExamples"
    )
  ) {
    payload.negative_examples =
      parseGuidanceText(
        input.negative_examples ??
          input.negativeExamples,
        MAX_TOPIC_NEGATIVE_EXAMPLES_LENGTH,
        "negative_examples"
      );
  }

  if (
    Object.prototype.hasOwnProperty.call(
      input,
      "classification_note"
    ) ||
    Object.prototype.hasOwnProperty.call(
      input,
      "classificationNote"
    )
  ) {
    payload.classification_note =
      parseGuidanceText(
        input.classification_note ??
          input.classificationNote,
        MAX_TOPIC_CLASSIFICATION_NOTE_LENGTH,
        "classification_note"
      );
  }

  if (
    Object.prototype.hasOwnProperty.call(
      input,
      "active"
    )
  ) {
    payload.active =
      parseBoolean(
        input.active,
        "active"
      );
  }

  if (
    Object.prototype.hasOwnProperty.call(
      input,
      "sort_order"
    ) ||
    Object.prototype.hasOwnProperty.call(
      input,
      "sortOrder"
    )
  ) {
    payload.sort_order =
      parseSortOrder(
        input.sort_order ??
          input.sortOrder
      );
  }

  if (
    Object.keys(
      payload
    ).length ===
    0
  ) {
    throw new TopicValidationError({
      code:
        "TOPIC_NO_CHANGES",

      message:
        "حداقل یک فیلد برای ویرایش موضوع ارسال کنید.",
    });
  }

  return payload;
}

/*
 * ============================================
 * Topic Code Uniqueness
 * ============================================
 */

export async function topicCodeExists({
  pb,
  code,
  excludeId,
}: {
  pb:
    PocketBase;

  code:
    string;

  excludeId?:
    string;
}) {
  const filters =
    [
      "code = {:code}",
    ];

  const values:
    Record<
      string,
      string
    > = {
      code,
    };

  if (
    excludeId
  ) {
    filters.push(
      "id != {:excludeId}"
    );

    values.excludeId =
      excludeId;
  }

  try {
    await pb
      .collection(
        "topics"
      )
      .getFirstListItem(
        pb.filter(
          filters.join(
            " && "
          ),
          values
        ),
        {
          fields:
            "id",
        }
      );

    return true;
  } catch (error) {
    if (
      getPocketBaseErrorStatus(
        error
      ) ===
      404
    ) {
      return false;
    }

    throw error;
  }
}

/*
 * ============================================
 * List Filter
 * ============================================
 */

export function buildTopicListFilter({
  pb,
  search,
  status,
}: {
  pb:
    PocketBase;

  search:
    string;

  status:
    TopicStatusFilter;
}) {
  const filters:
    string[] = [];

  const values:
    Record<
      string,
      string |
      boolean
    > = {};

  if (
    search
  ) {
    filters.push(
      [
        "(",
        "name ~ {:search}",
        "|| code ~ {:search}",
        "|| description ~ {:search}",
        "|| keywords ~ {:search}",
        "|| classification_note ~ {:search}",
        ")",
      ].join(
        " "
      )
    );

    values.search =
      search;
  }

  if (
    status ===
    "active"
  ) {
    filters.push(
      "active = true"
    );
  } else if (
    status ===
    "inactive"
  ) {
    filters.push(
      "active = false"
    );
  }

  if (
    filters.length ===
    0
  ) {
    return "";
  }

  return pb.filter(
    filters.join(
      " && "
    ),
    values
  );
}

/*
 * ============================================
 * Classified Message Count
 * ============================================
 */

export async function getTopicMessageCount({
  pb,
  topicId,
}: {
  pb:
    PocketBase;

  topicId:
    string;
}) {
  const result =
    await pb
      .collection(
        "messages"
      )
      .getList(
        1,
        1,
        {
          filter:
            pb.filter(
              "topic = {:topicId}",
              {
                topicId,
              }
            ),

          fields:
            "id",
        }
      );

  return Math.max(
    0,
    Number(
      result.totalItems
    ) ||
      0
  );
}

/*
 * ============================================
 * Serialize
 * ============================================
 */

export function serializeTopic(
  record:
    TopicRecord,

  classifiedMessages =
    0
) {
  return {
    id:
      String(
        record.id ||
          ""
      ),

    name:
      cleanText(
        record.name,
        MAX_TOPIC_NAME_LENGTH
      ),

    code:
      normalizeTopicCode(
        record.code
      ),

    description:
      cleanText(
        record.description,
        MAX_TOPIC_DESCRIPTION_LENGTH
      ),

    keywords:
      cleanMultilineText(
        record.keywords,
        MAX_TOPIC_KEYWORDS_LENGTH
      ),

    examples:
      cleanMultilineText(
        record.examples,
        MAX_TOPIC_EXAMPLES_LENGTH
      ),

    negativeExamples:
      cleanMultilineText(
        record.negative_examples,
        MAX_TOPIC_NEGATIVE_EXAMPLES_LENGTH
      ),

    classificationNote:
      cleanMultilineText(
        record.classification_note,
        MAX_TOPIC_CLASSIFICATION_NOTE_LENGTH
      ),

    active:
      record.active ===
      true,

    sortOrder:
      toSafeInteger(
        record.sort_order,
        0,
        MAX_TOPIC_SORT_ORDER,
        0
      ),

    classifiedMessages:
      Math.max(
        0,
        Math.trunc(
          Number(
            classifiedMessages
          ) ||
            0
        )
      ),

    created:
      cleanText(
        record.created,
        100
      ),

    updated:
      cleanText(
        record.updated,
        100
      ),
  };
}

/*
 * ============================================
 * Search / Status / Pagination
 * ============================================
 */

export function cleanTopicSearch(
  value:
    string |
    null
) {
  return cleanText(
    value,
    200
  );
}

export function parseTopicStatus(
  value:
    string |
    null
): TopicStatusFilter {
  if (
    value ===
      "active" ||
    value ===
      "inactive"
  ) {
    return value;
  }

  return "";
}

export function clampInteger(
  value:
    string |
    null,

  minimum:
    number,

  maximum:
    number,

  fallback:
    number
) {
  const parsed =
    Number(
      value
    );

  if (
    !Number.isSafeInteger(
      parsed
    )
  ) {
    return fallback;
  }

  return Math.min(
    maximum,
    Math.max(
      minimum,
      parsed
    )
  );
}

/*
 * ============================================
 * Record ID
 * ============================================
 */

export function isSafeTopicId(
  value:
    string
) {
  return RECORD_ID_PATTERN.test(
    value
  );
}

/*
 * ============================================
 * PocketBase Error
 * ============================================
 */

export function getPocketBaseErrorStatus(
  error:
    unknown
) {
  if (
    typeof error !==
      "object" ||
    error ===
      null
  ) {
    return undefined;
  }

  const value =
    error as {
      status?:
        unknown;
  };

  return typeof value.status ===
    "number"
    ? value.status
    : undefined;
}

/*
 * ============================================
 * Safe Error Metadata
 * ============================================
 */

export function safeTopicErrorMetadata(
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

      message?:
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

    message:
      typeof value.message ===
      "string"
        ? value.message
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

/*
 * ============================================
 * Parsers
 * ============================================
 */

function requireObject(
  value:
    unknown
): Record<
  string,
  unknown
> {
  if (
    typeof value !==
      "object" ||
    value ===
      null ||
    Array.isArray(
      value
    )
  ) {
    throw new TopicValidationError({
      code:
        "TOPIC_INVALID_BODY",

      message:
        "بدنه درخواست موضوع معتبر نیست.",
    });
  }

  return value as Record<
    string,
    unknown
  >;
}

function parseRequiredName(
  value:
    unknown
) {
  const name =
    cleanText(
      value,
      MAX_TOPIC_NAME_LENGTH
    );

  if (
    !name
  ) {
    throw new TopicValidationError({
      code:
        "TOPIC_NAME_REQUIRED",

      message:
        "نام موضوع الزامی است.",

      field:
        "name",
    });
  }

  return name;
}

function parseRequiredCode(
  value:
    unknown
) {
  const code =
    normalizeTopicCode(
      value
    );

  if (
    !code
  ) {
    throw new TopicValidationError({
      code:
        "TOPIC_CODE_REQUIRED",

      message:
        "کد موضوع الزامی است.",

      field:
        "code",
    });
  }

  if (
    code.length >
      MAX_TOPIC_CODE_LENGTH ||
    !TOPIC_CODE_PATTERN.test(
      code
    )
  ) {
    throw new TopicValidationError({
      code:
        "TOPIC_CODE_INVALID",

      message:
        "کد موضوع فقط می‌تواند شامل حروف کوچک انگلیسی، عدد، خط تیره و زیرخط باشد.",

      field:
        "code",
    });
  }

  return code;
}

function parseDescription(
  value:
    unknown
) {
  if (
    value ===
      undefined ||
    value ===
      null
  ) {
    return "";
  }

  return cleanText(
    value,
    MAX_TOPIC_DESCRIPTION_LENGTH
  );
}

function parseBoolean(
  value:
    unknown,

  field:
    string
) {
  if (
    typeof value ===
    "boolean"
  ) {
    return value;
  }

  throw new TopicValidationError({
    code:
      "TOPIC_BOOLEAN_INVALID",

    message:
      "مقدار وضعیت موضوع معتبر نیست.",

    field,
  });
}

function parseSortOrder(
  value:
    unknown
) {
  const parsed =
    Number(
      value
    );

  if (
    !Number.isSafeInteger(
      parsed
    ) ||
    parsed <
      0 ||
    parsed >
      MAX_TOPIC_SORT_ORDER
  ) {
    throw new TopicValidationError({
      code:
        "TOPIC_SORT_ORDER_INVALID",

      message:
        `ترتیب نمایش باید عدد صحیح بین 0 و ${MAX_TOPIC_SORT_ORDER} باشد.`,

      field:
        "sort_order",
    });
  }

  return parsed;
}

function parseGuidanceText(
  value:
    unknown,

  maxLength:
    number,

  field:
    string
) {
  if (
    value ===
      undefined ||
    value ===
      null
  ) {
    return "";
  }

  if (
    typeof value !==
    "string"
  ) {
    throw new TopicValidationError({
      code:
        "TOPIC_GUIDANCE_INVALID",

      message:
        "مقدار راهنمای طبقه‌بندی معتبر نیست.",

      field,
    });
  }

  return cleanMultilineText(
    value,
    maxLength
  );
}

function cleanMultilineText(
  value:
    unknown,

  maxLength:
    number
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
    .slice(
      0,
      maxLength
    )
    .trim();
}

/*
 * ============================================
 * Normalize
 * ============================================
 */

function normalizeTopicCode(
  value:
    unknown
) {
  return cleanText(
    value,
    MAX_TOPIC_CODE_LENGTH
  )
    .toLowerCase();
}

function cleanText(
  value:
    unknown,

  maxLength:
    number
) {
  if (
    typeof value !==
      "string"
  ) {
    return "";
  }

  return value
    .trim()
    .slice(
      0,
      maxLength
    );
}

function toSafeInteger(
  value:
    unknown,

  minimum:
    number,

  maximum:
    number,

  fallback:
    number
) {
  const parsed =
    Number(
      value
    );

  if (
    !Number.isSafeInteger(
      parsed
    )
  ) {
    return fallback;
  }

  return Math.min(
    maximum,
    Math.max(
      minimum,
      parsed
    )
  );
}