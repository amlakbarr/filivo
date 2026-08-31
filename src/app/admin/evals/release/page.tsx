"use client";

import Link from "next/link";

import {
  useCallback,
  useEffect,
  useState,
} from "react";

import type {
  AIEvalReleaseCoverageGate,
  AIEvalReleaseGate,
  AIEvalReleaseGateReason,
} from "@/types/ai-eval-release";

type ResponseBody =
  | {
      success:
        true;

      gate:
        AIEvalReleaseGate;
    }
  | {
      success:
        false;

      message:
        string;
    };

export default function AIEvalReleaseGatePage() {
  const [
    gate,
    setGate,
  ] =
    useState<
      AIEvalReleaseGate |
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
      async () => {
        setLoading(
          true
        );

        setError(
          ""
        );

        try {
          const response =
            await fetch(
              "/api/admin/evals/release-gate",
              {
                cache:
                  "no-store",
              }
            );

          const body =
            (
              await response.json()
            ) as ResponseBody;

          if (
            !response.ok ||
            !body.success
          ) {
            throw new Error(
              "message" in
              body
                ? body.message
                : "دریافت Release Gate ناموفق بود."
            );
          }

          setGate(
            body.gate
          );
        } catch (
          loadError
        ) {
          setGate(
            null
          );

          setError(
            loadError instanceof
              Error
              ? loadError.message
              : "دریافت Release Gate ناموفق بود."
          );
        } finally {
          setLoading(
            false
          );
        }
      },
      []
    );

  useEffect(
    () => {
      void load();
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

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">

        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">

          <div>

            <Link
              href="/admin/evals"
              className="text-xs font-black text-indigo-700"
            >
              → بازگشت به مرکز تست AI
            </Link>

            <p className="mt-5 text-xs font-black text-indigo-700">
              Production Readiness
            </p>

            <h1 className="mt-2 text-2xl font-black text-slate-950 sm:text-3xl">
              Release Gate هوش مصنوعی
            </h1>

            <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-500">
              این Gate علاوه بر Regression و ERROR، کافی بودن Golden Test Coverage را نیز قبل از انتشار بررسی می‌کند.
            </p>

          </div>

          <div className="flex flex-wrap gap-2">

            <Link
              href="/admin/evals/coverage"
              className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs font-black text-amber-700"
            >
              Coverage Report
            </Link>

            <button
              type="button"
              onClick={() =>
                void load()
              }
              disabled={
                loading
              }
              className="rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-black text-white disabled:opacity-50"
            >
              {
                loading
                  ? "در حال بررسی..."
                  : "بررسی دوباره"
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

      {gate && (
        <>
          <ReleaseStatus
            gate={
              gate
            }
          />

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">

            <Metric
              label="Regression"
              value={
                gate
                  .summary
                  .regressions
              }
              tone={
                gate
                  .summary
                  .regressions >
                0
                  ? "danger"
                  : "success"
              }
            />

            <Metric
              label="ERROR"
              value={
                gate
                  .summary
                  .errors
              }
              tone={
                gate
                  .summary
                  .errors >
                0
                  ? "danger"
                  : "success"
              }
            />

            <Metric
              label="Coverage Block"
              value={
                gate
                  .summary
                  .coverageBlockingIssues
              }
              tone={
                gate
                  .summary
                  .coverageBlockingIssues >
                0
                  ? "danger"
                  : "success"
              }
            />

            <Metric
              label="Coverage Warning"
              value={
                gate
                  .summary
                  .coverageWarnings
              }
              tone={
                gate
                  .summary
                  .coverageWarnings >
                0
                  ? "warning"
                  : "success"
              }
            />

            <Metric
              label="Improvement"
              value={
                gate
                  .summary
                  .improvements
              }
              tone="success"
            />

            <Metric
              label="Failure قدیمی"
              value={
                gate
                  .summary
                  .persistentFailures
              }
              tone={
                gate
                  .summary
                  .persistentFailures >
                0
                  ? "warning"
                  : "default"
              }
            />

            <Metric
              label="Config"
              value={
                gate
                  .summary
                  .configChanged
                  ? "تغییر"
                  : "ثابت"
              }
              tone={
                gate
                  .summary
                  .configChanged
                  ? "warning"
                  : "success"
              }
            />

            <Metric
              label="Knowledge"
              value={
                gate
                  .summary
                  .knowledgeChanged
                  ? "تغییر"
                  : "ثابت"
              }
              tone={
                gate
                  .summary
                  .knowledgeChanged
                  ? "warning"
                  : "success"
              }
            />

          </section>

          <CoverageGateCard
            coverage={
              gate.coverage
            }
          />

          <section className="grid gap-4 xl:grid-cols-2">

            <BatchCard
              title="Baseline"
              batch={
                gate.baseline
              }
            />

            <BatchCard
              title="Candidate"
              batch={
                gate.candidate
              }
            />

          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">

            <h2 className="text-lg font-black text-slate-950">
              دلایل تصمیم Release Gate
            </h2>

            <p className="mt-1 text-xs leading-6 text-slate-400">
              Blocking مانع Release می‌شود؛ Warning نیاز به پیگیری دارد ولی به‌تنهایی انتشار را متوقف نمی‌کند.
            </p>

            <div className="mt-4 space-y-3">

              {gate.reasons.map(
                (
                  reason,
                  index
                ) => (
                  <ReasonCard
                    key={
                      `${reason.code}-${index}`
                    }
                    reason={
                      reason
                    }
                  />
                )
              )}

            </div>

          </section>

          {gate.comparison &&
          gate
            .comparison
            .summary
            .regressions >
            0 && (
            <section className="rounded-3xl border border-rose-200 bg-rose-50/30 p-5 shadow-sm sm:p-6">

              <div className="flex flex-wrap items-center justify-between gap-3">

                <div>

                  <h2 className="text-lg font-black text-rose-950">
                    Regressionهای مسدودکننده Release
                  </h2>

                  <p className="mt-1 text-xs text-rose-700">
                    این Caseها در Baseline PASS و در Candidate FAIL شده‌اند.
                  </p>

                </div>

                <Link
                  href="/admin/evals/compare"
                  className="rounded-xl bg-rose-700 px-4 py-2.5 text-xs font-black text-white"
                >
                  مشاهده Compare کامل
                </Link>

              </div>

              <div className="mt-4 space-y-3">

                {gate
                  .comparison
                  .rows
                  .filter(
                    (
                      row
                    ) =>
                      row.outcome ===
                      "regression"
                  )
                  .map(
                    (
                      row
                    ) => (
                      <div
                        key={
                          row.key
                        }
                        className="rounded-xl border border-rose-200 bg-white p-4"
                      >

                        <p className="text-sm font-black text-slate-950">
                          {
                            row.title
                          }
                        </p>

                        <p className="mt-2 text-xs leading-6 text-slate-600">
                          {
                            row.question
                          }
                        </p>

                        {row
                          .currentRun
                          ?.failureReasons
                          .length ? (
                          <ul className="mt-3 list-disc space-y-1 pr-5 text-xs leading-6 text-rose-700">

                            {row
                              .currentRun
                              .failureReasons
                              .map(
                                (
                                  failure,
                                  index
                                ) => (
                                  <li
                                    key={
                                      `${row.key}-${index}`
                                    }
                                  >
                                    {
                                      failure
                                    }
                                  </li>
                                )
                              )}

                          </ul>
                        ) : null}

                      </div>
                    )
                  )}

              </div>

            </section>
          )}
        </>
      )}

    </main>
  );
}

/*
 * ============================================
 * Release Status
 * ============================================
 */

function ReleaseStatus({
  gate,
}: {
  gate:
    AIEvalReleaseGate;
}) {
  const ready =
    gate.status ===
    "ready";

  const notReady =
    gate.status ===
    "not_ready";

  return (
    <section
      role={
        ready
          ? "status"
          : "alert"
      }
      className={`rounded-3xl border p-6 shadow-sm ${
        ready
          ? "border-emerald-300 bg-emerald-50"
          : notReady
            ? "border-amber-300 bg-amber-50"
            : "border-rose-300 bg-rose-50"
      }`}
    >

      <p
        className={`text-xs font-black ${
          ready
            ? "text-emerald-700"
            : notReady
              ? "text-amber-700"
              : "text-rose-700"
        }`}
      >
        {
          ready
            ? "READY FOR RELEASE"
            : notReady
              ? "RELEASE CHECK INCOMPLETE"
              : "RELEASE BLOCKED"
        }
      </p>

      <h2
        className={`mt-2 text-2xl font-black ${
          ready
            ? "text-emerald-950"
            : notReady
              ? "text-amber-950"
              : "text-rose-950"
        }`}
      >
        {
          ready
            ? "نسخه از Quality Gate عبور کرده است"
            : notReady
              ? "داده کافی برای تصمیم انتشار وجود ندارد"
              : "انتشار این نسخه باید متوقف شود"
        }
      </h2>

      <p className="mt-2 text-sm leading-7 opacity-80">
        {
          ready
            ? "Regression و ERROR جدید وجود ندارد و Coverage Policy نیز مانع انتشار نیست."
            : "دلایل Blocking و Warning زیر را بررسی کنید."
        }
      </p>

    </section>
  );
}

/*
 * ============================================
 * Coverage Gate
 * ============================================
 */

function CoverageGateCard({
  coverage,
}: {
  coverage:
    AIEvalReleaseCoverageGate;
}) {
  const unavailable =
    !coverage.available;

  const blocked =
    coverage.blockingIssues >
    0;

  const warning =
    coverage.warnings >
    0;

  const cardClass =
    unavailable ||
    blocked
      ? "border-rose-200 bg-rose-50/30"
      : warning
        ? "border-amber-200 bg-amber-50/30"
        : "border-emerald-200 bg-emerald-50/30";

  return (
    <section className={`rounded-3xl border p-5 shadow-sm sm:p-6 ${cardClass}`}>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">

        <div>

          <div className="flex flex-wrap items-center gap-2">

            <h2 className="text-lg font-black text-slate-950">
              Golden Coverage Gate
            </h2>

            <span className={`rounded-full px-2.5 py-1 text-[9px] font-black ${
              coverage.mode ===
              "strict"
                ? "bg-rose-100 text-rose-700"
                : coverage.mode ===
                    "warn"
                  ? "bg-amber-100 text-amber-700"
                  : "bg-slate-100 text-slate-500"
            }`}>
              {
                coverage.mode.toUpperCase()
              }
            </span>

          </div>

          <p className="mt-2 text-xs leading-6 text-slate-600">
            {
              coverage.mode ===
              "strict"
                ? "در حالت strict، Topic Coverage و Knowledge Coverage زیر Threshold مانع Release می‌شوند."
                : coverage.mode ===
                    "warn"
                  ? "در حالت warn، Coverage deficit فقط Warning ایجاد می‌کند."
                  : "Coverage Gate در تصمیم Release غیرفعال است."
            }
          </p>

        </div>

        <Link
          href="/admin/evals/coverage"
          className="shrink-0 rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-black text-white"
        >
          مشاهده Coverage کامل
        </Link>

      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">

        <CoverageMetric
          label="Topic Coverage"
          current={
            coverage
              .topicCoveragePercent
          }
          minimum={
            coverage
              .minimumTopicCoveragePercent
          }
          countText={`${coverage.uncoveredTopics.toLocaleString(
            "fa-IR"
          )} Topic بدون پوشش`}
          passed={
            coverage
              .meetsTopicCoverage
          }
        />

        <CoverageMetric
          label="Knowledge Coverage"
          current={
            coverage
              .knowledgeCoveragePercent
          }
          minimum={
            coverage
              .minimumKnowledgeCoveragePercent
          }
          countText={`${coverage.uncoveredKnowledge.toLocaleString(
            "fa-IR"
          )} Knowledge بدون پوشش`}
          passed={
            coverage
              .meetsKnowledgeCoverage
          }
        />

        <CoverageMetric
          label="Direct Source Coverage"
          current={
            coverage
              .directKnowledgeCoveragePercent
          }
          minimum={
            coverage
              .minimumDirectKnowledgeCoveragePercent
          }
          countText={`${coverage.topicOnlyKnowledge.toLocaleString(
            "fa-IR"
          )} Knowledge فقط Topic-level`}
          passed={
            coverage
              .meetsDirectKnowledgeCoverage
          }
          warningOnly
        />

      </div>

      {!coverage.available && (
        <div className="mt-4 rounded-xl border border-rose-200 bg-white px-4 py-3 text-xs font-bold text-rose-700">
          گزارش Coverage قابل دریافت نبود. در حالت strict این وضعیت Fail-closed است و Release را Block می‌کند.
        </div>
      )}

    </section>
  );
}

function CoverageMetric({
  label,
  current,
  minimum,
  countText,
  passed,
  warningOnly = false,
}: {
  label:
    string;

  current:
    number;

  minimum:
    number;

  countText:
    string;

  passed:
    boolean;

  warningOnly?:
    boolean;
}) {
  return (
    <div className="rounded-2xl border border-white/70 bg-white p-4">

      <div className="flex items-center justify-between gap-2">

        <p className="text-[10px] font-black text-slate-500">
          {
            label
          }
        </p>

        <span
          className={`rounded-full px-2 py-0.5 text-[9px] font-black ${
            passed
              ? "bg-emerald-100 text-emerald-700"
              : warningOnly
                ? "bg-amber-100 text-amber-700"
                : "bg-rose-100 text-rose-700"
          }`}
        >
          {
            passed
              ? "PASS"
              : warningOnly
                ? "WARNING"
                : "BELOW GATE"
          }
        </span>

      </div>

      <p className="mt-3 text-2xl font-black text-slate-950">
        {
          formatPercent(
            current
          )
        }
        ٪
      </p>

      <p className="mt-1 text-[10px] text-slate-400">
        حداقل:
        {" "}
        {
          formatPercent(
            minimum
          )
        }
        ٪
      </p>

      <p className="mt-2 text-[10px] font-bold leading-5 text-slate-600">
        {
          countText
        }
      </p>

    </div>
  );
}

/*
 * ============================================
 * Reason
 * ============================================
 */

function ReasonCard({
  reason,
}: {
  reason:
    AIEvalReleaseGateReason;
}) {
  const style =
    reason.severity ===
    "blocking"
      ? "border-rose-200 bg-rose-50 text-rose-900"
      : reason.severity ===
          "warning"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : "border-indigo-100 bg-indigo-50 text-indigo-900";

  return (
    <article className={`rounded-xl border p-4 ${style}`}>

      <div className="flex flex-wrap items-center gap-2">

        <span className="rounded-full bg-white/70 px-2 py-1 text-[9px] font-black">
          {
            reason.severity ===
            "blocking"
              ? "BLOCKING"
              : reason.severity ===
                  "warning"
                ? "WARNING"
                : "INFO"
          }
        </span>

        <h3 className="text-sm font-black">
          {
            reason.title
          }
        </h3>

      </div>

      <p className="mt-2 text-xs leading-6">
        {
          reason.message
        }
      </p>

    </article>
  );
}

/*
 * ============================================
 * Batch
 * ============================================
 */

function BatchCard({
  title,
  batch,
}: {
  title:
    string;

  batch:
    AIEvalReleaseGate[
      "baseline"
    ];
}) {
  if (
    !batch
  ) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-5 text-sm font-bold text-slate-400">
        {
          title
        }
        :
        {" "}
        موجود نیست
      </div>
    );
  }

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">

      <p className="text-[10px] font-black text-slate-400">
        {
          title
        }
      </p>

      <h3 className="mt-2 text-sm font-black text-slate-950">
        {
          batch.label
        }
      </h3>

      <div className="mt-4 flex flex-wrap gap-2 text-[10px]">

        <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-black text-emerald-700">
          PASS:
          {" "}
          {
            batch
              .passedCount
              .toLocaleString(
                "fa-IR"
              )
          }
        </span>

        <span className="rounded-full bg-rose-50 px-2.5 py-1 font-black text-rose-700">
          FAIL:
          {" "}
          {
            batch
              .failedCount
              .toLocaleString(
                "fa-IR"
              )
          }
        </span>

        <span className="rounded-full bg-amber-50 px-2.5 py-1 font-black text-amber-700">
          ERROR:
          {" "}
          {
            batch
              .errorCount
              .toLocaleString(
                "fa-IR"
              )
          }
        </span>

      </div>

      <p
        dir="ltr"
        className="mt-4 text-left font-mono text-[10px] text-slate-400"
      >
        {
          batch.model ||
          "—"
        }
      </p>

    </article>
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
    number |
    string;

  tone?:
    | "default"
    | "success"
    | "warning"
    | "danger";
}) {
  const style =
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
    <div className={`rounded-2xl border p-4 shadow-sm ${style}`}>

      <p className="text-[10px] font-black opacity-60">
        {
          label
        }
      </p>

      <p className="mt-2 text-xl font-black">
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

function formatPercent(
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
