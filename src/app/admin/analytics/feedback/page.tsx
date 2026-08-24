import Link from "next/link";

import {
  redirect,
} from "next/navigation";

import {
  getFeedbackAnalytics,
  normalizeFeedbackRange,
  type FeedbackBreakdownItem,
  type FeedbackRangeKey,
  type RecentNegativeFeedback,
} from "@/lib/analytics/feedback";

import {
  getAdminSession,
} from "@/lib/pocketbase/admin";

type PageProps = {
  searchParams: Promise<{
    range?: string;
  }>;
};

export default async function FeedbackAnalyticsPage({
  searchParams,
}: PageProps) {
  /*
   * ==========================================
   * Security
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
   * Range
   * ==========================================
   */

  const params =
    await searchParams;

  const range =
    normalizeFeedbackRange(
      params.range
    );

  /*
   * ==========================================
   * Analytics
   * ==========================================
   */

  let analytics;

  try {
    analytics =
      await getFeedbackAnalytics(
        range
      );
  } catch (error) {
    console.error(
      "Feedback analytics page failed",
      {
        adminId:
          admin.account.id,

        error:
          getErrorMetadata(
            error
          ),
      }
    );

    return (
      <ErrorState />
    );
  }

  const {
    summary,
  } = analytics;

  return (
    <div
      className="min-h-full bg-slate-50 p-4 sm:p-6 lg:p-8"
      dir="rtl"
    >
      <div className="mx-auto max-w-7xl">

        {/* Header */}

        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">

          <div>

            <p className="text-sm font-bold text-emerald-700">
              تحلیل کیفیت
            </p>

            <h1 className="mt-1 text-2xl font-black text-slate-950 sm:text-3xl">
              کیفیت پاسخ‌های هوش مصنوعی
            </h1>

            <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-500">
              تحلیل بازخورد کارشناسان، موضوعات دارای نارضایتی و مطالب پایگاه دانشی که نیاز به بررسی دارند.
            </p>

          </div>

          <Link
            href="/admin"
            className="inline-flex w-fit items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
          >
            بازگشت به داشبورد
          </Link>

        </div>

        {/* Range */}

        <div className="mt-6 flex flex-wrap gap-2">

          <RangeButton
            value="24h"
            active={
              range ===
              "24h"
            }
          />

          <RangeButton
            value="7d"
            active={
              range ===
              "7d"
            }
          />

          <RangeButton
            value="30d"
            active={
              range ===
              "30d"
            }
          />

          <RangeButton
            value="90d"
            active={
              range ===
              "90d"
            }
          />

          <RangeButton
            value="all"
            active={
              range ===
              "all"
            }
          />

        </div>

        <p className="mt-3 text-xs text-slate-400">
          بازه فعلی:
          {" "}
          {
            analytics.range.label
          }
        </p>

        {/* KPI */}

        <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">

          <StatCard
            label="پاسخ‌های AI"
            value={
              formatNumber(
                summary.assistantMessages
              )
            }
          />

          <StatCard
            label="بازخورد ثبت‌شده"
            value={
              formatNumber(
                summary.totalFeedback
              )
            }
          />

          <StatCard
            label="نرخ مشارکت"
            value={
              formatPercent(
                summary.coverageRate
              )
            }
            hint="درصد پاسخ‌هایی که رأی گرفته‌اند"
          />

          <StatCard
            label="رضایت"
            value={
              formatPercent(
                summary.satisfactionRate
              )
            }
          />

          <StatCard
            label="رأی مثبت"
            value={`👍 ${formatNumber(
              summary.positive
            )}`}
          />

          <StatCard
            label="رأی منفی"
            value={`👎 ${formatNumber(
              summary.negative
            )}`}
            hint={`${formatNumber(
              summary.comments
            )} توضیح متنی`}
          />

        </div>

        {/* Overall quality */}

        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">

          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">

            <div>

              <h2 className="text-lg font-black text-slate-900">
                رضایت کلی
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                نسبت رأی مثبت به کل Feedbackهای ثبت‌شده
              </p>

            </div>

            <p className="text-3xl font-black text-slate-950">
              {
                formatPercent(
                  summary.satisfactionRate
                )
              }
            </p>

          </div>

          <div className="mt-5 h-3 overflow-hidden rounded-full bg-rose-100">

            <div
              className="h-full rounded-full bg-emerald-500"
              style={{
                width:
                  `${Math.min(
                    100,
                    Math.max(
                      0,
                      summary.satisfactionRate
                    )
                  )}%`,
              }}
            />

          </div>

          <div className="mt-3 flex items-center justify-between text-xs">

            <span className="font-bold text-emerald-700">
              👍{" "}
              {
                formatNumber(
                  summary.positive
                )
              }{" "}
              مثبت
            </span>

            <span className="font-bold text-rose-700">
              👎{" "}
              {
                formatNumber(
                  summary.negative
                )
              }{" "}
              منفی
            </span>

          </div>

        </section>

        {/* Breakdowns */}

        <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">

          <BreakdownCard
            title="کیفیت به تفکیک موضوع"
            description="موضوعاتی که بیشترین Feedback را دریافت کرده‌اند."
            items={
              analytics.topics
            }
            emptyText="هنوز Feedback موضوعی وجود ندارد."
          />

          <BreakdownCard
            title="کیفیت به تفکیک منبع"
            description="عملکرد مطالب Knowledge Base در پاسخ‌های دارای Feedback."
            items={
              analytics.sources
            }
            emptyText="هنوز Feedbackی برای پاسخ‌های دارای منبع وجود ندارد."
          />

        </div>

        {/* Employees */}

        <div className="mt-6">

          <BreakdownCard
            title="بازخورد به تفکیک کارشناس"
            description="نحوه ارزیابی پاسخ‌های AI توسط کارشناسان مختلف."
            items={
              analytics.employees
            }
            emptyText="هنوز Feedback کارشناسی ثبت نشده است."
            showTop={
              12
            }
          />

        </div>

        {/* Negative feedback */}

        <section className="mt-6 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">

          <div className="border-b border-slate-200 px-5 py-5 sm:px-6">

            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">

              <div>

                <h2 className="text-lg font-black text-slate-900">
                  پاسخ‌های نیازمند بررسی
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  آخرین پاسخ‌هایی که از کارشناسان رأی منفی گرفته‌اند.
                </p>

              </div>

              <span className="text-xs font-bold text-rose-600">
                {
                  formatNumber(
                    analytics.recentNegative.length
                  )
                }{" "}
                مورد اخیر
              </span>

            </div>

          </div>

          {analytics
            .recentNegative
            .length ===
          0 ? (

            <div className="px-6 py-14 text-center">

              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-xl">
                👍
              </div>

              <h3 className="mt-4 font-black text-slate-900">
                رأی منفی وجود ندارد
              </h3>

              <p className="mt-2 text-sm text-slate-500">
                در بازه انتخاب‌شده پاسخ دارای Feedback منفی ثبت نشده است.
              </p>

            </div>

          ) : (

            <div className="divide-y divide-slate-100">

              {analytics.recentNegative.map(
                (
                  item
                ) => (
                  <NegativeFeedbackCard
                    key={
                      item.feedbackId
                    }
                    item={
                      item
                    }
                  />
                )
              )}

            </div>

          )}

        </section>

      </div>
    </div>
  );
}

/*
 * ============================================
 * Range Button
 * ============================================
 */

function RangeButton({
  value,
  active,
}: {
  value:
    FeedbackRangeKey;

  active:
    boolean;
}) {
  const labels: Record<
    FeedbackRangeKey,
    string
  > = {
    "24h":
      "۲۴ ساعت",

    "7d":
      "۷ روز",

    "30d":
      "۳۰ روز",

    "90d":
      "۹۰ روز",

    all:
      "همه",
  };

  return (
    <Link
      href={`/admin/analytics/feedback?range=${value}`}
      className={`rounded-xl px-4 py-2.5 text-sm font-bold transition ${
        active
          ? "bg-slate-950 text-white"
          : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
      }`}
    >
      {
        labels[value]
      }
    </Link>
  );
}

/*
 * ============================================
 * Stat Card
 * ============================================
 */

function StatCard({
  label,
  value,
  hint,
}: {
  label:
    string;

  value:
    string;

  hint?:
    string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">

      <p className="text-xs font-bold text-slate-500">
        {
          label
        }
      </p>

      <p className="mt-3 text-2xl font-black text-slate-950">
        {
          value
        }
      </p>

      {hint && (
        <p className="mt-2 text-[11px] leading-5 text-slate-400">
          {
            hint
          }
        </p>
      )}

    </div>
  );
}

/*
 * ============================================
 * Breakdown
 * ============================================
 */

function BreakdownCard({
  title,
  description,
  items,
  emptyText,
  showTop = 10,
}: {
  title:
    string;

  description:
    string;

  items:
    FeedbackBreakdownItem[];

  emptyText:
    string;

  showTop?:
    number;
}) {
  const visibleItems =
    items.slice(
      0,
      showTop
    );

  return (
    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">

      <div className="border-b border-slate-200 px-5 py-5">

        <h2 className="font-black text-slate-900">
          {
            title
          }
        </h2>

        <p className="mt-1 text-xs leading-6 text-slate-500">
          {
            description
          }
        </p>

      </div>

      {visibleItems.length ===
      0 ? (

        <div className="px-5 py-12 text-center text-sm text-slate-400">
          {
            emptyText
          }
        </div>

      ) : (

        <div className="divide-y divide-slate-100">

          {visibleItems.map(
            (
              item
            ) => (

              <div
                key={
                  item.id
                }
                className="p-4"
              >

                <div className="flex items-start justify-between gap-4">

                  <div className="min-w-0">

                    <p className="truncate text-sm font-black text-slate-800">
                      {
                        item.name
                      }
                    </p>

                    <p className="mt-1 text-xs text-slate-400">
                      {
                        formatNumber(
                          item.total
                        )
                      }{" "}
                      بازخورد
                      {" • "}
                      👍{" "}
                      {
                        formatNumber(
                          item.up
                        )
                      }
                      {" • "}
                      👎{" "}
                      {
                        formatNumber(
                          item.down
                        )
                      }
                    </p>

                  </div>

                  <span
                    className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-black ${
                      item.satisfactionRate >=
                      80
                        ? "bg-emerald-50 text-emerald-700"
                        : item.satisfactionRate >=
                            60
                          ? "bg-amber-50 text-amber-700"
                          : "bg-rose-50 text-rose-700"
                    }`}
                  >
                    {
                      formatPercent(
                        item.satisfactionRate
                      )
                    }
                  </span>

                </div>

                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-rose-100">

                  <div
                    className="h-full rounded-full bg-emerald-500"
                    style={{
                      width:
                        `${Math.min(
                          100,
                          Math.max(
                            0,
                            item.satisfactionRate
                          )
                        )}%`,
                    }}
                  />

                </div>

              </div>

            )
          )}

        </div>

      )}

    </section>
  );
}

/*
 * ============================================
 * Negative Feedback Card
 * ============================================
 */

function NegativeFeedbackCard({
  item,
}: {
  item:
    RecentNegativeFeedback;
}) {
  return (
    <article className="p-5 sm:p-6">

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">

        <div className="min-w-0 flex-1">

          <div className="flex flex-wrap items-center gap-2">

            <span className="rounded-lg bg-rose-50 px-2.5 py-1 text-xs font-black text-rose-700">
              👎 پاسخ نامطلوب
            </span>

            {item.topicName && (
              <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
                {
                  item.topicName
                }
              </span>
            )}

          </div>

          {/* Question */}

          <div className="mt-4">

            <p className="text-xs font-black text-slate-400">
              سؤال کارشناس
            </p>

            <p className="mt-1 text-sm font-bold leading-7 text-slate-900">
              {
                truncate(
                  item.question ||
                    "متن سؤال در دسترس نیست.",
                  350
                )
              }
            </p>

          </div>

          {/* Answer */}

          <div className="mt-4 rounded-2xl bg-slate-50 p-4">

            <p className="text-xs font-black text-slate-500">
              پاسخ AI
            </p>

            <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-700">
              {
                truncate(
                  item.answer,
                  700
                )
              }
            </p>

          </div>

          {/* User Comment */}

          {item.comment && (
            <div className="mt-3 rounded-2xl border border-rose-100 bg-rose-50 p-4">

              <p className="text-xs font-black text-rose-700">
                توضیح کارشناس
              </p>

              <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-rose-900">
                {
                  item.comment
                }
              </p>

            </div>
          )}

          {/* Sources */}

          {item.sources.length >
            0 && (
            <div className="mt-4">

              <p className="text-xs font-black text-slate-400">
                منابع پاسخ
              </p>

              <div className="mt-2 flex flex-wrap gap-2">

                {item.sources.map(
                  (
                    source
                  ) => (
                    <span
                      key={
                        source.id
                      }
                      className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700"
                    >
                      {
                        source.title
                      }
                    </span>
                  )
                )}

              </div>

            </div>
          )}

        </div>

        {/* Metadata */}

        <div className="shrink-0 rounded-2xl border border-slate-100 bg-white p-4 text-xs text-slate-500 lg:w-56">

          <p>
            کارشناس:
            {" "}
            <span className="font-bold text-slate-700">
              {
                item.userName
              }
            </span>
          </p>

          {item.employeeCode && (
            <p className="mt-2">
              کد:
              {" "}
              {
                item.employeeCode
              }
            </p>
          )}

          {item.departmentName && (
            <p className="mt-2">
              واحد:
              {" "}
              {
                item.departmentName
              }
            </p>
          )}

          <p className="mt-2">
            زمان:
            {" "}
            {
              formatPersianDate(
                item.created
              )
            }
          </p>

          {item.userId && (
            <Link
              href={`/admin/accounts/${item.userId}`}
              className="mt-4 inline-block font-black text-emerald-700 hover:text-emerald-800"
            >
              مشاهده کارشناس
            </Link>
          )}

        </div>

      </div>

    </article>
  );
}

/*
 * ============================================
 * Error State
 * ============================================
 */

function ErrorState() {
  return (
    <div
      className="min-h-full bg-slate-50 p-6"
      dir="rtl"
    >
      <div className="mx-auto max-w-xl rounded-3xl border border-rose-200 bg-white p-8 text-center shadow-sm">

        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50 text-xl">
          !
        </div>

        <h1 className="mt-4 text-xl font-black text-slate-900">
          دریافت گزارش کیفیت ناموفق بود
        </h1>

        <p className="mt-2 text-sm leading-7 text-slate-500">
          اطلاعات Feedback در حال حاضر قابل دریافت نیست. دوباره صفحه را باز کنید.
        </p>

        <Link
          href="/admin/analytics/feedback"
          className="mt-5 inline-flex rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white"
        >
          تلاش مجدد
        </Link>

      </div>
    </div>
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
  ).format(
    value
  );
}

function formatPercent(
  value: number
) {
  return `${new Intl.NumberFormat(
    "fa-IR",
    {
      maximumFractionDigits:
        1,
    }
  ).format(value)}٪`;
}

function formatPersianDate(
  value: string
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

      timeZone:
        process.env
          .APP_TIMEZONE ||
        "Asia/Tehran",
    }
  ).format(
    date
  );
}

function truncate(
  value: string,
  maxLength: number
) {
  const normalized =
    value.trim();

  if (
    normalized.length <=
    maxLength
  ) {
    return normalized;
  }

  return `${normalized
    .slice(
      0,
      maxLength
    )
    .trim()}...`;
}

function getErrorMetadata(
  error: unknown
) {
  if (
    typeof error !==
      "object" ||
    error === null
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
      message?: unknown;
      status?: unknown;
    };

  return {
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
  };
}