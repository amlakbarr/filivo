import Link from "next/link";

import {
  redirect,
} from "next/navigation";

import GapActions from "@/components/admin/knowledge-gaps/GapActions";

import {
  getKnowledgeGapDetail,
  type GapDetailStatus,
  type GapDetailType,
} from "@/lib/knowledge-gaps/details";

import {
  getCurrentAccount,
} from "@/lib/pocketbase/auth";

export default async function KnowledgeGapDetailPage({
  params,
}: {
  params: Promise<{
    id: string;
  }>;
}) {
  /*
   * Security
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

  const {
    id,
  } = await params;

  const gap =
    await getKnowledgeGapDetail(
      id
    );

  if (!gap) {
    redirect(
      "/admin/knowledge/gaps"
    );
  }

  /*
   * URL برای ساخت Knowledge جدید.
   *
   * در مرحله بعد فرم Knowledge را
   * طوری تغییر می‌دهیم که این Query Params
   * را بخواند و فرم را Prefill کند.
   */
  const createKnowledgeParams =
    new URLSearchParams();

  createKnowledgeParams.set(
    "gapId",
    gap.id
  );

  createKnowledgeParams.set(
    "title",
    gap.title
  );

  createKnowledgeParams.set(
    "question",
    gap.sampleQuestion
  );

  if (gap.topicId) {
    createKnowledgeParams.set(
      "topicId",
      gap.topicId
    );
  }

  const createKnowledgeHref =
    `/admin/knowledge/new?${createKnowledgeParams.toString()}`;

  return (
    <div
      className="min-h-full bg-gray-50 p-4 md:p-6 lg:p-8"
      dir="rtl"
    >
      <div className="mx-auto max-w-7xl">

        {/* Header */}

        <div className="mb-6">

          <Link
            href="/admin/knowledge/gaps"
            className="text-sm font-medium text-gray-500 transition hover:text-gray-900"
          >
            ← بازگشت به شکاف‌های دانش
          </Link>

          <div className="mt-5 flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">

            <div className="max-w-3xl">

              <div className="flex flex-wrap items-center gap-2">

                <StatusBadge
                  status={
                    gap.status
                  }
                />

                <GapTypeBadge
                  type={
                    gap.gapType
                  }
                />

              </div>

              <h1 className="mt-4 text-2xl font-bold leading-10 text-gray-900">
                {gap.title}
              </h1>

              {gap.topicName && (
                <p className="mt-2 text-sm text-gray-500">
                  موضوع:{" "}
                  <span className="font-medium text-gray-700">
                    {
                      gap.topicName
                    }
                  </span>
                </p>
              )}

            </div>

            <Link
              href={
                createKnowledgeHref
              }
              className="inline-flex shrink-0 items-center justify-center rounded-xl bg-black px-5 py-3 text-sm font-medium text-white transition hover:bg-gray-800"
            >
              ایجاد پاسخ در پایگاه دانش
            </Link>

          </div>

        </div>

        {/* KPI */}

        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">

          <StatCard
            label="تعداد تکرار"
            value={
              gap.occurrenceCount
            }
          />

          <StatCard
            label="کاربران درگیر"
            value={
              gap.uniqueUsersCount
            }
          />

          <StatCard
            label="واحدهای درگیر"
            value={
              gap.uniqueDepartmentsCount
            }
          />

          <StatCard
            label="امتیاز اولویت"
            value={
              gap.priorityScore
            }
          />

        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_340px]">

          {/* Main */}

          <div className="space-y-6">

            {/* Sample question */}

            <section className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6">

              <h2 className="font-semibold text-gray-900">
                نمونه سؤال
              </h2>

              <p className="mt-4 whitespace-pre-wrap rounded-xl bg-gray-50 p-4 text-sm leading-8 text-gray-700">
                {
                  gap.sampleQuestion
                }
              </p>

            </section>

            {/* Occurrences */}

            <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white">

              <div className="border-b border-gray-200 px-5 py-4">

                <h2 className="font-semibold text-gray-900">
                  دفعات مشاهده
                </h2>

                <p className="mt-1 text-xs text-gray-500">
                  نمونه سؤال‌هایی که باعث ایجاد یا تکرار این Gap شده‌اند.
                </p>

              </div>

              {gap.occurrences.length ===
              0 ? (
                <div className="p-10 text-center text-sm text-gray-400">
                  Occurrenceای ثبت نشده است.
                </div>
              ) : (
                <div className="divide-y divide-gray-100">

                  {gap.occurrences.map(
                    (
                      occurrence,
                      index
                    ) => (
                      <article
                        key={
                          occurrence.id
                        }
                        className="p-5"
                      >

                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">

                          <div className="min-w-0">

                            <div className="flex flex-wrap items-center gap-2">

                              <span className="text-xs font-medium text-gray-400">
                                #
                                {
                                  gap
                                    .occurrences
                                    .length -
                                  index
                                }
                              </span>

                              <GapTypeBadge
                                type={
                                  occurrence.reason
                                }
                              />

                            </div>

                            <p className="mt-3 whitespace-pre-wrap text-sm font-medium leading-7 text-gray-900">
                              {
                                occurrence.questionText
                              }
                            </p>

                          </div>

                          <span className="shrink-0 text-xs text-gray-400">
                            {
                              formatPersianDate(
                                occurrence.created
                              )
                            }
                          </span>

                        </div>

                        {/* User metadata */}

                        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-gray-500">

                          <span>
                            کارشناس:{" "}
                            <strong className="font-medium text-gray-700">
                              {
                                occurrence.userName ||
                                "نامشخص"
                              }
                            </strong>
                          </span>

                          {occurrence.employeeCode && (
                            <span>
                              کد:{" "}
                              {
                                occurrence.employeeCode
                              }
                            </span>
                          )}

                          <span>
                            واحد:{" "}
                            {
                              occurrence.departmentName ||
                              "—"
                            }
                          </span>

                          <span>
                            موضوع:{" "}
                            {
                              occurrence.topicName ||
                              "بدون موضوع"
                            }
                          </span>

                        </div>

                        {/* Failed assistant answer */}

                        {occurrence.assistantAnswer && (
                          <div className="mt-4 rounded-xl border border-red-100 bg-red-50/50 p-4">

                            <p className="text-xs font-medium text-red-600">
                              پاسخ قبلی دستیار
                            </p>

                            <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-gray-700">
                              {
                                occurrence.assistantAnswer
                              }
                            </p>

                          </div>
                        )}

                      </article>
                    )
                  )}

                </div>
              )}

            </section>

          </div>

          {/* Sidebar */}

          <aside className="space-y-6">

            {/* Actions */}

            <section className="rounded-2xl border border-gray-200 bg-white p-5">

              <h2 className="font-semibold text-gray-900">
                مدیریت وضعیت
              </h2>

              <p className="mt-2 text-xs leading-6 text-gray-500">
                وضعیت این Gap را مدیریت کنید. حل نهایی Gap بعد از اتصال یک Knowledge Item انجام خواهد شد.
              </p>

              <div className="mt-5">

                <GapActions
                  gapId={
                    gap.id
                  }
                  currentStatus={
                    gap.status
                  }
                  currentIgnoreNote={
                    gap.ignoreNote
                  }
                />

              </div>

            </section>

            {/* Information */}

            <section className="rounded-2xl border border-gray-200 bg-white p-5">

              <h2 className="font-semibold text-gray-900">
                اطلاعات
              </h2>

              <dl className="mt-5 space-y-4 text-sm">

                <InfoRow
                  label="آخرین مشاهده"
                  value={
                    formatPersianDate(
                      gap.lastSeenAt
                    )
                  }
                />

                <InfoRow
                  label="تاریخ ایجاد"
                  value={
                    formatPersianDate(
                      gap.created
                    )
                  }
                />

                <InfoRow
                  label="آخرین تغییر"
                  value={
                    formatPersianDate(
                      gap.updated
                    )
                  }
                />

              </dl>

            </section>

            {/* Ignore note */}

            {gap.status ===
              "ignored" &&
              gap.ignoreNote && (
                <section className="rounded-2xl border border-gray-200 bg-white p-5">

                  <h2 className="font-semibold text-gray-900">
                    دلیل نادیده گرفتن
                  </h2>

                  <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-gray-600">
                    {
                      gap.ignoreNote
                    }
                  </p>

                </section>
              )}

            {/* Resolved data */}

            {gap.status ===
              "resolved" && (
                <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">

                  <h2 className="font-semibold text-emerald-900">
                    این Gap حل شده است
                  </h2>

                  {gap.resolvedKnowledgeItemTitle && (
                    <p className="mt-3 text-sm text-emerald-800">
                      Knowledge:{" "}
                      {
                        gap.resolvedKnowledgeItemTitle
                      }
                    </p>
                  )}

                  {gap.resolvedByName && (
                    <p className="mt-2 text-sm text-emerald-800">
                      توسط:{" "}
                      {
                        gap.resolvedByName
                      }
                    </p>
                  )}

                  {gap.resolvedAt && (
                    <p className="mt-2 text-xs text-emerald-700">
                      {
                        formatPersianDate(
                          gap.resolvedAt
                        )
                      }
                    </p>
                  )}

                </section>
              )}

          </aside>

        </div>

      </div>
    </div>
  );
}

/*
 * ============================================
 * Components
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
    <div className="rounded-2xl border border-gray-200 bg-white p-4 md:p-5">

      <p className="text-xs font-medium text-gray-500">
        {label}
      </p>

      <p className="mt-3 text-2xl font-bold text-gray-900">
        {
          formatNumber(
            value
          )
        }
      </p>

    </div>
  );
}

function InfoRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4">

      <dt className="text-gray-500">
        {label}
      </dt>

      <dd className="text-left font-medium text-gray-800">
        {value}
      </dd>

    </div>
  );
}

function StatusBadge({
  status,
}: {
  status: GapDetailStatus;
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
      className={`rounded-lg px-2.5 py-1 text-xs font-medium ${item.className}`}
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
  type: GapDetailType;
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
    <span className="rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
      {
        labels[type]
      }
    </span>
  );
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