"use client";

import Link from "next/link";

import {
  useRouter,
  useSearchParams,
} from "next/navigation";

import {
  useCallback,
  useEffect,
  useState,
} from "react";

import type {
  FormEvent,
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

type Department = {
  id: string;
  name: string;
  active: boolean;
};

type ListResponse = {
  success: true;

  items:
    ManagedAccount[];

  page:
    number;

  totalPages:
    number;

  totalItems:
    number;

  currentAccountId:
    string;

  activityUnavailable:
    boolean;
};

type LookupsResponse = {
  success: true;

  departments:
    Department[];
};

type BudgetWarning = {
  type:
    | "daily_tokens"
    | "monthly_tokens"
    | "daily_cost"
    | "monthly_cost";

  percent:
    number;
};

type BudgetSummaryItem =
  | {
      userId:
        string;

      available:
        true;

      status:
        | "normal"
        | "warning"
        | "blocked";

      source:
        | "default"
        | "account_override";

      warningPercent:
        number;

      code:
        string |
        null;

      warnings:
        BudgetWarning[];

      usage: {
        daily: {
          tokens:
            number;

          costUsd:
            number;

          requests:
            number;

          unpricedRequests:
            number;
        };

        monthly: {
          tokens:
            number;

          costUsd:
            number;

          requests:
            number;

          unpricedRequests:
            number;
        };
      };

      limits: {
        dailyTokenLimit:
          number;

        monthlyTokenLimit:
          number;

        dailyCostLimitUsd:
          number;

        monthlyCostLimitUsd:
          number;
      };

      percentages: {
        dailyTokens:
          number |
          null;

        monthlyTokens:
          number |
          null;

        dailyCost:
          number |
          null;

        monthlyCost:
          number |
          null;
      };
    }
  | {
      userId:
        string;

      available:
        false;
    };

type BudgetSummaryResponse = {
  success: true;

  items:
    BudgetSummaryItem[];
};

type BudgetSummaryError = {
  success: false;

  message:
    string;
};

/*
 * ============================================
 * Component
 * ============================================
 */

export default function AccountsList() {
  const searchParams =
    useSearchParams();

  const router =
    useRouter();

  const queryString =
    searchParams.toString();

  /*
   * Search
   */

  const [
    searchInput,
    setSearchInput,
  ] =
    useState(
      searchParams.get(
        "search"
      ) ||
        ""
    );

  /*
   * Accounts
   */

  const [
    items,
    setItems,
  ] =
    useState<
      ManagedAccount[]
    >(
      []
    );

  const [
    departments,
    setDepartments,
  ] =
    useState<
      Department[]
    >(
      []
    );

  const [
    currentAccountId,
    setCurrentAccountId,
  ] =
    useState(
      ""
    );

  const [
    meta,
    setMeta,
  ] =
    useState({
      page:
        Number(
          searchParams.get(
            "page"
          )
        ) ||
        1,

      totalPages:
        1,

      totalItems:
        0,
    });

  const [
    loading,
    setLoading,
  ] =
    useState(
      true
    );

  /*
   * Actions
   */

  const [
    actionId,
    setActionId,
  ] =
    useState(
      ""
    );

  const [
    notice,
    setNotice,
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
   * AI Budget
   */

  const [
    budgets,
    setBudgets,
  ] =
    useState<
      Record<
        string,
        BudgetSummaryItem
      >
    >(
      {}
    );

  const [
    budgetLoading,
    setBudgetLoading,
  ] =
    useState(
      false
    );

  const [
    budgetNotice,
    setBudgetNotice,
  ] =
    useState(
      ""
    );

  /*
   * ==========================================
   * Load Accounts
   * ==========================================
   */

  const loadAccounts =
    useCallback(
      async () => {
        setLoading(
          true
        );

        try {
          const response =
            await fetch(
              `/api/admin/accounts?${queryString}`,
              {
                cache:
                  "no-store",
              }
            );

          const data =
            (
              await response.json()
            ) as
              | ListResponse
              | AccountApiError;

          if (
            !response.ok ||
            !data.success
          ) {
            throw new Error(
              "message" in
              data
                ? data.message
                : "دریافت کارشناسان ناموفق بود."
            );
          }

          setItems(
            data.items
          );

          setCurrentAccountId(
            data.currentAccountId
          );

          setMeta({
            page:
              data.page,

            totalPages:
              Math.max(
                data.totalPages,
                1
              ),

            totalItems:
              data.totalItems,
          });

          if (
            data.activityUnavailable
          ) {
            setNotice({
              type:
                "error",

              text:
                "فهرست دریافت شد، اما شاخص‌های فعالیت موقتاً در دسترس نیست.",
            });
          }
        } catch (
          error
        ) {
          setNotice({
            type:
              "error",

            text:
              error instanceof
                Error
                ? error.message
                : "دریافت کارشناسان ناموفق بود.",
          });
        } finally {
          setLoading(
            false
          );
        }
      },
      [
        queryString,
      ]
    );

  /*
   * Initial / Query Reload
   */

  useEffect(
    () => {
      void loadAccounts();
    },
    [
      loadAccounts,
    ]
  );

  /*
   * ==========================================
   * Load Departments
   * ==========================================
   */

  useEffect(
    () => {
      fetch(
        "/api/admin/accounts/lookups",
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

            data:
              (
                await response.json()
              ) as
                | LookupsResponse
                | AccountApiError,
          })
        )
        .then(
          ({
            response,
            data,
          }) => {
            if (
              response.ok &&
              data.success
            ) {
              setDepartments(
                data.departments
              );
            }
          }
        )
        .catch(
          () =>
            undefined
        );
    },
    []
  );

  /*
   * ==========================================
   * Budget Key
   * ==========================================
   */

  const budgetKey =
    items
      .map(
        (
          account
        ) =>
          account.id
      )
      .join(
        ","
      );

  /*
   * ==========================================
   * Load Budget Summaries
   * ==========================================
   */

  useEffect(
    () => {
      const userIds =
        budgetKey
          ? budgetKey.split(
              ","
            )
          : [];

      if (
        userIds.length ===
        0
      ) {
        setBudgets(
          {}
        );

        setBudgetLoading(
          false
        );

        setBudgetNotice(
          ""
        );

        return;
      }

      let cancelled =
        false;

      setBudgetLoading(
        true
      );

      setBudgetNotice(
        ""
      );

      fetch(
        "/api/admin/accounts/ai-budget-summary",
        {
          method:
            "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body:
            JSON.stringify({
              userIds,
            }),

          cache:
            "no-store",
        }
      )
        .then(
          async (
            response
          ) => ({
            response,

            data:
              (
                await response.json()
              ) as
                | BudgetSummaryResponse
                | BudgetSummaryError,
          })
        )
        .then(
          ({
            response,
            data,
          }) => {
            if (
              !response.ok ||
              !data.success
            ) {
              throw new Error(
                "message" in
                data
                  ? data.message
                  : "دریافت وضعیت سهمیه‌ها ناموفق بود."
              );
            }

            if (
              cancelled
            ) {
              return;
            }

            const next:
              Record<
                string,
                BudgetSummaryItem
              > = {};

            for (
              const item of
              data.items
            ) {
              next[
                item.userId
              ] =
                item;
            }

            setBudgets(
              next
            );

            const unavailableCount =
              data.items.filter(
                (
                  item
                ) =>
                  !item.available
              ).length;

            if (
              unavailableCount >
              0
            ) {
              setBudgetNotice(
                `وضعیت سهمیه ${unavailableCount.toLocaleString(
                  "fa-IR"
                )} کارشناس موقتاً قابل محاسبه نیست.`
              );
            }
          }
        )
        .catch(
          (
            error: unknown
          ) => {
            if (
              cancelled
            ) {
              return;
            }

            setBudgets(
              {}
            );

            setBudgetNotice(
              error instanceof
                Error
                ? error.message
                : "دریافت وضعیت سهمیه‌ها ناموفق بود."
            );
          }
        )
        .finally(
          () => {
            if (
              !cancelled
            ) {
              setBudgetLoading(
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
      budgetKey,
    ]
  );

  /*
   * ==========================================
   * Query Params
   * ==========================================
   */

  function updateParams(
    changes:
      Record<
        string,
        string
      >
  ) {
    setLoading(
      true
    );

    const params =
      new URLSearchParams(
        searchParams.toString()
      );

    for (
      const [
        key,
        value,
      ] of Object.entries(
        changes
      )
    ) {
      if (value) {
        params.set(
          key,
          value
        );
      } else {
        params.delete(
          key
        );
      }
    }

    if (
      !(
        "page" in
        changes
      )
    ) {
      params.delete(
        "page"
      );
    }

    router.replace(
      `/admin/accounts${
        params.size
          ? `?${params}`
          : ""
      }`,
      {
        scroll:
          false,
      }
    );
  }

  /*
   * ==========================================
   * Search
   * ==========================================
   */

  function submitSearch(
    event:
      FormEvent
  ) {
    event.preventDefault();

    updateParams({
      search:
        searchInput.trim(),
    });
  }

  /*
   * ==========================================
   * Active Toggle
   * ==========================================
   */

  async function toggleActive(
    account:
      ManagedAccount
  ) {
    if (
      account.id ===
      currentAccountId
    ) {
      return;
    }

    const nextActive =
      !account.active;

    if (
      !nextActive &&
      !window.confirm(
        `حساب «${
          account.name ||
          account.email
        }» غیرفعال شود؟ کاربر از درخواست بعدی دسترسی نخواهد داشت.`
      )
    ) {
      return;
    }

    setActionId(
      account.id
    );

    setNotice(
      null
    );

    try {
      const response =
        await fetch(
          `/api/admin/accounts/${account.id}/status`,
          {
            method:
              "PATCH",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                active:
                  nextActive,
              }),
          }
        );

      const data =
        (
          await response.json()
        ) as {
          success:
            boolean;

          message?:
            string;
        };

      if (
        !response.ok ||
        !data.success
      ) {
        throw new Error(
          data.message ||
            "تغییر وضعیت حساب ناموفق بود."
        );
      }

      setNotice({
        type:
          "success",

        text:
          data.message ||
          "وضعیت حساب تغییر کرد.",
      });

      await loadAccounts();
    } catch (
      error
    ) {
      setNotice({
        type:
          "error",

        text:
          error instanceof
            Error
            ? error.message
            : "تغییر وضعیت حساب ناموفق بود.",
      });

      await loadAccounts();
    } finally {
      setActionId(
        ""
      );
    }
  }

  /*
   * ==========================================
   * Render
   * ==========================================
   */

  return (
    <div className="space-y-5">

      {/* Header */}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">

        <div>

          <p className="text-sm font-bold text-emerald-700">
            مدیریت دسترسی
          </p>

          <h1 className="mt-1 text-2xl font-black sm:text-3xl">
            کارشناسان
          </h1>

          <p className="mt-2 text-sm text-slate-500">
            {
              meta.totalItems.toLocaleString(
                "fa-IR"
              )
            }{" "}
            حساب کاربری
          </p>

        </div>

        <Link
          href="/admin/accounts/new"
          className="self-start rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-emerald-700"
        >
          + کاربر جدید
        </Link>

      </div>

      {/* Notice */}

      {notice && (
        <div
          role="status"
          className={`rounded-2xl border px-4 py-3 text-sm font-bold ${
            notice.type ===
            "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-rose-200 bg-rose-50 text-rose-800"
          }`}
        >
          {
            notice.text
          }
        </div>
      )}

      {budgetNotice && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
          {
            budgetNotice
          }
        </div>
      )}

      {/* Filters */}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">

        <form
          onSubmit={
            submitSearch
          }
          className="grid gap-3 md:grid-cols-2 xl:grid-cols-5"
        >

          <div className="flex xl:col-span-2">

            <input
              value={
                searchInput
              }
              onChange={(
                event
              ) =>
                setSearchInput(
                  event.target.value
                )
              }
              placeholder="نام، ایمیل یا کد کارشناس..."
              className="min-w-0 flex-1 rounded-r-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
            />

            <button className="rounded-l-xl bg-slate-800 px-4 text-sm font-bold text-white">
              جستجو
            </button>

          </div>

          <SelectFilter
            label="همه دپارتمان‌ها"
            value={
              searchParams.get(
                "department"
              ) ||
              ""
            }
            onChange={(
              value
            ) =>
              updateParams({
                department:
                  value,
              })
            }
            options={
              departments.map(
                (
                  department
                ) => [
                  department.id,
                  department.name,
                ]
              )
            }
          />

          <SelectFilter
            label="همه Roleها"
            value={
              searchParams.get(
                "role"
              ) ||
              ""
            }
            onChange={(
              value
            ) =>
              updateParams({
                role:
                  value,
              })
            }
            options={[
              [
                "employee",
                "کارشناس",
              ],
              [
                "admin",
                "مدیر",
              ],
            ]}
          />

          <SelectFilter
            label="همه وضعیت‌ها"
            value={
              searchParams.get(
                "active"
              ) ||
              ""
            }
            onChange={(
              value
            ) =>
              updateParams({
                active:
                  value,
              })
            }
            options={[
              [
                "true",
                "فعال",
              ],
              [
                "false",
                "غیرفعال",
              ],
            ]}
          />

          <div className="xl:col-start-5">

            <SelectFilter
              label="جدیدترین"
              value={
                searchParams.get(
                  "sort"
                ) ||
                ""
              }
              onChange={(
                value
              ) =>
                updateParams({
                  sort:
                    value,
                })
              }
              options={[
                [
                  "oldest",
                  "قدیمی‌ترین",
                ],
                [
                  "updated",
                  "آخرین بروزرسانی",
                ],
                [
                  "name",
                  "نام",
                ],
                [
                  "employee_code",
                  "کد کارشناس",
                ],
                [
                  "email",
                  "ایمیل",
                ],
              ]}
            />

          </div>

        </form>

      </section>

      {/* Table */}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">

        {loading ? (
          <Loading />
        ) : items.length ===
          0 ? (
          <div className="px-6 py-20 text-center">

            <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-slate-100 text-2xl">
              ♙
            </div>

            <h2 className="mt-4 font-black">
              کاربری پیدا نشد
            </h2>

            <p className="mt-2 text-sm text-slate-500">
              فیلترها را تغییر دهید یا کاربر جدید بسازید.
            </p>

          </div>
        ) : (
          <div className="overflow-x-auto">

            <table className="w-full min-w-[1580px] text-right text-sm">

              <thead className="bg-slate-50 text-xs text-slate-500">

                <tr>

                  {[
                    "نام",
                    "کد کارشناس",
                    "ایمیل",
                    "دپارتمان",
                    "سمت شغلی",
                    "Role",
                    "وضعیت",
                    "فعالیت",
                    "سهمیه AI",
                    "آخرین بروزرسانی",
                    "عملیات",
                  ].map(
                    (
                      heading
                    ) => (
                      <th
                        key={
                          heading
                        }
                        className="px-4 py-3 font-bold"
                      >
                        {
                          heading
                        }
                      </th>
                    )
                  )}

                </tr>

              </thead>

              <tbody className="divide-y divide-slate-100">

                {items.map(
                  (
                    account
                  ) => (
                    <tr
                      key={
                        account.id
                      }
                      className="hover:bg-slate-50/70"
                    >

                      {/* Name */}

                      <td className="px-4 py-4">

                        <Link
                          href={`/admin/accounts/${account.id}`}
                          className="font-black text-slate-900 hover:text-emerald-700"
                        >
                          {account.name ||
                            "بدون نام"}
                        </Link>

                        {account.id ===
                          currentAccountId && (
                          <span className="mr-2 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-700">
                            حساب شما
                          </span>
                        )}

                      </td>

                      {/* Code */}

                      <td className="px-4 py-4 font-mono text-xs text-slate-600">
                        {account.employee_code ||
                          "—"}
                      </td>

                      {/* Email */}

                      <td
                        dir="ltr"
                        className="px-4 py-4 text-left text-slate-600"
                      >
                        {
                          account.email
                        }
                      </td>

                      {/* Department */}

                      <td className="px-4 py-4 text-slate-600">
                        {account.department_name ||
                          "بدون دپارتمان"}
                      </td>

                      {/* Job */}

                      <td className="px-4 py-4 text-slate-600">
                        {account.job_title ||
                          "—"}
                      </td>

                      {/* Role */}

                      <td className="px-4 py-4">

                        <RoleBadge
                          role={
                            account.role
                          }
                        />

                      </td>

                      {/* Active */}

                      <td className="px-4 py-4">

                        <ActiveBadge
                          active={
                            account.active
                          }
                        />

                      </td>

                      {/* Activity */}

                      <td className="px-4 py-4">

                        <div className="whitespace-nowrap text-xs text-slate-600">

                          <p>
                            {
                              account.activity
                                .conversationCount
                                .toLocaleString(
                                  "fa-IR"
                                )
                            }{" "}
                            گفتگو
                            {" · "}
                            {
                              account.activity
                                .questionCount
                                .toLocaleString(
                                  "fa-IR"
                                )
                            }{" "}
                            سؤال
                          </p>

                          <p className="mt-1 text-slate-400">
                            {account.activity
                              .lastActivity
                              ? formatDate(
                                  account
                                    .activity
                                    .lastActivity
                                )
                              : "بدون فعالیت"}
                          </p>

                        </div>

                      </td>

                      {/* AI Budget */}

                      <td className="px-4 py-4">

                        <BudgetCell
                          loading={
                            budgetLoading
                          }
                          budget={
                            budgets[
                              account.id
                            ]
                          }
                        />

                      </td>

                      {/* Updated */}

                      <td className="whitespace-nowrap px-4 py-4 text-xs text-slate-500">
                        {
                          formatDate(
                            account.updated
                          )
                        }
                      </td>

                      {/* Actions */}

                      <td className="px-4 py-4">

                        <div className="flex gap-2">

                          <Link
                            href={`/admin/accounts/${account.id}`}
                            className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-700"
                          >
                            جزئیات
                          </Link>

                          <Link
                            href={`/admin/accounts/${account.id}/edit`}
                            className="rounded-lg border border-blue-200 px-2.5 py-1.5 text-xs font-bold text-blue-700"
                          >
                            ویرایش
                          </Link>

                          <button
                            type="button"
                            disabled={
                              Boolean(
                                actionId
                              ) ||
                              account.id ===
                                currentAccountId
                            }
                            onClick={() =>
                              toggleActive(
                                account
                              )
                            }
                            title={
                              account.id ===
                              currentAccountId
                                ? "تغییر وضعیت حساب فعلی مجاز نیست"
                                : undefined
                            }
                            className={`rounded-lg border px-2.5 py-1.5 text-xs font-bold disabled:opacity-40 ${
                              account.active
                                ? "border-rose-200 text-rose-700"
                                : "border-emerald-200 text-emerald-700"
                            }`}
                          >
                            {actionId ===
                            account.id
                              ? "..."
                              : account.active
                                ? "غیرفعال"
                                : "فعال‌سازی"}
                          </button>

                        </div>

                      </td>

                    </tr>
                  )
                )}

              </tbody>

            </table>

          </div>
        )}

        {/* Pagination */}

        {!loading &&
          meta.totalPages >
            1 && (
            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">

              <button
                type="button"
                disabled={
                  meta.page <=
                  1
                }
                onClick={() =>
                  updateParams({
                    page:
                      String(
                        meta.page -
                          1
                      ),
                  })
                }
                className="rounded-lg border px-3 py-1.5 text-sm font-bold disabled:opacity-40"
              >
                قبلی
              </button>

              <span className="text-sm text-slate-500">
                صفحه{" "}
                {
                  meta.page.toLocaleString(
                    "fa-IR"
                  )
                }{" "}
                از{" "}
                {
                  meta.totalPages.toLocaleString(
                    "fa-IR"
                  )
                }
              </span>

              <button
                type="button"
                disabled={
                  meta.page >=
                  meta.totalPages
                }
                onClick={() =>
                  updateParams({
                    page:
                      String(
                        meta.page +
                          1
                      ),
                  })
                }
                className="rounded-lg border px-3 py-1.5 text-sm font-bold disabled:opacity-40"
              >
                بعدی
              </button>

            </div>
          )}

      </section>

    </div>
  );
}

/*
 * ============================================
 * Budget Cell
 * ============================================
 */

function BudgetCell({
  budget,
  loading,
}: {
  budget:
    BudgetSummaryItem |
    undefined;

  loading:
    boolean;
}) {
  if (
    loading &&
    !budget
  ) {
    return (
      <div className="w-44">

        <div className="h-5 w-20 animate-pulse rounded-full bg-slate-100" />

        <div className="mt-3 h-2 w-full animate-pulse rounded-full bg-slate-100" />

        <div className="mt-2 h-3 w-28 animate-pulse rounded bg-slate-100" />

      </div>
    );
  }

  if (
    !budget ||
    !budget.available
  ) {
    return (
      <div className="w-44">

        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black text-slate-500">
          نامشخص
        </span>

        <p className="mt-2 text-[10px] text-slate-400">
          وضعیت سهمیه در دسترس نیست
        </p>

      </div>
    );
  }

  const dominantMonthly =
    maxPercent(
      budget.percentages
        .monthlyTokens,
      budget.percentages
        .monthlyCost
    );

  const progressWidth =
    dominantMonthly ===
    null
      ? 0
      : Math.min(
          100,
          Math.max(
            0,
            dominantMonthly
          )
        );

  return (
    <div className="w-44">

      <div className="flex flex-wrap items-center gap-1.5">

        <BudgetStatusBadge
          budget={
            budget
          }
        />

        <span
          className={`rounded-full px-2 py-1 text-[9px] font-black ${
            budget.source ===
            "account_override"
              ? "bg-blue-50 text-blue-700"
              : "bg-slate-100 text-slate-500"
          }`}
        >
          {budget.source ===
          "account_override"
            ? "اختصاصی"
            : "پیش‌فرض"}
        </span>

      </div>

      {dominantMonthly !==
      null ? (
        <>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">

            <div
              className="h-full rounded-full bg-emerald-600"
              style={{
                width:
                  `${progressWidth}%`,
              }}
            />

          </div>

          <p className="mt-2 text-[10px] font-bold text-slate-500">
            بیشترین مصرف ماه:
            {" "}
            {
              formatPercent(
                dominantMonthly
              )
            }
          </p>

          <p className="mt-1 whitespace-nowrap text-[10px] text-slate-400">
            توکن
            {" "}
            {
              formatNullablePercent(
                budget.percentages
                  .monthlyTokens
              )
            }
            {" · "}
            هزینه
            {" "}
            {
              formatNullablePercent(
                budget.percentages
                  .monthlyCost
              )
            }
          </p>
        </>
      ) : (
        <p className="mt-2 text-[10px] text-slate-400">
          سقف ماهانه غیرفعال است
        </p>
      )}

      {budget.usage
        .monthly
        .unpricedRequests >
        0 && (
        <p className="mt-1 text-[10px] font-bold text-amber-600">
          {
            budget.usage
              .monthly
              .unpricedRequests
              .toLocaleString(
                "fa-IR"
              )
          }{" "}
          درخواست بدون قیمت
        </p>
      )}

    </div>
  );
}

/*
 * ============================================
 * Budget Badge
 * ============================================
 */

function BudgetStatusBadge({
  budget,
}: {
  budget:
    Extract<
      BudgetSummaryItem,
      {
        available:
          true;
      }
    >;
}) {
  if (
    budget.status ===
    "blocked"
  ) {
    return (
      <span
        title={
          budgetCodeLabel(
            budget.code
          )
        }
        className="rounded-full bg-rose-50 px-2.5 py-1 text-[10px] font-black text-rose-700"
      >
        سهمیه تمام شده
      </span>
    );
  }

  if (
    budget.status ===
    "warning"
  ) {
    const dailyWarning =
      budget.warnings.some(
        (
          warning
        ) =>
          warning.type ===
            "daily_tokens" ||
          warning.type ===
            "daily_cost"
      );

    return (
      <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-black text-amber-700">
        {dailyWarning
          ? "هشدار روزانه"
          : "نزدیک سقف"}
      </span>
    );
  }

  return (
    <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-black text-emerald-700">
      عادی
    </span>
  );
}

/*
 * ============================================
 * Budget Labels
 * ============================================
 */

function budgetCodeLabel(
  code:
    string |
    null
) {
  switch (
    code
  ) {
    case "AI_DAILY_TOKEN_LIMIT_REACHED":
      return "سقف Token روزانه تمام شده است.";

    case "AI_MONTHLY_TOKEN_LIMIT_REACHED":
      return "سقف Token ماهانه تمام شده است.";

    case "AI_DAILY_COST_LIMIT_REACHED":
      return "سقف هزینه روزانه تمام شده است.";

    case "AI_MONTHLY_COST_LIMIT_REACHED":
      return "سقف هزینه ماهانه تمام شده است.";

    default:
      return "سهمیه هوش مصنوعی به پایان رسیده است.";
  }
}

/*
 * ============================================
 * Filters
 * ============================================
 */

function SelectFilter({
  label,
  value,
  options,
  onChange,
}: {
  label:
    string;

  value:
    string;

  options:
    string[][];

  onChange: (
    value: string
  ) => void;
}) {
  return (
    <select
      aria-label={
        label
      }
      value={
        value
      }
      onChange={(
        event
      ) =>
        onChange(
          event.target.value
        )
      }
      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
    >
      <option value="">
        {
          label
        }
      </option>

      {options.map(
        ([
          optionValue,
          optionLabel,
        ]) => (
          <option
            key={
              optionValue
            }
            value={
              optionValue
            }
          >
            {
              optionLabel
            }
          </option>
        )
      )}
    </select>
  );
}

/*
 * ============================================
 * Loading
 * ============================================
 */

function Loading() {
  return (
    <div className="space-y-3 p-5">

      {Array.from(
        {
          length:
            7,
        },
        (
          _,
          index
        ) => (
          <div
            key={
              index
            }
            className="h-14 animate-pulse rounded-xl bg-slate-100"
          />
        )
      )}

    </div>
  );
}

/*
 * ============================================
 * Formatting
 * ============================================
 */

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

function formatPercent(
  value: number
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
    ? "—"
    : formatPercent(
        value
      );
}

function maxPercent(
  first:
    number |
    null,

  second:
    number |
    null
) {
  const values = [
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