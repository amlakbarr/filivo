import {
  recordAuditLog,
} from "@/lib/audit/log";

import {
  buildAccountPayload,
  getAccountsActivity,
  getPocketBaseError,
  parseAccountInput,
  serializeAccount,
  validateAccountUniqueness,
  validateDepartment,
  type AccountRecord,
} from "@/lib/accounts/admin";

import {
  accountApiError,
  accountApiResponse,
} from "@/lib/accounts/response";

import {
  consumeAdminRateLimit,
} from "@/lib/admin/rate-limit";

import {
  getAdminSession,
} from "@/lib/pocketbase/admin";

import {
  getPocketBaseServiceClient,
} from "@/lib/pocketbase/service";

/*
 * ============================================
 * Limits
 * ============================================
 */

const MAX_PAGE =
  10_000;

const MAX_REQUEST_BODY_BYTES =
  16 * 1024;

/*
 * ============================================
 * Sort Allow-list
 * ============================================
 */

const SORTS: Record<
  string,
  string
> = {
  newest:
    "-created",

  oldest:
    "created",

  updated:
    "-updated",

  name:
    "name",

  employee_code:
    "employee_code",

  email:
    "email",
};

/*
 * ============================================
 * GET
 * ============================================
 */

export async function GET(
  request: Request
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

  if (
    !admin.ok
  ) {
    return accountApiError(
      requestId,
      admin.status,
      admin.code,
      admin.message
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
      "Account list service unavailable",
      {
        requestId,

        adminId:
          admin.account.id,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return serviceUnavailable(
      requestId
    );
  }

  /*
   * ==========================================
   * Query Params
   * ==========================================
   */

  const url =
    new URL(
      request.url
    );

  const page =
    clampInteger(
      url.searchParams.get(
        "page"
      ),
      1,
      MAX_PAGE,
      1
    );

  const perPage =
    clampInteger(
      url.searchParams.get(
        "perPage"
      ),
      1,
      50,
      10
    );

  const search =
    cleanSearch(
      url.searchParams.get(
        "search"
      )
    );

  const department =
    cleanId(
      url.searchParams.get(
        "department"
      )
    );

  const role =
    url.searchParams.get(
      "role"
    ) ||
    "";

  const active =
    url.searchParams.get(
      "active"
    ) ||
    "";

  const sort =
    SORTS[
      url.searchParams.get(
        "sort"
      ) ||
        "newest"
    ] ||
    SORTS.newest;

  /*
   * ==========================================
   * Build Safe Filter
   *
   * Client هیچ Filter خام PocketBase ارسال
   * نمی‌کند.
   * ==========================================
   */

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
      "(name ~ {:search} || email ~ {:search} || employee_code ~ {:search})"
    );

    values.search =
      search;
  }

  if (
    department
  ) {
    filters.push(
      "department = {:department}"
    );

    values.department =
      department;
  }

  if (
    role ===
      "employee" ||
    role ===
      "admin"
  ) {
    filters.push(
      "role = {:role}"
    );

    values.role =
      role;
  }

  if (
    active ===
      "true" ||
    active ===
      "false"
  ) {
    filters.push(
      "active = {:active}"
    );

    values.active =
      active ===
      "true";
  }

  /*
   * ==========================================
   * Accounts List
   * ==========================================
   */

  try {
    const result =
      await pb
        .collection(
          "accounts"
        )
        .getList<AccountRecord>(
          page,
          perPage,
          {
            filter:
              filters.length >
              0
                ? pb.filter(
                    filters.join(
                      " && "
                    ),
                    values
                  )
                : "",

            sort,

            expand:
              "department",
          }
        );

    /*
     * ========================================
     * Account Activity
     *
     * Activity failure نباید Accounts List را
     * Fail کند.
     * ========================================
     */

    let activity =
      new Map();

    let activityUnavailable =
      false;

    try {
      activity =
        await getAccountsActivity(
          pb,
          result.items.map(
            (
              item
            ) =>
              item.id
          )
        );
    } catch (error) {
      activityUnavailable =
        true;

      console.error(
        "Accounts activity batch failed",
        {
          requestId,

          adminId:
            admin.account.id,

          error:
            safeErrorMetadata(
              error
            ),
        }
      );
    }

    /*
     * ========================================
     * Response
     * ========================================
     */

    return accountApiResponse(
      {
        success:
          true,

        items:
          result.items.map(
            (
              item
            ) =>
              serializeAccount(
                item,
                activity.get(
                  item.id
                )
              )
          ),

        page:
          result.page,

        perPage:
          result.perPage,

        totalItems:
          result.totalItems,

        totalPages:
          result.totalPages,

        currentAccountId:
          admin.account.id,

        activityUnavailable,
      },
      200,
      requestId
    );
  } catch (error) {
    console.error(
      "Accounts list failed",
      {
        requestId,

        adminId:
          admin.account.id,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return accountApiError(
      requestId,
      503,
      "ACCOUNTS_LIST_FAILED",
      "دریافت فهرست کارشناسان ناموفق بود."
    );
  }
}

/*
 * ============================================
 * POST
 *
 * Create Account
 *
 * Rate Limit:
 *
 * account.create
 * 10 requests / 10 minutes / admin
 * ============================================
 */

export async function POST(
  request: Request
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

  if (
    !admin.ok
  ) {
    return accountApiError(
      requestId,
      admin.status,
      admin.code,
      admin.message
    );
  }

  /*
   * ==========================================
   * Admin Rate Limit
   *
   * account.create
   *
   * 10 account creation attempts
   * / 10 minutes
   * / admin
   *
   * Rate Limit عمداً قبل از Body parsing قرار
   * گرفته است تا Request خراب نیز نتواند
   * Endpoint حساس را Flood کند.
   *
   * Fail-closed:
   * اگر Rate Limiter در دسترس نباشد Account
   * ساخته نمی‌شود.
   * ==========================================
   */

  let rateLimit:
    Awaited<
      ReturnType<
        typeof consumeAdminRateLimit
      >
    >;

  try {
    rateLimit =
      await consumeAdminRateLimit({
        adminId:
          admin.account.id,

        action:
          "account.create",

        requestId,
      });
  } catch (error) {
    console.error(
      "Admin account create rate limit unavailable",
      {
        requestId,

        adminId:
          admin.account.id,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return accountApiError(
      requestId,
      503,
      "ADMIN_RATE_LIMIT_UNAVAILABLE",
      "سرویس کنترل تعداد درخواست‌ها موقتاً در دسترس نیست."
    );
  }

  /*
   * ==========================================
   * Rate Limited
   * ==========================================
   */

  if (
    !rateLimit.allowed
  ) {
    console.warn(
      "Admin account creation rate limited",
      {
        requestId,

        adminId:
          admin.account.id,

        retryAfterSeconds:
          rateLimit.retryAfterSeconds,

        resetAt:
          rateLimit.resetAt,
      }
    );

    const response =
      accountApiError(
        requestId,
        429,
        "ADMIN_RATE_LIMITED",
        "تعداد درخواست‌های ساخت حساب بیش از حد مجاز است.",
        {
          retryAfterSeconds:
            rateLimit.retryAfterSeconds,

          limit:
            rateLimit.limit,

          remaining:
            rateLimit.remaining,

          resetAt:
            rateLimit.resetAt,
        }
      );

    response.headers.set(
      "Retry-After",
      String(
        rateLimit.retryAfterSeconds
      )
    );

    response.headers.set(
      "X-RateLimit-Limit",
      String(
        rateLimit.limit
      )
    );

    response.headers.set(
      "X-RateLimit-Remaining",
      "0"
    );

    response.headers.set(
      "X-RateLimit-Reset",
      rateLimit.resetAt
    );

    return response;
  }

  /*
   * ==========================================
   * Content Type
   * ==========================================
   */

  const contentType =
    String(
      request.headers.get(
        "content-type"
      ) ||
        ""
    )
      .split(
        ";"
      )[0]
      .trim()
      .toLowerCase();

  if (
    contentType !==
    "application/json"
  ) {
    return withRateLimitHeaders(
      accountApiError(
        requestId,
        415,
        "UNSUPPORTED_MEDIA_TYPE",
        "نوع محتوای درخواست معتبر نیست."
      ),
      rateLimit
    );
  }

  /*
   * ==========================================
   * Declared Body Size
   *
   * Fast Reject.
   *
   * Stream Reader پایین‌تر نیز Limit واقعی را
   * اعمال می‌کند.
   * ==========================================
   */

  const rawContentLength =
    request.headers.get(
      "content-length"
    );

  if (
    rawContentLength
  ) {
    const declaredLength =
      Number(
        rawContentLength
      );

    if (
      !Number.isSafeInteger(
        declaredLength
      ) ||
      declaredLength <
        0
    ) {
      return withRateLimitHeaders(
        accountApiError(
          requestId,
          400,
          "INVALID_CONTENT_LENGTH",
          "حجم درخواست معتبر نیست."
        ),
        rateLimit
      );
    }

    if (
      declaredLength >
      MAX_REQUEST_BODY_BYTES
    ) {
      return withRateLimitHeaders(
        accountApiError(
          requestId,
          413,
          "REQUEST_BODY_TOO_LARGE",
          "حجم درخواست بیش از حد مجاز است."
        ),
        rateLimit
      );
    }
  }

  /*
   * ==========================================
   * Bounded JSON Body
   * ==========================================
   */

  const parsedBody =
    await readJsonBodyWithLimit(
      request,
      MAX_REQUEST_BODY_BYTES
    );

  if (
    !parsedBody.ok
  ) {
    return withRateLimitHeaders(
      accountApiError(
        requestId,
        parsedBody.status,
        parsedBody.code,
        parsedBody.message
      ),
      rateLimit
    );
  }

  const body =
    parsedBody.body;

  /*
   * ==========================================
   * Parse / Validate
   * ==========================================
   */

  const parsed =
    parseAccountInput(
      body,
      {
        requirePassword:
          true,

        applyDefaults:
          true,
      }
    );

  if (
    !parsed.success
  ) {
    return withRateLimitHeaders(
      accountApiError(
        requestId,
        400,
        parsed.code,
        parsed.message,
        {
          fieldErrors:
            parsed.fieldErrors,
        }
      ),
      rateLimit
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
      "Account service unavailable",
      {
        requestId,

        adminId:
          admin.account.id,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    await safeAuditAccountCreate({
      request,

      requestId,

      actorId:
        admin.account.id,

      result:
        "failure",

      errorCode:
        "ACCOUNT_SERVICE_UNAVAILABLE",

      metadata: {
        stage:
          "service_client",
      },
    });

    return withRateLimitHeaders(
      serviceUnavailable(
        requestId
      ),
      rateLimit
    );
  }

  /*
   * ==========================================
   * Validate Relations / Uniqueness
   * ==========================================
   */

  try {
    const [
      uniqueErrors,
      departmentError,
    ] =
      await Promise.all([
        validateAccountUniqueness(
          pb,
          parsed.data
        ),

        validateDepartment(
          pb,
          parsed.data.department
        ),
      ]);

    const fieldErrors = {
      ...uniqueErrors,

      ...(departmentError
        ? {
            department:
              departmentError,
          }
        : {}),
    };

    if (
      Object.keys(
        fieldErrors
      ).length >
      0
    ) {
      return withRateLimitHeaders(
        accountApiError(
          requestId,
          409,
          "ACCOUNT_CONFLICT",
          Object.values(
            fieldErrors
          )[0],
          {
            fieldErrors,
          }
        ),
        rateLimit
      );
    }

    /*
     * ========================================
     * Create
     * ========================================
     */

    const created =
      await pb
        .collection(
          "accounts"
        )
        .create<AccountRecord>({
          ...buildAccountPayload(
            parsed.data
          ),

          /*
           * Password فقط برای PocketBase
           * ارسال می‌شود.
           */
          password:
            parsed.data.password,

          passwordConfirm:
            parsed.data
              .passwordConfirm,
        });

    /*
     * ========================================
     * Audit Create Success
     *
     * Password یا Request Body در Audit ثبت
     * نمی‌شود.
     * ========================================
     */

    await safeAuditAccountCreate({
      request,

      requestId,

      actorId:
        admin.account.id,

      result:
        "success",

      entityId:
        created.id,

      targetUserId:
        created.id,

      metadata: {
        role:
          normalizeAuditText(
            created.role,
            32
          ),

        active:
          created.active ===
          true,

        employee_code:
          normalizeAuditText(
            created.employee_code,
            100
          ),

        department_id:
          created.department
            ? normalizeAuditText(
                created.department,
                64
              )
            : null,
      },
    });

    /*
     * ========================================
     * Reload with Department Expand
     * ========================================
     */

    let account:
      AccountRecord;

    try {
      account =
        await pb
          .collection(
            "accounts"
          )
          .getOne<AccountRecord>(
            created.id,
            {
              expand:
                "department",
            }
          );
    } catch (error) {
      /*
       * خود Account واقعاً ساخته شده است.
       * Reload failure نباید عملیات موفق را
       * Failure نشان دهد.
       */

      console.error(
        "Account created but reload failed",
        {
          requestId,

          adminId:
            admin.account.id,

          accountId:
            created.id,

          error:
            safeErrorMetadata(
              error
            ),
        }
      );

      return withRateLimitHeaders(
        accountApiResponse(
          {
            success:
              true,

            account:
              serializeAccount(
                created
              ),

            message:
              "حساب کاربری ساخته شد، اما دریافت اطلاعات تکمیلی آن ناموفق بود.",

            warningCode:
              "ACCOUNT_RELOAD_FAILED",
          },
          201,
          requestId
        ),
        rateLimit
      );
    }

    /*
     * ========================================
     * Success Response
     * ========================================
     */

    return withRateLimitHeaders(
      accountApiResponse(
        {
          success:
            true,

          account:
            serializeAccount(
              account
            ),

          message:
            "حساب کاربری با موفقیت ساخته شد.",
        },
        201,
        requestId
      ),
      rateLimit
    );
  } catch (error) {
    const metadata =
      getPocketBaseError(
        error
      );

    console.error(
      "Account create failed",
      {
        requestId,

        adminId:
          admin.account.id,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    /*
     * ========================================
     * Audit Create Failure
     *
     * Password و Request Body عمداً وارد
     * Metadata نمی‌شوند.
     * ========================================
     */

    await safeAuditAccountCreate({
      request,

      requestId,

      actorId:
        admin.account.id,

      result:
        "failure",

      errorCode:
        "ACCOUNT_CREATE_FAILED",

      metadata: {
        stage:
          "create",

        pocketbase_status:
          metadata.status,
      },
    });

    return withRateLimitHeaders(
      accountApiError(
        requestId,

        metadata.status ===
          400
          ? 400
          : 503,

        "ACCOUNT_CREATE_FAILED",

        metadata.status ===
          400
          ? "ساخت حساب به‌دلیل ناسازگاری اطلاعات ناموفق بود."
          : "ساخت حساب کاربری ناموفق بود."
      ),
      rateLimit
    );
  }
}

/*
 * ============================================
 * Account Create Audit
 *
 * Audit failure نباید عملیات Account را Fail
 * کند.
 * ============================================
 */

async function safeAuditAccountCreate({
  request,
  requestId,
  actorId,
  result,
  entityId,
  targetUserId,
  errorCode,
  metadata,
}: {
  request:
    Request;

  requestId:
    string;

  actorId:
    string;

  result:
    "success" |
    "failure";

  entityId?:
    string;

  targetUserId?:
    string;

  errorCode?:
    string;

  metadata?:
    Record<
      string,
      unknown
    >;
}) {
  try {
    await recordAuditLog({
      request,

      requestId,

      actorId,

      actorRole:
        "admin",

      action:
        "account.create",

      result,

      entityType:
        "account",

      ...(entityId
        ? {
            entityId,
          }
        : {}),

      ...(targetUserId
        ? {
            targetUserId,
          }
        : {}),

      ...(errorCode
        ? {
            errorCode,
          }
        : {}),

      ...(metadata
        ? {
            metadata,
          }
        : {}),
    });
  } catch (error) {
    console.error(
      "Account create audit failed",
      {
        requestId,

        actorId,

        result,

        entityId,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );
  }
}

/*
 * ============================================
 * Rate Limit Headers
 * ============================================
 */

function withRateLimitHeaders<
  TResponse extends Response,
>(
  response:
    TResponse,

  rateLimit: {
    limit:
      number;

    remaining:
      number;

    resetAt:
      string;
  }
) {
  response.headers.set(
    "X-RateLimit-Limit",
    String(
      rateLimit.limit
    )
  );

  response.headers.set(
    "X-RateLimit-Remaining",
    String(
      rateLimit.remaining
    )
  );

  response.headers.set(
    "X-RateLimit-Reset",
    rateLimit.resetAt
  );

  return response;
}

/*
 * ============================================
 * Limited JSON Body
 * ============================================
 */

async function readJsonBodyWithLimit(
  request:
    Request,

  maximumBytes:
    number
): Promise<
  | {
      ok:
        true;

      body:
        unknown;
    }
  | {
      ok:
        false;

      status:
        number;

      code:
        string;

      message:
        string;
    }
> {
  if (
    !request.body
  ) {
    return {
      ok:
        false,

      status:
        400,

      code:
        "INVALID_JSON",

      message:
        "ساختار درخواست معتبر نیست.",
    };
  }

  const reader =
    request.body
      .getReader();

  const decoder =
    new TextDecoder(
      "utf-8",
      {
        fatal:
          true,
      }
    );

  let totalBytes =
    0;

  let text =
    "";

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
          ok:
            false,

          status:
            413,

          code:
            "REQUEST_BODY_TOO_LARGE",

          message:
            "حجم درخواست بیش از حد مجاز است.",
        };
      }

      text +=
        decoder.decode(
          value,
          {
            stream:
              true,
          }
        );
    }

    text +=
      decoder.decode();
  } catch {
    return {
      ok:
        false,

      status:
        400,

      code:
        "INVALID_JSON",

      message:
        "ساختار درخواست معتبر نیست.",
    };
  }

  if (
    !text.trim()
  ) {
    return {
      ok:
        false,

      status:
        400,

      code:
        "INVALID_JSON",

      message:
        "ساختار درخواست معتبر نیست.",
    };
  }

  try {
    return {
      ok:
        true,

      body:
        JSON.parse(
          text
        ),
    };
  } catch {
    return {
      ok:
        false,

      status:
        400,

      code:
        "INVALID_JSON",

      message:
        "ساختار درخواست معتبر نیست.",
    };
  }
}

/*
 * ============================================
 * Service Unavailable
 * ============================================
 */

function serviceUnavailable(
  requestId:
    string
) {
  return accountApiError(
    requestId,
    503,
    "ACCOUNT_SERVICE_UNAVAILABLE",
    "سرویس امن مدیریت حساب‌ها پیکربندی نشده است."
  );
}

/*
 * ============================================
 * Integer
 * ============================================
 */

function clampInteger(
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
  const number =
    Number(
      value
    );

  return Number.isInteger(
    number
  )
    ? Math.min(
        Math.max(
          number,
          minimum
        ),
        maximum
      )
    : fallback;
}

/*
 * ============================================
 * Search
 * ============================================
 */

function cleanSearch(
  value:
    string |
    null
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
      100
    );
}

/*
 * ============================================
 * ID
 * ============================================
 */

function cleanId(
  value:
    string |
    null
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

/*
 * ============================================
 * Audit Text
 * ============================================
 */

function normalizeAuditText(
  value:
    unknown,

  maximumLength:
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
      maximumLength
    );
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