import Link from "next/link";

import {
  redirect,
} from "next/navigation";

import type {
  RecordModel,
} from "pocketbase";

import {
  AnalyticsRangeError,
  resolveAnalyticsRange,
} from "@/lib/analytics/range";

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

type PageProps = {
  searchParams: Promise<
    Record<
      string,
      string |
      string[] |
      undefined
    >
  >;
};

type AuditResult =
  | "success"
  | "failure"
  | "blocked";

type AuditRecord =
  RecordModel & {
    actor?: string;

    actor_role?: string;

    action?: string;

    entity_type?: string;

    entity_id?: string;

    target_user?: string;

    result?: AuditResult;

    request_id?: string;

    ip_hash?: string;

    metadata?: unknown;

    error_code?: string;
  };

type AuditAccount = {
  id: string;

  name?: unknown;

  email?: unknown;

  employee_code?: unknown;

  role?: unknown;
};

/*
 * ============================================
 * Constants
 * ============================================
 */

const PER_PAGE_OPTIONS = [
  20,
  50,
  100,
];

const ACTION_OPTIONS = [
  "auth.login.success",
  "auth.login.failure",
  "auth.login.blocked",
  "auth.logout",

  "knowledge.create",
  "knowledge.update",
  "knowledge.publish",
  "knowledge.unpublish",
  "knowledge.sync.success",
  "knowledge.sync.failure",
  "knowledge.openai.remove.success",
  "knowledge.openai.remove.failure",
  "knowledge.delete",

  "gap.status.in_progress",
  "gap.ignore",
  "gap.reopen",
  "gap.resolve",

  "account.create",
  "account.update",
  "account.role_change",
  "account.disable",
  "account.enable",
] as const;

/*
 * ============================================
 * Page
 * ============================================
 */

export default async function AuditLogPage({
  searchParams,
}: PageProps) {
  /*
   * ==========================================
   * Authorization
   * ==========================================
   */

  const admin =
    await getAdminSession();

  if (!admin.ok) {
    if (
      admin.status ===
      401
    ) {
      redirect(
        "/login"
      );
    }

    redirect(
      "/chat"
    );
  }

  /*
   * ==========================================
   * Search Params
   * ==========================================
   */

  const rawParams =
    await searchParams;

  const params =
    toUrlSearchParams(
      rawParams
    );

  const page =
    clampInteger(
      params.get(
        "page"
      ),
      1,
      100_000,
      1
    );

  const perPage =
    normalizePerPage(
      params.get(
        "perPage"
      )
    );

  const action =
    cleanAction(
      params.get(
        "action"
      )
    );

  const result =
    cleanResult(
      params.get(
        "result"
      )
    );

  const userSearch =
    cleanSearch(
      params.get(
        "user"
      ),
      100
    );

  const query =
    cleanSearch(
      params.get(
        "q"
      ),
      150
    );

  /*
   * ==========================================
   * Date Range
   *
   * همان Range داشبورد اصلی استفاده می‌شود.
   * ==========================================
   */

  let range;

  try {
    range =
      resolveAnalyticsRange(
        params
      );
  } catch (error) {
    if (
      error instanceof
      AnalyticsRangeError
    ) {
      return (
        <AuditErrorState
          message={
            error.message
          }
        />
      );
    }

    throw error;
  }

  /*
   * ==========================================
   * PocketBase
   * ==========================================
   */

  let pb;

  try {
    pb =
      await getPocketBaseServiceClient();
  } catch (error) {
    console.error(
      "Audit service client failed",
      {
        adminId:
          admin.account.id,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return (
      <AuditErrorState
        message="سرویس Audit Log در دسترس نیست."
      />
    );
  }

  /*
   * ==========================================
   * Filters
   * ==========================================
   */

  const filters:
    string[] = [
      "created >= {:from}",
      "created < {:to}",
    ];

  const values:
    Record<
      string,
      string
    > = {
      from:
        range.from.toISOString(),

      to:
        range.to.toISOString(),
    };

  if (action) {
    filters.push(
      "action = {:action}"
    );

    values.action =
      action;
  }

  if (result) {
    filters.push(
      "result = {:result}"
    );

    values.result =
      result;
  }

  /*
   * User Search:
   *
   * Actor یا Target User
   */
  if (userSearch) {
    filters.push(
      [
        "(",
        "actor.name ~ {:userSearch}",
        "|| actor.email ~ {:userSearch}",
        "|| actor.employee_code ~ {:userSearch}",
        "|| target_user.name ~ {:userSearch}",
        "|| target_user.email ~ {:userSearch}",
        "|| target_user.employee_code ~ {:userSearch}",
        ")",
      ].join(
        " "
      )
    );

    values.userSearch =
      userSearch;
  }

  /*
   * General Search
   */
  if (query) {
    filters.push(
      [
        "(",
        "action ~ {:query}",
        "|| entity_type ~ {:query}",
        "|| entity_id ~ {:query}",
        "|| request_id ~ {:query}",
        "|| error_code ~ {:query}",
        ")",
      ].join(
        " "
      )
    );

    values.query =
      query;
  }

  /*
   * ==========================================
   * Load Records
   * ==========================================
   */

  let resultList;

  try {
    resultList =
      await pb
        .collection(
          "audit_logs"
        )
        .getList<AuditRecord>(
          page,
          perPage,
          {
            filter:
              pb.filter(
                filters.join(
                  " && "
                ),
                values
              ),

            sort:
              "-created",

            expand:
              "actor,target_user",
          }
        );
  } catch (error) {
    console.error(
      "Audit log list failed",
      {
        adminId:
          admin.account.id,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return (
      <AuditErrorState
        message="دریافت Audit Log ناموفق بود."
      />
    );
  }

  /*
   * ==========================================
   * Render
   * ==========================================
   */

  return (
    <div
      className="space-y-6"
      dir="rtl"
    >

      {/* Header */}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">

        <div>

          <p className="text-sm font-bold text-emerald-700">
            امنیت و رهگیری
          </p>

          <h1 className="mt-1 text-2xl font-black text-slate-950 sm:text-3xl">
            Audit Log
          </h1>

          <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-500">
            سابقه عملیات امنیتی و مدیریتی شامل ورود کاربران، تغییر حساب‌ها، مدیریت پایگاه دانش و Knowledge Gap.
          </p>

        </div>

        <Link
          href="/admin"
          className="inline-flex w-fit rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
        >
          بازگشت به داشبورد
        </Link>

      </div>

      {/* Summary */}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">

        <SummaryCard
          label="کل رویدادها"
          value={
            formatNumber(
              resultList.totalItems
            )
          }
        />

        <SummaryCard
          label="صفحه فعلی"
          value={
            formatNumber(
              resultList.page
            )
          }
        />

        <SummaryCard
          label="تعداد صفحات"
          value={
            formatNumber(
              resultList.totalPages
            )
          }
        />

        <SummaryCard
          label="بازه زمانی"
          value={
            range.label
          }
          small
        />

      </div>

      {/* Filters */}

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">

        <div>

          <h2 className="font-black text-slate-900">
            فیلتر رویدادها
          </h2>

          <p className="mt-1 text-xs leading-6 text-slate-500">
            امکان جستجو براساس کاربر، Action، نتیجه، Request ID و شناسه موجودیت.
          </p>

        </div>

        <form
          action="/admin/audit"
          method="get"
          className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4"
        >

          {/* Range */}

          <FilterField
            label="بازه زمانی"
          >
            <select
              name="range"
              defaultValue={
                params.get(
                  "range"
                ) ||
                "30d"
              }
              className={
                inputClass
              }
            >
              <option value="today">
                امروز
              </option>

              <option value="7d">
                ۷ روز اخیر
              </option>

              <option value="30d">
                ۳۰ روز اخیر
              </option>

              <option value="this_month">
                این ماه
              </option>

              <option value="previous_month">
                ماه قبل
              </option>

              <option value="custom">
                بازه سفارشی
              </option>
            </select>
          </FilterField>

          {/* From */}

          <FilterField
            label="از تاریخ"
          >
            <input
              type="date"
              name="from"
              defaultValue={
                params.get(
                  "from"
                ) ||
                ""
              }
              className={
                inputClass
              }
            />
          </FilterField>

          {/* To */}

          <FilterField
            label="تا تاریخ"
          >
            <input
              type="date"
              name="to"
              defaultValue={
                params.get(
                  "to"
                ) ||
                ""
              }
              className={
                inputClass
              }
            />
          </FilterField>

          {/* Result */}

          <FilterField
            label="نتیجه"
          >
            <select
              name="result"
              defaultValue={
                result
              }
              className={
                inputClass
              }
            >
              <option value="">
                همه
              </option>

              <option value="success">
                موفق
              </option>

              <option value="failure">
                ناموفق
              </option>

              <option value="blocked">
                مسدودشده
              </option>
            </select>
          </FilterField>

          {/* Action */}

          <FilterField
            label="Action"
          >
            <select
              name="action"
              defaultValue={
                action
              }
              className={
                inputClass
              }
            >
              <option value="">
                همه عملیات‌ها
              </option>

              {ACTION_OPTIONS.map(
                (
                  value
                ) => (
                  <option
                    key={
                      value
                    }
                    value={
                      value
                    }
                  >
                    {
                      actionLabel(
                        value
                      )
                    }
                  </option>
                )
              )}

            </select>
          </FilterField>

          {/* User */}

          <FilterField
            label="کاربر"
          >
            <input
              name="user"
              defaultValue={
                userSearch
              }
              maxLength={
                100
              }
              placeholder="نام، ایمیل یا کد پرسنلی"
              className={
                inputClass
              }
            />
          </FilterField>

          {/* Query */}

          <FilterField
            label="جستجوی عمومی"
          >
            <input
              name="q"
              defaultValue={
                query
              }
              maxLength={
                150
              }
              placeholder="Action، Request ID، Entity ID..."
              className={
                inputClass
              }
            />
          </FilterField>

          {/* Per Page */}

          <FilterField
            label="تعداد در صفحه"
          >
            <select
              name="perPage"
              defaultValue={
                String(
                  perPage
                )
              }
              className={
                inputClass
              }
            >
              {PER_PAGE_OPTIONS.map(
                (
                  value
                ) => (
                  <option
                    key={
                      value
                    }
                    value={
                      value
                    }
                  >
                    {
                      formatNumber(
                        value
                      )
                    }
                  </option>
                )
              )}
            </select>
          </FilterField>

          {/* Buttons */}

          <div className="flex items-end gap-2 md:col-span-2 xl:col-span-4">

            <button
              type="submit"
              className="rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-black text-white transition hover:bg-black"
            >
              اعمال فیلتر
            </button>

            <Link
              href="/admin/audit"
              className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-bold text-slate-600 transition hover:bg-slate-50"
            >
              پاک کردن فیلترها
            </Link>

          </div>

        </form>

      </section>

      {/* Records */}

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">

        <div className="flex flex-col gap-2 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">

          <div>

            <h2 className="font-black text-slate-900">
              رویدادها
            </h2>

            <p className="mt-1 text-xs text-slate-500">
              {
                formatNumber(
                  resultList.totalItems
                )
              }{" "}
              رویداد مطابق فیلتر فعلی
            </p>

          </div>

          <p className="text-xs text-slate-400">
            منطقه زمانی:
            {" "}
            {
              range.timezone
            }
          </p>

        </div>

        {resultList.items.length ===
        0 ? (

          <div className="px-6 py-16 text-center">

            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-xl">
              ⌕
            </div>

            <h3 className="mt-4 font-black text-slate-800">
              رویدادی پیدا نشد
            </h3>

            <p className="mt-2 text-sm text-slate-500">
              برای این بازه و فیلترها Audit Log وجود ندارد.
            </p>

          </div>

        ) : (

          <div className="divide-y divide-slate-100">

            {resultList.items.map(
              (
                record
              ) => (
                <AuditCard
                  key={
                    record.id
                  }
                  record={
                    record
                  }
                  timezone={
                    range.timezone
                  }
                />
              )
            )}

          </div>

        )}

        {/* Pagination */}

        {resultList.totalPages >
          1 && (

          <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-4">

            <Link
              href={
                resultList.page >
                1
                  ? buildPageHref(
                      params,
                      resultList.page -
                        1
                    )
                  : "#"
              }
              aria-disabled={
                resultList.page <=
                1
              }
              className={`rounded-xl border px-4 py-2 text-sm font-bold ${
                resultList.page <=
                1
                  ? "pointer-events-none border-slate-100 text-slate-300"
                  : "border-slate-200 text-slate-700 hover:bg-slate-50"
              }`}
            >
              قبلی
            </Link>

            <p className="text-xs text-slate-500">
              صفحه{" "}
              {
                formatNumber(
                  resultList.page
                )
              }{" "}
              از{" "}
              {
                formatNumber(
                  resultList.totalPages
                )
              }
            </p>

            <Link
              href={
                resultList.page <
                resultList.totalPages
                  ? buildPageHref(
                      params,
                      resultList.page +
                        1
                    )
                  : "#"
              }
              aria-disabled={
                resultList.page >=
                resultList.totalPages
              }
              className={`rounded-xl border px-4 py-2 text-sm font-bold ${
                resultList.page >=
                resultList.totalPages
                  ? "pointer-events-none border-slate-100 text-slate-300"
                  : "border-slate-200 text-slate-700 hover:bg-slate-50"
              }`}
            >
              بعدی
            </Link>

          </div>

        )}

      </section>

    </div>
  );
}

/*
 * ============================================
 * Audit Card
 * ============================================
 */

function AuditCard({
  record,
  timezone,
}: {
  record:
    AuditRecord;

  timezone:
    string;
}) {
  const actor =
    expandedAccount(
      record,
      "actor"
    );

  const targetUser =
    expandedAccount(
      record,
      "target_user"
    );

  const metadata =
    formatMetadata(
      record.metadata
    );

  const entityHref =
    getEntityHref(
      String(
        record.entity_type ||
          ""
      ),
      String(
        record.entity_id ||
          ""
      )
    );

  return (
    <article className="p-5 sm:p-6">

      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">

        <div className="min-w-0 flex-1">

          {/* Title */}

          <div className="flex flex-wrap items-center gap-2">

            <ResultBadge
              value={
                normalizeResult(
                  record.result
                )
              }
            />

            <span className="rounded-lg bg-slate-100 px-2.5 py-1 font-mono text-xs font-bold text-slate-700">
              {
                String(
                  record.action ||
                    "unknown"
                )
              }
            </span>

            <span className="text-sm font-black text-slate-900">
              {
                actionLabel(
                  String(
                    record.action ||
                      ""
                  )
                )
              }
            </span>

          </div>

          {/* Actor */}

          <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-3">

            <InfoBox
              label="انجام‌دهنده"
            >
              {actor ? (
                <Link
                  href={`/admin/accounts/${actor.id}`}
                  className="font-black text-slate-800 hover:text-emerald-700"
                >
                  {
                    accountLabel(
                      actor
                    )
                  }
                </Link>
              ) : (
                <span className="font-bold text-slate-600">
                  {record.actor_role ===
                  "system"
                    ? "سیستم"
                    : "نامشخص"}
                </span>
              )}
            </InfoBox>

            <InfoBox
              label="نقش"
            >
              {
                actorRoleLabel(
                  String(
                    record.actor_role ||
                      ""
                  )
                )
              }
            </InfoBox>

            <InfoBox
              label="زمان"
            >
              {
                formatDate(
                  String(
                    record.created ||
                      ""
                  ),
                  timezone
                )
              }
            </InfoBox>

          </div>

          {/* Entity */}

          {(record.entity_type ||
            record.entity_id) && (

            <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">

              <InfoBox
                label="موجودیت"
              >
                <span>
                  {
                    entityTypeLabel(
                      String(
                        record.entity_type ||
                          ""
                      )
                    )
                  }
                </span>

                {record.entity_id && (
                  <span
                    dir="ltr"
                    className="mr-2 font-mono text-xs text-slate-400"
                  >
                    {
                      String(
                        record.entity_id
                      )
                    }
                  </span>
                )}
              </InfoBox>

              <InfoBox
                label="عملیات"
              >
                {entityHref ? (
                  <Link
                    href={
                      entityHref
                    }
                    className="font-black text-emerald-700 hover:text-emerald-800"
                  >
                    مشاهده رکورد مرتبط
                  </Link>
                ) : (
                  <span className="text-slate-400">
                    لینک مستقیمی ندارد
                  </span>
                )}
              </InfoBox>

            </div>

          )}

          {/* Target */}

          {targetUser && (
            <div className="mt-3 rounded-xl bg-blue-50 px-4 py-3 text-sm">

              <span className="text-xs font-bold text-blue-600">
                کاربر هدف:
              </span>

              {" "}

              <Link
                href={`/admin/accounts/${targetUser.id}`}
                className="font-black text-blue-900"
              >
                {
                  accountLabel(
                    targetUser
                  )
                }
              </Link>

            </div>
          )}

          {/* Error */}

          {record.error_code && (
            <div className="mt-3 rounded-xl border border-rose-100 bg-rose-50 px-4 py-3">

              <span className="text-xs font-black text-rose-600">
                Error Code
              </span>

              <p
                dir="ltr"
                className="mt-1 text-left font-mono text-xs font-bold text-rose-800"
              >
                {
                  String(
                    record.error_code
                  )
                }
              </p>

            </div>
          )}

          {/* Metadata */}

          {metadata && (
            <details className="mt-3 rounded-xl border border-slate-200 bg-slate-50">

              <summary className="cursor-pointer px-4 py-3 text-xs font-black text-slate-600">
                مشاهده Metadata
              </summary>

              <pre
                dir="ltr"
                className="max-h-80 overflow-auto border-t border-slate-200 px-4 py-3 text-left font-mono text-[11px] leading-6 text-slate-600"
              >
                {
                  metadata
                }
              </pre>

            </details>
          )}

        </div>

        {/* Trace */}

        <div className="shrink-0 rounded-2xl border border-slate-100 bg-slate-50 p-4 text-xs xl:w-72">

          <p className="font-black text-slate-500">
            Trace
          </p>

          <div className="mt-3 space-y-3">

            <div>

              <p className="text-[10px] text-slate-400">
                Request ID
              </p>

              <p
                dir="ltr"
                className="mt-1 break-all text-left font-mono text-[11px] text-slate-700"
              >
                {
                  String(
                    record.request_id ||
                      "—"
                  )
                }
              </p>

            </div>

            <div>

              <p className="text-[10px] text-slate-400">
                Audit ID
              </p>

              <p
                dir="ltr"
                className="mt-1 break-all text-left font-mono text-[11px] text-slate-700"
              >
                {
                  record.id
                }
              </p>

            </div>

            <div>

              <p className="text-[10px] text-slate-400">
                IP Hash
              </p>

              <p
                dir="ltr"
                className="mt-1 text-left font-mono text-[11px] text-slate-700"
              >
                {
                  shortHash(
                    record.ip_hash
                  )
                }
              </p>

            </div>

          </div>

        </div>

      </div>

    </article>
  );
}

/*
 * ============================================
 * Result Badge
 * ============================================
 */

function ResultBadge({
  value,
}: {
  value:
    AuditResult;
}) {
  const config = {
    success: {
      label:
        "موفق",

      className:
        "bg-emerald-50 text-emerald-700",
    },

    failure: {
      label:
        "ناموفق",

      className:
        "bg-rose-50 text-rose-700",
    },

    blocked: {
      label:
        "مسدود",

      className:
        "bg-amber-50 text-amber-700",
    },
  }[
    value
  ];

  return (
    <span
      className={`rounded-lg px-2.5 py-1 text-xs font-black ${config.className}`}
    >
      {
        config.label
      }
    </span>
  );
}

/*
 * ============================================
 * Summary Card
 * ============================================
 */

function SummaryCard({
  label,
  value,
  small,
}: {
  label:
    string;

  value:
    string;

  small?:
    boolean;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">

      <p className="text-xs font-bold text-slate-500">
        {
          label
        }
      </p>

      <p
        className={`mt-3 font-black text-slate-950 ${
          small
            ? "text-lg"
            : "text-2xl"
        }`}
      >
        {
          value
        }
      </p>

    </div>
  );
}

/*
 * ============================================
 * Filter Field
 * ============================================
 */

function FilterField({
  label,
  children,
}: {
  label:
    string;

  children:
    React.ReactNode;
}) {
  return (
    <label className="block">

      <span className="mb-2 block text-xs font-black text-slate-600">
        {
          label
        }
      </span>

      {
        children
      }

    </label>
  );
}

/*
 * ============================================
 * Info Box
 * ============================================
 */

function InfoBox({
  label,
  children,
}: {
  label:
    string;

  children:
    React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-slate-50 px-4 py-3">

      <p className="text-[10px] font-bold text-slate-400">
        {
          label
        }
      </p>

      <div className="mt-1 min-w-0 text-sm text-slate-700">
        {
          children
        }
      </div>

    </div>
  );
}

/*
 * ============================================
 * Error State
 * ============================================
 */

function AuditErrorState({
  message,
}: {
  message:
    string;
}) {
  return (
    <div
      className="rounded-3xl border border-rose-200 bg-rose-50 p-8 text-center"
      dir="rtl"
    >

      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-xl font-black text-rose-700">
        !
      </div>

      <h1 className="mt-4 text-xl font-black text-slate-900">
        Audit Log در دسترس نیست
      </h1>

      <p className="mt-2 text-sm leading-7 text-rose-800">
        {
          message
        }
      </p>

      <Link
        href="/admin/audit"
        className="mt-5 inline-flex rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white"
      >
        تلاش مجدد
      </Link>

    </div>
  );
}

/*
 * ============================================
 * Expanded Account
 * ============================================
 */

function expandedAccount(
  record: AuditRecord,
  key:
    | "actor"
    | "target_user"
): AuditAccount | null {
  const expand =
    record.expand as
      | Record<
          string,
          unknown
        >
      | undefined;

  const value =
    expand?.[
      key
    ];

  if (!value) {
    return null;
  }

  if (
    Array.isArray(
      value
    )
  ) {
    const first =
      value[0];

    return isObject(
      first
    )
      ? first as AuditAccount
      : null;
  }

  return isObject(
    value
  )
    ? value as AuditAccount
    : null;
}

/*
 * ============================================
 * Labels
 * ============================================
 */

function actionLabel(
  action: string
) {
  const labels:
    Record<
      string,
      string
    > = {
      "auth.login.success":
        "ورود موفق",

      "auth.login.failure":
        "ورود ناموفق",

      "auth.login.blocked":
        "مسدود شدن ورود",

      "auth.logout":
        "خروج از حساب",

      "knowledge.create":
        "ساخت مطلب",

      "knowledge.update":
        "ویرایش مطلب",

      "knowledge.publish":
        "انتشار مطلب",

      "knowledge.unpublish":
        "بازگرداندن به پیش‌نویس",

      "knowledge.sync.success":
        "همگام‌سازی موفق",

      "knowledge.sync.failure":
        "همگام‌سازی ناموفق",

      "knowledge.openai.remove.success":
        "حذف موفق از OpenAI",

      "knowledge.openai.remove.failure":
        "حذف ناموفق از OpenAI",

      "knowledge.delete":
        "حذف مطلب",

      "gap.status.in_progress":
        "بررسی Gap",

      "gap.ignore":
        "نادیده گرفتن Gap",

      "gap.reopen":
        "بازگشایی Gap",

      "gap.resolve":
        "حل Gap",

      "account.create":
        "ساخت حساب",

      "account.update":
        "ویرایش حساب",

      "account.role_change":
        "تغییر سطح دسترسی",

      "account.disable":
        "غیرفعال کردن حساب",

      "account.enable":
        "فعال کردن حساب",
    };

  return (
    labels[
      action
    ] ||
    action ||
    "عملیات نامشخص"
  );
}

function actorRoleLabel(
  value: string
) {
  if (
    value ===
    "admin"
  ) {
    return "مدیر";
  }

  if (
    value ===
    "employee"
  ) {
    return "کارشناس";
  }

  if (
    value ===
    "system"
  ) {
    return "سیستم";
  }

  return "نامشخص";
}

function entityTypeLabel(
  value: string
) {
  if (
    value ===
    "account"
  ) {
    return "حساب کاربری";
  }

  if (
    value ===
    "knowledge_item"
  ) {
    return "مطلب پایگاه دانش";
  }

  if (
    value ===
    "knowledge_gap"
  ) {
    return "Knowledge Gap";
  }

  if (
    value ===
    "auth"
  ) {
    return "احراز هویت";
  }

  return (
    value ||
    "نامشخص"
  );
}

/*
 * ============================================
 * Entity link
 * ============================================
 */

function getEntityHref(
  type: string,
  id: string
) {
  if (!id) {
    return null;
  }

  if (
    type ===
    "account"
  ) {
    return `/admin/accounts/${id}`;
  }

  if (
    type ===
    "knowledge_item"
  ) {
    return `/admin/knowledge/${id}/edit`;
  }

  if (
    type ===
    "knowledge_gap"
  ) {
    return `/admin/knowledge/gaps/${id}`;
  }

  return null;
}

/*
 * ============================================
 * Account
 * ============================================
 */

function accountLabel(
  account: AuditAccount
) {
  const name =
    String(
      account.name ||
        ""
    ).trim();

  const employeeCode =
    String(
      account.employee_code ||
        ""
    ).trim();

  const email =
    String(
      account.email ||
        ""
    ).trim();

  if (
    name &&
    employeeCode
  ) {
    return `${name} — ${employeeCode}`;
  }

  return (
    name ||
    email ||
    account.id
  );
}

/*
 * ============================================
 * Metadata
 * ============================================
 */

function formatMetadata(
  value: unknown
) {
  if (
    value ===
      null ||
    value ===
      undefined ||
    value ===
      ""
  ) {
    return "";
  }

  try {
    if (
      typeof value ===
      "string"
    ) {
      const trimmed =
        value.trim();

      if (!trimmed) {
        return "";
      }

      try {
        return JSON.stringify(
          JSON.parse(
            trimmed
          ),
          null,
          2
        );
      } catch {
        return trimmed.slice(
          0,
          12_000
        );
      }
    }

    return JSON.stringify(
      value,
      null,
      2
    );
  } catch {
    return "[Metadata قابل نمایش نیست]";
  }
}

/*
 * ============================================
 * URL
 * ============================================
 */

function toUrlSearchParams(
  raw:
    Record<
      string,
      string |
      string[] |
      undefined
    >
) {
  const params =
    new URLSearchParams();

  for (
    const [
      key,
      value,
    ] of Object.entries(
      raw
    )
  ) {
    if (
      typeof value ===
      "string"
    ) {
      params.set(
        key,
        value
      );

      continue;
    }

    if (
      Array.isArray(
        value
      ) &&
      value[0]
    ) {
      params.set(
        key,
        value[0]
      );
    }
  }

  return params;
}

function buildPageHref(
  current:
    URLSearchParams,

  page:
    number
) {
  const params =
    new URLSearchParams(
      current.toString()
    );

  params.set(
    "page",
    String(
      page
    )
  );

  return `/admin/audit?${params.toString()}`;
}

/*
 * ============================================
 * Filters
 * ============================================
 */

function cleanAction(
  value:
    string |
    null
) {
  const result =
    String(
      value ||
        ""
    )
      .trim()
      .toLowerCase()
      .slice(
        0,
        120
      );

  return /^[a-z0-9._-]*$/.test(
    result
  )
    ? result
    : "";
}

function cleanResult(
  value:
    string |
    null
):
  | AuditResult
  | "" {
  if (
    value ===
      "success" ||
    value ===
      "failure" ||
    value ===
      "blocked"
  ) {
    return value;
  }

  return "";
}

function cleanSearch(
  value:
    string |
    null,

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

function normalizePerPage(
  value:
    string |
    null
) {
  const parsed =
    Number(
      value
    );

  return PER_PAGE_OPTIONS.includes(
    parsed
  )
    ? parsed
    : 20;
}

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
  const parsed =
    Number(
      value
    );

  return Number.isInteger(
    parsed
  )
    ? Math.min(
        Math.max(
          parsed,
          minimum
        ),
        maximum
      )
    : fallback;
}

/*
 * ============================================
 * Result
 * ============================================
 */

function normalizeResult(
  value: unknown
): AuditResult {
  if (
    value ===
    "failure"
  ) {
    return "failure";
  }

  if (
    value ===
    "blocked"
  ) {
    return "blocked";
  }

  return "success";
}

/*
 * ============================================
 * Date
 * ============================================
 */

function formatDate(
  value: string,
  timezone: string
) {
  if (!value) {
    return "—";
  }

  const date =
    new Date(
      value
    );

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return "—";
  }

  return new Intl.DateTimeFormat(
    "fa-IR",
    {
      timeZone:
        timezone,

      dateStyle:
        "medium",

      timeStyle:
        "medium",
    }
  ).format(
    date
  );
}

/*
 * ============================================
 * Hash
 * ============================================
 */

function shortHash(
  value: unknown
) {
  const hash =
    String(
      value ||
        ""
    ).trim();

  if (!hash) {
    return "—";
  }

  if (
    hash.length <=
    16
  ) {
    return hash;
  }

  return `${hash.slice(
    0,
    12
  )}…${hash.slice(
    -4
  )}`;
}

/*
 * ============================================
 * Formatting
 * ============================================
 */

function formatNumber(
  value: number
) {
  return value.toLocaleString(
    "fa-IR"
  );
}

/*
 * ============================================
 * Utils
 * ============================================
 */

function isObject(
  value: unknown
): value is
  Record<
    string,
    unknown
  > {
  return (
    typeof value ===
      "object" &&
    value !==
      null
  );
}

/*
 * ============================================
 * Safe Error
 * ============================================
 */

function safeErrorMetadata(
  error: unknown
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

/*
 * ============================================
 * Styles
 * ============================================
 */

const inputClass =
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100";