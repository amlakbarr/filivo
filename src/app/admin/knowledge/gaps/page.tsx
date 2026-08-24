import Link from "next/link";
import { redirect } from "next/navigation";

import {
  getKnowledgeGaps,
  getKnowledgeGapStats,
  type KnowledgeGapListItem,
} from "@/lib/knowledge-gaps/admin";

import { getCurrentAccount } from "@/lib/pocketbase/auth";

type PageProps = {
  searchParams: Promise<{
    page?: string;
    search?: string;
    status?: string;
    gapType?: string;
    sort?: string;
  }>;
};

export default async function KnowledgeGapsPage({
  searchParams,
}: PageProps) {
  /*
   * ============================================
   * Security
   * ============================================
   */

  const account =
    await getCurrentAccount();

  if (!account) {
    redirect(
      "/login"
    );
  }

  if (
    account.role !==
    "admin"
  ) {
    redirect(
      "/chat"
    );
  }

  /*
   * ============================================
   * Query Params
   * ============================================
   */

  const params =
    await searchParams;

  const page =
    parsePositiveInteger(
      params.page,
      1
    );

  const search =
    params.search?.trim() ||
    "";

  const status =
    params.status || "";

  const gapType =
    params.gapType || "";

  const sort =
    params.sort ||
    "-priority_score";

  /*
   * ============================================
   * Data
   * ============================================
   */

  const [
    gaps,
    stats,
  ] = await Promise.all([
    getKnowledgeGaps({
      page,

      perPage:
        20,

      search,

      status,

      gapType,

      sort,
    }),

    getKnowledgeGapStats(),
  ]);

  return (
    <div
      className="min-h-full bg-gray-50 p-4 md:p-6 lg:p-8"
      dir="rtl"
    >
      <div className="mx-auto max-w-7xl">

        {/* Header */}

        <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">

          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              شکاف‌های دانش
            </h1>

            <p className="mt-2 text-sm leading-7 text-gray-500">
              سوالاتی که پاسخ کافی در پایگاه دانش برای آن‌ها وجود نداشته است.
            </p>
          </div>

          <Link
            href="/admin/knowledge"
            className="inline-flex w-fit items-center justify-center rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            بازگشت به پایگاه دانش
          </Link>

        </div>

        {/* KPI */}

        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">

          <StatCard
            label="شکاف باز"
            value={
              stats.open
            }
          />

          <StatCard
            label="در حال بررسی"
            value={
              stats.inProgress
            }
          />

          <StatCard
            label="حل‌شده"
            value={
              stats.resolved
            }
          />

          <StatCard
            label="کل دفعات مشاهده"
            value={
              stats.totalOccurrences
            }
          />

          <StatCard
            label="کاربران درگیر"
            value={
              stats.affectedUsers
            }
          />

        </div>

        {/* Highest priority */}

        {stats.highestPriority && (
          <div className="mb-8 rounded-2xl border border-amber-200 bg-amber-50 p-5">

            <p className="text-xs font-medium text-amber-700">
              بالاترین اولویت فعلی
            </p>

            <div className="mt-2 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">

              <div>
                <p className="font-semibold text-gray-900">
                  {
                    stats
                      .highestPriority
                      .title
                  }
                </p>

                <p className="mt-1 text-sm text-gray-600">
                  {
                    stats
                      .highestPriority
                      .occurrenceCount
                  }{" "}
                  بار تکرار
                  {" • "}
                  امتیاز اولویت{" "}
                  {
                    stats
                      .highestPriority
                      .priorityScore
                  }
                </p>
              </div>

            </div>

          </div>
        )}

        {/* Filters */}

        <form
          action="/admin/knowledge/gaps"
          method="GET"
          className="mb-6 rounded-2xl border border-gray-200 bg-white p-4"
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">

            {/* Search */}

            <div className="xl:col-span-2">
              <label
                htmlFor="search"
                className="mb-1.5 block text-xs font-medium text-gray-600"
              >
                جستجو
              </label>

              <input
                id="search"
                name="search"
                type="search"
                defaultValue={
                  search
                }
                placeholder="متن سوال یا عنوان Gap..."
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-gray-400"
              />
            </div>

            {/* Status */}

            <div>
              <label
                htmlFor="status"
                className="mb-1.5 block text-xs font-medium text-gray-600"
              >
                وضعیت
              </label>

              <select
                id="status"
                name="status"
                defaultValue={
                  status
                }
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none"
              >
                <option value="">
                  همه وضعیت‌ها
                </option>

                <option value="open">
                  باز
                </option>

                <option value="in_progress">
                  در حال بررسی
                </option>

                <option value="resolved">
                  حل‌شده
                </option>

                <option value="ignored">
                  نادیده گرفته‌شده
                </option>
              </select>
            </div>

            {/* Gap Type */}

            <div>
              <label
                htmlFor="gapType"
                className="mb-1.5 block text-xs font-medium text-gray-600"
              >
                دلیل
              </label>

              <select
                id="gapType"
                name="gapType"
                defaultValue={
                  gapType
                }
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none"
              >
                <option value="">
                  همه
                </option>

                <option value="no_answer">
                  بدون پاسخ
                </option>

                <option value="unclassified">
                  بدون موضوع
                </option>

                <option value="both">
                  بدون پاسخ و موضوع
                </option>
              </select>
            </div>

            {/* Sort */}

            <div>
              <label
                htmlFor="sort"
                className="mb-1.5 block text-xs font-medium text-gray-600"
              >
                مرتب‌سازی
              </label>

              <select
                id="sort"
                name="sort"
                defaultValue={
                  sort
                }
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none"
              >
                <option value="-priority_score">
                  بیشترین اولویت
                </option>

                <option value="-occurrence_count">
                  بیشترین تکرار
                </option>

                <option value="-last_seen_at">
                  آخرین مشاهده
                </option>

                <option value="-created">
                  جدیدترین
                </option>

                <option value="created">
                  قدیمی‌ترین
                </option>
              </select>
            </div>

          </div>

          <div className="mt-4 flex flex-wrap gap-2">

            <button
              type="submit"
              className="rounded-xl bg-black px-5 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800"
            >
              اعمال فیلتر
            </button>

            <Link
              href="/admin/knowledge/gaps"
              className="rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-sm font-medium text-gray-600 transition hover:bg-gray-50"
            >
              پاک کردن فیلتر
            </Link>

          </div>

        </form>

        {/* Results information */}

        <div className="mb-3 flex items-center justify-between">

          <p className="text-sm text-gray-500">
            {
              gaps.totalItems
            }{" "}
            مورد
          </p>

          {gaps.totalPages > 0 && (
            <p className="text-xs text-gray-400">
              صفحه{" "}
              {
                gaps.page
              }{" "}
              از{" "}
              {
                gaps.totalPages
              }
            </p>
          )}

        </div>

        {/* Table */}

        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">

          {gaps.items.length === 0 ? (

            <div className="px-6 py-16 text-center">

              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100 text-xl">
                ✓
              </div>

              <h2 className="mt-4 font-semibold text-gray-900">
                موردی پیدا نشد
              </h2>

              <p className="mt-2 text-sm text-gray-500">
                در حال حاضر Knowledge Gap مطابق این فیلتر وجود ندارد.
              </p>

            </div>

          ) : (

            <div className="overflow-x-auto">

              <table className="w-full min-w-[1000px] text-right">

                <thead className="border-b border-gray-200 bg-gray-50">

                  <tr className="text-xs font-medium text-gray-500">

                    <th className="px-4 py-3">
                      سوال
                    </th>

                    <th className="px-4 py-3">
                      موضوع
                    </th>

                    <th className="px-4 py-3">
                      وضعیت
                    </th>

                    <th className="px-4 py-3 text-center">
                      تکرار
                    </th>

                    <th className="px-4 py-3 text-center">
                      کاربران
                    </th>

                    <th className="px-4 py-3 text-center">
                      واحدها
                    </th>

                    <th className="px-4 py-3 text-center">
                      اولویت
                    </th>

                    <th className="px-4 py-3">
                      آخرین مشاهده
                    </th>

                  </tr>

                </thead>

                <tbody className="divide-y divide-gray-100">

                  {gaps.items.map(
                    (gap) => (
                      <GapRow
                        key={
                          gap.id
                        }
                        gap={
                          gap
                        }
                      />
                    )
                  )}

                </tbody>

              </table>

            </div>

          )}

        </div>

        {/* Pagination */}

        {gaps.totalPages > 1 && (

          <div className="mt-6 flex items-center justify-between">

            <PaginationButton
              label="صفحه قبل"
              disabled={
                gaps.page <= 1
              }
              href={buildPageHref({
                page:
                  gaps.page - 1,
                search,
                status,
                gapType,
                sort,
              })}
            />

            <span className="text-sm text-gray-500">
              {
                gaps.page
              }{" "}
              /{" "}
              {
                gaps.totalPages
              }
            </span>

            <PaginationButton
              label="صفحه بعد"
              disabled={
                gaps.page >=
                gaps.totalPages
              }
              href={buildPageHref({
                page:
                  gaps.page + 1,
                search,
                status,
                gapType,
                sort,
              })}
            />

          </div>

        )}

      </div>
    </div>
  );
}

/*
 * ============================================
 * Gap Row
 * ============================================
 */

function GapRow({
  gap,
}: {
  gap: KnowledgeGapListItem;
}) {
  return (
    <tr className="transition hover:bg-gray-50">

      {/* Question */}

      <td className="max-w-[360px] px-4 py-4">

        <p className="line-clamp-2 text-sm font-medium leading-6 text-gray-900">
          {
            gap.title
          }
        </p>

        {gap.sampleQuestion &&
          gap.sampleQuestion !==
            gap.title && (
            <p className="mt-1 line-clamp-1 text-xs text-gray-400">
              {
                gap.sampleQuestion
              }
            </p>
          )}

        <div className="mt-2">
          <GapTypeBadge
            type={
              gap.gapType
            }
          />
        </div>

      </td>

      {/* Topic */}

      <td className="px-4 py-4 text-sm text-gray-600">

        {gap.topicName ? (
          gap.topicName
        ) : (
          <span className="text-gray-400">
            بدون موضوع
          </span>
        )}

      </td>

      {/* Status */}

      <td className="px-4 py-4">

        <StatusBadge
          status={
            gap.status
          }
        />

      </td>

      <td className="px-4 py-4 text-center text-sm font-medium text-gray-700">
        {
          gap.occurrenceCount
        }
      </td>

      <td className="px-4 py-4 text-center text-sm text-gray-600">
        {
          gap.uniqueUsersCount
        }
      </td>

      <td className="px-4 py-4 text-center text-sm text-gray-600">
        {
          gap.uniqueDepartmentsCount
        }
      </td>

      {/* Priority */}

      <td className="px-4 py-4 text-center">

        <span className="inline-flex min-w-10 items-center justify-center rounded-lg bg-gray-100 px-2.5 py-1 text-sm font-semibold text-gray-700">
          {
            gap.priorityScore
          }
        </span>

      </td>

      {/* Date */}

      <td className="whitespace-nowrap px-4 py-4 text-xs text-gray-500">
        {
          formatPersianDate(
            gap.lastSeenAt ||
              gap.updated
          )
        }
      </td>

    </tr>
  );
}

/*
 * ============================================
 * KPI
 * ============================================
 */

function StatCard({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">

      <p className="text-xs font-medium text-gray-500">
        {label}
      </p>

      <p className="mt-3 text-2xl font-bold text-gray-900">
        {formatNumber(
          value
        )}
      </p>

    </div>
  );
}

/*
 * ============================================
 * Badges
 * ============================================
 */

function StatusBadge({
  status,
}: {
  status:
    KnowledgeGapListItem["status"];
}) {
  const config = {
    open: {
      label:
        "باز",

      className:
        "bg-red-50 text-red-700",
    },

    in_progress: {
      label:
        "در حال بررسی",

      className:
        "bg-amber-50 text-amber-700",
    },

    resolved: {
      label:
        "حل‌شده",

      className:
        "bg-emerald-50 text-emerald-700",
    },

    ignored: {
      label:
        "نادیده گرفته‌شده",

      className:
        "bg-gray-100 text-gray-600",
    },
  } as const;

  const item =
    config[status];

  return (
    <span
      className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-medium ${item.className}`}
    >
      {
        item.label
      }
    </span>
  );
}

function GapTypeBadge({
  type,
}: {
  type:
    KnowledgeGapListItem["gapType"];
}) {
  const labels = {
    no_answer:
      "بدون پاسخ",

    unclassified:
      "بدون موضوع",

    both:
      "بدون پاسخ و موضوع",
  } as const;

  return (
    <span className="inline-flex rounded-md bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-700">
      {
        labels[type]
      }
    </span>
  );
}

/*
 * ============================================
 * Pagination
 * ============================================
 */

function PaginationButton({
  label,
  href,
  disabled,
}: {
  label: string;
  href: string;
  disabled: boolean;
}) {
  if (disabled) {
    return (
      <span className="cursor-not-allowed rounded-xl border border-gray-200 bg-gray-50 px-4 py-2 text-sm text-gray-300">
        {label}
      </span>
    );
  }

  return (
    <Link
      href={href}
      className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
    >
      {label}
    </Link>
  );
}

function buildPageHref({
  page,
  search,
  status,
  gapType,
  sort,
}: {
  page: number;
  search: string;
  status: string;
  gapType: string;
  sort: string;
}) {
  const params =
    new URLSearchParams();

  params.set(
    "page",
    String(
      Math.max(
        1,
        page
      )
    )
  );

  if (search) {
    params.set(
      "search",
      search
    );
  }

  if (status) {
    params.set(
      "status",
      status
    );
  }

  if (gapType) {
    params.set(
      "gapType",
      gapType
    );
  }

  if (sort) {
    params.set(
      "sort",
      sort
    );
  }

  return `/admin/knowledge/gaps?${params.toString()}`;
}

/*
 * ============================================
 * Formatting
 * ============================================
 */

function formatNumber(
  value: number
) {
  return new Intl.NumberFormat(
    "fa-IR"
  ).format(value);
}

function formatPersianDate(
  value?: string
) {
  if (!value) {
    return "—";
  }

  const date =
    new Date(value);

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
      year:
        "numeric",

      month:
        "2-digit",

      day:
        "2-digit",

      hour:
        "2-digit",

      minute:
        "2-digit",
    }
  ).format(date);
}

function parsePositiveInteger(
  value: string | undefined,
  fallback: number
) {
  const parsed =
    Number.parseInt(
      value || "",
      10
    );

  if (
    !Number.isFinite(
      parsed
    ) ||
    parsed <= 0
  ) {
    return fallback;
  }

  return parsed;
}