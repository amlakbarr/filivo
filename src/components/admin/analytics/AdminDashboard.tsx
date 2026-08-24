"use client";

import Link from "next/link";

import {
  useRouter,
  useSearchParams,
} from "next/navigation";

import {
  FormEvent,
  useEffect,
  useState,
} from "react";

import AnalyticsChart from "@/components/admin/analytics/AnalyticsChart";

import DateRangeControls from "@/components/admin/analytics/DateRangeControls";

import type {
  AnalyticsDashboard as DashboardData,
  AnalyticsMetric,
} from "@/types/analytics";

type DashboardResponse =
  | {
      success: true;
      dashboard: DashboardData;
    }
  | {
      success: false;
      message: string;
    };

export default function AdminDashboard() {
  const searchParams =
    useSearchParams();

  const router =
    useRouter();

  const queryString =
    searchParams.toString();

  const [
    data,
    setData,
  ] =
    useState<DashboardData | null>(
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

  const [
    employeeSearch,
    setEmployeeSearch,
  ] =
    useState(
      searchParams.get(
        "employeeSearch"
      ) ||
        ""
    );

  /*
   * ==========================================
   * Load Dashboard
   * ==========================================
   */

  useEffect(() => {
    let cancelled =
      false;

    fetch(
      `/api/admin/analytics/dashboard?${queryString}`,
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
            (await response.json()) as DashboardResponse,
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
                : "دریافت داشبورد ناموفق بود."
            );
          }

          if (
            !cancelled
          ) {
            setData(
              body.dashboard
            );

            setError(
              ""
            );
          }
        }
      )
      .catch(
        (
          reason: unknown
        ) => {
          if (
            !cancelled
          ) {
            setError(
              reason instanceof
                Error
                ? reason.message
                : "دریافت داشبورد ناموفق بود."
            );
          }
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
  }, [
    queryString,
    refreshKey,
  ]);

  /*
   * ==========================================
   * Employee Params
   * ==========================================
   */

  function updateEmployeeParams(
    changes: Record<
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
      if (
        value
      ) {
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
        "employeePage" in
        changes
      )
    ) {
      params.delete(
        "employeePage"
      );
    }

    router.replace(
      `/admin?${params}`,
      {
        scroll:
          false,
      }
    );
  }

  function searchEmployees(
    event:
      FormEvent
  ) {
    event.preventDefault();

    updateEmployeeParams({
      employeeSearch:
        employeeSearch.trim(),
    });
  }

  /*
   * ==========================================
   * Loading / Error
   * ==========================================
   */

  if (
    !data &&
    loading
  ) {
    return (
      <div className="space-y-5">

        <div className="h-24 animate-pulse rounded-3xl bg-slate-100" />

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">

          {Array.from(
            {
              length:
                8,
            },
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

        <div className="h-80 animate-pulse rounded-3xl bg-slate-100" />

      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-rose-800">

        <h1 className="text-lg font-black">
          داشبورد در دسترس نیست
        </h1>

        <p className="mt-2 text-sm">
          {
            error
          }
        </p>

        <button
          type="button"
          onClick={() => {
            setLoading(
              true
            );

            setRefreshKey(
              (
                value
              ) =>
                value +
                1
            );
          }}
          className="mt-4 rounded-xl bg-rose-700 px-4 py-2 text-sm font-bold text-white"
        >
          تلاش دوباره
        </button>

      </div>
    );
  }

  const empty =
    data.kpis.questions
      .value ===
      0 &&
    data.kpis.requests ===
      0;

  const tokenReasoning =
    data.series.reduce(
      (
        total,
        point
      ) =>
        total +
        point.reasoningTokens,
      0
    );

  /*
   * ==========================================
   * Render
   * ==========================================
   */

  return (
    <div className="space-y-6">

      {/* Header */}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">

        <div>

          <p className="text-sm font-bold text-emerald-700">
            نمای کلی عملکرد
          </p>

          <h1 className="mt-1 text-2xl font-black sm:text-3xl">
            داشبورد مدیریت
          </h1>

          <p className="mt-2 text-sm text-slate-500">
            {
              data.range.label
            }
            {" · "}
            منطقه زمانی{" "}
            {
              data.range.timezone
            }
          </p>

        </div>

        {loading && (
          <span className="text-xs font-bold text-emerald-700">
            در حال دریافت داده جدید...
          </span>
        )}

      </div>

      {/* Date range */}

      <DateRangeControls
        basePath="/admin"
        loading={
          loading
        }
        onRefresh={() => {
          setLoading(
            true
          );

          setRefreshKey(
            (
              value
            ) =>
              value +
              1
          );
        }}
      />

      {/* General error */}

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800">
          {
            error
          }
        </div>
      )}

      {/* Widget errors */}

      {data.errors.length >
        0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">

          <p className="font-black">
            بعضی بخش‌ها کامل بارگذاری نشدند:
          </p>

          <ul className="mt-2 list-inside list-disc">

            {data.errors.map(
              (
                item
              ) => (
                <li
                  key={
                    item
                  }
                >
                  {
                    item
                  }
                </li>
              )
            )}

          </ul>

        </div>
      )}

      {empty && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-4 text-sm font-bold text-blue-800">
          هنوز داده‌ای برای این بازه وجود ندارد. نمودارها و KPIها پس از ثبت اولین سؤال یا درخواست OpenAI بروزرسانی می‌شوند.
        </div>
      )}

      {/* Main KPI */}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">

        <MetricCard
          title="تعداد سؤال‌ها"
          metric={
            data.kpis.questions
          }
          format={
            formatInteger
          }
          detail="پیام‌های ارسال‌شده توسط کاربران"
        />

        <MetricCard
          title="کارشناسان فعال"
          metric={
            data.kpis.activeUsers
          }
          format={
            formatInteger
          }
          detail="کاربران یکتا با حداقل یک سؤال"
        />

        <SimpleMetric
          title="درخواست‌های OpenAI"
          value={
            formatInteger(
              data.kpis.requests
            )
          }
          detail={`${formatInteger(
            data.kpis.chatRequests
          )} چت · ${formatInteger(
            data.kpis
              .classificationRequests
          )} دسته‌بندی`}
        />

        <MetricCard
          title="Token مصرفی"
          metric={
            data.kpis.totalTokens
          }
          format={
            formatInteger
          }
          detail="Reasoning دوباره به Total اضافه نشده"
        />

        <MetricCard
          title="هزینه تخمینی"
          metric={
            data.kpis.cost
          }
          format={
            formatCost
          }
          detail={`${formatInteger(
            data.kpis
              .pricedRequests
          )} دارای Pricing · ${formatInteger(
            data.kpis
              .unpricedRequests
          )} بدون Pricing`}
          warning={
            data.kpis
              .unpricedRequests >
            0
          }
        />

        <SimpleMetric
          title="میانگین زمان پاسخ"
          value={
            formatLatency(
              data.kpis
                .avgChatLatency
            )
          }
          detail="فقط درخواست Chat موفق"
        />

        <SimpleMetric
          title="نرخ موفقیت"
          value={
            formatPercent(
              data.kpis
                .successRate
            )
          }
          detail="تمام درخواست‌های OpenAI"
        />

        <SimpleMetric
          title="File Search"
          value={
            formatInteger(
              data.fileSearch
                .calls
            )
          }
          detail={`${data.fileSearch.avgCallsPerChat.toLocaleString(
            "fa-IR",
            {
              maximumFractionDigits:
                2,
            }
          )} فراخوانی به‌ازای Chat`}
        />

      </section>

      {/* =====================================
          Feedback Quality
          ===================================== */}

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">

        <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">

          <div>

            <p className="text-xs font-bold text-emerald-700">
              کیفیت پاسخ‌های AI
            </p>

            <h2 className="mt-1 text-lg font-black text-slate-900">
              رضایت کارشناسان
            </h2>

            <p className="mt-1 text-sm leading-6 text-slate-500">
              Feedback پاسخ‌هایی که در بازه فعلی Dashboard ایجاد شده‌اند.
            </p>

          </div>

          <Link
            href="/admin/analytics/feedback"
            className="inline-flex w-fit shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-black text-slate-700 transition hover:bg-slate-50"
          >
            مشاهده گزارش کامل کیفیت
          </Link>

        </div>

        <div className="p-5 sm:p-6">

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">

            <QualityMetric
              title="نرخ رضایت"
              value={
                data.feedback
                  .total >
                0
                  ? formatPercent(
                      data.feedback
                        .satisfactionRate
                    )
                  : "بدون داده"
              }
              detail={`${formatInteger(
                data.feedback
                  .total
              )} بازخورد`}
              accent={
                satisfactionAccent(
                  data.feedback
                    .satisfactionRate,
                  data.feedback
                    .total
                )
              }
            />

            <QualityMetric
              title="نرخ مشارکت"
              value={
                formatPercent(
                  data.feedback
                    .coverageRate
                )
              }
              detail={`${formatInteger(
                data.feedback
                  .total
              )} از ${formatInteger(
                data.feedback
                  .assistantMessages
              )} پاسخ AI`}
              accent="neutral"
            />

            <QualityMetric
              title="رأی مثبت"
              value={`👍 ${formatInteger(
                data.feedback
                  .positive
              )}`}
              detail="پاسخ مفید بوده"
              accent="positive"
            />

            <QualityMetric
              title="رأی منفی"
              value={`👎 ${formatInteger(
                data.feedback
                  .negative
              )}`}
              detail="پاسخ نیازمند بررسی"
              accent={
                data.feedback
                  .negative >
                0
                  ? "negative"
                  : "neutral"
              }
            />

          </div>

          {/* Satisfaction progress */}

          {data.feedback.total >
            0 && (
            <div className="mt-5">

              <div className="mb-2 flex items-center justify-between text-xs">

                <span className="font-bold text-slate-500">
                  ترکیب بازخورد
                </span>

                <span className="font-black text-slate-700">
                  {
                    formatPercent(
                      data.feedback
                        .satisfactionRate
                    )
                  }{" "}
                  مثبت
                </span>

              </div>

              <div className="h-2.5 overflow-hidden rounded-full bg-rose-100">

                <div
                  className="h-full rounded-full bg-emerald-500"
                  style={{
                    width:
                      `${Math.min(
                        100,
                        Math.max(
                          0,
                          data.feedback
                            .satisfactionRate
                        )
                      )}%`,
                  }}
                />

              </div>

            </div>
          )}

        </div>

      </section>

      {/* Problematic Knowledge Alerts */}

      <section
        className={`overflow-hidden rounded-3xl border shadow-sm ${
          data.feedback
            .problematicSources
            .length >
          0
            ? "border-amber-200 bg-amber-50/40"
            : "border-slate-200 bg-white"
        }`}
      >

        <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">

          <div>

            <div className="flex items-center gap-2">

              <h2 className="text-lg font-black text-slate-900">
                سلامت پایگاه دانش
              </h2>

              {data.feedback
                .problematicSources
                .length >
                0 && (
                <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-black text-amber-800">
                  ⚠️{" "}
                  {
                    formatInteger(
                      data.feedback
                        .problematicSources
                        .length
                    )
                  }
                </span>
              )}

            </div>

            <p className="mt-1 text-sm leading-6 text-slate-500">
              مطالبی که Feedback منفی آن‌ها از حد هشدار عبور کرده است.
            </p>

          </div>

          <p className="text-xs leading-6 text-slate-400">
            حد هشدار:
            {" "}
            حداقل{" "}
            {
              formatInteger(
                data.feedback
                  .alertThresholds
                  .minTotal
              )
            }{" "}
            Feedback
            {" · "}
            نارضایتی حداقل{" "}
            {
              formatPercent(
                data.feedback
                  .alertThresholds
                  .negativeRate
              )
            }
          </p>

        </div>

        {data.feedback
          .problematicSources
          .length ===
        0 ? (

          <div className="px-6 py-12 text-center">

            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-xl">
              ✓
            </div>

            <p className="mt-4 font-black text-slate-800">
              هشدار فعالی وجود ندارد
            </p>

            <p className="mt-2 text-sm text-slate-500">
              هیچ مطلبی در بازه فعلی از حد تعیین‌شده برای نارضایتی عبور نکرده است.
            </p>

          </div>

        ) : (

          <div className="grid gap-3 p-4 sm:p-5 xl:grid-cols-2">

            {data.feedback
              .problematicSources
              .map(
                (
                  source
                ) => (

                  <div
                    key={
                      source.id
                    }
                    className="rounded-2xl border border-amber-200 bg-white p-4"
                  >

                    <div className="flex items-start justify-between gap-4">

                      <div className="min-w-0">

                        <p className="font-black leading-7 text-slate-900">
                          {
                            source.title
                          }
                        </p>

                        <p className="mt-1 text-xs text-slate-500">
                          {
                            formatInteger(
                              source.totalFeedback
                            )
                          }{" "}
                          بازخورد
                          {" · "}
                          👍{" "}
                          {
                            formatInteger(
                              source.positive
                            )
                          }
                          {" · "}
                          👎{" "}
                          {
                            formatInteger(
                              source.negative
                            )
                          }
                        </p>

                      </div>

                      <span className="shrink-0 rounded-xl bg-rose-50 px-3 py-1.5 text-xs font-black text-rose-700">
                        {
                          formatPercent(
                            source.negativeRate
                          )
                        }{" "}
                        نارضایتی
                      </span>

                    </div>

                    <div className="mt-4 h-2 overflow-hidden rounded-full bg-emerald-100">

                      <div
                        className="h-full rounded-full bg-rose-500"
                        style={{
                          width:
                            `${Math.min(
                              100,
                              Math.max(
                                0,
                                source.negativeRate
                              )
                            )}%`,
                        }}
                      />

                    </div>

                    <div className="mt-4 flex items-center justify-between gap-3">

                      <span className="text-xs text-slate-400">
                        رضایت:
                        {" "}
                        {
                          formatPercent(
                            source.satisfactionRate
                          )
                        }
                      </span>

                      <Link
                        href={`/admin/knowledge/${source.id}/edit`}
                        className="text-xs font-black text-emerald-700 transition hover:text-emerald-800"
                      >
                        بررسی مطلب
                      </Link>

                    </div>

                  </div>

                )
              )}

          </div>

        )}

      </section>

      {/* Charts */}

      <section className="grid gap-5 xl:grid-cols-2">

        <ChartCard
          title="تعداد سؤال در زمان"
          subtitle={
            data.range
              .granularity ===
            "hour"
              ? "گروه‌بندی ساعتی"
              : "گروه‌بندی روزانه"
          }
        >

          <AnalyticsChart
            points={
              data.series
            }
            series={[
              {
                key:
                  "questions",

                label:
                  "تعداد سؤال",

                color:
                  "#059669",

                format:
                  formatInteger,
              },
            ]}
          />

        </ChartCard>

        <ChartCard
          title="مصرف Token"
          subtitle={`Reasoning: ${formatInteger(
            tokenReasoning
          )} Token (جزئی از Output)`}
        >

          <AnalyticsChart
            points={
              data.series
            }
            series={[
              {
                key:
                  "inputTokens",

                label:
                  "Input",

                color:
                  "#2563eb",

                format:
                  formatInteger,
              },

              {
                key:
                  "cachedInputTokens",

                label:
                  "Cached Input",

                color:
                  "#8b5cf6",

                format:
                  formatInteger,
              },

              {
                key:
                  "outputTokens",

                label:
                  "Output",

                color:
                  "#f59e0b",

                format:
                  formatInteger,
              },
            ]}
          />

        </ChartCard>

      </section>

      <ChartCard
        title="هزینه تخمینی OpenAI"
        subtitle={
          data.kpis
            .unpricedRequests >
          0
            ? "بعضی درخواست‌ها Pricing نداشته‌اند؛ مبلغ، حداقل هزینه قابل محاسبه است."
            : "تمام درخواست‌های این بازه دارای Pricing بوده‌اند."
        }
      >

        <AnalyticsChart
          points={
            data.series
          }
          series={[
            {
              key:
                "cost",

              label:
                "هزینه دلار",

              color:
                "#e11d48",

              format:
                formatCost,
            },
          ]}
        />

      </ChartCard>

      {/* Usage summary */}

      <section className="grid gap-5 xl:grid-cols-3">

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">

          <h2 className="text-lg font-black">
            نوع درخواست
          </h2>

          <p className="mt-1 text-sm text-slate-500">
            سهم بخش‌های مختلف از مصرف
          </p>

          <div className="mt-5 space-y-3">

            {data.requestBreakdown
              .length ? (
              data.requestBreakdown.map(
                (
                  item
                ) => (

                  <div
                    key={
                      item.key
                    }
                    className="rounded-2xl bg-slate-50 p-3"
                  >

                    <div className="flex items-center justify-between">

                      <span className="font-black text-slate-800">
                        {
                          item.label
                        }
                      </span>

                      <span className="text-xs text-slate-500">
                        {
                          formatInteger(
                            item.requests
                          )
                        }{" "}
                        درخواست
                      </span>

                    </div>

                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">

                      <span>
                        {
                          formatInteger(
                            item.totalTokens
                          )
                        }{" "}
                        Token
                      </span>

                      <span>
                        {
                          formatCost(
                            item.cost
                          )
                        }
                      </span>

                      <span>
                        {
                          formatLatency(
                            item.avgLatency
                          )
                        }
                      </span>

                    </div>

                  </div>

                )
              )
            ) : (
              <Empty />
            )}

          </div>

        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">

          <h2 className="text-lg font-black">
            بازیابی دانش
          </h2>

          <p className="mt-1 text-sm text-slate-500">
            File Search در درخواست‌های Chat
          </p>

          <dl className="mt-5 space-y-4">

            <InfoRow
              label="تعداد فراخوانی"
              value={
                formatInteger(
                  data.fileSearch
                    .calls
                )
              }
            />

            <InfoRow
              label="میانگین به‌ازای Chat"
              value={
                data.fileSearch
                  .avgCallsPerChat
                  .toLocaleString(
                    "fa-IR",
                    {
                      maximumFractionDigits:
                        3,
                    }
                  )
              }
            />

            <InfoRow
              label="Chat دارای File Search"
              value={
                data.fileSearch
                  .chatsWithSearchPercent ===
                null
                  ? "بدون داده"
                  : formatPercent(
                      data.fileSearch
                        .chatsWithSearchPercent
                    )
              }
            />

          </dl>

          <p className="mt-5 rounded-xl bg-slate-50 p-3 text-xs leading-6 text-slate-500">
            هزینه مستقل File Search نمایش داده نمی‌شود، چون داده قابل اتکایی برای آن ثبت نشده است.
          </p>

        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">

          <h2 className="text-lg font-black">
            کیفیت درخواست‌ها
          </h2>

          <p className="mt-1 text-sm text-slate-500">
            خلاصه موفقیت و Pricing
          </p>

          <div className="mt-5 space-y-4">

            <Progress
              label="نرخ موفقیت"
              value={
                data.kpis
                  .successRate
              }
              color="bg-emerald-500"
            />

            <Progress
              label="پوشش Pricing"
              value={
                data.kpis
                  .requests
                  ? (
                      data.kpis
                        .pricedRequests /
                      data.kpis
                        .requests
                    ) *
                    100
                  : 0
              }
              color="bg-blue-500"
            />

          </div>

        </div>

      </section>

      {/* Models */}

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">

        <div className="border-b border-slate-100 px-5 py-4 sm:px-6">

          <h2 className="text-lg font-black">
            مصرف به تفکیک مدل
          </h2>

          <p className="mt-1 text-sm text-slate-500">
            مدل‌ها مستقیماً از Usage استخراج می‌شوند.
          </p>

        </div>

        {data.modelBreakdown
          .length ? (

          <div className="overflow-x-auto">

            <table className="w-full min-w-[900px] text-right text-sm">

              <thead className="bg-slate-50 text-xs text-slate-500">

                <tr>

                  {[
                    "مدل",
                    "Request",
                    "Input",
                    "Cached",
                    "Output",
                    "Total",
                    "Cost",
                    "Avg Latency",
                  ].map(
                    (
                      heading
                    ) => (
                      <th
                        key={
                          heading
                        }
                        className="px-4 py-3"
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

                {data.modelBreakdown.map(
                  (
                    item
                  ) => (

                    <tr
                      key={
                        item.key
                      }
                    >

                      <td
                        dir="ltr"
                        className="px-4 py-4 text-left font-mono text-xs font-bold"
                      >
                        {
                          item.label
                        }
                      </td>

                      <td className="px-4 py-4">
                        {
                          formatInteger(
                            item.requests
                          )
                        }
                      </td>

                      <td className="px-4 py-4">
                        {
                          formatInteger(
                            item.inputTokens
                          )
                        }
                      </td>

                      <td className="px-4 py-4">
                        {
                          formatInteger(
                            item.cachedInputTokens
                          )
                        }
                      </td>

                      <td className="px-4 py-4">
                        {
                          formatInteger(
                            item.outputTokens
                          )
                        }
                      </td>

                      <td className="px-4 py-4 font-bold">
                        {
                          formatInteger(
                            item.totalTokens
                          )
                        }
                      </td>

                      <td className="px-4 py-4">
                        {
                          formatCost(
                            item.cost
                          )
                        }
                      </td>

                      <td className="px-4 py-4">
                        {
                          formatLatency(
                            item.avgLatency
                          )
                        }
                      </td>

                    </tr>

                  )
                )}

              </tbody>

            </table>

          </div>

        ) : (

          <div className="p-8">
            <Empty />
          </div>

        )}

      </section>

      {/* Employees */}

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">

        <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">

          <div>

            <h2 className="text-lg font-black">
              مصرف کارشناسان
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              مرتب‌سازی بر اساس شاخص‌های واقعی بازه
            </p>

          </div>

          <form
            onSubmit={
              searchEmployees
            }
            className="flex gap-2"
          >

            <input
              value={
                employeeSearch
              }
              onChange={(
                event
              ) =>
                setEmployeeSearch(
                  event.target
                    .value
                )
              }
              placeholder="نام، ایمیل یا کد..."
              className="min-w-0 rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />

            <button className="rounded-xl bg-slate-800 px-3 py-2 text-xs font-bold text-white">
              جستجو
            </button>

            <select
              value={
                data.employees.sort
              }
              onChange={(
                event
              ) =>
                updateEmployeeParams({
                  employeeSort:
                    event.target
                      .value,
                })
              }
              className="rounded-xl border border-slate-300 px-2 py-2 text-xs"
            >

              <option value="questions">
                بیشترین سؤال
              </option>

              <option value="tokens">
                بیشترین Token
              </option>

              <option value="cost">
                بیشترین Cost
              </option>

              <option value="activity">
                آخرین فعالیت
              </option>

              <option value="conversations">
                بیشترین گفتگو
              </option>

            </select>

          </form>

        </div>

        {data.employees.items
          .length ? (

          <div className="overflow-x-auto">

            <table className="w-full min-w-[1280px] text-right text-sm">

              <thead className="bg-slate-50 text-xs text-slate-500">

                <tr>

                  {[
                    "کارشناس",
                    "دپارتمان",
                    "سؤال",
                    "گفتگو",
                    "Chat",
                    "Classification",
                    "Token",
                    "Cost",
                    "Avg Chat",
                    "آخرین فعالیت",
                  ].map(
                    (
                      heading
                    ) => (
                      <th
                        key={
                          heading
                        }
                        className="px-4 py-3"
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

                {data.employees.items.map(
                  (
                    item
                  ) => (

                    <tr
                      key={
                        item.id
                      }
                    >

                      <td className="px-4 py-4">

                        <Link
                          href={`/admin/accounts/${item.id}/usage?${rangeQuery(
                            searchParams
                          )}`}
                          className="font-black text-slate-900 hover:text-emerald-700"
                        >
                          {
                            item.name
                          }
                        </Link>

                        <p className="mt-1 text-xs text-slate-400">
                          {
                            item.employeeCode ||
                            item.email
                          }
                        </p>

                      </td>

                      <td className="px-4 py-4 text-slate-600">
                        {
                          item.department ||
                          "—"
                        }
                      </td>

                      <td className="px-4 py-4">
                        {
                          formatInteger(
                            item.questions
                          )
                        }
                      </td>

                      <td className="px-4 py-4">
                        {
                          formatInteger(
                            item.conversations
                          )
                        }
                      </td>

                      <td className="px-4 py-4">
                        {
                          formatInteger(
                            item.chatRequests
                          )
                        }
                      </td>

                      <td className="px-4 py-4">
                        {
                          formatInteger(
                            item.classificationRequests
                          )
                        }
                      </td>

                      <td className="px-4 py-4 font-bold">
                        {
                          formatInteger(
                            item.totalTokens
                          )
                        }
                      </td>

                      <td className="px-4 py-4">
                        {
                          formatCost(
                            item.cost
                          )
                        }
                      </td>

                      <td className="px-4 py-4">
                        {
                          formatLatency(
                            item.avgChatLatency
                          )
                        }
                      </td>

                      <td className="whitespace-nowrap px-4 py-4 text-xs text-slate-500">
                        {
                          formatDate(
                            item.lastActivity,
                            data.range
                              .timezone
                          )
                        }
                      </td>

                    </tr>

                  )
                )}

              </tbody>

            </table>

          </div>

        ) : (

          <div className="p-8">
            <Empty />
          </div>

        )}

        {data.employees
          .totalPages >
          1 && (

          <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3">

            <button
              disabled={
                data.employees
                  .page <=
                1
              }
              onClick={() =>
                updateEmployeeParams({
                  employeePage:
                    String(
                      data.employees
                        .page -
                        1
                    ),
                })
              }
              className="rounded-lg border px-3 py-1.5 text-sm font-bold disabled:opacity-40"
            >
              قبلی
            </button>

            <span className="text-xs text-slate-500">
              صفحه{" "}
              {
                formatInteger(
                  data.employees
                    .page
                )
              }{" "}
              از{" "}
              {
                formatInteger(
                  data.employees
                    .totalPages
                )
              }
            </span>

            <button
              disabled={
                data.employees
                  .page >=
                data.employees
                  .totalPages
              }
              onClick={() =>
                updateEmployeeParams({
                  employeePage:
                    String(
                      data.employees
                        .page +
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

      {/* Failures */}

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">

        <div className="border-b border-slate-100 px-5 py-4 sm:px-6">

          <h2 className="text-lg font-black">
            خطاهای اخیر
          </h2>

          <p className="mt-1 text-sm text-slate-500">
            آخرین ۱۰ درخواست ناموفق در بازه انتخاب‌شده
          </p>

        </div>

        {data.failures.length ? (

          <div className="overflow-x-auto">

            <table className="w-full min-w-[950px] text-right text-sm">

              <thead className="bg-slate-50 text-xs text-slate-500">

                <tr>

                  {[
                    "زمان",
                    "کاربر",
                    "نوع",
                    "مدل",
                    "خطا",
                    "Latency",
                  ].map(
                    (
                      heading
                    ) => (
                      <th
                        key={
                          heading
                        }
                        className="px-4 py-3"
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

                {data.failures.map(
                  (
                    failure
                  ) => (

                    <tr
                      key={
                        failure.id
                      }
                    >

                      <td className="whitespace-nowrap px-4 py-4 text-xs text-slate-500">
                        {
                          formatDate(
                            failure.created,
                            data.range
                              .timezone
                          )
                        }
                      </td>

                      <td className="px-4 py-4">

                        {failure.userId ? (

                          <Link
                            href={`/admin/accounts/${failure.userId}/usage?${rangeQuery(
                              searchParams
                            )}`}
                            className="font-bold text-slate-800 hover:text-emerald-700"
                          >
                            {
                              failure.userName
                            }
                          </Link>

                        ) : (
                          failure.userName
                        )}

                      </td>

                      <td className="px-4 py-4">
                        {
                          failure.requestType
                        }
                      </td>

                      <td
                        dir="ltr"
                        className="px-4 py-4 text-left font-mono text-xs"
                      >
                        {
                          failure.model
                        }
                      </td>

                      <td className="max-w-sm px-4 py-4 text-xs leading-6 text-rose-700">
                        {
                          failure.errorMessage
                        }
                      </td>

                      <td className="px-4 py-4">
                        {
                          formatLatency(
                            failure.latencyMs
                          )
                        }
                      </td>

                    </tr>

                  )
                )}

              </tbody>

            </table>

          </div>

        ) : (

          <div className="p-8 text-center text-sm text-slate-400">
            در این بازه درخواست ناموفقی ثبت نشده است.
          </div>

        )}

      </section>

    </div>
  );
}

/*
 * ============================================
 * Components
 * ============================================
 */

function MetricCard({
  title,
  metric,
  format,
  detail,
  warning,
}: {
  title: string;

  metric:
    AnalyticsMetric;

  format: (
    value: number
  ) => string;

  detail:
    string;

  warning?:
    boolean;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">

      <p className="text-sm font-bold text-slate-500">
        {
          title
        }
      </p>

      <div className="mt-3 flex items-end justify-between gap-2">

        <p className="text-2xl font-black text-slate-950">
          {
            format(
              metric.value
            )
          }
        </p>

        <Change
          value={
            metric.changePercent
          }
        />

      </div>

      <p
        className={`mt-3 text-xs leading-5 ${
          warning
            ? "font-bold text-amber-700"
            : "text-slate-400"
        }`}
      >
        {
          detail
        }
      </p>

    </div>
  );
}

function SimpleMetric({
  title,
  value,
  detail,
}: {
  title:
    string;

  value:
    string;

  detail:
    string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">

      <p className="text-sm font-bold text-slate-500">
        {
          title
        }
      </p>

      <p className="mt-3 text-2xl font-black text-slate-950">
        {
          value
        }
      </p>

      <p className="mt-3 text-xs leading-5 text-slate-400">
        {
          detail
        }
      </p>

    </div>
  );
}

function QualityMetric({
  title,
  value,
  detail,
  accent,
}: {
  title:
    string;

  value:
    string;

  detail:
    string;

  accent:
    | "positive"
    | "negative"
    | "warning"
    | "neutral";
}) {
  const accentClass = {
    positive:
      "border-emerald-200 bg-emerald-50/60",

    negative:
      "border-rose-200 bg-rose-50/60",

    warning:
      "border-amber-200 bg-amber-50/60",

    neutral:
      "border-slate-200 bg-slate-50/60",
  }[
    accent
  ];

  return (
    <div
      className={`rounded-2xl border p-4 ${accentClass}`}
    >

      <p className="text-xs font-bold text-slate-500">
        {
          title
        }
      </p>

      <p className="mt-2 text-2xl font-black text-slate-950">
        {
          value
        }
      </p>

      <p className="mt-2 text-xs leading-5 text-slate-500">
        {
          detail
        }
      </p>

    </div>
  );
}

function satisfactionAccent(
  rate: number,
  total: number
):
  | "positive"
  | "negative"
  | "warning"
  | "neutral" {
  if (
    total ===
    0
  ) {
    return "neutral";
  }

  if (
    rate >=
    80
  ) {
    return "positive";
  }

  if (
    rate >=
    60
  ) {
    return "warning";
  }

  return "negative";
}

function Change({
  value,
}: {
  value:
    number | null;
}) {
  if (
    value ===
    null
  ) {
    return (
      <span className="text-[10px] font-bold text-slate-400">
        بدون مبنای قبلی
      </span>
    );
  }

  const positive =
    value >
    0;

  return (
    <span
      className={`rounded-full px-2 py-1 text-[10px] font-black ${
        positive
          ? "bg-emerald-50 text-emerald-700"
          : value <
              0
            ? "bg-rose-50 text-rose-700"
            : "bg-slate-100 text-slate-500"
      }`}
    >
      {positive
        ? "+"
        : ""}
      {value.toLocaleString(
        "fa-IR",
        {
          maximumFractionDigits:
            1,
        }
      )}
      %
    </span>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title:
    string;

  subtitle:
    string;

  children:
    React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">

      <h2 className="text-lg font-black">
        {
          title
        }
      </h2>

      <p className="mt-1 text-sm text-slate-500">
        {
          subtitle
        }
      </p>

      <div className="mt-5">
        {
          children
        }
      </div>

    </section>
  );
}

function InfoRow({
  label,
  value,
}: {
  label:
    string;

  value:
    string;
}) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 pb-3">

      <dt className="text-sm text-slate-500">
        {
          label
        }
      </dt>

      <dd className="font-black text-slate-800">
        {
          value
        }
      </dd>

    </div>
  );
}

function Progress({
  label,
  value,
  color,
}: {
  label:
    string;

  value:
    number;

  color:
    string;
}) {
  const safe =
    Math.min(
      Math.max(
        value,
        0
      ),
      100
    );

  return (
    <div>

      <div className="mb-2 flex justify-between text-sm">

        <span className="font-bold text-slate-600">
          {
            label
          }
        </span>

        <span className="font-black">
          {
            formatPercent(
              safe
            )
          }
        </span>

      </div>

      <div className="h-2 overflow-hidden rounded-full bg-slate-100">

        <div
          className={`h-full rounded-full ${color}`}
          style={{
            width:
              `${safe}%`,
          }}
        />

      </div>

    </div>
  );
}

function Empty() {
  return (
    <p className="text-center text-sm text-slate-400">
      هنوز داده‌ای برای این بازه وجود ندارد.
    </p>
  );
}

/*
 * ============================================
 * Formatting
 * ============================================
 */

function formatInteger(
  value: number
) {
  return Math.round(
    value
  ).toLocaleString(
    "fa-IR"
  );
}

function formatCost(
  value: number
) {
  if (!value) {
    return "$0";
  }

  return `$${value.toLocaleString(
    "en-US",
    {
      minimumFractionDigits:
        value <
        0.01
          ? 6
          : 4,

      maximumFractionDigits:
        value <
        0.01
          ? 8
          : 6,
    }
  )}`;
}

function formatLatency(
  value: number
) {
  return value
    ? `${Math.round(
        value
      ).toLocaleString(
        "fa-IR"
      )} ms`
    : "—";
}

function formatPercent(
  value: number
) {
  return `${value.toLocaleString(
    "fa-IR",
    {
      maximumFractionDigits:
        1,
    }
  )}%`;
}

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

  return Number.isNaN(
    date.getTime()
  )
    ? "—"
    : new Intl.DateTimeFormat(
        "fa-IR",
        {
          timeZone:
            timezone,

          dateStyle:
            "medium",

          timeStyle:
            "short",
        }
      ).format(
        date
      );
}

function rangeQuery(
  params:
    URLSearchParams
) {
  const result =
    new URLSearchParams();

  for (
    const key of
    [
      "range",
      "from",
      "to",
    ]
  ) {
    const value =
      params.get(
        key
      );

    if (
      value
    ) {
      result.set(
        key,
        value
      );
    }
  }

  return result.toString();
}