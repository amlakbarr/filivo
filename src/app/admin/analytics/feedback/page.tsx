import Link from "next/link";

import FeedbackReviewControls from "@/components/admin/analytics/FeedbackReviewControls";

import {
  getFeedbackAnalytics,
  normalizeFeedbackRange,
  normalizeFeedbackReviewFilter,
  type FeedbackAnalytics,
  type FeedbackBreakdownItem,
  type FeedbackRangeKey,
  type FeedbackReasonBreakdownItem,
  type RecentNegativeFeedback,
} from "@/lib/analytics/feedback";

type PageProps = {
  searchParams:
    Promise<{
      range?:
        string |
        string[];

      review?:
        string |
        string[];
    }>;
};

const RANGE_OPTIONS: Array<{
  key:
    FeedbackRangeKey;

  label:
    string;
}> = [
  {
    key:
      "24h",

    label:
      "۲۴ ساعت",
  },
  {
    key:
      "7d",

    label:
      "۷ روز",
  },
  {
    key:
      "30d",

    label:
      "۳۰ روز",
  },
  {
    key:
      "90d",

    label:
      "۹۰ روز",
  },
  {
    key:
      "all",

    label:
      "کل دوره",
  },
];

const REVIEW_OPTIONS = [
  {
    key:
      "all" as const,

    label:
      "همه",
  },
  {
    key:
      "new" as const,

    label:
      "جدید",
  },
  {
    key:
      "in_progress" as const,

    label:
      "در حال بررسی",
  },
  {
    key:
      "resolved" as const,

    label:
      "رفع‌شده",
  },
  {
    key:
      "ignored" as const,

    label:
      "نادیده گرفته‌شده",
  },
];

export default async function FeedbackAnalyticsPage({
  searchParams,
}: PageProps) {
  const params =
    await searchParams;

  const rawRange =
    typeof params.range ===
    "string"
      ? params.range
      : undefined;

  const range =
    normalizeFeedbackRange(
      rawRange
    );

  const rawReview =
    typeof params.review ===
    "string"
      ? params.review
      : undefined;

  const review =
    normalizeFeedbackReviewFilter(
      rawReview
    );

  let analytics:
    FeedbackAnalytics |
    null =
      null;

  let loadError =
    "";

  try {
    analytics =
      await getFeedbackAnalytics(
        range,
        review
      );
  } catch (error) {
    console.error(
      "Feedback analytics page load failed",
      {
        range,

        review,

        error:
          getErrorMetadata(
            error
          ),
      }
    );

    loadError =
      "دریافت گزارش کیفیت پاسخ‌ها انجام نشد. دوباره تلاش کنید.";
  }

  return (
    <main
      dir="rtl"
      className="mx-auto w-full max-w-[1500px] space-y-6 px-4 py-6 sm:px-6 lg:px-8"
    >
      {/* =====================================
          Header
          ===================================== */}

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">

        <div className="flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">

          <div>

            <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500">

              <Link
                href="/admin/analytics"
                className="transition hover:text-slate-900"
              >
                تحلیل‌ها
              </Link>

              <span>
                /
              </span>

              <span className="text-emerald-700">
                کیفیت پاسخ‌ها
              </span>

            </div>

            <h1 className="mt-3 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">
              گزارش Feedback پاسخ‌های AI
            </h1>

            <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-500">
              رضایت کارشناسان، دلایل رأی منفی، Topicهای پرتکرار و پاسخ‌هایی که بیشترین نیاز به بررسی دارند.
            </p>

          </div>

          <Link
            href="/admin/analytics"
            className="inline-flex w-fit items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-black text-slate-700 transition hover:bg-slate-50"
          >
            بازگشت به داشبورد
          </Link>

        </div>

      </section>

      {/* =====================================
          Range
          ===================================== */}

      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">

          <div>

            <p className="text-xs font-black text-slate-700">
              بازه گزارش
            </p>

            <p className="mt-1 text-xs leading-6 text-slate-400">
              تمام شاخص‌های این صفحه بر اساس زمان ثبت Feedback محاسبه می‌شوند.
            </p>

          </div>

          <div className="flex flex-wrap gap-2">

            {RANGE_OPTIONS.map(
              (
                option
              ) => (
                <Link
                  key={
                    option.key
                  }
                  href={`/admin/analytics/feedback?range=${option.key}&review=${review}`}
                  className={`rounded-xl px-3 py-2 text-xs font-black transition ${
                    option.key ===
                    range
                      ? "bg-slate-950 text-white shadow-sm"
                      : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {
                    option.label
                  }
                </Link>
              )
            )}

          </div>

        </div>

      </section>

      {/* =====================================
          Review status filter
          ===================================== */}

      {analytics && (

        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">

          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">

            <div>

              <p className="text-xs font-black text-slate-700">
                وضعیت رسیدگی Feedback منفی
              </p>

              <p className="mt-1 text-xs leading-6 text-slate-400">
                فیلتر فقط روی فهرست Feedbackهای منفی نیازمند بررسی اعمال می‌شود.
              </p>

            </div>

            <div className="flex flex-wrap gap-2">

              {REVIEW_OPTIONS.map(
                (
                  option
                ) => {
                  const count =
                    option.key ===
                    "all"
                      ? analytics.reviewSummary.all
                      : option.key ===
                          "new"
                        ? analytics.reviewSummary.new
                        : option.key ===
                            "in_progress"
                          ? analytics.reviewSummary.inProgress
                          : option.key ===
                              "resolved"
                            ? analytics.reviewSummary.resolved
                            : analytics.reviewSummary.ignored;

                  return (
                    <Link
                      key={
                        option.key
                      }
                      href={`/admin/analytics/feedback?range=${range}&review=${option.key}`}
                      className={`rounded-xl border px-3 py-2 text-xs font-black transition ${
                        review ===
                        option.key
                          ? "border-slate-950 bg-slate-950 text-white"
                          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {
                        option.label
                      }
                      {" · "}
                      {
                        formatInteger(
                          count
                        )
                      }
                    </Link>
                  );
                }
              )}

            </div>

          </div>

        </section>

      )}

      {/* =====================================
          Error
          ===================================== */}

      {loadError && (

        <section className="rounded-3xl border border-rose-200 bg-rose-50 p-5 text-sm font-bold leading-7 text-rose-700">
          {
            loadError
          }
        </section>

      )}

      {analytics && (
        <>

          {/* =================================
              Summary
              ================================= */}

          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">

            <SummaryCard
              title="نرخ رضایت"
              value={
                analytics
                  .summary
                  .totalFeedback >
                0
                  ? formatPercent(
                      analytics
                        .summary
                        .satisfactionRate
                    )
                  : "بدون داده"
              }
              detail={`${formatInteger(
                analytics
                  .summary
                  .positive
              )} مثبت از ${formatInteger(
                analytics
                  .summary
                  .totalFeedback
              )} بازخورد`}
              tone={
                satisfactionTone(
                  analytics
                    .summary
                    .satisfactionRate,
                  analytics
                    .summary
                    .totalFeedback
                )
              }
            />

            <SummaryCard
              title="نرخ مشارکت"
              value={
                formatPercent(
                  analytics
                    .summary
                    .coverageRate
                )
              }
              detail={`${formatInteger(
                analytics
                  .summary
                  .totalFeedback
              )} بازخورد برای ${formatInteger(
                analytics
                  .summary
                  .assistantMessages
              )} پاسخ AI`}
              tone="neutral"
            />

            <SummaryCard
              title="رأی مثبت"
              value={`👍 ${formatInteger(
                analytics
                  .summary
                  .positive
              )}`}
              detail="پاسخ مفید بوده"
              tone="positive"
            />

            <SummaryCard
              title="رأی منفی"
              value={`👎 ${formatInteger(
                analytics
                  .summary
                  .negative
              )}`}
              detail={`${formatInteger(
                analytics
                  .summary
                  .comments
              )} بازخورد دارای توضیح`}
              tone={
                analytics
                  .summary
                  .negative >
                0
                  ? "negative"
                  : "neutral"
              }
            />

          </section>

          {/* =================================
              Feedback composition
              ================================= */}

          <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">

            <div className="border-b border-slate-100 px-5 py-5 sm:px-6">

              <p className="text-xs font-black text-emerald-700">
                وضعیت کلی
              </p>

              <h2 className="mt-1 text-lg font-black text-slate-950">
                ترکیب Feedback
              </h2>

              <p className="mt-1 text-sm leading-6 text-slate-500">
                {
                  analytics
                    .range
                    .label
                }
              </p>

            </div>

            <div className="p-5 sm:p-6">

              {analytics
                .summary
                .totalFeedback >
              0 ? (

                <div className="space-y-5">

                  <div>

                    <div className="mb-2 flex items-center justify-between gap-4 text-xs">

                      <span className="font-bold text-slate-500">
                        مثبت در برابر منفی
                      </span>

                      <span className="font-black text-slate-800">
                        {
                          formatPercent(
                            analytics
                              .summary
                              .satisfactionRate
                          )
                        }{" "}
                        مثبت
                      </span>

                    </div>

                    <div className="flex h-3 overflow-hidden rounded-full bg-rose-100">

                      <div
                        className="h-full bg-emerald-500"
                        style={{
                          width:
                            `${clampPercent(
                              analytics
                                .summary
                                .satisfactionRate
                            )}%`,
                        }}
                      />

                    </div>

                  </div>

                  <div className="grid gap-4 sm:grid-cols-3">

                    <MiniMetric
                      label="کل Feedback"
                      value={
                        formatInteger(
                          analytics
                            .summary
                            .totalFeedback
                        )
                      }
                    />

                    <MiniMetric
                      label="منفی دارای دلیل"
                      value={`${formatInteger(
                        analytics
                          .summary
                          .negativeWithReasons
                      )} مورد`}
                    />

                    <MiniMetric
                      label="پوشش دلیل در 👎"
                      value={
                        formatPercent(
                          analytics
                            .summary
                            .negativeReasonCoverageRate
                        )
                      }
                    />

                  </div>

                </div>

              ) : (

                <EmptyState
                  message="در این بازه هنوز Feedback ثبت نشده است."
                />

              )}

            </div>

          </section>

          {/* =================================
              Negative Reasons
              ================================= */}

          <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">

            <div className="border-b border-slate-100 px-5 py-5 sm:px-6">

              <p className="text-xs font-black text-rose-700">
                دلایل نارضایتی
              </p>

              <h2 className="mt-1 text-lg font-black text-slate-950">
                چرا پاسخ‌ها رأی منفی گرفته‌اند؟
              </h2>

              <p className="mt-1 text-sm leading-6 text-slate-500">
                هر Feedback منفی می‌تواند حداکثر ۳ دلیل داشته باشد؛ بنابراین مجموع درصد دلیل‌ها ممکن است از ۱۰۰٪ بیشتر شود.
              </p>

            </div>

            <div className="p-5 sm:p-6">

              {analytics
                .summary
                .negative >
              0 ? (

                <div className="grid gap-4 lg:grid-cols-2">

                  {analytics
                    .negativeReasons
                    .map(
                      (
                        reason
                      ) => (
                        <NegativeReasonCard
                          key={
                            reason.key
                          }
                          item={
                            reason
                          }
                        />
                      )
                    )}

                </div>

              ) : (

                <EmptyState
                  message="در این بازه رأی منفی ثبت نشده است."
                />

              )}

            </div>

          </section>

          {/* =================================
              Breakdowns
              ================================= */}

          <section className="grid gap-6 xl:grid-cols-3">

            <BreakdownPanel
              title="کیفیت بر اساس Topic"
              description="موضوع‌هایی که بیشترین Feedback را دریافت کرده‌اند."
              items={
                analytics
                  .topics
              }
              emptyMessage="هنوز داده Topic برای Feedbackها وجود ندارد."
            />

            <BreakdownPanel
              title="کیفیت منابع دانش"
              description="منابعی که در پاسخ‌های دارای Feedback استفاده شده‌اند."
              items={
                analytics
                  .sources
              }
              emptyMessage="هنوز Feedback قابل انتساب به منبع دانش وجود ندارد."
            />

            <BreakdownPanel
              title="کیفیت بر اساس کارشناس"
              description="الگوی رضایت در Feedback ثبت‌شده توسط کارشناسان."
              items={
                analytics
                  .employees
              }
              emptyMessage="هنوز Feedback کافی برای نمایش کارشناسان وجود ندارد."
            />

          </section>

          {/* =================================
              Recent Negative
              ================================= */}

          <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">

            <div className="border-b border-slate-100 px-5 py-5 sm:px-6">

              <p className="text-xs font-black text-rose-700">
                نیازمند بررسی
              </p>

              <h2 className="mt-1 text-lg font-black text-slate-950">
                آخرین Feedbackهای منفی — {analytics.reviewFilter.label}
              </h2>

              <p className="mt-1 text-sm leading-6 text-slate-500">
                حداکثر ۲۰ مورد اخیر مطابق وضعیت رسیدگی انتخاب‌شده نمایش داده می‌شود.
              </p>

            </div>

            <div className="p-5 sm:p-6">

              {analytics
                .recentNegative
                .length >
              0 ? (

                <div className="space-y-4">

                  {analytics
                    .recentNegative
                    .map(
                      (
                        item
                      ) => (
                        <RecentNegativeCard
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

              ) : (

                <EmptyState
                  message="Feedback منفی برای نمایش وجود ندارد."
                />

              )}

            </div>

          </section>

        </>
      )}

    </main>
  );
}

/*
 * ============================================
 * Summary Card
 * ============================================
 */

function SummaryCard({
  title,
  value,
  detail,
  tone,
}: {
  title:
    string;

  value:
    string;

  detail:
    string;

  tone:
    "positive" |
    "negative" |
    "warning" |
    "neutral";
}) {
  const toneClass =
    tone ===
    "positive"
      ? "border-emerald-200 bg-emerald-50/70"
      : tone ===
          "negative"
        ? "border-rose-200 bg-rose-50/70"
        : tone ===
            "warning"
          ? "border-amber-200 bg-amber-50/70"
          : "border-slate-200 bg-white";

  const valueClass =
    tone ===
    "positive"
      ? "text-emerald-800"
      : tone ===
          "negative"
        ? "text-rose-800"
        : tone ===
            "warning"
          ? "text-amber-800"
          : "text-slate-950";

  return (
    <div
      className={`rounded-3xl border p-5 shadow-sm ${toneClass}`}
    >

      <p className="text-xs font-black text-slate-500">
        {
          title
        }
      </p>

      <p
        className={`mt-3 text-2xl font-black ${valueClass}`}
      >
        {
          value
        }
      </p>

      <p className="mt-2 text-xs leading-6 text-slate-500">
        {
          detail
        }
      </p>

    </div>
  );
}

/*
 * ============================================
 * Mini Metric
 * ============================================
 */

function MiniMetric({
  label,
  value,
}: {
  label:
    string;

  value:
    string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">

      <p className="text-xs font-bold text-slate-500">
        {
          label
        }
      </p>

      <p className="mt-2 text-lg font-black text-slate-900">
        {
          value
        }
      </p>

    </div>
  );
}

/*
 * ============================================
 * Negative Reason Card
 * ============================================
 */

function NegativeReasonCard({
  item,
}: {
  item:
    FeedbackReasonBreakdownItem;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 p-4 sm:p-5">

      <div className="flex items-start justify-between gap-4">

        <div>

          <h3 className="text-sm font-black text-slate-900">
            {
              item.label
            }
          </h3>

          <p className="mt-1 text-xs text-slate-400">
            {
              formatInteger(
                item.count
              )
            }{" "}
            رأی منفی
          </p>

        </div>

        <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-black text-rose-700">
          {
            formatPercent(
              item.percentage
            )
          }
        </div>

      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">

        <div
          className="h-full rounded-full bg-rose-400"
          style={{
            width:
              `${clampPercent(
                item.percentage
              )}%`,
          }}
        />

      </div>

      <div className="mt-4 border-t border-slate-100 pt-4">

        <p className="text-[11px] font-black text-slate-500">
          Topicهای پرتکرار
        </p>

        {item
          .topics
          .length >
        0 ? (

          <div className="mt-2 flex flex-wrap gap-2">

            {item
              .topics
              .map(
                (
                  topic
                ) => (
                  <span
                    key={
                      `${item.key}-${topic.id}`
                    }
                    className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600"
                  >
                    {
                      topic.name
                    }
                    {" · "}
                    {
                      formatInteger(
                        topic.count
                      )
                    }
                  </span>
                )
              )}

          </div>

        ) : (

          <p className="mt-2 text-xs text-slate-400">
            داده‌ای ثبت نشده است.
          </p>

        )}

      </div>

    </article>
  );
}

/*
 * ============================================
 * Breakdown Panel
 * ============================================
 */

function BreakdownPanel({
  title,
  description,
  items,
  emptyMessage,
}: {
  title:
    string;

  description:
    string;

  items:
    FeedbackBreakdownItem[];

  emptyMessage:
    string;
}) {
  return (
    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">

      <div className="border-b border-slate-100 px-5 py-5">

        <h2 className="text-base font-black text-slate-950">
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

      <div className="p-5">

        {items.length >
        0 ? (

          <div className="space-y-3">

            {items.map(
              (
                item
              ) => (
                <BreakdownRow
                  key={
                    item.id
                  }
                  item={
                    item
                  }
                />
              )
            )}

          </div>

        ) : (

          <EmptyState
            message={
              emptyMessage
            }
          />

        )}

      </div>

    </section>
  );
}

/*
 * ============================================
 * Breakdown Row
 * ============================================
 */

function BreakdownRow({
  item,
}: {
  item:
    FeedbackBreakdownItem;
}) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3.5">

      <div className="flex items-start justify-between gap-4">

        <div className="min-w-0">

          <p
            title={
              item.name
            }
            className="truncate text-xs font-black text-slate-800"
          >
            {
              item.name
            }
          </p>

          <p className="mt-1 text-[11px] text-slate-400">
            {
              formatInteger(
                item.total
              )
            }{" "}
            بازخورد
            {" · "}
            👍{" "}
            {
              formatInteger(
                item.up
              )
            }
            {" · "}
            👎{" "}
            {
              formatInteger(
                item.down
              )
            }
          </p>

        </div>

        <span
          className={`shrink-0 rounded-lg px-2 py-1 text-[11px] font-black ${
            item.negativeRate >=
            50
              ? "bg-rose-100 text-rose-700"
              : item.satisfactionRate >=
                  80
                ? "bg-emerald-100 text-emerald-700"
                : "bg-slate-200 text-slate-600"
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
              `${clampPercent(
                item.satisfactionRate
              )}%`,
          }}
        />

      </div>

    </div>
  );
}

/*
 * ============================================
 * Recent Negative Card
 * ============================================
 */

function RecentNegativeCard({
  item,
}: {
  item:
    RecentNegativeFeedback;
}) {
  return (
    <article className="rounded-2xl border border-rose-100 bg-rose-50/30 p-4 sm:p-5">

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">

        <div>

          <p className="text-sm font-black text-slate-900">
            {
              item.userName
            }
          </p>

          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400">

            {item.employeeCode && (
              <span>
                کد: {
                  item.employeeCode
                }
              </span>
            )}

            {item.departmentName && (
              <span>
                {
                  item.departmentName
                }
              </span>
            )}

            {item.topicName && (
              <span>
                Topic: {
                  item.topicName
                }
              </span>
            )}

          </div>

        </div>

        <time className="shrink-0 text-[11px] text-slate-400">
          {
            formatDateTime(
              item.created
            )
          }
        </time>

      </div>

      {item
        .reasons
        .length >
      0 && (

        <div className="mt-4 flex flex-wrap gap-2">

          {item
            .reasons
            .map(
              (
                reason
              ) => (
                <span
                  key={
                    reason
                  }
                  className="rounded-full border border-rose-200 bg-white px-2.5 py-1 text-[11px] font-bold text-rose-700"
                >
                  {
                    feedbackReasonLabel(
                      reason
                    )
                  }
                </span>
              )
            )}

        </div>

      )}

      <div className="mt-4 grid gap-3 lg:grid-cols-2">

        <div className="rounded-xl border border-slate-200 bg-white p-3.5">

          <p className="text-[11px] font-black text-slate-500">
            سؤال
          </p>

          <p className="mt-2 whitespace-pre-wrap text-xs leading-6 text-slate-700">
            {
              item.question ||
              "—"
            }
          </p>

        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-3.5">

          <p className="text-[11px] font-black text-slate-500">
            پاسخ AI
          </p>

          <p className="mt-2 whitespace-pre-wrap text-xs leading-6 text-slate-700">
            {
              item.answer ||
              "—"
            }
          </p>

        </div>

      </div>

      {item.comment && (

        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3.5">

          <p className="text-[11px] font-black text-amber-700">
            توضیح کارشناس
          </p>

          <p className="mt-2 whitespace-pre-wrap text-xs leading-6 text-amber-900">
            {
              item.comment
            }
          </p>

        </div>

      )}

      {item.resolvedKnowledgeItem && (

        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5">

          <p className="text-[11px] font-black text-emerald-700">
            Knowledge اصلاحی
          </p>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">

            <span className="text-xs font-bold text-emerald-900">
              {
                item.resolvedKnowledgeItem.title
              }
            </span>

            <Link
              href={`/admin/knowledge/${item.resolvedKnowledgeItem.id}/edit`}
              className="rounded-lg bg-emerald-700 px-3 py-1.5 text-[11px] font-black text-white transition hover:bg-emerald-800"
            >
              مشاهده مطلب
            </Link>

          </div>

        </div>

      )}

      {item.sources.length >
      0 && (

        <div className="mt-3">

          <p className="text-[11px] font-black text-slate-500">
            منابع استفاده‌شده
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
                  className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600"
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

      <FeedbackReviewControls
        feedbackId={
          item.feedbackId
        }
        initialStatus={
          item.reviewStatus
        }
        initialNote={
          item.reviewNote
        }
        reviewedAt={
          item.reviewedAt
        }
      />

    </article>
  );
}

/*
 * ============================================
 * Empty State
 * ============================================
 */

function EmptyState({
  message,
}: {
  message:
    string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-xs font-bold leading-6 text-slate-400">
      {
        message
      }
    </div>
  );
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
  return Math.max(
    0,
    Number.isFinite(
      value
    )
      ? Math.round(
          value
        )
      : 0
  ).toLocaleString(
    "fa-IR"
  );
}

function formatPercent(
  value:
    number
) {
  const safeValue =
    Number.isFinite(
      value
    )
      ? value
      : 0;

  return `${safeValue.toLocaleString(
    "fa-IR",
    {
      maximumFractionDigits:
        1,
    }
  )}٪`;
}

function formatDateTime(
  value:
    string
) {
  const timestamp =
    Date.parse(
      value
    );

  if (
    !Number.isFinite(
      timestamp
    )
  ) {
    return value ||
      "—";
  }

  return new Intl.DateTimeFormat(
    "fa-IR",
    {
      dateStyle:
        "medium",

      timeStyle:
        "short",
    }
  ).format(
    new Date(
      timestamp
    )
  );
}

function clampPercent(
  value:
    number
) {
  if (
    !Number.isFinite(
      value
    )
  ) {
    return 0;
  }

  return Math.max(
    0,
    Math.min(
      100,
      value
    )
  );
}

function satisfactionTone(
  value:
    number,

  total:
    number
):
  | "positive"
  | "negative"
  | "warning"
  | "neutral" {
  if (
    total <=
    0
  ) {
    return "neutral";
  }

  if (
    value >=
    85
  ) {
    return "positive";
  }

  if (
    value <
    60
  ) {
    return "negative";
  }

  return "warning";
}

function feedbackReasonLabel(
  reason:
    RecentNegativeFeedback["reasons"][number]
) {
  switch (
    reason
  ) {
    case "incorrect":
      return "پاسخ اشتباه است";

    case "incomplete":
      return "پاسخ ناقص است";

    case "outdated":
      return "اطلاعات قدیمی است";

    case "irrelevant":
      return "پاسخ نامرتبط است";

    case "unclear":
      return "پاسخ مبهم است";

    case "source_issue":
      return "مشکل در منبع یا اطلاعات";

    case "other":
      return "مورد دیگر";
  }
}

/*
 * ============================================
 * Error Metadata
 * ============================================
 */

function getErrorMetadata(
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
  };
}
