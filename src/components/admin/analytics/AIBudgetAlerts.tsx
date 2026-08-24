"use client";

import Link from "next/link";

import {
  useEffect,
  useState,
} from "react";

/*
 * ============================================
 * Types
 * ============================================
 */

type BudgetMetric =
  | "daily_tokens"
  | "daily_cost"
  | "monthly_tokens"
  | "monthly_cost"
  | "none";

type AttentionItem = {
  userId:
    string;

  name:
    string;

  email:
    string;

  employeeCode:
    string;

  status:
    | "warning"
    | "blocked";

  source:
    | "default"
    | "account_override";

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
};

type BudgetAlertsResponse =
  | {
      success:
        true;

      summary: {
        totalEmployees:
          number;

        checkedEmployees:
          number;

        normal:
          number;

        warning:
          number;

        blocked:
          number;

        monthlyWarning:
          number;

        unpricedRequests:
          number;

        unavailable:
          number;
      };

      attention:
        AttentionItem[];
    }
  | {
      success:
        false;

      code?:
        string;

      message:
        string;
    };

/*
 * ============================================
 * Component
 * ============================================
 */

export default function AIBudgetAlerts() {
  const [
    data,
    setData,
  ] =
    useState<
      Extract<
        BudgetAlertsResponse,
        {
          success:
            true;
        }
      > |
      null
    >(
      null
    );

  const [
    loading,
    setLoading,
  ] =
    useState(
      true
    );

  const [
    error,
    setError,
  ] =
    useState(
      ""
    );

  const [
    refreshKey,
    setRefreshKey,
  ] =
    useState(
      0
    );

  /*
   * ==========================================
   * Load
   * ==========================================
   */

  useEffect(
    () => {
      let cancelled =
        false;

      setLoading(
        true
      );

      fetch(
        "/api/admin/analytics/ai-budget-alerts",
        {
          cache:
            "no-store",
        }
      )
        .then(
          async (
            response
          ) => ({
            response,

            body:
              (
                await response.json()
              ) as
                BudgetAlertsResponse,
          })
        )
        .then(
          ({
            response,
            body,
          }) => {
            if (
              !response.ok ||
              !body.success
            ) {
              throw new Error(
                "message" in
                body
                  ? body.message
                  : "دریافت وضعیت سهمیه‌ها ناموفق بود."
              );
            }

            if (
              cancelled
            ) {
              return;
            }

            setData(
              body
            );

            setError(
              ""
            );
          }
        )
        .catch(
          (
            reason:
              unknown
          ) => {
            if (
              cancelled
            ) {
              return;
            }

            setError(
              reason instanceof
                Error
                ? reason.message
                : "دریافت وضعیت سهمیه‌ها ناموفق بود."
            );
          }
        )
        .finally(
          () => {
            if (
              !cancelled
            ) {
              setLoading(
                false
              );
            }
          }
        );

      return () => {
        cancelled =
          true;
      };
    },
    [
      refreshKey,
    ]
  );

  /*
   * ==========================================
   * Loading
   * ==========================================
   */

  if (
    !data &&
    loading
  ) {
    return (
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">

        <div className="h-5 w-44 animate-pulse rounded bg-slate-100" />

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">

          {Array.from({
            length:
              4,
          }).map(
            (
              _,
              index
            ) => (
              <div
                key={
                  index
                }
                className="h-24 animate-pulse rounded-2xl bg-slate-100"
              />
            )
          )}

        </div>

      </section>
    );
  }

  /*
   * ==========================================
   * Error
   * ==========================================
   */

  if (!data) {
    return (
      <section className="rounded-3xl border border-rose-200 bg-rose-50 p-5">

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">

          <div>

            <p className="font-black text-rose-800">
              وضعیت سهمیه AI در دسترس نیست
            </p>

            <p className="mt-1 text-sm text-rose-700">
              {
                error
              }
            </p>

          </div>

          <button
            type="button"
            onClick={() =>
              setRefreshKey(
                (
                  value
                ) =>
                  value +
                  1
              )
            }
            className="w-fit rounded-xl bg-white px-4 py-2 text-sm font-bold text-rose-700 shadow-sm"
          >
            تلاش مجدد
          </button>

        </div>

      </section>
    );
  }

  const hasAttention =
    data.attention.length >
    0;

  /*
   * ==========================================
   * Render
   * ==========================================
   */

  return (
    <section
      className={`overflow-hidden rounded-3xl border shadow-sm ${
        data.summary.blocked >
          0
          ? "border-rose-200 bg-rose-50/30"
          : data.summary.warning >
              0
            ? "border-amber-200 bg-amber-50/30"
            : "border-slate-200 bg-white"
      }`}
    >

      {/* Header */}

      <div className="flex flex-col gap-4 border-b border-slate-100 bg-white px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">

        <div>

          <p className="text-xs font-bold text-emerald-700">
            کنترل هزینه و مصرف
          </p>

          <div className="mt-1 flex flex-wrap items-center gap-2">

            <h2 className="text-lg font-black text-slate-900">
              وضعیت سهمیه هوش مصنوعی
            </h2>

            {data.summary.blocked >
              0 && (
              <span className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-black text-rose-700">
                ⛔{" "}
                {
                  formatInteger(
                    data.summary
                      .blocked
                  )
                }
              </span>
            )}

            {data.summary.warning >
              0 && (
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-black text-amber-800">
                ⚠️{" "}
                {
                  formatInteger(
                    data.summary
                      .warning
                  )
                }
              </span>
            )}

          </div>

          <p className="mt-1 text-sm leading-6 text-slate-500">
            وضعیت فعلی سهمیه روزانه و ماهانه کارشناسان فعال؛ مستقل از بازه زمانی Dashboard.
          </p>

        </div>

        <div className="flex flex-wrap gap-2">

          <button
            type="button"
            disabled={
              loading
            }
            onClick={() =>
              setRefreshKey(
                (
                  value
                ) =>
                  value +
                  1
              )
            }
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
          >
            {loading
              ? "در حال بروزرسانی..."
              : "بروزرسانی"}
          </button>

          <Link
            href="/admin/accounts"
            className="rounded-xl bg-slate-950 px-4 py-2 text-xs font-black text-white"
          >
            مشاهده کارشناسان
          </Link>

        </div>

      </div>

      <div className="p-5 sm:p-6">

        {/* Summary */}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">

          <BudgetSummaryCard
            label="نزدیک سقف"
            value={
              data.summary
                .warning
            }
            detail="دارای هشدار مصرف"
            accent={
              data.summary
                .warning >
              0
                ? "warning"
                : "normal"
            }
          />

          <BudgetSummaryCard
            label="مسدودشده"
            value={
              data.summary
                .blocked
            }
            detail="Budget Guard فعال شده"
            accent={
              data.summary
                .blocked >
              0
                ? "danger"
                : "normal"
            }
          />

          <BudgetSummaryCard
            label="هشدار ماهانه"
            value={
              data.summary
                .monthlyWarning
            }
            detail="Token یا هزینه ماهانه"
            accent={
              data.summary
                .monthlyWarning >
              0
                ? "warning"
                : "normal"
            }
          />

          <BudgetSummaryCard
            label="درخواست بدون قیمت"
            value={
              data.summary
                .unpricedRequests
            }
            detail="در ماه جاری"
            accent={
              data.summary
                .unpricedRequests >
              0
                ? "warning"
                : "normal"
            }
          />

        </div>

        {/* Availability warning */}

        {data.summary
          .unavailable >
          0 && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">

            وضعیت{" "}
            <strong>
              {
                formatInteger(
                  data.summary
                    .unavailable
                )
              }
            </strong>{" "}
            کارشناس موقتاً قابل محاسبه نبود.

          </div>
        )}

        {/* Attention */}

        <div className="mt-6">

          <div className="flex items-center justify-between gap-3">

            <div>

              <h3 className="font-black text-slate-900">
                کارشناسان نیازمند توجه
              </h3>

              <p className="mt-1 text-xs text-slate-500">
                ابتدا کاربران مسدودشده و سپس بیشترین درصد مصرف نمایش داده می‌شوند.
              </p>

            </div>

            <span className="text-xs text-slate-400">
              {
                formatInteger(
                  data.summary
                    .checkedEmployees
                )
              }{" "}
              از{" "}
              {
                formatInteger(
                  data.summary
                    .totalEmployees
                )
              }{" "}
              بررسی شد
            </span>

          </div>

          {!hasAttention ? (
            <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50 px-5 py-8 text-center">

              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-lg text-emerald-700">
                ✓
              </div>

              <p className="mt-3 font-black text-emerald-800">
                وضعیت مصرف کارشناسان عادی است
              </p>

              <p className="mt-1 text-sm text-emerald-700">
                هیچ کارشناس فعالی در محدوده هشدار یا مسدودی قرار ندارد.
              </p>

            </div>
          ) : (
            <div className="mt-4 grid gap-3 xl:grid-cols-2">

              {data.attention.map(
                (
                  item
                ) => (
                  <AttentionCard
                    key={
                      item.userId
                    }
                    item={
                      item
                    }
                  />
                )
              )}

            </div>
          )}

        </div>

      </div>

    </section>
  );
}

/*
 * ============================================
 * Summary Card
 * ============================================
 */

function BudgetSummaryCard({
  label,
  value,
  detail,
  accent,
}: {
  label:
    string;

  value:
    number;

  detail:
    string;

  accent:
    | "normal"
    | "warning"
    | "danger";
}) {
  const className =
    accent ===
    "danger"
      ? "border-rose-200 bg-rose-50"
      : accent ===
          "warning"
        ? "border-amber-200 bg-amber-50"
        : "border-slate-200 bg-white";

  return (
    <div
      className={`rounded-2xl border p-4 ${className}`}
    >

      <p className="text-xs font-bold text-slate-500">
        {
          label
        }
      </p>

      <p className="mt-2 text-2xl font-black text-slate-950">
        {
          formatInteger(
            value
          )
        }
      </p>

      <p className="mt-1 text-xs text-slate-500">
        {
          detail
        }
      </p>

    </div>
  );
}

/*
 * ============================================
 * Attention Card
 * ============================================
 */

function AttentionCard({
  item,
}: {
  item:
    AttentionItem;
}) {
  const progress =
    Math.min(
      100,
      Math.max(
        0,
        item.peakPercent ||
          0
      )
    );

  return (
    <Link
      href={`/admin/accounts/${item.userId}`}
      className={`block rounded-2xl border bg-white p-4 transition hover:shadow-sm ${
        item.status ===
        "blocked"
          ? "border-rose-200"
          : "border-amber-200"
      }`}
    >

      <div className="flex items-start justify-between gap-4">

        <div className="min-w-0">

          <p className="truncate font-black text-slate-900">
            {
              item.name
            }
          </p>

          <p className="mt-1 truncate text-xs text-slate-500">
            {item.employeeCode
              ? `کد ${item.employeeCode} · `
              : ""}
            {
              item.email
            }
          </p>

        </div>

        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">

          <span
            className={`rounded-full px-2.5 py-1 text-[10px] font-black ${
              item.status ===
              "blocked"
                ? "bg-rose-50 text-rose-700"
                : "bg-amber-50 text-amber-700"
            }`}
          >
            {item.status ===
            "blocked"
              ? "سهمیه تمام شده"
              : "نزدیک سقف"}
          </span>

          <span
            className={`rounded-full px-2.5 py-1 text-[10px] font-black ${
              item.source ===
              "account_override"
                ? "bg-blue-50 text-blue-700"
                : "bg-slate-100 text-slate-500"
            }`}
          >
            {item.source ===
            "account_override"
              ? "اختصاصی"
              : "پیش‌فرض"}
          </span>

        </div>

      </div>

      <div className="mt-4">

        <div className="flex items-center justify-between gap-3 text-xs">

          <span className="font-bold text-slate-500">
            {
              budgetMetricLabel(
                item.dominantMetric
              )
            }
          </span>

          <span className="font-black text-slate-800">
            {item.peakPercent ===
            null
              ? "—"
              : formatPercent(
                  item.peakPercent
                )}
          </span>

        </div>

        {item.peakPercent !==
          null && (
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">

            <div
              className={`h-full rounded-full ${
                item.status ===
                "blocked"
                  ? "bg-rose-500"
                  : "bg-amber-500"
              }`}
              style={{
                width:
                  `${progress}%`,
              }}
            />

          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">

          <span>
            امروز:{" "}
            <strong className="text-slate-700">
              {
                formatNullablePercent(
                  item.dailyPeakPercent
                )
              }
            </strong>
          </span>

          <span>
            ماه جاری:{" "}
            <strong className="text-slate-700">
              {
                formatNullablePercent(
                  item.monthlyPeakPercent
                )
              }
            </strong>
          </span>

        </div>

        {item.status ===
          "blocked" &&
          item.code && (
          <p className="mt-3 text-xs font-bold text-rose-700">
            {
              budgetCodeLabel(
                item.code
              )
            }
          </p>
        )}

        {item.unpricedRequests >
          0 && (
          <p className="mt-2 text-[11px] font-bold text-amber-700">
            {
              formatInteger(
                item.unpricedRequests
              )
            }{" "}
            درخواست ماه جاری بدون Pricing
          </p>
        )}

      </div>

    </Link>
  );
}

/*
 * ============================================
 * Labels
 * ============================================
 */

function budgetMetricLabel(
  value:
    BudgetMetric
) {
  switch (
    value
  ) {
    case "daily_tokens":
      return "مصرف Token روزانه";

    case "daily_cost":
      return "هزینه روزانه";

    case "monthly_tokens":
      return "مصرف Token ماهانه";

    case "monthly_cost":
      return "هزینه ماهانه";

    default:
      return "مصرف AI";
  }
}

function budgetCodeLabel(
  code:
    string
) {
  switch (
    code
  ) {
    case "AI_DAILY_TOKEN_LIMIT_REACHED":
      return "سقف Token روزانه به پایان رسیده است.";

    case "AI_MONTHLY_TOKEN_LIMIT_REACHED":
      return "سقف Token ماهانه به پایان رسیده است.";

    case "AI_DAILY_COST_LIMIT_REACHED":
      return "سقف هزینه روزانه به پایان رسیده است.";

    case "AI_MONTHLY_COST_LIMIT_REACHED":
      return "سقف هزینه ماهانه به پایان رسیده است.";

    default:
      return "سهمیه هوش مصنوعی این حساب به پایان رسیده است.";
  }
}

/*
 * ============================================
 * Formatting
 * ============================================
 */

function formatInteger(
  value:
    number
) {
  return value.toLocaleString(
    "fa-IR"
  );
}

function formatPercent(
  value:
    number
) {
  return `${(
    Math.round(
      value *
        10
    ) /
    10
  ).toLocaleString(
    "fa-IR"
  )}٪`;
}

function formatNullablePercent(
  value:
    number |
    null
) {
  return value ===
    null
    ? "بدون سقف"
    : formatPercent(
        value
      );
}