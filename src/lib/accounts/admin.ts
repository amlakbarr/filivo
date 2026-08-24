import type PocketBase from "pocketbase";

import type {
  RecordModel,
} from "pocketbase";

import type {
  AccountActivity,
  AccountRole,
  ManagedAccount,
} from "@/types/account";

/*
 * ============================================
 * Types
 * ============================================
 */

export type AccountRecord =
  RecordModel & {
    name?:
      string;

    email?:
      string;

    employee_code?:
      string;

    department?:
      string;

    job_title?:
      string;

    role?:
      AccountRole;

    active?:
      boolean;
  };

export type AccountInput = {
  name:
    string;

  email:
    string;

  employeeCode:
    string;

  department:
    string;

  jobTitle:
    string;

  role:
    AccountRole;

  active:
    boolean;

  password?:
    string;

  passwordConfirm?:
    string;
};

export type AccountValidationResult =
  | {
      success:
        true;

      data:
        AccountInput;
    }
  | {
      success:
        false;

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

/*
 * ============================================
 * Constants
 * ============================================
 */

const EMAIL_PATTERN =
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u;

const RELATION_ID_PATTERN =
  /^[a-zA-Z0-9_-]{1,64}$/;

const ACCOUNT_ROLES = [
  "employee",
  "admin",
] as const;

/*
 * Accounts List Route حداکثر 50 Account
 * در هر Page برمی‌گرداند.
 *
 * این Guard مانع استفاده ناخواسته از این
 * Helper برای هزاران Account به‌صورت همزمان
 * می‌شود.
 */
const MAX_ACTIVITY_ACCOUNT_IDS =
  50;

/*
 * در هر لحظه فقط تعداد محدودی Account
 * برای Activity Query پردازش می‌شود.
 *
 * هر Account حداکثر دو Query همزمان دارد:
 *
 * conversations
 * messages
 */
const ACCOUNT_ACTIVITY_CONCURRENCY =
  6;

/*
 * ============================================
 * Record ID
 * ============================================
 */

export function isSafeRecordId(
  value:
    string
) {
  return RELATION_ID_PATTERN.test(
    value
  );
}

/*
 * ============================================
 * Parse Account Input
 * ============================================
 */

export function parseAccountInput(
  body:
    unknown,

  options: {
    requirePassword:
      boolean;

    applyDefaults?:
      boolean;
  }
): AccountValidationResult {
  if (
    typeof body !==
      "object" ||
    body ===
      null
  ) {
    return validationFailure({
      form:
        "ساختار درخواست معتبر نیست.",
    });
  }

  const value =
    body as Record<
      string,
      unknown
    >;

  const name =
    cleanSingleLine(
      value.name,
      120
    );

  const email =
    String(
      value.email ||
        ""
    )
      .trim()
      .toLowerCase()
      .slice(
        0,
        254
      );

  const employeeCode =
    cleanSingleLine(
      value.employee_code,
      50
    );

  const department =
    String(
      value.department ||
        ""
    ).trim();

  const jobTitle =
    cleanSingleLine(
      value.job_title,
      120
    );

  const role =
    String(
      value.role ||
        (
          options.applyDefaults
            ? "employee"
            : ""
        )
    ) as AccountRole;

  const active =
    value.active ===
      undefined &&
    options.applyDefaults
      ? true
      : value.active;

  const password =
    String(
      value.password ||
        ""
    );

  const passwordConfirm =
    String(
      value.passwordConfirm ||
        ""
    );

  const fieldErrors:
    Record<
      string,
      string
    > = {};

  /*
   * ==========================================
   * Name
   * ==========================================
   */

  if (
    !name
  ) {
    fieldErrors.name =
      "نام الزامی است.";
  }

  /*
   * ==========================================
   * Email
   * ==========================================
   */

  if (
    !email
  ) {
    fieldErrors.email =
      "ایمیل الزامی است.";
  } else if (
    !EMAIL_PATTERN.test(
      email
    )
  ) {
    fieldErrors.email =
      "فرمت ایمیل معتبر نیست.";
  }

  /*
   * ==========================================
   * Employee Code
   * ==========================================
   */

  if (
    !employeeCode
  ) {
    fieldErrors.employee_code =
      "کد کارشناس الزامی است.";
  }

  /*
   * ==========================================
   * Department
   * ==========================================
   */

  if (
    department &&
    !RELATION_ID_PATTERN.test(
      department
    )
  ) {
    fieldErrors.department =
      "دپارتمان انتخاب‌شده معتبر نیست.";
  }

  /*
   * ==========================================
   * Role
   * ==========================================
   */

  if (
    !ACCOUNT_ROLES.includes(
      role
    )
  ) {
    fieldErrors.role =
      "Role انتخاب‌شده معتبر نیست.";
  }

  /*
   * ==========================================
   * Active
   * ==========================================
   */

  if (
    typeof active !==
    "boolean"
  ) {
    fieldErrors.active =
      "وضعیت حساب معتبر نیست.";
  }

  /*
   * ==========================================
   * Password
   * ==========================================
   */

  if (
    options.requirePassword ||
    password ||
    passwordConfirm
  ) {
    const passwordError =
      validatePassword(
        password
      );

    if (
      passwordError
    ) {
      fieldErrors.password =
        passwordError;
    }

    if (
      password !==
      passwordConfirm
    ) {
      fieldErrors.passwordConfirm =
        "تکرار رمز عبور با رمز عبور یکسان نیست.";
    }
  }

  /*
   * ==========================================
   * Result
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
      name,

      email,

      employeeCode,

      department,

      jobTitle,

      role,

      active:
        active as boolean,

      ...(options.requirePassword
        ? {
            password,

            passwordConfirm,
          }
        : {}),
    },
  };
}

/*
 * ============================================
 * Parse Password Input
 * ============================================
 */

export function parsePasswordInput(
  body:
    unknown
) {
  if (
    typeof body !==
      "object" ||
    body ===
      null
  ) {
    return validationFailure({
      form:
        "ساختار درخواست معتبر نیست.",
    });
  }

  const value =
    body as Record<
      string,
      unknown
    >;

  const password =
    String(
      value.password ||
        ""
    );

  const passwordConfirm =
    String(
      value.passwordConfirm ||
        ""
    );

  const fieldErrors:
    Record<
      string,
      string
    > = {};

  const passwordError =
    validatePassword(
      password
    );

  if (
    passwordError
  ) {
    fieldErrors.password =
      passwordError;
  }

  if (
    password !==
    passwordConfirm
  ) {
    fieldErrors.passwordConfirm =
      "تکرار رمز عبور با رمز عبور یکسان نیست.";
  }

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
      true as const,

    data: {
      password,

      passwordConfirm,
    },
  };
}

/*
 * ============================================
 * Validate Uniqueness
 * ============================================
 */

export async function validateAccountUniqueness(
  pb:
    PocketBase,

  input:
    Pick<
      AccountInput,
      | "email"
      | "employeeCode"
    >,

  excludeId?:
    string
) {
  const filterValues:
    Record<
      string,
      string
    > = {
    email:
      input.email,

    employeeCode:
      input.employeeCode,
  };

  let filter =
    "(email = {:email} || employee_code = {:employeeCode})";

  if (
    excludeId
  ) {
    filterValues.excludeId =
      excludeId;

    filter +=
      " && id != {:excludeId}";
  }

  const result =
    await pb
      .collection(
        "accounts"
      )
      .getList<AccountRecord>(
        1,
        10,
        {
          filter:
            pb.filter(
              filter,
              filterValues
            ),

          fields:
            "id,email,employee_code",
        }
      );

  const errors:
    Record<
      string,
      string
    > = {};

  for (
    const record of
    result.items
  ) {
    if (
      String(
        record.email ||
          ""
      ).toLowerCase() ===
      input.email
    ) {
      errors.email =
        "این ایمیل قبلاً ثبت شده است.";
    }

    if (
      String(
        record.employee_code ||
          ""
      ) ===
      input.employeeCode
    ) {
      errors.employee_code =
        "این کد کارشناس قبلاً ثبت شده است.";
    }
  }

  return errors;
}

/*
 * ============================================
 * Validate Department
 * ============================================
 */

export async function validateDepartment(
  pb:
    PocketBase,

  departmentId:
    string,

  options?: {
    allowInactiveId?:
      string;
  }
) {
  if (
    !departmentId
  ) {
    return "";
  }

  try {
    const department =
      await pb
        .collection(
          "departments"
        )
        .getOne(
          departmentId,
          {
            fields:
              "id,active",
          }
        );

    if (
      department.active ===
        false &&
      department.id !==
        options?.allowInactiveId
    ) {
      return "دپارتمان انتخاب‌شده غیرفعال است.";
    }

    return "";
  } catch {
    return "دپارتمان انتخاب‌شده وجود ندارد.";
  }
}

/*
 * ============================================
 * Account Guards
 * ============================================
 */

export async function enforceAccountGuards({
  pb,
  actorId,
  target,
  nextRole,
  nextActive,
}: {
  pb:
    PocketBase;

  actorId:
    string;

  target:
    AccountRecord;

  nextRole:
    AccountRole;

  nextActive:
    boolean;
}) {
  /*
   * ==========================================
   * Self Protection
   * ==========================================
   */

  if (
    target.id ===
    actorId
  ) {
    if (
      !nextActive
    ) {
      return {
        code:
          "SELF_DEACTIVATION_FORBIDDEN",

        message:
          "نمی‌توانید حساب مدیریتی فعلی خود را غیرفعال کنید.",
      };
    }

    if (
      target.role ===
        "admin" &&
      nextRole !==
        "admin"
    ) {
      return {
        code:
          "SELF_DEMOTION_FORBIDDEN",

        message:
          "نمی‌توانید Role حساب مدیریتی فعلی خود را کاهش دهید.",
      };
    }
  }

  /*
   * ==========================================
   * Last Active Admin
   * ==========================================
   */

  const removesActiveAdmin =
    target.role ===
      "admin" &&
    target.active !==
      false &&
    (
      !nextActive ||
      nextRole !==
        "admin"
    );

  if (
    removesActiveAdmin
  ) {
    const result =
      await pb
        .collection(
          "accounts"
        )
        .getList(
          1,
          1,
          {
            filter:
              pb.filter(
                "role = 'admin' && active = true && id != {:targetId}",
                {
                  targetId:
                    target.id,
                }
              ),

            fields:
              "id",
          }
        );

    if (
      result.totalItems ===
      0
    ) {
      return {
        code:
          "LAST_ACTIVE_ADMIN",

        message:
          "آخرین مدیر فعال سیستم را نمی‌توان غیرفعال یا به کارشناس تبدیل کرد.",
      };
    }
  }

  return null;
}

/*
 * ============================================
 * Build Account Payload
 * ============================================
 */

export function buildAccountPayload(
  input:
    AccountInput
) {
  return {
    name:
      input.name,

    email:
      input.email,

    employee_code:
      input.employeeCode,

    department:
      input.department,

    job_title:
      input.jobTitle,

    role:
      input.role,

    active:
      input.active,
  };
}

/*
 * ============================================
 * Accounts Activity
 *
 * مهم:
 *
 * نسخه قدیمی conversations و messages را با
 * getFullList دریافت می‌کرد.
 *
 * با افزایش حجم دیتابیس آن روش می‌توانست
 * هزاران یا میلیون‌ها Record را فقط برای
 * نمایش صفحه Accounts منتقل کند.
 *
 * در این نسخه:
 *
 * - برای هر Account فقط getList(1, 1)
 * - Count از totalItems
 * - Last Activity از همان یک Record
 * - Concurrency محدود
 *
 * بنابراین مصرف Memory و حجم Data Transfer
 * با بزرگ‌شدن دیتابیس ثابت می‌ماند.
 * ============================================
 */

export async function getAccountsActivity(
  pb:
    PocketBase,

  accountIds:
    string[]
) {
  /*
   * ==========================================
   * Normalize IDs
   * ==========================================
   */

  const uniqueIds = [
    ...new Set(
      accountIds.filter(
        isSafeRecordId
      )
    ),
  ];

  /*
   * ==========================================
   * Result
   * ==========================================
   */

  const result =
    new Map<
      string,
      AccountActivity
    >();

  for (
    const id of
    uniqueIds
  ) {
    result.set(
      id,
      emptyActivity()
    );
  }

  if (
    uniqueIds.length ===
    0
  ) {
    return result;
  }

  /*
   * ==========================================
   * Defensive Limit
   * ==========================================
   */

  if (
    uniqueIds.length >
    MAX_ACTIVITY_ACCOUNT_IDS
  ) {
    throw new Error(
      `getAccountsActivity supports at most ${MAX_ACTIVITY_ACCOUNT_IDS} accounts per request`
    );
  }

  /*
   * ==========================================
   * Limited Concurrency
   * ==========================================
   */

  await mapWithConcurrency(
    uniqueIds,
    ACCOUNT_ACTIVITY_CONCURRENCY,
    async (
      accountId
    ) => {
      const activity =
        await loadAccountActivity(
          pb,
          accountId
        );

      result.set(
        accountId,
        activity
      );
    }
  );

  return result;
}

/*
 * ============================================
 * Load One Account Activity
 * ============================================
 */

async function loadAccountActivity(
  pb:
    PocketBase,

  accountId:
    string
): Promise<AccountActivity> {
  /*
   * فقط یک Record از هر Collection لازم است.
   *
   * totalItems تعداد واقعی Recordهای Match
   * شده را بدون انتقال همه آن‌ها می‌دهد.
   */

  const [
    conversations,
    questions,
  ] =
    await Promise.all([
      pb
        .collection(
          "conversations"
        )
        .getList(
          1,
          1,
          {
            filter:
              pb.filter(
                "user = {:userId}",
                {
                  userId:
                    accountId,
                }
              ),

            /*
             * updated با ثبت پیام جدید Conversation
             * نیز به‌روز می‌شود و برای یافتن آخرین
             * Activity مناسب است.
             */
            sort:
              "-updated",

            fields:
              "id,created,updated,last_message_at",
          }
        ),

      pb
        .collection(
          "messages"
        )
        .getList(
          1,
          1,
          {
            filter:
              pb.filter(
                "role = 'user' && user = {:userId}",
                {
                  userId:
                    accountId,
                }
              ),

            sort:
              "-created",

            fields:
              "id,created",
          }
        ),
    ]);

  /*
   * ==========================================
   * Conversation Activity
   * ==========================================
   */

  const latestConversation =
    conversations.items[0];

  const conversationActivity =
    latestConversation
      ? String(
          latestConversation
            .last_message_at ||
            latestConversation
              .updated ||
            latestConversation
              .created ||
            ""
        )
      : "";

  /*
   * ==========================================
   * Question Activity
   * ==========================================
   */

  const latestQuestion =
    questions.items[0];

  const questionActivity =
    latestQuestion
      ? String(
          latestQuestion.created ||
            ""
        )
      : "";

  /*
   * ==========================================
   * Exact Result
   * ==========================================
   */

  return {
    conversationCount:
      conversations.totalItems,

    questionCount:
      questions.totalItems,

    lastActivity:
      latestDate(
        conversationActivity,
        questionActivity
      ),
  };
}

/*
 * ============================================
 * Limited Concurrency
 * ============================================
 */

async function mapWithConcurrency<
  TItem
>(
  items:
    TItem[],

  concurrency:
    number,

  worker: (
    item:
      TItem
  ) => Promise<void>
) {
  if (
    items.length ===
    0
  ) {
    return;
  }

  const safeConcurrency =
    Math.max(
      1,
      Math.min(
        Math.floor(
          concurrency
        ),
        items.length
      )
    );

  let nextIndex =
    0;

  async function runWorker() {
    while (
      true
    ) {
      const currentIndex =
        nextIndex;

      if (
        currentIndex >=
        items.length
      ) {
        return;
      }

      /*
       * JS execution تا await بعدی synchronous
       * است؛ بنابراین گرفتن Index در این قسمت
       * بین Workerها تداخل ندارد.
       */
      nextIndex +=
        1;

      await worker(
        items[
          currentIndex
        ]
      );
    }
  }

  await Promise.all(
    Array.from(
      {
        length:
          safeConcurrency,
      },
      () =>
        runWorker()
    )
  );
}

/*
 * ============================================
 * Serialize Account
 * ============================================
 */

export function serializeAccount(
  record:
    AccountRecord,

  activity =
    emptyActivity()
): ManagedAccount {
  const departmentValue =
    record.expand
      ?.department;

  const department =
    Array.isArray(
      departmentValue
    )
      ? departmentValue[0]
      : departmentValue;

  return {
    id:
      record.id,

    name:
      String(
        record.name ||
          ""
      ),

    email:
      String(
        record.email ||
          ""
      ),

    employee_code:
      String(
        record.employee_code ||
          ""
      ),

    department:
      String(
        record.department ||
          ""
      ),

    department_name:
      String(
        department?.name ||
          ""
      ),

    job_title:
      String(
        record.job_title ||
          ""
      ),

    role:
      record.role ===
      "admin"
        ? "admin"
        : "employee",

    active:
      record.active !==
      false,

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

    activity,
  };
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
 * Password Validation
 * ============================================
 */

function validatePassword(
  password:
    string
) {
  if (
    password.length <
    10
  ) {
    return "رمز عبور باید حداقل ۱۰ نویسه باشد.";
  }

  if (
    password.length >
    128
  ) {
    return "رمز عبور نباید بیشتر از ۱۲۸ نویسه باشد.";
  }

  if (
    !/\p{L}/u.test(
      password
    ) ||
    !/\p{N}/u.test(
      password
    )
  ) {
    return "رمز عبور باید حداقل شامل یک حرف و یک عدد باشد.";
  }

  return "";
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
) {
  return {
    success:
      false as const,

    code:
      "VALIDATION_ERROR" as const,

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
 * Clean Single Line
 * ============================================
 */

function cleanSingleLine(
  value:
    unknown,

  maxLength:
    number
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
    .trim()
    .slice(
      0,
      maxLength
    );
}

/*
 * ============================================
 * Empty Activity
 * ============================================
 */

function emptyActivity():
  AccountActivity {
  return {
    conversationCount:
      0,

    questionCount:
      0,

    lastActivity:
      "",
  };
}

/*
 * ============================================
 * Latest Date
 * ============================================
 */

function latestDate(
  left:
    string,

  right:
    string
) {
  if (
    !left
  ) {
    return right;
  }

  if (
    !right
  ) {
    return left;
  }

  const leftTime =
    new Date(
      left
    ).getTime();

  const rightTime =
    new Date(
      right
    ).getTime();

  /*
   * اگر یکی از تاریخ‌های Legacy نامعتبر باشد،
   * تاریخ معتبر را ترجیح می‌دهیم.
   */

  if (
    Number.isNaN(
      leftTime
    )
  ) {
    return right;
  }

  if (
    Number.isNaN(
      rightTime
    )
  ) {
    return left;
  }

  return rightTime >
    leftTime
    ? right
    : left;
}