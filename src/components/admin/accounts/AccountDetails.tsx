"use client";

import Link from "next/link";

import {
  useRouter,
} from "next/navigation";

import {
  useEffect,
  useState,
} from "react";

import {
  ActiveBadge,
  RoleBadge,
} from "@/components/admin/accounts/AccountBadges";

import type {
  AccountApiError,
  ManagedAccount,
} from "@/types/account";

/*
 * ============================================
 * Types
 * ============================================
 */

type Conversation = {
  id: string;
  title: string;
  status: string;
  created: string;
  updated: string;
  last_message_at: string;
  message_count: number;
};

type DetailsResponse = {
  success: true;

  account:
    ManagedAccount;

  conversations:
    Conversation[];

  currentAccountId:
    string;
};

type BudgetPeriodUsage = {
  tokens: number;
  costUsd: number;
  pricedRequests: number;
  unpricedRequests: number;
  requests: number;
};

type BudgetLimits = {
  dailyTokenLimit: number;
  monthlyTokenLimit: number;

  dailyCostLimitUsd: number;
  monthlyCostLimitUsd: number;

  warningPercent: number;

  source:
    | "default"
    | "account_override";
};

type BudgetWarning = {
  type:
    | "daily_tokens"
    | "monthly_tokens"
    | "daily_cost"
    | "monthly_cost";

  percent: number;
};

type BudgetStatus =
  | {
      allowed: true;

      warnings:
        BudgetWarning[];
    }
  | {
      allowed: false;

      code:
        string;

      retryAfterSeconds:
        number;
    };

type ConfiguredLimit = {
  id: string;

  enabled: boolean;

  dailyTokenLimit: number;
  monthlyTokenLimit: number;

  dailyCostLimitUsd: number;
  monthlyCostLimitUsd: number;

  warningPercent: number;

  created: string;
  updated: string;
};

type AiLimitResponse = {
  success: true;

  configured:
    ConfiguredLimit |
    null;

  effective:
    BudgetLimits;

  usage: {
    daily:
      BudgetPeriodUsage;

    monthly:
      BudgetPeriodUsage;
  };

  budgetStatus?:
    BudgetStatus;

  message?:
    string;
};

type AiLimitError = {
  success: false;

  code?:
    string;

  message:
    string;
};

type LimitForm = {
  enabled:
    boolean;

  dailyTokenLimit:
    string;

  monthlyTokenLimit:
    string;

  dailyCostLimitUsd:
    string;

  monthlyCostLimitUsd:
    string;

  warningPercent:
    string;
};

type RevokeSessionsResponse = {
  success:
    boolean;

  message?:
    string;

  revokedSessions?:
    number;

  totalSessions?:
    number;
};

/*
 * ============================================
 * Component
 * ============================================
 */

export default function AccountDetails({
  accountId,
}: {
  accountId: string;
}) {
  const router =
    useRouter();

  /*
   * Account
   */

  const [
    data,
    setData,
  ] =
    useState<DetailsResponse | null>(
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

  /*
   * AI Limit
   */

  const [
    aiLimit,
    setAiLimit,
  ] =
    useState<AiLimitResponse | null>(
      null
    );

  const [
    aiLimitLoading,
    setAiLimitLoading,
  ] =
    useState(
      true
    );

  const [
    aiLimitError,
    setAiLimitError,
  ] =
    useState(
      ""
    );

  const [
    aiLimitReloadKey,
    setAiLimitReloadKey,
  ] =
    useState(
      0
    );

  const [
    limitForm,
    setLimitForm,
  ] =
    useState<LimitForm>({
      enabled:
        true,

      dailyTokenLimit:
        "0",

      monthlyTokenLimit:
        "0",

      dailyCostLimitUsd:
        "0",

      monthlyCostLimitUsd:
        "0",

      warningPercent:
        "80",
    });

  const [
    savingLimit,
    setSavingLimit,
  ] =
    useState(
      false
    );

  const [
    resettingLimit,
    setResettingLimit,
  ] =
    useState(
      false
    );

  const [
    limitMessage,
    setLimitMessage,
  ] =
    useState(
      ""
    );

  const [
    limitFormError,
    setLimitFormError,
  ] =
    useState(
      ""
    );

  /*
   * Sessions
   */

  const [
    revokingSessions,
    setRevokingSessions,
  ] =
    useState(
      false
    );

  const [
    securityNotice,
    setSecurityNotice,
  ] =
    useState<{
      type:
        | "success"
        | "error";

      text:
        string;
    } | null>(
      null
    );

  /*
   * ==========================================
   * Load Account
   * ==========================================
   */

  useEffect(
    () => {
      let cancelled =
        false;

      setLoading(
        true
      );

      setError(
        ""
      );

      fetch(
        `/api/admin/accounts/${accountId}`,
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
                | DetailsResponse
                | AccountApiError,
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
                "message" in body
                  ? body.message
                  : "دریافت اطلاعات حساب ناموفق بود."
              );
            }

            if (!cancelled) {
              setData(
                body
              );
            }
          }
        )
        .catch(
          (
            reason: unknown
          ) => {
            if (!cancelled) {
              setError(
                reason instanceof
                  Error
                  ? reason.message
                  : "دریافت اطلاعات حساب ناموفق بود."
              );
            }
          }
        )
        .finally(
          () => {
            if (!cancelled) {
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
      accountId,
    ]
  );

  /*
   * ==========================================
   * Load AI Limit
   * ==========================================
   */

  useEffect(
    () => {
      let cancelled =
        false;

      setAiLimitLoading(
        true
      );

      setAiLimitError(
        ""
      );

      loadAiLimit(
        accountId
      )
        .then(
          (
            result
          ) => {
            if (cancelled) {
              return;
            }

            setAiLimit(
              result
            );

            setLimitForm(
              createLimitForm(
                result
              )
            );
          }
        )
        .catch(
          (
            reason: unknown
          ) => {
            if (!cancelled) {
              setAiLimitError(
                reason instanceof
                  Error
                  ? reason.message
                  : "دریافت سهمیه هوش مصنوعی ناموفق بود."
              );
            }
          }
        )
        .finally(
          () => {
            if (!cancelled) {
              setAiLimitLoading(
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
      accountId,
      aiLimitReloadKey,
    ]
  );

  /*
   * ==========================================
   * Save Limit
   * ==========================================
   */

  async function saveAiLimit() {
    if (
      savingLimit ||
      resettingLimit
    ) {
      return;
    }

    setLimitMessage(
      ""
    );

    setLimitFormError(
      ""
    );

    const parsed =
      validateLimitForm(
        limitForm
      );

    if (
      !parsed.success
    ) {
      setLimitFormError(
        parsed.message
      );

      return;
    }

    setSavingLimit(
      true
    );

    try {
      const response =
        await fetch(
          `/api/admin/accounts/${accountId}/ai-limit`,
          {
            method:
              "PATCH",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                enabled:
                  limitForm.enabled,

                dailyTokenLimit:
                  parsed.dailyTokenLimit,

                monthlyTokenLimit:
                  parsed.monthlyTokenLimit,

                dailyCostLimitUsd:
                  parsed.dailyCostLimitUsd,

                monthlyCostLimitUsd:
                  parsed.monthlyCostLimitUsd,

                warningPercent:
                  parsed.warningPercent,
              }),
          }
        );

      const body =
        (
          await response.json()
        ) as
          | AiLimitResponse
          | AiLimitError;

      if (
        !response.ok ||
        !body.success
      ) {
        throw new Error(
          "message" in body
            ? body.message
            : "ذخیره سهمیه ناموفق بود."
        );
      }

      setAiLimit(
        body
      );

      setLimitForm(
        createLimitForm(
          body
        )
      );

      setLimitMessage(
        body.message ||
          "سهمیه هوش مصنوعی ذخیره شد."
      );
    } catch (reason) {
      setLimitFormError(
        reason instanceof
          Error
          ? reason.message
          : "ذخیره سهمیه هوش مصنوعی ناموفق بود."
      );
    } finally {
      setSavingLimit(
        false
      );
    }
  }

  /*
   * ==========================================
   * Reset Limit
   * ==========================================
   */

  async function resetAiLimit() {
    if (
      savingLimit ||
      resettingLimit
    ) {
      return;
    }

    const confirmed =
      window.confirm(
        "سهمیه اختصاصی این کارشناس حذف شود و تنظیمات پیش‌فرض سیستم اعمال شود؟"
      );

    if (!confirmed) {
      return;
    }

    setLimitMessage(
      ""
    );

    setLimitFormError(
      ""
    );

    setResettingLimit(
      true
    );

    try {
      const response =
        await fetch(
          `/api/admin/accounts/${accountId}/ai-limit`,
          {
            method:
              "DELETE",
          }
        );

      const body =
        (
          await response.json()
        ) as
          | AiLimitResponse
          | AiLimitError;

      if (
        !response.ok ||
        !body.success
      ) {
        throw new Error(
          "message" in body
            ? body.message
            : "بازنشانی سهمیه ناموفق بود."
        );
      }

      const refreshed =
        await loadAiLimit(
          accountId
        );

      setAiLimit(
        refreshed
      );

      setLimitForm(
        createLimitForm(
          refreshed
        )
      );

      setLimitMessage(
        body.message ||
          "سهمیه اختصاصی حذف شد."
      );
    } catch (reason) {
      setLimitFormError(
        reason instanceof
          Error
          ? reason.message
          : "بازنشانی سهمیه هوش مصنوعی ناموفق بود."
      );
    } finally {
      setResettingLimit(
        false
      );
    }
  }

  /*
   * ==========================================
   * Revoke All Sessions
   * ==========================================
   */

  async function revokeAllSessions() {
    if (
      revokingSessions
    ) {
      return;
    }

    const isCurrentAccount =
      accountId ===
      data?.currentAccountId;

    const confirmed =
      window.confirm(
        isCurrentAccount
          ? "با این عملیات از همه دستگاه‌ها، از جمله همین دستگاه، خارج می‌شوید. ادامه می‌دهید؟"
          : "همه نشست‌های فعال این کاربر بسته شوند؟ کاربر برای ادامه باید دوباره وارد حساب شود."
      );

    if (!confirmed) {
      return;
    }

    setSecurityNotice(
      null
    );

    setRevokingSessions(
      true
    );

    try {
      const response =
        await fetch(
          `/api/admin/accounts/${accountId}/sessions/revoke`,
          {
            method:
              "POST",

            cache:
              "no-store",
          }
        );

      const body =
        (
          await response.json()
        ) as RevokeSessionsResponse;

      if (
        !response.ok ||
        !body.success
      ) {
        throw new Error(
          body.message ||
            "خروج از همه دستگاه‌ها ناموفق بود."
        );
      }

      /*
       * اگر Admin نشست‌های خودش را بست،
       * همین Session نیز از این لحظه Revoked است.
       */
      if (
        isCurrentAccount
      ) {
        router.replace(
          "/login"
        );

        router.refresh();

        return;
      }

      setSecurityNotice({
        type:
          "success",

        text:
          body.message ||
          "همه نشست‌های کاربر بسته شدند.",
      });
    } catch (reason) {
      setSecurityNotice({
        type:
          "error",

        text:
          reason instanceof
            Error
            ? reason.message
            : "خروج از همه دستگاه‌ها ناموفق بود.",
      });
    } finally {
      setRevokingSessions(
        false
      );
    }
  }

  /*
   * ==========================================
   * Loading / Error
   * ==========================================
   */

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-40 animate-pulse rounded-3xl bg-slate-100" />

        <div className="h-72 animate-pulse rounded-3xl bg-slate-100" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-rose-800">

        <h1 className="font-black">
          نمایش حساب ممکن نیست
        </h1>

        <p className="mt-2 text-sm">
          {error}
        </p>

        <Link
          href="/admin/accounts"
          className="mt-4 inline-block text-sm font-bold underline"
        >
          بازگشت به فهرست
        </Link>

      </div>
    );
  }

  const {
    account,
    conversations,
  } = data;

  const isCurrentAccount =
    account.id ===
    data.currentAccountId;

  return (
    <div className="space-y-5">

      {/* Header */}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">

        <div>

          <Link
            href="/admin/accounts"
            className="text-sm font-bold text-emerald-700"
          >
            → بازگشت به کارشناسان
          </Link>

          <div className="mt-3 flex flex-wrap items-center gap-2">

            <h1 className="text-2xl font-black sm:text-3xl">
              {account.name ||
                "بدون نام"}
            </h1>

            {isCurrentAccount && (
              <span className="rounded-full bg-violet-50 px-2 py-1 text-xs font-bold text-violet-700">
                حساب شما
              </span>
            )}

          </div>

          <div className="mt-3 flex gap-2">

            <RoleBadge
              role={
                account.role
              }
            />

            <ActiveBadge
              active={
                account.active
              }
            />

          </div>

        </div>

        <div className="flex flex-wrap gap-2">

          <Link
            href={`/admin/accounts/${account.id}/topics`}
            className="self-start rounded-xl border border-blue-200 px-4 py-2.5 text-sm font-bold text-blue-700"
          >
            تحلیل موضوعی
          </Link>

          <Link
            href={`/admin/accounts/${account.id}/usage`}
            className="self-start rounded-xl border border-emerald-200 px-4 py-2.5 text-sm font-bold text-emerald-700"
          >
            گزارش مصرف
          </Link>

          <Link
            href={`/admin/accounts/${account.id}/edit`}
            className="self-start rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white"
          >
            ویرایش حساب
          </Link>

        </div>

      </div>

      {/* Stats */}

      <div className="grid gap-4 sm:grid-cols-3">

        <Stat
          label="تعداد گفتگو"
          value={
            account.activity
              .conversationCount
              .toLocaleString(
                "fa-IR"
              )
          }
        />

        <Stat
          label="تعداد سؤال"
          value={
            account.activity
              .questionCount
              .toLocaleString(
                "fa-IR"
              )
          }
        />

        <Stat
          label="آخرین فعالیت"
          value={
            account.activity
              .lastActivity
              ? formatDate(
                  account
                    .activity
                    .lastActivity
                )
              : "بدون فعالیت"
          }
          small
        />

      </div>

      {/* AI Limit */}

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">

        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">

          <div>

            <h2 className="text-lg font-black">
              سهمیه هوش مصنوعی
            </h2>

            <p className="mt-1 text-sm leading-7 text-slate-500">
              مشاهده مصرف Token و هزینه و تعیین سقف اختصاصی برای این کارشناس.
            </p>

          </div>

          {aiLimit && (
            <div className="flex flex-wrap gap-2">

              <span
                className={`rounded-full px-3 py-1.5 text-xs font-black ${
                  aiLimit.effective.source ===
                  "account_override"
                    ? "bg-blue-50 text-blue-700"
                    : "bg-slate-100 text-slate-600"
                }`}
              >
                {aiLimit.effective.source ===
                "account_override"
                  ? "سهمیه اختصاصی"
                  : "سهمیه پیش‌فرض"}
              </span>

              {aiLimit.budgetStatus &&
                (
                  aiLimit.budgetStatus.allowed
                    ? (
                      <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-black text-emerald-700">
                        دسترسی فعال
                      </span>
                    )
                    : (
                      <span className="rounded-full bg-rose-50 px-3 py-1.5 text-xs font-black text-rose-700">
                        سهمیه تمام شده
                      </span>
                    )
                )}

            </div>
          )}

        </div>

        {aiLimitLoading ? (
          <div className="mt-6 space-y-4">

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">

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
                    className="h-32 animate-pulse rounded-2xl bg-slate-100"
                  />
                )
              )}

            </div>

            <div className="h-56 animate-pulse rounded-2xl bg-slate-100" />

          </div>
        ) : aiLimitError ? (
          <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 p-5">

            <p className="font-black text-rose-800">
              دریافت سهمیه انجام نشد
            </p>

            <p className="mt-2 text-sm text-rose-700">
              {aiLimitError}
            </p>

            <button
              type="button"
              onClick={() =>
                setAiLimitReloadKey(
                  (
                    value
                  ) =>
                    value +
                    1
                )
              }
              className="mt-4 rounded-xl bg-white px-4 py-2 text-sm font-bold text-rose-700 shadow-sm"
            >
              تلاش مجدد
            </button>

          </div>
        ) : aiLimit ? (
          <>
            <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">

              <UsageMeter
                label="Token امروز"
                used={
                  aiLimit.usage.daily.tokens
                }
                limit={
                  aiLimit.effective.dailyTokenLimit
                }
                formatValue={
                  formatTokens
                }
              />

              <UsageMeter
                label="Token این ماه"
                used={
                  aiLimit.usage.monthly.tokens
                }
                limit={
                  aiLimit.effective.monthlyTokenLimit
                }
                formatValue={
                  formatTokens
                }
              />

              <UsageMeter
                label="هزینه امروز"
                used={
                  aiLimit.usage.daily.costUsd
                }
                limit={
                  aiLimit.effective.dailyCostLimitUsd
                }
                formatValue={
                  formatUsd
                }
                ltr
              />

              <UsageMeter
                label="هزینه این ماه"
                used={
                  aiLimit.usage.monthly.costUsd
                }
                limit={
                  aiLimit.effective.monthlyCostLimitUsd
                }
                formatValue={
                  formatUsd
                }
                ltr
              />

            </div>

            {aiLimit.budgetStatus &&
              !aiLimit.budgetStatus.allowed && (
                <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4">

                  <p className="font-black text-rose-800">
                    مصرف این کارشناس در حال حاضر محدود شده است.
                  </p>

                  <p className="mt-2 text-sm text-rose-700">
                    {
                      budgetCodeLabel(
                        aiLimit
                          .budgetStatus
                          .code
                      )
                    }
                  </p>

                  <p
                    dir="ltr"
                    className="mt-2 text-left font-mono text-xs text-rose-600"
                  >
                    {
                      aiLimit
                        .budgetStatus
                        .code
                    }
                  </p>

                </div>
              )}

            {aiLimit.budgetStatus?.allowed &&
              aiLimit.budgetStatus.warnings.length >
                0 && (
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">

                  <p className="font-black text-amber-800">
                    مصرف به محدوده هشدار رسیده است.
                  </p>

                  <div className="mt-2 space-y-1 text-sm text-amber-700">

                    {aiLimit.budgetStatus.warnings.map(
                      (
                        warning
                      ) => (
                        <p
                          key={
                            warning.type
                          }
                        >
                          {
                            warningTypeLabel(
                              warning.type
                            )
                          }
                          :
                          {" "}
                          {
                            formatPercent(
                              warning.percent
                            )
                          }
                        </p>
                      )
                    )}

                  </div>

                </div>
              )}

            <div className="mt-4 grid gap-3 sm:grid-cols-2">

              <MiniInfo
                label="درخواست‌های امروز"
                value={`${aiLimit.usage.daily.requests.toLocaleString(
                  "fa-IR"
                )} درخواست`}
              />

              <MiniInfo
                label="وضعیت محاسبه هزینه"
                value={
                  aiLimit.usage.monthly.unpricedRequests >
                  0
                    ? `${aiLimit.usage.monthly.unpricedRequests.toLocaleString(
                        "fa-IR"
                      )} درخواست بدون قیمت`
                    : "هزینه همه درخواست‌های ماه قابل محاسبه است"
                }
              />

            </div>

            <div className="mt-7 border-t border-slate-100 pt-6">

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">

                <div>

                  <h3 className="font-black text-slate-900">
                    تنظیم سهمیه اختصاصی
                  </h3>

                  <p className="mt-1 text-xs leading-6 text-slate-500">
                    مقدار صفر یعنی استفاده از مقدار پیش‌فرض سیستم.
                  </p>

                </div>

                {aiLimit.configured && (
                  <button
                    type="button"
                    disabled={
                      savingLimit ||
                      resettingLimit
                    }
                    onClick={
                      resetAiLimit
                    }
                    className="w-fit rounded-xl border border-rose-200 px-4 py-2 text-xs font-black text-rose-700 transition hover:bg-rose-50 disabled:opacity-50"
                  >
                    {resettingLimit
                      ? "در حال بازنشانی..."
                      : "بازگشت کامل به پیش‌فرض"}
                  </button>
                )}

              </div>

              <label className="mt-5 flex cursor-pointer items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">

                <input
                  type="checkbox"
                  checked={
                    limitForm.enabled
                  }
                  onChange={(
                    event
                  ) =>
                    setLimitForm(
                      (
                        current
                      ) => ({
                        ...current,

                        enabled:
                          event.target.checked,
                      })
                    )
                  }
                  className="size-4"
                />

                <div>

                  <p className="text-sm font-black text-slate-800">
                    استفاده از سهمیه اختصاصی
                  </p>

                  <p className="mt-1 text-xs text-slate-500">
                    در صورت غیرفعال بودن، مقادیر پیش‌فرض سیستم اعمال می‌شوند.
                  </p>

                </div>

              </label>

              <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">

                <LimitField
                  label="سقف Token روزانه"
                  value={
                    limitForm.dailyTokenLimit
                  }
                  disabled={
                    !limitForm.enabled
                  }
                  step="1"
                  onChange={(
                    value
                  ) =>
                    setLimitForm(
                      (
                        current
                      ) => ({
                        ...current,

                        dailyTokenLimit:
                          value,
                      })
                    )
                  }
                />

                <LimitField
                  label="سقف Token ماهانه"
                  value={
                    limitForm.monthlyTokenLimit
                  }
                  disabled={
                    !limitForm.enabled
                  }
                  step="1"
                  onChange={(
                    value
                  ) =>
                    setLimitForm(
                      (
                        current
                      ) => ({
                        ...current,

                        monthlyTokenLimit:
                          value,
                      })
                    )
                  }
                />

                <LimitField
                  label="هزینه روزانه (USD)"
                  value={
                    limitForm.dailyCostLimitUsd
                  }
                  disabled={
                    !limitForm.enabled
                  }
                  step="0.01"
                  onChange={(
                    value
                  ) =>
                    setLimitForm(
                      (
                        current
                      ) => ({
                        ...current,

                        dailyCostLimitUsd:
                          value,
                      })
                    )
                  }
                />

                <LimitField
                  label="هزینه ماهانه (USD)"
                  value={
                    limitForm.monthlyCostLimitUsd
                  }
                  disabled={
                    !limitForm.enabled
                  }
                  step="0.01"
                  onChange={(
                    value
                  ) =>
                    setLimitForm(
                      (
                        current
                      ) => ({
                        ...current,

                        monthlyCostLimitUsd:
                          value,
                      })
                    )
                  }
                />

                <LimitField
                  label="درصد هشدار"
                  value={
                    limitForm.warningPercent
                  }
                  disabled={
                    !limitForm.enabled
                  }
                  min="1"
                  max="100"
                  step="1"
                  suffix="%"
                  onChange={(
                    value
                  ) =>
                    setLimitForm(
                      (
                        current
                      ) => ({
                        ...current,

                        warningPercent:
                          value,
                      })
                    )
                  }
                />

              </div>

              {limitFormError && (
                <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
                  {limitFormError}
                </div>
              )}

              {limitMessage && (
                <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">
                  {limitMessage}
                </div>
              )}

              <div className="mt-5 flex flex-wrap items-center gap-3">

                <button
                  type="button"
                  disabled={
                    savingLimit ||
                    resettingLimit
                  }
                  onClick={
                    saveAiLimit
                  }
                  className="rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-black text-white transition hover:bg-black disabled:opacity-50"
                >
                  {savingLimit
                    ? "در حال ذخیره..."
                    : "ذخیره سهمیه"}
                </button>

                {aiLimit.configured && (
                  <p className="text-xs text-slate-400">
                    آخرین بروزرسانی:
                    {" "}
                    {
                      formatDate(
                        aiLimit.configured.updated
                      )
                    }
                  </p>
                )}

              </div>

            </div>

          </>
        ) : null}

      </section>

      {/* Session Security */}

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">

        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">

          <div className="max-w-2xl">

            <p className="text-xs font-bold text-rose-600">
              امنیت حساب
            </p>

            <h2 className="mt-1 text-lg font-black text-slate-900">
              امنیت نشست‌ها
            </h2>

            <p className="mt-2 text-sm leading-7 text-slate-500">
              با خروج از همه دستگاه‌ها، تمام نشست‌های فعال این حساب در سرور باطل می‌شوند. رمز عبور و وضعیت حساب تغییر نمی‌کند و کاربر می‌تواند دوباره وارد شود.
            </p>

            {!account.active && (
              <p className="mt-2 text-xs font-bold text-amber-700">
                این حساب در حال حاضر غیرفعال است.
              </p>
            )}

            {isCurrentAccount && (
              <p className="mt-2 text-xs font-bold text-violet-700">
                این حساب متعلق به شماست؛ اجرای این عملیات همین نشست فعلی شما را نیز می‌بندد.
              </p>
            )}

          </div>

          <button
            type="button"
            disabled={
              revokingSessions
            }
            onClick={
              revokeAllSessions
            }
            className="w-fit shrink-0 rounded-xl border border-rose-200 bg-white px-5 py-3 text-sm font-black text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {revokingSessions
              ? "در حال بستن نشست‌ها..."
              : "خروج از همه دستگاه‌ها"}
          </button>

        </div>

        {securityNotice && (
          <div
            className={`mt-5 rounded-xl border px-4 py-3 text-sm font-bold ${
              securityNotice.type ===
              "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-rose-200 bg-rose-50 text-rose-700"
            }`}
          >
            {securityNotice.text}
          </div>
        )}

      </section>

      {/* Account Information */}

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">

        <h2 className="text-lg font-black">
          مشخصات کاربر
        </h2>

        <dl className="mt-5 grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">

          <Info
            label="ایمیل"
            value={
              account.email
            }
            ltr
          />

          <Info
            label="کد کارشناس"
            value={
              account.employee_code ||
              "—"
            }
          />

          <Info
            label="دپارتمان"
            value={
              account.department_name ||
              "بدون دپارتمان"
            }
          />

          <Info
            label="سمت شغلی"
            value={
              account.job_title ||
              "—"
            }
          />

          <Info
            label="تاریخ ایجاد"
            value={
              formatDate(
                account.created
              )
            }
          />

          <Info
            label="آخرین بروزرسانی"
            value={
              formatDate(
                account.updated
              )
            }
          />

        </dl>

      </section>

      {/* Conversations */}

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">

        <div className="border-b border-slate-100 px-5 py-4 sm:px-7">

          <h2 className="text-lg font-black">
            آخرین گفتگوها
          </h2>

          <p className="mt-1 text-sm text-slate-500">
            ۱۰ گفتگوی اخیر این کارشناس
          </p>

        </div>

        {conversations.length ===
        0 ? (
          <div className="px-6 py-14 text-center text-sm text-slate-500">
            هنوز گفتگویی ثبت نشده است.
          </div>
        ) : (
          <div className="overflow-x-auto">

            <table className="w-full min-w-[700px] text-right text-sm">

              <thead className="bg-slate-50 text-xs text-slate-500">

                <tr>
                  <th className="px-5 py-3">
                    عنوان
                  </th>

                  <th className="px-5 py-3">
                    وضعیت
                  </th>

                  <th className="px-5 py-3">
                    تعداد پیام
                  </th>

                  <th className="px-5 py-3">
                    آخرین فعالیت
                  </th>
                </tr>

              </thead>

              <tbody className="divide-y divide-slate-100">

                {conversations.map(
                  (
                    conversation
                  ) => (
                    <tr
                      key={
                        conversation.id
                      }
                    >

                      <td className="px-5 py-4 font-bold text-slate-800">
                        {
                          conversation.title
                        }
                      </td>

                      <td className="px-5 py-4 text-slate-600">
                        {conversation.status ===
                        "active"
                          ? "فعال"
                          : conversation.status ||
                            "—"}
                      </td>

                      <td className="px-5 py-4 text-slate-600">
                        {
                          conversation
                            .message_count
                            .toLocaleString(
                              "fa-IR"
                            )
                        }
                      </td>

                      <td className="px-5 py-4 text-xs text-slate-500">
                        {
                          formatDate(
                            conversation.last_message_at ||
                              conversation.updated ||
                              conversation.created
                          )
                        }
                      </td>

                    </tr>
                  )
                )}

              </tbody>

            </table>

          </div>
        )}

      </section>

    </div>
  );
}

/*
 * ============================================
 * AI Limit API
 * ============================================
 */

async function loadAiLimit(
  accountId: string
): Promise<AiLimitResponse> {
  const response =
    await fetch(
      `/api/admin/accounts/${accountId}/ai-limit`,
      {
        cache:
          "no-store",
      }
    );

  const body =
    (
      await response.json()
    ) as
      | AiLimitResponse
      | AiLimitError;

  if (
    !response.ok ||
    !body.success
  ) {
    throw new Error(
      "message" in body
        ? body.message
        : "دریافت سهمیه هوش مصنوعی ناموفق بود."
    );
  }

  return body;
}

/*
 * ============================================
 * Limit Form
 * ============================================
 */

function createLimitForm(
  data: AiLimitResponse
): LimitForm {
  const configured =
    data.configured;

  return {
    enabled:
      configured
        ? configured.enabled
        : true,

    dailyTokenLimit:
      String(
        configured?.dailyTokenLimit ??
          0
      ),

    monthlyTokenLimit:
      String(
        configured?.monthlyTokenLimit ??
          0
      ),

    dailyCostLimitUsd:
      String(
        configured?.dailyCostLimitUsd ??
          0
      ),

    monthlyCostLimitUsd:
      String(
        configured?.monthlyCostLimitUsd ??
          0
      ),

    warningPercent:
      String(
        configured?.warningPercent ??
          data.effective.warningPercent ??
          80
      ),
  };
}

function validateLimitForm(
  form: LimitForm
):
  | {
      success: true;

      dailyTokenLimit:
        number;

      monthlyTokenLimit:
        number;

      dailyCostLimitUsd:
        number;

      monthlyCostLimitUsd:
        number;

      warningPercent:
        number;
    }
  | {
      success: false;

      message:
        string;
    } {
  const dailyTokenLimit =
    Number(
      form.dailyTokenLimit
    );

  const monthlyTokenLimit =
    Number(
      form.monthlyTokenLimit
    );

  const dailyCostLimitUsd =
    Number(
      form.dailyCostLimitUsd
    );

  const monthlyCostLimitUsd =
    Number(
      form.monthlyCostLimitUsd
    );

  const warningPercent =
    Number(
      form.warningPercent
    );

  if (
    !Number.isFinite(
      dailyTokenLimit
    ) ||
    !Number.isFinite(
      monthlyTokenLimit
    ) ||
    dailyTokenLimit < 0 ||
    monthlyTokenLimit < 0
  ) {
    return {
      success:
        false,

      message:
        "سقف Token باید عدد صفر یا بزرگ‌تر باشد.",
    };
  }

  if (
    !Number.isFinite(
      dailyCostLimitUsd
    ) ||
    !Number.isFinite(
      monthlyCostLimitUsd
    ) ||
    dailyCostLimitUsd < 0 ||
    monthlyCostLimitUsd < 0
  ) {
    return {
      success:
        false,

      message:
        "سقف هزینه باید عدد صفر یا بزرگ‌تر باشد.",
    };
  }

  if (
    !Number.isFinite(
      warningPercent
    ) ||
    warningPercent < 1 ||
    warningPercent > 100
  ) {
    return {
      success:
        false,

      message:
        "درصد هشدار باید بین ۱ تا ۱۰۰ باشد.",
    };
  }

  return {
    success:
      true,

    dailyTokenLimit,

    monthlyTokenLimit,

    dailyCostLimitUsd,

    monthlyCostLimitUsd,

    warningPercent,
  };
}

/*
 * ============================================
 * Usage Meter
 * ============================================
 */

function UsageMeter({
  label,
  used,
  limit,
  formatValue,
  ltr,
}: {
  label: string;

  used: number;

  limit: number;

  formatValue: (
    value: number
  ) => string;

  ltr?: boolean;
}) {
  const percent =
    limit > 0
      ? Math.min(
          100,
          Math.max(
            0,
            (
              used /
              limit
            ) *
              100
          )
        )
      : 0;

  return (
    <div className="rounded-2xl border border-slate-200 p-4">

      <p className="text-xs font-bold text-slate-500">
        {label}
      </p>

      <div
        dir={
          ltr
            ? "ltr"
            : undefined
        }
        className={`mt-2 flex items-end gap-1 ${
          ltr
            ? "justify-end text-left"
            : ""
        }`}
      >

        <span className="text-xl font-black text-slate-900">
          {
            formatValue(
              used
            )
          }
        </span>

        <span className="pb-0.5 text-xs text-slate-400">
          /
          {" "}
          {limit > 0
            ? formatValue(
                limit
              )
            : "بدون سقف"}
        </span>

      </div>

      {limit > 0 && (
        <>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">

            <div
              className="h-full rounded-full bg-emerald-600 transition-all"
              style={{
                width:
                  `${percent}%`,
              }}
            />

          </div>

          <p className="mt-2 text-xs text-slate-400">
            {
              formatPercent(
                (
                  used /
                  limit
                ) *
                  100
              )
            } مصرف شده
          </p>
        </>
      )}

    </div>
  );
}

/*
 * ============================================
 * Limit Field
 * ============================================
 */

function LimitField({
  label,
  value,
  onChange,
  disabled,
  step,
  min = "0",
  max,
  suffix,
}: {
  label: string;

  value: string;

  onChange: (
    value: string
  ) => void;

  disabled?: boolean;

  step: string;

  min?: string;

  max?: string;

  suffix?: string;
}) {
  return (
    <label className="block">

      <span className="mb-2 block text-xs font-black text-slate-600">
        {label}
      </span>

      <div className="relative">

        <input
          type="number"
          value={
            value
          }
          min={
            min
          }
          max={
            max
          }
          step={
            step
          }
          disabled={
            disabled
          }
          onChange={(
            event
          ) =>
            onChange(
              event.target.value
            )
          }
          dir="ltr"
          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-left text-sm text-slate-800 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-100 disabled:text-slate-400"
        />

        {suffix && (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-bold text-slate-400">
            {suffix}
          </span>
        )}

      </div>

    </label>
  );
}

/*
 * ============================================
 * UI
 * ============================================
 */

function Stat({
  label,
  value,
  small,
}: {
  label: string;

  value: string;

  small?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">

      <p className="text-sm text-slate-500">
        {label}
      </p>

      <p
        className={`mt-2 font-black text-slate-900 ${
          small
            ? "text-base"
            : "text-2xl"
        }`}
      >
        {value}
      </p>

    </div>
  );
}

function Info({
  label,
  value,
  ltr,
}: {
  label: string;

  value: string;

  ltr?: boolean;
}) {
  return (
    <div>

      <dt className="text-xs font-bold text-slate-400">
        {label}
      </dt>

      <dd
        dir={
          ltr
            ? "ltr"
            : undefined
        }
        className={`mt-1 text-sm font-bold text-slate-700 ${
          ltr
            ? "text-right"
            : ""
        }`}
      >
        {value}
      </dd>

    </div>
  );
}

function MiniInfo({
  label,
  value,
}: {
  label: string;

  value: string;
}) {
  return (
    <div className="rounded-xl bg-slate-50 px-4 py-3">

      <p className="text-xs font-bold text-slate-400">
        {label}
      </p>

      <p className="mt-1 text-sm font-bold text-slate-700">
        {value}
      </p>

    </div>
  );
}

/*
 * ============================================
 * Labels
 * ============================================
 */

function budgetCodeLabel(
  code: string
) {
  switch (code) {
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

function warningTypeLabel(
  value:
    BudgetWarning["type"]
) {
  switch (value) {
    case "daily_tokens":
      return "Token روزانه";

    case "monthly_tokens":
      return "Token ماهانه";

    case "daily_cost":
      return "هزینه روزانه";

    case "monthly_cost":
      return "هزینه ماهانه";
  }
}

/*
 * ============================================
 * Formatting
 * ============================================
 */

function formatTokens(
  value: number
) {
  return Math.round(
    value
  ).toLocaleString(
    "fa-IR"
  );
}

function formatUsd(
  value: number
) {
  return new Intl.NumberFormat(
    "en-US",
    {
      style:
        "currency",

      currency:
        "USD",

      minimumFractionDigits:
        2,

      maximumFractionDigits:
        4,
    }
  ).format(
    value
  );
}

function formatPercent(
  value: number
) {
  const safe =
    Number.isFinite(
      value
    )
      ? value
      : 0;

  return `${(
    Math.round(
      safe *
        10
    ) /
    10
  ).toLocaleString(
    "fa-IR"
  )}٪`;
}

function formatDate(
  value: string
) {
  if (!value) {
    return "—";
  }

  const date =
    new Date(
      value
    );

  return Number.isNaN(
    date.getTime()
  )
    ? "—"
    : new Intl.DateTimeFormat(
        "fa-IR",
        {
          dateStyle:
            "medium",

          timeStyle:
            "short",
        }
      ).format(
        date
      );
}