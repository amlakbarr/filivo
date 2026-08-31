"use client";

import Link from "next/link";

import {
  useCallback,
  useEffect,
  useState,
} from "react";

import type {
  GroundingAnalyticsAlert,
  GroundingAnalyticsBlockedItem,
  GroundingAnalyticsDashboard,
  GroundingAnalyticsRange,
  GroundingAnalyticsReasonRow,
  GroundingAnalyticsTopicRow,
} from "@/types/grounding-analytics";

type ResponseBody =
  | {
      success:
        true;

      dashboard:
        GroundingAnalyticsDashboard;
    }
  | {
      success:
        false;

      message:
        string;

      requestId?:
        string;
    };

const RANGE_OPTIONS:
  Array<{
    value:
      GroundingAnalyticsRange;

    label:
      string;
  }> = [
    {
      value:
        "24h",

      label:
        "۲۴ ساعت",
    },
    {
      value:
        "7d",

      label:
        "۷ روز",
    },
    {
      value:
        "30d",

      label:
        "۳۰ روز",
    },
    {
      value:
        "90d",

      label:
        "۹۰ روز",
    },
  ];

export default function GroundingAnalyticsPage() {
  const [
    range,
    setRange,
  ] =
    useState<
      GroundingAnalyticsRange
    >(
      "7d"
    );

  const [
    dashboard,
    setDashboard,
  ] =
    useState<
      GroundingAnalyticsDashboard |
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

  const load =
    useCallback(
      async (
        signal?:
          AbortSignal
      ) => {
        setLoading(
          true
        );

        setError(
          ""
        );

        try {
          const response =
            await fetch(
              `/api/admin/analytics/grounding?range=${range}`,
              {
                cache:
                  "no-store",

                signal,
              }
            );

          const body =
            (
              await response
                .json()
                .catch(
                  () => ({})
                )
            ) as ResponseBody;

          if (
            signal
              ?.aborted
          ) {
            return;
          }

          if (
            !response.ok ||
            !body.success
          ) {
            throw new Error(
              "message" in
              body
                ? body.message
                : "دریافت گزارش کنترل صحت پاسخ‌ها ناموفق بود."
            );
          }

          setDashboard(
            body.dashboard
          );
        } catch (
          loadError
        ) {
          if (
            loadError instanceof
              DOMException &&
            loadError.name ===
              "AbortError"
          ) {
            return;
          }

          setDashboard(
            null
          );

          setError(
            loadError instanceof
              Error
              ? loadError.message
              : "دریافت گزارش کنترل صحت پاسخ‌ها ناموفق بود."
          );
        } finally {
          if (
            !signal
              ?.aborted
          ) {
            setLoading(
              false
            );
          }
        }
      },
      [
        range,
      ]
    );

  useEffect(
    () => {
      const controller =
        new AbortController();

      void load(
        controller.signal
      );

      return () => {
        controller.abort();
      };
    },
    [
      load,
    ]
  );

  return (
    <main
      dir="rtl"
      className="space-y-6"
    >
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">

        <div className="flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">

          <div>

            <p className="text-xs font-black text-indigo-700">
              AI Grounding
            </p>

            <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">
              کنترل صحت و جلوگیری از Hallucination
            </h1>

            <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-500">
              این گزارش نشان می‌دهد چه تعداد پاسخ سازمانی با Evidence معتبر تأیید شده‌اند و چه پاسخ‌هایی قبل از نمایش به کارشناس مسدود شده‌اند.
            </p>

          </div>

          <div className="flex flex-wrap gap-2">

            <select
              value={
                range
              }
              onChange={(
                event
              ) =>
                setRange(
                  event
                    .target
                    .value as
                    GroundingAnalyticsRange
                )
              }
              className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-black text-slate-700 outline-none focus:border-indigo-400"
            >
              {RANGE_OPTIONS.map(
                (
                  option
                ) => (
                  <option
                    key={
                      option.value
                    }
                    value={
                      option.value
                    }
                  >
                    {
                      option.label
                    }
                  </option>
                )
              )}
            </select>

            <button
              type="button"
              onClick={() =>
                void load()
              }
              disabled={
                loading
              }
              className="rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-black text-white transition hover:bg-black disabled:opacity-50"
            >
              {
                loading
                  ? "در حال بروزرسانی..."
                  : "بروزرسانی"
              }
            </button>

          </div>

        </div>

      </section>

      {error && (
        <div
          role="alert"
          className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold leading-7 text-rose-700"
        >
          {
            error
          }
        </div>
      )}

      {dashboard &&
      dashboard.alerts.length >
        0 && (
        <QualityAlerts
          alerts={
            dashboard.alerts
          }
        />
      )}

      {loading &&
      !dashboard ? (
        <LoadingState />
      ) : dashboard ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">

            <Metric
              label="بررسی‌شده"
              value={
                formatInteger(
                  dashboard
                    .totals
                    .checked
                )
              }
            />

            <Metric
              label="تأییدشده"
              value={
                formatInteger(
                  dashboard
                    .totals
                    .verified
                )
              }
              tone="success"
            />

            <Metric
              label="مسدودشده"
              value={
                formatInteger(
                  dashboard
                    .totals
                    .blocked
                )
              }
              tone={
                dashboard
                  .totals
                  .blocked >
                0
                  ? "danger"
                  : "default"
              }
            />

            <Metric
              label="بدون نیاز به Knowledge"
              value={
                formatInteger(
                  dashboard
                    .totals
                    .notRequired
                )
              }
            />

            <Metric
              label="نرخ تأیید"
              value={
                formatPercent(
                  dashboard
                    .totals
                    .verificationRate
                )
              }
              tone="success"
            />

            <Metric
              label="نرخ Block"
              value={
                formatPercent(
                  dashboard
                    .totals
                    .blockRate
                )
              }
              tone={
                dashboard
                  .totals
                  .blockRate >
                0
                  ? "danger"
                  : "default"
              }
            />

          </section>

          <section className="grid gap-5 xl:grid-cols-2">

            <ReasonPanel
              title="دلیل Hard Grounding Gate"
              rows={
                dashboard
                  .gateReasons
              }
            />

            <ReasonPanel
              title="نتیجه Semantic Verifier"
              rows={
                dashboard
                  .verifierReasons
              }
            />

          </section>

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">

            <Metric
              label="میانگین Retrieval"
              value={
                formatDecimal(
                  dashboard
                    .evidence
                    .averageRetrievalCount
                )
              }
            />

            <Metric
              label="میانگین Relevant"
              value={
                formatDecimal(
                  dashboard
                    .evidence
                    .averageRelevantCount
                )
              }
            />

            <Metric
              label="میانگین Sources"
              value={
                formatDecimal(
                  dashboard
                    .evidence
                    .averageSourceCount
                )
              }
            />

            <Metric
              label="Block بدون Evidence"
              value={
                formatInteger(
                  dashboard
                    .evidence
                    .blockedWithoutRelevantEvidence
                )
              }
              tone={
                dashboard
                  .evidence
                  .blockedWithoutRelevantEvidence >
                0
                  ? "warning"
                  : "default"
              }
            />

            <Metric
              label="Block توسط Verifier"
              value={
                formatInteger(
                  dashboard
                    .evidence
                    .blockedAfterVerifier
                )
              }
              tone={
                dashboard
                  .evidence
                  .blockedAfterVerifier >
                0
                  ? "danger"
                  : "default"
              }
            />

          </section>

          <TopicHealthTable
            rows={
              dashboard.topics
            }
            warningThreshold={
              dashboard
                .thresholds
                .topicBlockRateWarningPercent
            }
          />

          <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">

            <div className="border-b border-slate-100 px-5 py-5 sm:px-6">

              <h2 className="text-lg font-black text-slate-950">
                پاسخ‌های اخیر مسدودشده
              </h2>

              <p className="mt-1 text-xs leading-6 text-slate-400">
                مواردی که Hard Gate یا Verifier اجازه خروج پاسخ را نداده است.
              </p>

            </div>

            <div className="space-y-4 p-4 sm:p-6">

              {dashboard
                .recentBlocked
                .length >
              0 ? (
                dashboard
                  .recentBlocked
                  .map(
                    (
                      item
                    ) => (
                      <BlockedCard
                        key={
                          item.id
                        }
                        item={
                          item
                        }
                      />
                    )
                  )
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 py-12 text-center text-sm font-bold text-slate-400">
                  در این بازه پاسخ مسدودشده‌ای ثبت نشده است.
                </div>
              )}

            </div>

          </section>
        </>
      ) : null}

    </main>
  );
}

/*
 * ============================================
 * Quality Alerts
 * ============================================
 */

function QualityAlerts({
  alerts,
}: {
  alerts:
    GroundingAnalyticsAlert[];
}) {
  return (
    <section
      aria-label="هشدارهای کیفیت"
      className="space-y-3"
    >

      <div className="flex items-center justify-between gap-3">

        <div>

          <h2 className="text-sm font-black text-slate-950">
            هشدارهای خودکار کیفیت
          </h2>

          <p className="mt-1 text-xs text-slate-400">
            این هشدارها از داده واقعی بازه انتخاب‌شده محاسبه می‌شوند.
          </p>

        </div>

        <span className="rounded-full bg-rose-100 px-3 py-1 text-[10px] font-black text-rose-700">
          {
            alerts.length
              .toLocaleString(
                "fa-IR"
              )
          }
          {" "}
          هشدار
        </span>

      </div>

      <div className="grid gap-3 xl:grid-cols-2">

        {alerts.map(
          (
            alert
          ) => (
            <QualityAlertCard
              key={
                alert.id
              }
              alert={
                alert
              }
            />
          )
        )}

      </div>

    </section>
  );
}

function QualityAlertCard({
  alert,
}: {
  alert:
    GroundingAnalyticsAlert;
}) {
  const critical =
    alert.severity ===
    "critical";

  return (
    <article
      role={
        critical
          ? "alert"
          : "status"
      }
      className={`rounded-2xl border p-4 sm:p-5 ${
        critical
          ? "border-rose-300 bg-rose-50"
          : "border-amber-300 bg-amber-50"
      }`}
    >

      <div className="flex flex-wrap items-start justify-between gap-3">

        <div>

          <span
            className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-black ${
              critical
                ? "bg-rose-200 text-rose-800"
                : "bg-amber-200 text-amber-800"
            }`}
          >
            {
              critical
                ? "بحرانی"
                : "هشدار"
            }
          </span>

          <h3
            className={`mt-3 text-sm font-black ${
              critical
                ? "text-rose-950"
                : "text-amber-950"
            }`}
          >
            {
              alert.title
            }
          </h3>

        </div>

        {alert.currentValue !==
          undefined && (
          <div className="text-left">

            <p
              className={`text-xl font-black ${
                critical
                  ? "text-rose-800"
                  : "text-amber-800"
              }`}
            >
              {
                alert.unit ===
                "percent"
                  ? formatPercent(
                      alert.currentValue
                    )
                  : formatInteger(
                      alert.currentValue
                    )
              }
            </p>

            {alert.thresholdValue !==
              undefined && (
              <p className="mt-1 text-[10px] text-slate-500">
                حد هشدار:
                {" "}
                {
                  alert.unit ===
                  "percent"
                    ? formatPercent(
                        alert.thresholdValue
                      )
                    : formatInteger(
                        alert.thresholdValue
                      )
                }
              </p>
            )}

          </div>
        )}

      </div>

      <p
        className={`mt-3 text-xs font-medium leading-6 ${
          critical
            ? "text-rose-800"
            : "text-amber-800"
        }`}
      >
        {
          alert.message
        }
      </p>

      {alert.topicId && (
        <div className="mt-4">

          <Link
            href={`/admin/analytics/grounding/topics/${alert.topicId}`}
            className="text-[11px] font-black text-indigo-700 underline underline-offset-4"
          >
            اقدام اصلاحی این موضوع
          </Link>

        </div>
      )}

    </article>
  );
}

/*
 * ============================================
 * Topic Health
 * ============================================
 */

function TopicHealthTable({
  rows,
  warningThreshold,
}: {
  rows:
    GroundingAnalyticsTopicRow[];

  warningThreshold:
    number;
}) {
  return (
    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">

      <div className="border-b border-slate-100 px-5 py-5 sm:px-6">

        <h2 className="text-lg font-black text-slate-950">
          سلامت Grounding بر اساس موضوع
        </h2>

        <p className="mt-1 text-xs leading-6 text-slate-400">
          موضوعاتی با Block Rate بالا سریع‌تر نیاز به تکمیل Knowledge یا اصلاح Retrieval دارند.
        </p>

      </div>

      {rows.length >
      0 ? (
        <div className="overflow-x-auto">

          <table className="w-full min-w-[900px] text-right text-xs">

            <thead className="bg-slate-50 text-slate-500">

              <tr>

                {[
                  "موضوع",
                  "پاسخ سازمانی",
                  "تأیید",
                  "Block",
                  "Block Rate",
                  "بدون Evidence",
                  "Verifier Block",
                  "Claim بدون مدرک",
                  "عملیات",
                ].map(
                  (
                    heading
                  ) => (
                    <th
                      key={
                        heading
                      }
                      className="px-4 py-3 font-black"
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

              {rows.map(
                (
                  row
                ) => {
                  const risky =
                    row.blockRate >=
                    warningThreshold;

                  return (
                    <tr
                      key={
                        row.topicId ||
                        "__unclassified"
                      }
                      className={
                        risky
                          ? "bg-rose-50/40"
                          : "hover:bg-slate-50/70"
                      }
                    >

                      <td className="px-4 py-4">

                        <div className="flex items-center gap-2">

                          <span className="font-black text-slate-900">
                            {
                              row.topicName
                            }
                          </span>

                          {risky && (
                            <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[9px] font-black text-rose-700">
                              پرریسک
                            </span>
                          )}

                        </div>

                      </td>

                      <td className="px-4 py-4 font-bold text-slate-700">
                        {
                          formatInteger(
                            row.required
                          )
                        }
                      </td>

                      <td className="px-4 py-4 font-black text-emerald-700">
                        {
                          formatInteger(
                            row.verified
                          )
                        }
                      </td>

                      <td className="px-4 py-4 font-black text-rose-700">
                        {
                          formatInteger(
                            row.blocked
                          )
                        }
                      </td>

                      <td className="px-4 py-4">

                        <span
                          className={`rounded-full px-2.5 py-1 font-black ${
                            risky
                              ? "bg-rose-100 text-rose-700"
                              : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {
                            formatPercent(
                              row.blockRate
                            )
                          }
                        </span>

                      </td>

                      <td className="px-4 py-4 text-slate-600">
                        {
                          formatInteger(
                            row.blockedWithoutEvidence
                          )
                        }
                      </td>

                      <td className="px-4 py-4 text-slate-600">
                        {
                          formatInteger(
                            row.blockedAfterVerifier
                          )
                        }
                      </td>

                      <td className="px-4 py-4 text-slate-600">
                        {
                          formatInteger(
                            row.unsupportedClaimCount
                          )
                        }
                      </td>

                      <td className="px-4 py-4">

                        {row.topicId ? (
                          <Link
                            href={`/admin/analytics/grounding/topics/${row.topicId}`}
                            className="rounded-lg border border-indigo-200 px-2.5 py-1.5 text-[10px] font-black text-indigo-700 transition hover:bg-indigo-50"
                          >
                            اقدام اصلاحی
                          </Link>
                        ) : (
                          <span className="text-[10px] text-slate-400">
                            —
                          </span>
                        )}

                      </td>

                    </tr>
                  );
                }
              )}

            </tbody>

          </table>

        </div>
      ) : (
        <div className="px-6 py-12 text-center text-sm font-bold text-slate-400">
          داده موضوعی برای نمایش وجود ندارد.
        </div>
      )}

    </section>
  );
}

/*
 * ============================================
 * Blocked Card
 * ============================================
 */

function BlockedCard({
  item,
}: {
  item:
    GroundingAnalyticsBlockedItem;
}) {
  return (
    <article className="rounded-2xl border border-rose-100 bg-rose-50/30 p-4 sm:p-5">

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">

        <div className="flex flex-wrap items-center gap-2">

          <span className="rounded-full bg-rose-100 px-2.5 py-1 text-[10px] font-black text-rose-700">
            Blocked
          </span>

          {item.topicName && (
            <span className="rounded-full bg-indigo-100 px-2.5 py-1 text-[10px] font-black text-indigo-700">
              {
                item.topicName
              }
            </span>
          )}

          {item.userName && (
            <span className="text-[11px] font-bold text-slate-500">
              {
                item.userName
              }
            </span>
          )}

        </div>

        <time className="text-[10px] text-slate-400">
          {
            formatDateTime(
              item.created
            )
          }
        </time>

      </div>

      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3.5">

        <p className="text-[10px] font-black text-slate-400">
          سؤال
        </p>

        <p className="mt-1 whitespace-pre-wrap text-sm font-bold leading-7 text-slate-800">
          {
            item.question ||
            "—"
          }
        </p>

      </div>

      <div className="mt-3 flex flex-wrap gap-2">

        <Badge
          label="Gate"
          value={
            gateLabel(
              item.gateReason
            )
          }
        />

        <Badge
          label="Verifier"
          value={
            verifierLabel(
              item.verifierStatus
            )
          }
        />

        <Badge
          label="Retrieval"
          value={
            formatInteger(
              item.retrievalCount
            )
          }
        />

        <Badge
          label="Relevant"
          value={
            formatInteger(
              item.relevantCount
            )
          }
        />

        <Badge
          label="Source"
          value={
            formatInteger(
              item.sourceCount
            )
          }
        />

      </div>

      {item.unsupportedClaims.length >
      0 && (
        <div className="mt-4 rounded-xl border border-rose-200 bg-white p-3.5">

          <p className="text-[10px] font-black text-rose-700">
            Claimهای بدون مدرک
          </p>

          <ul className="mt-2 list-disc space-y-2 pr-5 text-xs leading-6 text-rose-900">

            {item
              .unsupportedClaims
              .map(
                (
                  claim,
                  index
                ) => (
                  <li
                    key={
                      `${item.id}-${index}`
                    }
                  >
                    {
                      claim
                    }
                  </li>
                )
              )}

          </ul>

        </div>
      )}

      {item.verifierReason && (
        <p className="mt-3 text-xs leading-6 text-slate-600">
          <span className="font-black">
            توضیح Verifier:
          </span>
          {" "}
          {
            item.verifierReason
          }
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-rose-100 pt-4">

        <div className="text-[10px] leading-5 text-slate-400">

          {item.verifierModel && (
            <span
              dir="ltr"
              className="ml-3 font-mono"
            >
              {
                item.verifierModel
              }
            </span>
          )}

          {item.employeeCode && (
            <span>
              کد کارشناس:{" "}
              {
                item.employeeCode
              }
            </span>
          )}

        </div>

        {item.conversationId && (
          <Link
            href={`/admin/conversations/${item.conversationId}`}
            className="rounded-lg bg-slate-950 px-3 py-2 text-[11px] font-black text-white transition hover:bg-black"
          >
            مشاهده مکالمه
          </Link>
        )}

      </div>

    </article>
  );
}

/*
 * ============================================
 * Reason Panel
 * ============================================
 */

function ReasonPanel({
  title,
  rows,
}: {
  title:
    string;

  rows:
    GroundingAnalyticsReasonRow[];
}) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">

      <h2 className="text-sm font-black text-slate-950">
        {
          title
        }
      </h2>

      <div className="mt-5 space-y-4">

        {rows.length >
        0 ? (
          rows.map(
            (
              row
            ) => (
              <div
                key={
                  row.key
                }
              >

                <div className="flex items-center justify-between gap-3 text-xs">

                  <span className="font-bold text-slate-700">
                    {
                      row.label
                    }
                  </span>

                  <span className="font-black text-slate-950">
                    {
                      formatInteger(
                        row.count
                      )
                    }
                    {" · "}
                    {
                      formatPercent(
                        row.percent
                      )
                    }
                  </span>

                </div>

                <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">

                  <div
                    className="h-full rounded-full bg-slate-800"
                    style={{
                      width:
                        `${Math.max(
                          0,
                          Math.min(
                            100,
                            row.percent
                          )
                        )}%`,
                    }}
                  />

                </div>

              </div>
            )
          )
        ) : (
          <p className="text-xs text-slate-400">
            داده‌ای برای نمایش وجود ندارد.
          </p>
        )}

      </div>

    </section>
  );
}

/*
 * ============================================
 * Metric
 * ============================================
 */

function Metric({
  label,
  value,
  tone = "default",
}: {
  label:
    string;

  value:
    string;

  tone?:
    | "default"
    | "success"
    | "warning"
    | "danger";
}) {
  const styles =
    tone ===
    "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : tone ===
          "warning"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : tone ===
            "danger"
          ? "border-rose-200 bg-rose-50 text-rose-900"
          : "border-slate-200 bg-white text-slate-950";

  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${styles}`}>

      <p className="text-[10px] font-black opacity-60">
        {
          label
        }
      </p>

      <p className="mt-2 text-xl font-black">
        {
          value
        }
      </p>

    </div>
  );
}

function Badge({
  label,
  value,
}: {
  label:
    string;

  value:
    string;
}) {
  return (
    <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-bold text-slate-600">
      {
        label
      }
      :
      {" "}
      <span className="font-black text-slate-900">
        {
          value
        }
      </span>
    </span>
  );
}

/*
 * ============================================
 * Loading
 * ============================================
 */

function LoadingState() {
  return (
    <div className="space-y-5">

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">

        {Array.from(
          {
            length:
              6,
          },
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

      <div className="grid gap-5 xl:grid-cols-2">

        <div className="h-64 animate-pulse rounded-3xl bg-slate-100" />

        <div className="h-64 animate-pulse rounded-3xl bg-slate-100" />

      </div>

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
  return Math.round(
    Number.isFinite(
      value
    )
      ? value
      : 0
  ).toLocaleString(
    "fa-IR"
  );
}

function formatDecimal(
  value:
    number
) {
  return (
    Number.isFinite(
      value
    )
      ? value
      : 0
  ).toLocaleString(
    "fa-IR",
    {
      maximumFractionDigits:
        1,
    }
  );
}

function formatPercent(
  value:
    number
) {
  return `${formatDecimal(
    value
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

function gateLabel(
  value:
    string
) {
  switch (
    value
  ) {
    case "verified_knowledge":
      return "Knowledge معتبر";

    case "missing_verified_knowledge":
      return "Evidence نامعتبر";

    case "model_declared_insufficient":
      return "کمبود دانش";

    case "safe_ungrounded_question":
      return "بدون نیاز";

    default:
      return value ||
        "نامشخص";
  }
}

function verifierLabel(
  value:
    string
) {
  switch (
    value
  ) {
    case "supported":
      return "تأیید";

    case "unsupported_claims":
      return "Claim نامعتبر";

    case "no_evidence":
      return "بدون Evidence";

    case "budget_blocked":
      return "Budget Block";

    case "verifier_unavailable":
      return "Unavailable";

    case "invalid_verifier_response":
      return "Invalid output";

    case "not_run":
      return "اجرا نشده";

    case "not_required":
      return "لازم نیست";

    default:
      return value ||
        "نامشخص";
  }
}
