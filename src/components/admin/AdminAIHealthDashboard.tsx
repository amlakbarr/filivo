"use client";

import Link from "next/link";

import {
  useCallback,
  useEffect,
  useState,
} from "react";

import type {
  AdminAIHealthDashboard,
  AdminAIHealthLevel,
  AdminAIHealthResponse,
} from "@/types/admin-ai-health";

const REFRESH_INTERVAL_MS =
  30_000;

export default function AdminAIHealthDashboard() {
  const [
    dashboard,
    setDashboard,
  ] =
    useState<
      AdminAIHealthDashboard |
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
    refreshing,
    setRefreshing,
  ] =
    useState(
      false
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
        background =
          false
      ) => {
        if (
          background
        ) {
          setRefreshing(
            true
          );
        } else {
          setLoading(
            true
          );
        }

        try {
          const response =
            await fetch(
              "/api/admin/health-dashboard",
              {
                cache:
                  "no-store",
              }
            );

          const body =
            (
              await response.json()
            ) as
              AdminAIHealthResponse;

          if (
            !response.ok ||
            !body.success
          ) {
            throw new Error(
              "message" in
              body
                ? body.message
                : "دریافت سلامت AI ناموفق بود."
            );
          }

          setDashboard(
            body.dashboard
          );

          setError(
            ""
          );
        } catch (
          loadError
        ) {
          setError(
            loadError instanceof
              Error
              ? loadError.message
              : "دریافت سلامت AI ناموفق بود."
          );
        } finally {
          setLoading(
            false
          );

          setRefreshing(
            false
          );
        }
      },
      []
    );

  useEffect(
    () => {
      void load();

      const interval =
        window.setInterval(
          () => {
            void load(
              true
            );
          },
          REFRESH_INTERVAL_MS
        );

      return () =>
        window.clearInterval(
          interval
        );
    },
    [
      load,
    ]
  );

  if (
    loading &&
    !dashboard
  ) {
    return (
      <DashboardLoading />
    );
  }

  return (
    <div className="space-y-6">

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">

        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">

          <div>

            <p className="text-xs font-black text-emerald-700">
              AI Operations Center
            </p>

            <h1 className="mt-2 text-2xl font-black text-slate-950 sm:text-3xl">
              داشبورد سلامت هوش مصنوعی
            </h1>

            <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-500">
              وضعیت Release، Regression، Grounding، Knowledge Gap، Feedback و Sync را در یک نمای عملیاتی بررسی کنید.
            </p>

          </div>

          <div className="flex flex-wrap items-center gap-2">

            {dashboard && (
              <span className="text-[10px] text-slate-400">
                بروزرسانی:
                {" "}
                {
                  formatDateTime(
                    dashboard.generatedAt
                  )
                }
              </span>
            )}

            <button
              type="button"
              onClick={() =>
                void load(
                  true
                )
              }
              disabled={
                refreshing
              }
              className="rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-black text-white disabled:opacity-50"
            >
              {
                refreshing
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
          className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700"
        >
          {
            error
          }
        </div>
      )}

      {dashboard && (
        <>
          <OverallHealth
            dashboard={
              dashboard
            }
          />

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">

            <HealthMetric
              label="Release Gate"
              value={
                releaseLabel(
                  dashboard
                    .release
                    .status
                )
              }
              detail={
                dashboard
                  .release
                  .message
              }
              level={
                dashboard
                  .release
                  .status ===
                  "ready"
                  ? "healthy"
                  : dashboard
                      .release
                      .status ===
                      "blocked"
                    ? "critical"
                    : "warning"
              }
              href="/admin/evals/release"
            />

            <HealthMetric
              label="Regression فعال"
              value={
                dashboard
                  .regressions
                  .active
                  .toLocaleString(
                    "fa-IR"
                  )
              }
              detail={`${dashboard.regressions.knowledge.toLocaleString(
                "fa-IR"
              )} Knowledge · ${dashboard.regressions.topics.toLocaleString(
                "fa-IR"
              )} Topic · ${dashboard.regressions.running.toLocaleString(
                "fa-IR"
              )} در حال تست`}
              level={
                dashboard
                  .regressions
                  .critical >
                0
                  ? "critical"
                  : dashboard
                      .regressions
                      .active >
                      0 ||
                    dashboard
                      .regressions
                      .running >
                      0
                    ? "warning"
                    : "healthy"
              }
              href="/admin/evals"
            />

            <HealthMetric
              label="Golden Coverage"
              value={`${formatNumber(
                dashboard
                  .coverage
                  .topicCoveragePercent
              )}٪`}
              detail={`${dashboard.coverage.uncoveredTopics.toLocaleString(
                "fa-IR"
              )} Topic · ${dashboard.coverage.uncoveredKnowledge.toLocaleString(
                "fa-IR"
              )} Knowledge بدون پوشش`}
              level={
                dashboard
                  .coverage
                  .uncoveredTopics >
                  0 ||
                dashboard
                  .coverage
                  .uncoveredKnowledge >
                  0
                  ? "warning"
                  : "healthy"
              }
              href="/admin/evals/coverage"
            />

            <HealthMetric
              label="Grounding Block Rate"
              value={`${formatNumber(
                dashboard
                  .grounding
                  .blockRate
              )}٪`}
              detail={`${dashboard.grounding.blocked.toLocaleString(
                "fa-IR"
              )} Block از ${dashboard.grounding.required.toLocaleString(
                "fa-IR"
              )} پاسخ سازمانی`}
              level={
                dashboard
                  .grounding
                  .level
              }
              href="/admin/analytics/grounding"
            />

            <HealthMetric
              label="Knowledge Gap"
              value={
                (
                  dashboard
                    .gaps
                    .open +
                  dashboard
                    .gaps
                    .inProgress
                ).toLocaleString(
                  "fa-IR"
                )
              }
              detail={`${dashboard.gaps.highPriority.toLocaleString(
                "fa-IR"
              )} مورد با Priority بالا`}
              level={
                dashboard
                  .gaps
                  .highPriority >
                0
                  ? "warning"
                  : "healthy"
              }
              href="/admin/knowledge/gaps"
            />

            <HealthMetric
              label="Feedback منفی باز"
              value={
                dashboard
                  .feedback
                  .negativeOpen
                  .toLocaleString(
                    "fa-IR"
                  )
              }
              detail={`${dashboard.feedback.new.toLocaleString(
                "fa-IR"
              )} جدید · ${dashboard.feedback.inProgress.toLocaleString(
                "fa-IR"
              )} در حال بررسی`}
              level={
                dashboard
                  .feedback
                  .negativeOpen >
                0
                  ? "warning"
                  : "healthy"
              }
              href="/admin/analytics/feedback"
            />

            <HealthMetric
              label="Knowledge Sync"
              value={
                dashboard
                  .knowledgeSync
                  .errors >
                0
                  ? `${dashboard.knowledgeSync.errors.toLocaleString(
                      "fa-IR"
                    )} خطا`
                  : dashboard
                      .knowledgeSync
                      .pending >
                      0
                    ? `${dashboard.knowledgeSync.pending.toLocaleString(
                        "fa-IR"
                      )} در انتظار`
                    : "سالم"
              }
              detail={`${dashboard.knowledgeSync.synced.toLocaleString(
                "fa-IR"
              )} از ${dashboard.knowledgeSync.published.toLocaleString(
                "fa-IR"
              )} مطلب منتشرشده Sync است`}
              level={
                dashboard
                  .knowledgeSync
                  .errors >
                0
                  ? "critical"
                  : dashboard
                      .knowledgeSync
                      .pending >
                      0
                    ? "warning"
                    : "healthy"
              }
              href="/admin/knowledge"
            />

          </section>

          <section className="grid gap-5 xl:grid-cols-2">

            <ActionQueue
              dashboard={
                dashboard
              }
            />

            <GroundingCard
              dashboard={
                dashboard
              }
            />

          </section>

          <section className="grid gap-5 xl:grid-cols-2">

            <GapQueue
              dashboard={
                dashboard
              }
            />

            <ReleaseCard
              dashboard={
                dashboard
              }
            />

          </section>

          <CoverageRiskCard
            dashboard={
              dashboard
            }
          />

          <AvailabilityCard
            dashboard={
              dashboard
            }
          />
        </>
      )}

    </div>
  );
}

/*
 * ============================================
 * Overall
 * ============================================
 */

function OverallHealth({
  dashboard,
}: {
  dashboard:
    AdminAIHealthDashboard;
}) {
  const style =
    levelStyle(
      dashboard
        .overall
        .level
    );

  return (
    <section
      role={
        dashboard
          .overall
          .level ===
          "critical"
          ? "alert"
          : "status"
      }
      className={`rounded-3xl border p-5 shadow-sm sm:p-6 ${style.card}`}
    >

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">

        <div>

          <span className={`inline-flex rounded-full px-3 py-1 text-[10px] font-black ${style.badge}`}>
            {
              dashboard
                .overall
                .level ===
                "healthy"
                ? "HEALTHY"
                : dashboard
                    .overall
                    .level ===
                    "critical"
                  ? "ACTION REQUIRED"
                  : "ATTENTION"
            }
          </span>

          <h2 className="mt-3 text-xl font-black text-slate-950">
            {
              dashboard
                .overall
                .title
            }
          </h2>

          <p className="mt-2 text-sm leading-7 text-slate-600">
            {
              dashboard
                .overall
                .message
            }
          </p>

        </div>

        <Link
          href="/admin/evals/release"
          className={`shrink-0 rounded-xl px-4 py-2.5 text-xs font-black ${style.action}`}
        >
          بررسی آمادگی Release
        </Link>

      </div>

    </section>
  );
}

/*
 * ============================================
 * Action Queue
 * ============================================
 */

function ActionQueue({
  dashboard,
}: {
  dashboard:
    AdminAIHealthDashboard;
}) {
  const items =
    dashboard
      .regressions
      .items;

  return (
    <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">

      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">

        <div>

          <h2 className="font-black text-slate-950">
            اقدامات فوری AI
          </h2>

          <p className="mt-1 text-[10px] text-slate-400">
            آخرین Regression و Failureهای Auto Test
          </p>

        </div>

        <Link
          href="/admin/evals"
          className="text-xs font-black text-indigo-700"
        >
          Test Center
        </Link>

      </div>

      <div className="space-y-3 p-4 sm:p-5">

        {items.length >
        0 ? (
          items.map(
            (
              item
            ) => (
              <Link
                key={
                  item.id
                }
                href={
                  item.detailHref
                }
                className="block rounded-xl border border-slate-200 p-3 transition hover:border-indigo-200 hover:bg-indigo-50/30"
              >

                <div className="flex flex-wrap items-center gap-2">

                  <span
                    className={`rounded-full px-2 py-1 text-[9px] font-black ${
                      item.severity ===
                      "critical"
                        ? "bg-rose-100 text-rose-700"
                        : item.kind ===
                            "running"
                          ? "bg-blue-100 text-blue-700"
                          : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {
                      item.kind ===
                      "regression"
                        ? "REGRESSION"
                        : item.kind ===
                            "error"
                          ? "ERROR"
                          : item.kind ===
                              "running"
                            ? "RUNNING"
                            : "FAIL"
                    }
                  </span>

                  <span className="rounded-full bg-slate-100 px-2 py-1 text-[9px] font-black text-slate-600">
                    {
                      item.scope ===
                      "topic"
                        ? "TOPIC / GUIDANCE"
                        : "KNOWLEDGE"
                    }
                  </span>

                </div>

                <p className="mt-2 text-sm font-black text-slate-900">
                  {
                    item.entityTitle
                  }
                </p>

                <p className="mt-1 text-xs leading-6 text-slate-500">
                  {
                    item.message
                  }
                </p>

              </Link>
            )
          )
        ) : (
          <EmptyState
            text="Regression یا Failure فعال Auto Test وجود ندارد."
          />
        )}

      </div>

    </section>
  );
}

/*
 * ============================================
 * Grounding
 * ============================================
 */

function GroundingCard({
  dashboard,
}: {
  dashboard:
    AdminAIHealthDashboard;
}) {
  const grounding =
    dashboard.grounding;

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">

      <div className="flex items-start justify-between gap-3">

        <div>

          <h2 className="font-black text-slate-950">
            سلامت Grounding
          </h2>

          <p className="mt-1 text-[10px] text-slate-400">
            {
              grounding.rangeLabel
            }
          </p>

        </div>

        <Link
          href="/admin/analytics/grounding"
          className="text-xs font-black text-indigo-700"
        >
          جزئیات
        </Link>

      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">

        <SmallMetric
          label="Required"
          value={
            grounding.required
          }
        />

        <SmallMetric
          label="Verified"
          value={
            grounding.verified
          }
        />

        <SmallMetric
          label="Blocked"
          value={
            grounding.blocked
          }
        />

        <SmallMetric
          label="Unsupported"
          value={
            grounding.unsupportedClaims
          }
        />

        <SmallMetric
          label="Operational Error"
          value={
            grounding.operationalErrors
          }
        />

        <SmallMetric
          label="Block Rate"
          value={`${formatNumber(
            grounding.blockRate
          )}٪`}
        />

      </div>

    </section>
  );
}

/*
 * ============================================
 * Gaps
 * ============================================
 */

function GapQueue({
  dashboard,
}: {
  dashboard:
    AdminAIHealthDashboard;
}) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">

      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">

        <div>

          <h2 className="font-black text-slate-950">
            Knowledge Gapهای اولویت‌دار
          </h2>

          <p className="mt-1 text-[10px] text-slate-400">
            بر اساس Priority Score فعلی
          </p>

        </div>

        <Link
          href="/admin/knowledge/gaps"
          className="text-xs font-black text-amber-700"
        >
          مشاهده همه
        </Link>

      </div>

      <div className="space-y-3 p-4 sm:p-5">

        {dashboard
          .gaps
          .top
          .length >
        0 ? (
          dashboard.gaps.top.map(
            (
              gap
            ) => (
              <Link
                key={
                  gap.id
                }
                href={`/admin/knowledge/gaps/${gap.id}`}
                className="block rounded-xl border border-slate-200 p-3 transition hover:border-amber-200 hover:bg-amber-50/30"
              >

                <div className="flex flex-wrap items-center justify-between gap-2">

                  <p className="text-sm font-black text-slate-900">
                    {
                      gap.title
                    }
                  </p>

                  <span className="rounded-full bg-amber-100 px-2 py-1 text-[9px] font-black text-amber-700">
                    Priority
                    {" "}
                    {
                      formatNumber(
                        gap.priorityScore
                      )
                    }
                  </span>

                </div>

                <p className="mt-2 text-[10px] text-slate-400">
                  {
                    gap.topicName ||
                    "بدون Topic"
                  }
                  {" · "}
                  {
                    gap.occurrenceCount.toLocaleString(
                      "fa-IR"
                    )
                  }
                  {" "}
                  تکرار
                </p>

              </Link>
            )
          )
        ) : (
          <EmptyState
            text="Knowledge Gap باز یا در حال بررسی وجود ندارد."
          />
        )}

      </div>

    </section>
  );
}

/*
 * ============================================
 * Release
 * ============================================
 */

function ReleaseCard({
  dashboard,
}: {
  dashboard:
    AdminAIHealthDashboard;
}) {
  const release =
    dashboard.release;

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">

      <div className="flex items-start justify-between gap-3">

        <div>

          <h2 className="font-black text-slate-950">
            Release Gate
          </h2>

          <p className="mt-1 text-[10px] text-slate-400">
            Golden Suite Baseline vs Candidate
          </p>

        </div>

        <Link
          href="/admin/evals/release"
          className="text-xs font-black text-indigo-700"
        >
          جزئیات
        </Link>

      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">

        <SmallMetric
          label="Regression"
          value={
            release.regressions
          }
        />

        <SmallMetric
          label="ERROR"
          value={
            release.errors
          }
        />

        <SmallMetric
          label="Improvement"
          value={
            release.improvements
          }
        />

        <SmallMetric
          label="Failure قدیمی"
          value={
            release.persistentFailures
          }
        />

      </div>

      <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs leading-6 text-slate-600">

        <p>
          Baseline:
          {" "}
          <strong>
            {
              release.baselineLabel ||
              "—"
            }
          </strong>
        </p>

        <p className="mt-1">
          Candidate:
          {" "}
          <strong>
            {
              release.candidateLabel ||
              "—"
            }
          </strong>
        </p>

        <p className="mt-2 text-slate-500">
          {
            release.message
          }
        </p>

      </div>

    </section>
  );
}

/*
 * ============================================
 * Golden Coverage Risk
 * ============================================
 */

function CoverageRiskCard({
  dashboard,
}: {
  dashboard:
    AdminAIHealthDashboard;
}) {
  const coverage =
    dashboard.coverage;

  const hasRisk =
    coverage.uncoveredTopics >
      0 ||
    coverage.uncoveredKnowledge >
      0 ||
    coverage.topicOnlyKnowledge >
      0;

  return (
    <section
      className={`rounded-3xl border p-5 shadow-sm ${
        hasRisk
          ? "border-amber-200 bg-amber-50/40"
          : "border-emerald-200 bg-emerald-50/40"
      }`}
    >

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">

        <div>

          <h2 className="font-black text-slate-950">
            Regression Protection Coverage
          </h2>

          <p className="mt-2 text-xs leading-6 text-slate-600">
            {
              hasRisk
                ? `${coverage.uncoveredTopics.toLocaleString(
                    "fa-IR"
                  )} Topic و ${coverage.uncoveredKnowledge.toLocaleString(
                    "fa-IR"
                  )} Knowledge هنوز بدون محافظ مستقیم Golden Test هستند.`
                : "تمام Topicها و Knowledgeهای منتشرشده حداقل یک محافظ Golden Test دارند."
            }
          </p>

          <p className="mt-1 text-[10px] text-slate-500">
            Source Coverage مستقیم:
            {" "}
            {
              formatNumber(
                coverage.directKnowledgeCoveragePercent
              )
            }
            ٪
            {" · "}
            Topic-only:
            {" "}
            {
              coverage.topicOnlyKnowledge.toLocaleString(
                "fa-IR"
              )
            }
          </p>

        </div>

        <Link
          href="/admin/evals/coverage"
          className="shrink-0 rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-black text-white"
        >
          بررسی Coverage
        </Link>

      </div>

    </section>
  );
}

/*
 * ============================================
 * Availability
 * ============================================
 */

function AvailabilityCard({
  dashboard,
}: {
  dashboard:
    AdminAIHealthDashboard;
}) {
  const unavailable =
    Object.entries(
      dashboard.availability
    )
      .filter(
        (
          [
            ,
            available,
          ]
        ) =>
          !available
      )
      .map(
        (
          [
            key,
          ]
        ) =>
          key
      );

  if (
    unavailable.length ===
    0
  ) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold leading-6 text-amber-800">
      بخشی از Health Dashboard موقتاً در دسترس نبود:
      {" "}
      {
        unavailable.join(
          "، "
        )
      }
      . سایر KPIها همچنان معتبر هستند.
    </div>
  );
}

/*
 * ============================================
 * UI Helpers
 * ============================================
 */

function HealthMetric({
  label,
  value,
  detail,
  level,
  href,
}: {
  label:
    string;

  value:
    string;

  detail:
    string;

  level:
    AdminAIHealthLevel;

  href:
    string;
}) {
  const style =
    levelStyle(
      level
    );

  return (
    <Link
      href={
        href
      }
      className={`rounded-2xl border p-4 shadow-sm transition hover:-translate-y-0.5 ${style.metric}`}
    >

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

      <p className="mt-2 line-clamp-2 text-[10px] leading-5 opacity-70">
        {
          detail
        }
      </p>

    </Link>
  );
}

function SmallMetric({
  label,
  value,
}: {
  label:
    string;

  value:
    number |
    string;
}) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">

      <p className="text-[9px] font-black text-slate-400">
        {
          label
        }
      </p>

      <p className="mt-1 text-base font-black text-slate-900">
        {
          typeof value ===
          "number"
            ? value.toLocaleString(
                "fa-IR"
              )
            : value
        }
      </p>

    </div>
  );
}

function EmptyState({
  text,
}: {
  text:
    string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-xs font-bold text-slate-400">
      {
        text
      }
    </div>
  );
}

function DashboardLoading() {
  return (
    <div className="space-y-5">

      <div className="h-32 animate-pulse rounded-3xl bg-slate-100" />

      <div className="h-36 animate-pulse rounded-3xl bg-slate-100" />

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
              className="h-32 animate-pulse rounded-2xl bg-slate-100"
            />
          )
        )}

      </div>

    </div>
  );
}

function levelStyle(
  level:
    AdminAIHealthLevel
) {
  if (
    level ===
    "critical"
  ) {
    return {
      card:
        "border-rose-300 bg-rose-50",

      badge:
        "bg-rose-200 text-rose-800",

      action:
        "bg-rose-700 text-white",

      metric:
        "border-rose-200 bg-rose-50 text-rose-950",
    };
  }

  if (
    level ===
    "warning"
  ) {
    return {
      card:
        "border-amber-300 bg-amber-50",

      badge:
        "bg-amber-200 text-amber-800",

      action:
        "bg-amber-700 text-white",

      metric:
        "border-amber-200 bg-amber-50 text-amber-950",
    };
  }

  return {
    card:
      "border-emerald-300 bg-emerald-50",

    badge:
      "bg-emerald-200 text-emerald-800",

    action:
      "bg-emerald-700 text-white",

    metric:
      "border-emerald-200 bg-emerald-50 text-emerald-950",
  };
}

function releaseLabel(
  value:
    AdminAIHealthDashboard[
      "release"
    ][
      "status"
    ]
) {
  switch (
    value
  ) {
    case "ready":
      return "READY";

    case "blocked":
      return "BLOCKED";

    case "not_ready":
      return "NOT READY";

    case "unavailable":
    default:
      return "UNKNOWN";
  }
}

function formatNumber(
  value:
    number
) {
  return value.toLocaleString(
    "fa-IR",
    {
      maximumFractionDigits:
        1,
    }
  );
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
    return "—";
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
