import {
  getDashboardAnalytics,
} from "@/lib/analytics/dashboard";

import {
  AnalyticsRangeError,
  resolveAnalyticsRange,
} from "@/lib/analytics/range";

import {
  analyticsError,
  analyticsResponse,
} from "@/lib/analytics/response";

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

const MAX_EMPLOYEE_PAGE =
  10_000;

const EMPLOYEE_PER_PAGE =
  10;

const MAX_EMPLOYEE_SEARCH_LENGTH =
  100;

/*
 * باید با Sortهای پشتیبانی‌شده در
 * src/lib/analytics/dashboard.ts هماهنگ باشد.
 */
const EMPLOYEE_SORTS =
  new Set([
    "questions",
    "tokens",
    "cost",
    "activity",
    "conversations",
  ]);

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
    return analyticsError(
      requestId,
      admin.status,
      admin.code,
      admin.message
    );
  }

  /*
   * ==========================================
   * Query Params
   * ==========================================
   */

  let searchParams:
    URLSearchParams;

  try {
    searchParams =
      new URL(
        request.url
      ).searchParams;
  } catch {
    return analyticsError(
      requestId,
      400,
      "INVALID_QUERY",
      "پارامترهای درخواست معتبر نیستند."
    );
  }

  /*
   * ==========================================
   * Analytics Range
   * ==========================================
   */

  let range:
    ReturnType<
      typeof resolveAnalyticsRange
    >;

  try {
    range =
      resolveAnalyticsRange(
        searchParams
      );
  } catch (error) {
    if (
      error instanceof
      AnalyticsRangeError
    ) {
      return analyticsError(
        requestId,
        400,
        "INVALID_DATE_RANGE",
        error.message
      );
    }

    console.error(
      "Analytics range resolution failed",
      {
        requestId,

        adminId:
          admin.account.id,

        error:
          metadata(
            error
          ),
      }
    );

    return analyticsError(
      requestId,
      400,
      "INVALID_DATE_RANGE",
      "بازه زمانی انتخاب‌شده معتبر نیست."
    );
  }

  /*
   * ==========================================
   * Employee Pagination
   * ==========================================
   */

  const employeePage =
    safeInteger(
      searchParams.get(
        "employeePage"
      ),
      1,
      MAX_EMPLOYEE_PAGE,
      1
    );

  /*
   * ==========================================
   * Employee Search
   * ==========================================
   */

  const employeeSearch =
    cleanSearch(
      searchParams.get(
        "employeeSearch"
      )
    );

  /*
   * ==========================================
   * Employee Sort
   *
   * مقدار خام Client مستقیماً به Analytics
   * Library منتقل نمی‌شود.
   * ==========================================
   */

  const employeeSort =
    cleanEmployeeSort(
      searchParams.get(
        "employeeSort"
      )
    );

  /*
   * ==========================================
   * Service Client + Analytics
   * ==========================================
   */

  try {
    const pb =
      await getPocketBaseServiceClient();

    const dashboard =
      await getDashboardAnalytics(
        pb,
        range,
        {
          employeePage,

          /*
           * Client اجازه تغییر تعداد رکورد
           * هر صفحه را ندارد.
           */
          employeePerPage:
            EMPLOYEE_PER_PAGE,

          employeeSearch,

          employeeSort,
        }
      );

    /*
     * ========================================
     * Success
     * ========================================
     */

    return analyticsResponse(
      {
        success:
          true,

        dashboard,
      },
      200,
      requestId
    );
  } catch (error) {
    console.error(
      "Admin dashboard analytics failed",
      {
        requestId,

        adminId:
          admin.account.id,

        error:
          metadata(
            error
          ),
      }
    );

    return analyticsError(
      requestId,
      503,
      "ANALYTICS_UNAVAILABLE",
      "اطلاعات داشبورد در دسترس نیست."
    );
  }
}

/*
 * ============================================
 * Integer
 * ============================================
 */

function safeInteger(
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
  if (
    !value
  ) {
    return fallback;
  }

  /*
   * فقط Integer ساده پذیرفته می‌شود.
   *
   * مواردی مثل:
   * 1e5
   * 1.5
   * Infinity
   * رد می‌شوند.
   */
  if (
    !/^\d+$/.test(
      value
    )
  ) {
    return fallback;
  }

  const number =
    Number(
      value
    );

  if (
    !Number.isSafeInteger(
      number
    )
  ) {
    return fallback;
  }

  return Math.min(
    Math.max(
      number,
      minimum
    ),
    maximum
  );
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
    /*
     * Control Characters
     */
    .replace(
      /[\u0000-\u001f\u007f]/g,
      " "
    )

    /*
     * Whitespace normalization
     */
    .replace(
      /\s+/g,
      " "
    )

    .trim()

    /*
     * Query abuse / excessive in-memory search
     */
    .slice(
      0,
      MAX_EMPLOYEE_SEARCH_LENGTH
    );
}

/*
 * ============================================
 * Employee Sort
 * ============================================
 */

function cleanEmployeeSort(
  value:
    string |
    null
) {
  const normalized =
    String(
      value ||
        ""
    )
      .trim()
      .toLowerCase();

  return EMPLOYEE_SORTS.has(
    normalized
  )
    ? normalized
    : "questions";
}

/*
 * ============================================
 * Safe Error Metadata
 * ============================================
 */

function metadata(
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
      message:
        String(
          error
        ),
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