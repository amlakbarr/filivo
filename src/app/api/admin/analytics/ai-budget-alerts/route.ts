import {
  NextResponse,
} from "next/server";

import {
  checkAIBudgetGuard,
} from "@/lib/ai/budget-guard";

import {
  getAdminSession,
} from "@/lib/pocketbase/admin";

import {
  getPocketBaseServiceClient,
} from "@/lib/pocketbase/service";

/*
 * ============================================
 * Types
 * ============================================
 */

type BudgetStatus =
  | "normal"
  | "warning"
  | "blocked";

type BudgetMetric =
  | "daily_tokens"
  | "daily_cost"
  | "monthly_tokens"
  | "monthly_cost"
  | "none";

type AccountBudgetResult =
  | {
      available:
        true;

      userId:
        string;

      name:
        string;

      email:
        string;

      employeeCode:
        string;

      status:
        BudgetStatus;

      source:
        "default" |
        "account_override";

      code:
        string |
        null;

      warningPercent:
        number;

      dailyPeakPercent:
        number |
        null;

      monthlyPeakPercent:
        number |
        null;

      peakPercent:
        number |
        null;

      dominantMetric:
        BudgetMetric;

      unpricedRequests:
        number;
    }
  | {
      available:
        false;

      userId:
        string;

      name:
        string;

      email:
        string;

      employeeCode:
        string;
    };

/*
 * ============================================
 * GET
 * ============================================
 */

export async function GET() {
  const requestId =
    crypto.randomUUID();

  /*
   * ==========================================
   * Admin Auth
   * ==========================================
   */

  const admin =
    await getAdminSession();

  if (!admin.ok) {
    return apiResponse(
      {
        success:
          false,

        code:
          admin.code,

        message:
          admin.message,
      },
      admin.status,
      requestId
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
      "AI budget alerts service unavailable",
      {
        requestId,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return apiResponse(
      {
        success:
          false,

        code:
          "AI_BUDGET_ALERTS_UNAVAILABLE",

        message:
          "سرویس بررسی سهمیه هوش مصنوعی در دسترس نیست.",
      },
      503,
      requestId
    );
  }

  /*
   * ==========================================
   * Active Employees
   *
   * فقط کارشناسان فعال.
   * Adminها وارد آمار سهمیه کارشناسان نمی‌شوند.
   * ==========================================
   */

  let accounts;

  try {
    accounts =
      await pb
        .collection(
          "accounts"
        )
        .getFullList({
          filter:
            pb.filter(
              "active = {:active} && role = {:role}",
              {
                active:
                  true,

                role:
                  "employee",
              }
            ),

          fields:
            "id,name,email,employee_code",

          sort:
            "name",

          batch:
            200,
        });
  } catch (error) {
    console.error(
      "AI budget alerts accounts failed",
      {
        requestId,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return apiResponse(
      {
        success:
          false,

        code:
          "AI_BUDGET_ACCOUNTS_FAILED",

        message:
          "دریافت کارشناسان برای بررسی سهمیه ناموفق بود.",
      },
      503,
      requestId
    );
  }

  /*
   * ==========================================
   * Budget Checks
   *
   * در Batchهای کوچک اجرا می‌کنیم تا برای
   * تعداد زیاد کاربر فشار ناگهانی ایجاد نشود.
   * ==========================================
   */

  const results =
    await mapInBatches(
      accounts,
      10,
      async (
        account
      ): Promise<AccountBudgetResult> => {
        const userId =
          String(
            account.id ||
              ""
          );

        const name =
          String(
            account.name ||
              account.email ||
              "کارشناس بدون نام"
          );

        const email =
          String(
            account.email ||
              ""
          );

        const employeeCode =
          String(
            account.employee_code ||
              ""
          );

        try {
          const budget =
            await checkAIBudgetGuard({
              userId,
            });

          const dailyTokens =
            calculatePercent(
              budget.usage
                .daily
                .tokens,

              budget.limits
                .dailyTokenLimit
            );

          const dailyCost =
            calculatePercent(
              budget.usage
                .daily
                .costUsd,

              budget.limits
                .dailyCostLimitUsd
            );

          const monthlyTokens =
            calculatePercent(
              budget.usage
                .monthly
                .tokens,

              budget.limits
                .monthlyTokenLimit
            );

          const monthlyCost =
            calculatePercent(
              budget.usage
                .monthly
                .costUsd,

              budget.limits
                .monthlyCostLimitUsd
            );

          const dailyPeak =
            maxNullable(
              dailyTokens,
              dailyCost
            );

          const monthlyPeak =
            maxNullable(
              monthlyTokens,
              monthlyCost
            );

          const peak =
            maxNullable(
              dailyPeak,
              monthlyPeak
            );

          const dominantMetric =
            getDominantMetric({
              dailyTokens,
              dailyCost,
              monthlyTokens,
              monthlyCost,
            });

          const status:
            BudgetStatus =
            !budget.allowed
              ? "blocked"
              : budget
                    .warnings
                    .length >
                  0
                ? "warning"
                : "normal";

          return {
            available:
              true,

            userId,

            name,

            email,

            employeeCode,

            status,

            source:
              budget.limits
                .source,

            code:
              budget.allowed
                ? null
                : budget.code,

            warningPercent:
              budget.limits
                .warningPercent,

            dailyPeakPercent:
              dailyPeak,

            monthlyPeakPercent:
              monthlyPeak,

            peakPercent:
              peak,

            dominantMetric,

            unpricedRequests:
              budget.usage
                .monthly
                .unpricedRequests,
          };
        } catch (error) {
          console.error(
            "AI budget employee check failed",
            {
              requestId,

              userId,

              error:
                safeErrorMetadata(
                  error
                ),
            }
          );

          return {
            available:
              false,

            userId,

            name,

            email,

            employeeCode,
          };
        }
      }
    );

  /*
   * ==========================================
   * Available Results
   * ==========================================
   */

  const available =
    results.filter(
      (
        item
      ): item is Extract<
        AccountBudgetResult,
        {
          available:
            true;
        }
      > =>
        item.available
    );

  /*
   * ==========================================
   * Summary
   * ==========================================
   */

  const warning =
    available.filter(
      (
        item
      ) =>
        item.status ===
        "warning"
    );

  const blocked =
    available.filter(
      (
        item
      ) =>
        item.status ===
        "blocked"
    );

  const normal =
    available.filter(
      (
        item
      ) =>
        item.status ===
        "normal"
    );

  /*
   * کاربرانی که مصرف ماهانه‌شان به
   * warningPercent خودشان رسیده است.
   */
  const monthlyWarning =
    available.filter(
      (
        item
      ) =>
        item.monthlyPeakPercent !==
          null &&
        item.monthlyPeakPercent >=
          item.warningPercent
    );

  const unpricedRequests =
    available.reduce(
      (
        total,
        item
      ) =>
        total +
        item.unpricedRequests,
      0
    );

  /*
   * ==========================================
   * Attention List
   *
   * Blocked اول، سپس بیشترین مصرف.
   * ==========================================
   */

  const attention =
    available
      .filter(
        (
          item
        ) =>
          item.status ===
            "blocked" ||
          item.status ===
            "warning"
      )
      .sort(
        (
          left,
          right
        ) => {
          if (
            left.status !==
            right.status
          ) {
            return left.status ===
              "blocked"
              ? -1
              : 1;
          }

          return (
            (
              right.peakPercent ||
              0
            ) -
            (
              left.peakPercent ||
              0
            )
          );
        }
      )
      .slice(
        0,
        10
      )
      .map(
        (
          item
        ) => ({
          userId:
            item.userId,

          name:
            item.name,

          email:
            item.email,

          employeeCode:
            item.employeeCode,

          status:
            item.status,

          source:
            item.source,

          code:
            item.code,

          warningPercent:
            item.warningPercent,

          dailyPeakPercent:
            item.dailyPeakPercent,

          monthlyPeakPercent:
            item.monthlyPeakPercent,

          peakPercent:
            item.peakPercent,

          dominantMetric:
            item.dominantMetric,

          unpricedRequests:
            item.unpricedRequests,
        })
      );

  /*
   * ==========================================
   * Response
   * ==========================================
   */

  return apiResponse(
    {
      success:
        true,

      summary: {
        totalEmployees:
          accounts.length,

        checkedEmployees:
          available.length,

        normal:
          normal.length,

        warning:
          warning.length,

        blocked:
          blocked.length,

        monthlyWarning:
          monthlyWarning.length,

        unpricedRequests,

        unavailable:
          results.length -
          available.length,
      },

      attention,
    },
    200,
    requestId
  );
}

/*
 * ============================================
 * Batch
 * ============================================
 */

async function mapInBatches<
  T,
  R
>(
  items:
    T[],

  batchSize:
    number,

  worker: (
    item: T
  ) => Promise<R>
) {
  const output:
    R[] = [];

  for (
    let index =
      0;
    index <
    items.length;
    index +=
      batchSize
  ) {
    const batch =
      items.slice(
        index,
        index +
          batchSize
      );

    const result =
      await Promise.all(
        batch.map(
          worker
        )
      );

    output.push(
      ...result
    );
  }

  return output;
}

/*
 * ============================================
 * Dominant Metric
 * ============================================
 */

function getDominantMetric({
  dailyTokens,
  dailyCost,
  monthlyTokens,
  monthlyCost,
}: {
  dailyTokens:
    number |
    null;

  dailyCost:
    number |
    null;

  monthlyTokens:
    number |
    null;

  monthlyCost:
    number |
    null;
}): BudgetMetric {
  const candidates: Array<{
    metric:
      Exclude<
        BudgetMetric,
        "none"
      >;

    value:
      number |
      null;
  }> = [
    {
      metric:
        "daily_tokens",

      value:
        dailyTokens,
    },

    {
      metric:
        "daily_cost",

      value:
        dailyCost,
    },

    {
      metric:
        "monthly_tokens",

      value:
        monthlyTokens,
    },

    {
      metric:
        "monthly_cost",

      value:
        monthlyCost,
    },
  ];

  const available =
    candidates.filter(
      (
        item
      ): item is {
        metric:
          Exclude<
            BudgetMetric,
            "none"
          >;

        value:
          number;
      } =>
        typeof item.value ===
          "number" &&
        Number.isFinite(
          item.value
        )
    );

  if (
    available.length ===
    0
  ) {
    return "none";
  }

  available.sort(
    (
      left,
      right
    ) =>
      right.value -
      left.value
  );

  return available[0]
    .metric;
}

/*
 * ============================================
 * Percent
 * ============================================
 */

function calculatePercent(
  used:
    number,

  limit:
    number
) {
  if (
    !Number.isFinite(
      limit
    ) ||
    limit <=
      0
  ) {
    return null;
  }

  return roundPercent(
    (
      Math.max(
        0,
        used
      ) /
      limit
    ) *
      100
  );
}

function maxNullable(
  first:
    number |
    null,

  second:
    number |
    null
) {
  const values =
    [
      first,
      second,
    ].filter(
      (
        value
      ): value is number =>
        typeof value ===
          "number" &&
        Number.isFinite(
          value
        )
    );

  if (
    values.length ===
    0
  ) {
    return null;
  }

  return Math.max(
    ...values
  );
}

function roundPercent(
  value:
    number
) {
  return (
    Math.round(
      value *
        10
    ) /
    10
  );
}

/*
 * ============================================
 * Response
 * ============================================
 */

function apiResponse(
  body:
    Record<
      string,
      unknown
    >,

  status:
    number,

  requestId:
    string
) {
  return NextResponse.json(
    {
      ...body,

      requestId,
    },
    {
      status,

      headers: {
        "X-Request-Id":
          requestId,

        "Cache-Control":
          "no-store",
      },
    }
  );
}

/*
 * ============================================
 * Safe Error
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