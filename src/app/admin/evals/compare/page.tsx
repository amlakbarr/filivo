"use client";

import Link from "next/link";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import type {
  AIEvalBatch,
  AIEvalBatchComparison,
  AIEvalComparisonOutcome,
  AIEvalRun,
} from "@/types/ai-evals";

type BatchesResponse =
  | {
      success:
        true;

      batches:
        AIEvalBatch[];
    }
  | {
      success:
        false;

      message:
        string;
    };

type CompareResponse =
  | {
      success:
        true;

      comparison:
        AIEvalBatchComparison;
    }
  | {
      success:
        false;

      message:
        string;
    };

export default function AIEvalComparePage() {
  const [
    batches,
    setBatches,
  ] =
    useState<
      AIEvalBatch[]
    >(
      []
    );

  const [
    baselineId,
    setBaselineId,
  ] =
    useState(
      ""
    );

  const [
    currentId,
    setCurrentId,
  ] =
    useState(
      ""
    );

  const [
    comparison,
    setComparison,
  ] =
    useState<
      AIEvalBatchComparison |
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
    comparing,
    setComparing,
  ] =
    useState(
      false
    );

  const [
    busyBaseline,
    setBusyBaseline,
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

  const [
    notice,
    setNotice,
  ] =
    useState(
      ""
    );

  const completedBatches =
    useMemo(
      () =>
        batches.filter(
          (
            batch
          ) =>
            batch.status !==
            "running"
        ),
      [
        batches,
      ]
    );

  const loadBatches =
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
              "/api/admin/evals/batches",
              {
                cache:
                  "no-store",
              }
            );

          const body =
            (
              await response.json()
            ) as
              BatchesResponse;

          if (
            !response.ok ||
            !body.success
          ) {
            throw new Error(
              "message" in
              body
                ? body.message
                : "دریافت Batchها ناموفق بود."
            );
          }

          setBatches(
            body.batches
          );

          const baseline =
            body.batches.find(
              (
                batch
              ) =>
                batch.isBaseline
            );

          const current =
            body.batches.find(
              (
                batch
              ) =>
                batch.status !==
                  "running" &&
                batch.id !==
                  baseline?.id
            );

          setBaselineId(
            (
              existing
            ) =>
              existing ||
              baseline?.id ||
              ""
          );

          setCurrentId(
            (
              existing
            ) =>
              existing ||
              current?.id ||
              ""
          );
        } catch (
          loadError
        ) {
          setError(
            loadError instanceof
              Error
              ? loadError.message
              : "دریافت Batchها ناموفق بود."
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
      void loadBatches();
    },
    [
      loadBatches,
    ]
  );

  async function compare() {
    setError(
      ""
    );

    setNotice(
      ""
    );

    if (
      !baselineId ||
      !currentId
    ) {
      setError(
        "Baseline و Current Batch را انتخاب کنید."
      );

      return;
    }

    if (
      baselineId ===
      currentId
    ) {
      setError(
        "دو Batch متفاوت انتخاب کنید."
      );

      return;
    }

    setComparing(
      true
    );

    try {
      const params =
        new URLSearchParams({
          baseline:
            baselineId,

          current:
            currentId,
        });

      const response =
        await fetch(
          `/api/admin/evals/compare?${params.toString()}`,
          {
            cache:
              "no-store",
          }
        );

      const body =
        (
          await response.json()
        ) as
          CompareResponse;

      if (
        !response.ok ||
        !body.success
      ) {
        throw new Error(
          "message" in
          body
            ? body.message
            : "مقایسه انجام نشد."
        );
      }

      setComparison(
        body.comparison
      );
    } catch (
      compareError
    ) {
      setComparison(
        null
      );

      setError(
        compareError instanceof
          Error
          ? compareError.message
          : "مقایسه انجام نشد."
      );
    } finally {
      setComparing(
        false
      );
    }
  }

  async function markBaseline() {
    if (
      !currentId
    ) {
      return;
    }

    setBusyBaseline(
      true
    );

    setError(
      ""
    );

    setNotice(
      ""
    );

    try {
      const response =
        await fetch(
          `/api/admin/evals/batches/${currentId}/baseline`,
          {
            method:
              "POST",
          }
        );

      const body =
        await response
          .json();

      if (
        !response.ok ||
        body.success !==
          true
      ) {
        throw new Error(
          body.message ||
          "ثبت Baseline انجام نشد."
        );
      }

      setBaselineId(
        currentId
      );

      setCurrentId(
        ""
      );

      setComparison(
        null
      );

      setNotice(
        "Batch انتخاب‌شده به‌عنوان Baseline ثبت شد."
      );

      await loadBatches();
    } catch (
      baselineError
    ) {
      setError(
        baselineError instanceof
          Error
          ? baselineError.message
          : "ثبت Baseline انجام نشد."
      );
    } finally {
      setBusyBaseline(
        false
      );
    }
  }

  return (
    <main
      dir="rtl"
      className="space-y-6"
    >

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">

        <Link
          href="/admin/evals"
          className="text-xs font-black text-indigo-700"
        >
          → بازگشت به مرکز تست AI
        </Link>

        <div className="mt-5 flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">

          <div>

            <p className="text-xs font-black text-indigo-700">
              Versioned Regression
            </p>

            <h1 className="mt-2 text-2xl font-black text-slate-950 sm:text-3xl">
              مقایسه Golden Test Runها
            </h1>

            <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-500">
              یک Baseline پایدار را با اجرای جدید مقایسه کنید تا Regression، Improvement و تغییرات Environment مشخص شوند.
            </p>

          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:min-w-[700px]">

            <BatchSelect
              label="Baseline"
              value={
                baselineId
              }
              batches={
                completedBatches
              }
              onChange={
                setBaselineId
              }
            />

            <BatchSelect
              label="Current"
              value={
                currentId
              }
              batches={
                completedBatches
              }
              onChange={
                setCurrentId
              }
            />

            <button
              type="button"
              onClick={() =>
                void compare()
              }
              disabled={
                comparing ||
                loading
              }
              className="rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-black text-white disabled:opacity-50"
            >
              {
                comparing
                  ? "در حال مقایسه..."
                  : "مقایسه"
              }
            </button>

            <button
              type="button"
              onClick={() =>
                void markBaseline()
              }
              disabled={
                !currentId ||
                busyBaseline
              }
              className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-xs font-black text-indigo-700 disabled:opacity-50"
            >
              {
                busyBaseline
                  ? "در حال ثبت..."
                  : "Current را Baseline کن"
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

      {notice && (
        <div
          role="status"
          className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700"
        >
          {
            notice
          }
        </div>
      )}

      {comparison && (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7">

            <Metric
              label="Regression"
              value={
                comparison
                  .summary
                  .regressions
              }
              tone="danger"
            />

            <Metric
              label="Improvement"
              value={
                comparison
                  .summary
                  .improvements
              }
              tone="success"
            />

            <Metric
              label="Stable PASS"
              value={
                comparison
                  .summary
                  .stablePass
              }
              tone="success"
            />

            <Metric
              label="Failure ادامه‌دار"
              value={
                comparison
                  .summary
                  .persistentFailures
              }
              tone="warning"
            />

            <Metric
              label="ERROR"
              value={
                comparison
                  .summary
                  .errors
              }
              tone="warning"
            />

            <Metric
              label="Case جدید"
              value={
                comparison
                  .summary
                  .newCases
              }
            />

            <Metric
              label="Case حذف‌شده"
              value={
                comparison
                  .summary
                  .removedCases
              }
            />

          </section>

          <EnvironmentComparison
            comparison={
              comparison
            }
          />

          <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">

            <div className="border-b border-slate-100 px-5 py-5 sm:px-6">

              <h2 className="text-lg font-black text-slate-950">
                نتیجه Caseها
              </h2>

              <p className="mt-1 text-xs leading-6 text-slate-400">
                Regressionها در ابتدای فهرست قرار می‌گیرند.
              </p>

            </div>

            <div className="space-y-4 p-4 sm:p-6">

              {comparison.rows.map(
                (
                  row
                ) => (
                  <ComparisonCard
                    key={
                      row.key
                    }
                    row={
                      row
                    }
                  />
                )
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
 * Environment
 * ============================================
 */

function EnvironmentComparison({
  comparison,
}: {
  comparison:
    AIEvalBatchComparison;
}) {
  return (
    <section className="grid gap-4 xl:grid-cols-2">

      <BatchCard
        title="Baseline"
        batch={
          comparison.baseline
        }
      />

      <BatchCard
        title="Current"
        batch={
          comparison.current
        }
      />

      <div className="xl:col-span-2 rounded-2xl border border-slate-200 bg-white p-4">

        <div className="flex flex-wrap gap-2">

          <EnvironmentBadge
            changed={
              comparison
                .environment
                .configChanged
            }
            changedText="Configuration تغییر کرده"
            stableText="Configuration ثابت است"
          />

          <EnvironmentBadge
            changed={
              comparison
                .environment
                .knowledgeChanged
            }
            changedText="Knowledge تغییر کرده"
            stableText="Knowledge Fingerprint ثابت است"
          />

        </div>

        <p className="mt-3 text-xs leading-6 text-slate-500">
          اگر Config ثابت ولی Knowledge تغییر کرده باشد، Regression احتمالاً ناشی از Knowledge/Sync است. اگر Config Hash تغییر کرده باشد، Model، Prompt، Retrieval threshold، Vector Store یا تنظیمات مرتبط نیز تغییر کرده‌اند.
        </p>

      </div>

    </section>
  );
}

function BatchCard({
  title,
  batch,
}: {
  title:
    string;

  batch:
    AIEvalBatch;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4">

      <div className="flex items-center justify-between gap-3">

        <div>

          <p className="text-[10px] font-black text-slate-400">
            {
              title
            }
          </p>

          <h3 className="mt-1 text-sm font-black text-slate-950">
            {
              batch.label
            }
          </h3>

        </div>

        {batch.isBaseline && (
          <span className="rounded-full bg-indigo-100 px-2.5 py-1 text-[10px] font-black text-indigo-700">
            Baseline
          </span>
        )}

      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 text-[10px]">

        <Info
          label="PASS"
          value={
            batch.passedCount
              .toLocaleString(
                "fa-IR"
              )
          }
        />

        <Info
          label="FAIL"
          value={
            batch.failedCount
              .toLocaleString(
                "fa-IR"
              )
          }
        />

        <Info
          label="Model"
          value={
            batch.model ||
            "—"
          }
          ltr
        />

        <Info
          label="Knowledge"
          value={
            String(
              batch
                .systemSnapshot
                .publishedKnowledgeCount ??
              "—"
            )
          }
        />

      </div>

    </article>
  );
}

/*
 * ============================================
 * Comparison Card
 * ============================================
 */

function ComparisonCard({
  row,
}: {
  row:
    AIEvalBatchComparison[
      "rows"
    ][number];
}) {
  const style =
    outcomeStyle(
      row.outcome
    );

  return (
    <article className={`rounded-2xl border p-4 sm:p-5 ${style.card}`}>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">

        <div>

          <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${style.badge}`}>
            {
              outcomeLabel(
                row.outcome
              )
            }
          </span>

          <h3 className="mt-3 text-sm font-black text-slate-950">
            {
              row.title
            }
          </h3>

          <p className="mt-2 whitespace-pre-wrap text-xs leading-6 text-slate-600">
            {
              row.question
            }
          </p>

        </div>

      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">

        <RunPanel
          title="Baseline"
          run={
            row.baselineRun
          }
        />

        <RunPanel
          title="Current"
          run={
            row.currentRun
          }
        />

      </div>

    </article>
  );
}

function RunPanel({
  title,
  run,
}: {
  title:
    string;

  run?:
    AIEvalRun;
}) {
  if (
    !run
  ) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-white p-3 text-xs font-bold text-slate-400">
        {
          title
        }
        : اجرا نشده
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">

      <div className="flex items-center justify-between gap-2">

        <span className="text-[10px] font-black text-slate-400">
          {
            title
          }
        </span>

        <span className={`rounded-full px-2 py-0.5 text-[9px] font-black ${
          run.status ===
          "passed"
            ? "bg-emerald-100 text-emerald-700"
            : run.status ===
                "failed"
              ? "bg-rose-100 text-rose-700"
              : "bg-amber-100 text-amber-700"
        }`}>
          {
            run.status.toUpperCase()
          }
        </span>

      </div>

      {run.actualAnswer && (
        <p className="mt-3 whitespace-pre-wrap text-xs leading-6 text-slate-700">
          {
            run.actualAnswer
          }
        </p>
      )}

      {run.failureReasons.length >
        0 && (
        <ul className="mt-3 list-disc space-y-1 pr-5 text-[11px] leading-5 text-rose-700">

          {run.failureReasons.map(
            (
              reason,
              index
            ) => (
              <li
                key={
                  `${run.id}-${index}`
                }
              >
                {
                  reason
                }
              </li>
            )
          )}

        </ul>
      )}

      <div className="mt-3 text-[10px] text-slate-400">
        Grounding:
        {" "}
        {
          run.groundingStatus ||
          "—"
        }
        {" · "}
        Verifier:
        {" "}
        {
          run.verifierStatus ||
          "—"
        }
      </div>

    </div>
  );
}

/*
 * ============================================
 * UI Helpers
 * ============================================
 */

function BatchSelect({
  label,
  value,
  batches,
  onChange,
}: {
  label:
    string;

  value:
    string;

  batches:
    AIEvalBatch[];

  onChange:
    (
      value:
        string
    ) => void;
}) {
  return (
    <label className="block">

      <span className="text-[10px] font-black text-slate-500">
        {
          label
        }
      </span>

      <select
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
        className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold text-slate-700 outline-none"
      >
        <option value="">
          انتخاب کنید
        </option>

        {batches.map(
          (
            batch
          ) => (
            <option
              key={
                batch.id
              }
              value={
                batch.id
              }
            >
              {
                batch.isBaseline
                  ? "★ "
                  : ""
              }
              {
                batch.label
              }
              {" · "}
              {
                batch.passedCount
              }
              /
              {
                batch.totalCases
              }
            </option>
          )
        )}

      </select>

    </label>
  );
}

function Metric({
  label,
  value,
  tone = "default",
}: {
  label:
    string;

  value:
    number;

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
          value.toLocaleString(
            "fa-IR"
          )
        }
      </p>

    </div>
  );
}

function EnvironmentBadge({
  changed,
  changedText,
  stableText,
}: {
  changed:
    boolean;

  changedText:
    string;

  stableText:
    string;
}) {
  return (
    <span
      className={`rounded-full px-3 py-1.5 text-[10px] font-black ${
        changed
          ? "bg-amber-100 text-amber-800"
          : "bg-emerald-100 text-emerald-700"
      }`}
    >
      {
        changed
          ? changedText
          : stableText
      }
    </span>
  );
}

function Info({
  label,
  value,
  ltr = false,
}: {
  label:
    string;

  value:
    string;

  ltr?:
    boolean;
}) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">

      <span className="text-slate-400">
        {
          label
        }
        :
        {" "}
      </span>

      <span
        dir={
          ltr
            ? "ltr"
            : undefined
        }
        className="font-black text-slate-700"
      >
        {
          value
        }
      </span>

    </div>
  );
}

function outcomeStyle(
  outcome:
    AIEvalComparisonOutcome
) {
  switch (
    outcome
  ) {
    case "regression":
      return {
        card:
          "border-rose-300 bg-rose-50/50",

        badge:
          "bg-rose-200 text-rose-800",
      };

    case "improvement":
      return {
        card:
          "border-emerald-200 bg-emerald-50/40",

        badge:
          "bg-emerald-100 text-emerald-700",
      };

    case "persistent_failure":
      return {
        card:
          "border-amber-200 bg-amber-50/40",

        badge:
          "bg-amber-100 text-amber-700",
      };

    case "error":
      return {
        card:
          "border-orange-200 bg-orange-50/40",

        badge:
          "bg-orange-100 text-orange-700",
      };

    case "new_case":
    case "removed_case":
      return {
        card:
          "border-indigo-200 bg-indigo-50/30",

        badge:
          "bg-indigo-100 text-indigo-700",
      };

    case "stable_pass":
    default:
      return {
        card:
          "border-slate-200 bg-white",

        badge:
          "bg-slate-100 text-slate-600",
      };
  }
}

function outcomeLabel(
  outcome:
    AIEvalComparisonOutcome
) {
  switch (
    outcome
  ) {
    case "regression":
      return "PASS → FAIL · REGRESSION";

    case "improvement":
      return "FAIL → PASS · IMPROVEMENT";

    case "persistent_failure":
      return "FAIL → FAIL";

    case "error":
      return "ERROR";

    case "new_case":
      return "NEW CASE";

    case "removed_case":
      return "REMOVED CASE";

    case "stable_pass":
    default:
      return "PASS → PASS";
  }
}
