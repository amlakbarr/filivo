"use client";

import Link from "next/link";

import {
  useParams,
} from "next/navigation";

import {
  useCallback,
  useEffect,
  useState,
} from "react";

import type {
  AIEvalComparisonOutcome,
  AIEvalRun,
} from "@/types/ai-evals";

import type {
  TopicEvalDetail,
  TopicEvalDetailBatch,
  TopicEvalDetailRow,
} from "@/types/topic-eval-detail";

type ResponseBody =
  | {
      success:
        true;

      detail:
        TopicEvalDetail;
    }
  | {
      success:
        false;

      message:
        string;
    };

export default function TopicEvalDetailPage() {
 const params =
  useParams<{
    id:
      string;
  }>();

 const topicId =
  String(
    params.id ||
      ""
  );

  const [
    detail,
    setDetail,
  ] =
    useState<
      TopicEvalDetail |
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
        if (
          !topicId
        ) {
          return;
        }

        setLoading(
          true
        );

        setError(
          ""
        );

        try {
          const response =
            await fetch(
              `/api/admin/topics/${topicId}/eval-detail`,
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
                : "دریافت جزئیات تست ناموفق بود."
            );
          }

          setDetail(
            body.detail
          );
        } catch (
          loadError
        ) {
          setDetail(
            null
          );

          setError(
            loadError instanceof
              Error
              ? loadError.message
              : "دریافت جزئیات تست ناموفق بود."
          );
        } finally {
          setLoading(
            false
          );
        }
      },
      [
        topicId,
      ]
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
              href="/admin/topics"
              className="text-xs font-black text-emerald-700"
            >
              → بازگشت به موضوعات
            </Link>

            <p className="mt-5 text-xs font-black text-indigo-700">
              Topic / Guidance Regression
            </p>

            <h1 className="mt-2 text-2xl font-black text-slate-950 sm:text-3xl">
              {
                detail
                  ?.topic
                  .name ||
                "جزئیات Auto Golden Test موضوع"
              }
            </h1>

            {detail && (
              <div className="mt-3 flex flex-wrap gap-2 text-[10px]">

                <span
                  className={`rounded-full px-2.5 py-1 font-black ${
                    detail.topic.active
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {
                    detail.topic.active
                      ? "فعال"
                      : "غیرفعال"
                  }
                </span>

                <span className="rounded-full bg-slate-100 px-2.5 py-1 font-black text-slate-600">
                  آخرین تغییر:
                  {" "}
                  {
                    formatDateTime(
                      detail.topic.updated
                    )
                  }
                </span>

              </div>
            )}

          </div>

          <div className="flex flex-wrap gap-2">

            <Link
              href="/admin/topics"
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-black text-slate-700"
            >
              مدیریت Topic
            </Link>

            <Link
              href="/admin/evals"
              className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-xs font-black text-indigo-700"
            >
              Test Center
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

      {loading &&
      !detail ? (
        <LoadingState />
      ) : detail ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7">

            <Metric
              label="Regression"
              value={
                detail.summary.regressions
              }
              tone={
                detail.summary.regressions >
                0
                  ? "danger"
                  : "success"
              }
            />

            <Metric
              label="Improvement"
              value={
                detail.summary.improvements
              }
              tone="success"
            />

            <Metric
              label="Stable PASS"
              value={
                detail.summary.stablePass
              }
              tone="success"
            />

            <Metric
              label="FAIL ادامه‌دار"
              value={
                detail.summary.persistentFailures
              }
              tone={
                detail.summary.persistentFailures >
                0
                  ? "warning"
                  : "default"
              }
            />

            <Metric
              label="ERROR"
              value={
                detail.summary.errors
              }
              tone={
                detail.summary.errors >
                0
                  ? "danger"
                  : "default"
              }
            />

            <Metric
              label="Case جدید"
              value={
                detail.summary.newCases
              }
            />

            <Metric
              label="Case حذف‌شده"
              value={
                detail.summary.removedCases
              }
            />

          </section>

          <section className="grid gap-4 xl:grid-cols-2">

            <BatchCard
              title="Auto Run قبلی"
              batch={
                detail.previousBatch
              }
              emptyText="Auto Run قبلی وجود ندارد."
            />

            <BatchCard
              title="آخرین Auto Run"
              batch={
                detail.currentBatch
              }
              emptyText="برای این Topic هنوز Auto Run ثبت نشده است."
              current
            />

          </section>

          {detail.currentBatch?.capped && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold leading-6 text-amber-800">
              تعداد Golden Caseهای مرتبط بیشتر از سقف Auto Test بوده است؛ برای ارزیابی کامل یک Run All در Test Center اجرا کنید.
            </div>
          )}

          <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">

            <div className="border-b border-slate-100 px-5 py-5 sm:px-6">

              <h2 className="text-lg font-black text-slate-950">
                اثر تغییر Topic / Guidance روی Golden Questions
              </h2>

              <p className="mt-1 text-xs leading-6 text-slate-400">
                Regressionها و ERRORها در ابتدای فهرست هستند.
              </p>

            </div>

            <div className="space-y-4 p-4 sm:p-6">

              {detail.rows.length >
              0 ? (
                detail.rows.map(
                  (
                    row
                  ) => (
                    <CaseComparisonCard
                      key={
                        row.key
                      }
                      row={
                        row
                      }
                    />
                  )
                )
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-12 text-center text-sm font-bold text-slate-400">
                  هنوز Run قابل مقایسه‌ای برای این Topic وجود ندارد.
                </div>
              )}

            </div>

          </section>
        </>
      ) : null}

    </main>
  );
}

function BatchCard({
  title,
  batch,
  emptyText,
  current = false,
}: {
  title:
    string;

  batch?:
    TopicEvalDetailBatch;

  emptyText:
    string;

  current?:
    boolean;
}) {
  if (
    !batch
  ) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-5 text-sm font-bold text-slate-400">
        {
          emptyText
        }
      </div>
    );
  }

  const failing =
    batch.failed >
      0 ||
    batch.errors >
      0;

  return (
    <article
      className={`rounded-2xl border p-5 shadow-sm ${
        current &&
        failing
          ? "border-rose-200 bg-rose-50/30"
          : "border-slate-200 bg-white"
      }`}
    >

      <div className="flex flex-wrap items-start justify-between gap-3">

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

        <BatchStatus
          batch={
            batch
          }
        />

      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">

        <SmallMetric
          label="PASS"
          value={
            batch.passed
          }
        />

        <SmallMetric
          label="FAIL"
          value={
            batch.failed
          }
        />

        <SmallMetric
          label="ERROR"
          value={
            batch.errors
          }
        />

        <SmallMetric
          label="TOTAL"
          value={
            batch.total
          }
        />

      </div>

      <div className="mt-4 space-y-1 text-[10px] leading-5 text-slate-500">

        <p>
          Trigger:
          {" "}
          <strong>
            {
              triggerLabel(
                batch.trigger
              )
            }
          </strong>
        </p>

        <p>
          Topic Active:
          {" "}
          {
            batch.topicActive ===
            undefined
              ? "—"
              : batch.topicActive
                ? "بله"
                : "خیر"
          }
        </p>

        <p>
          Revision:
          {" "}
          {
            batch.topicUpdated
              ? formatDateTime(
                  batch.topicUpdated
                )
              : "—"
          }
        </p>

        {batch.impactedCases !==
          undefined && (
          <p>
            Case مرتبط:
            {" "}
            {
              batch.impactedCases.toLocaleString(
                "fa-IR"
              )
            }
            {" · "}
            اجراشده:
            {" "}
            {
              (
                batch.executedCases ??
                batch.total
              ).toLocaleString(
                "fa-IR"
              )
            }
          </p>
        )}

      </div>

    </article>
  );
}

function BatchStatus({
  batch,
}: {
  batch:
    TopicEvalDetailBatch;
}) {
  const status =
    batch.status ===
      "running"
      ? {
          text:
            "RUNNING",

          className:
            "bg-blue-100 text-blue-700",
        }
      : batch.errors >
          0 ||
        batch.status ===
          "error"
        ? {
            text:
              "ERROR",

            className:
              "bg-orange-100 text-orange-700",
          }
        : batch.failed >
          0
          ? {
              text:
                "FAIL",

              className:
                "bg-rose-100 text-rose-700",
            }
          : {
              text:
                "PASS",

              className:
                "bg-emerald-100 text-emerald-700",
            };

  return (
    <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${status.className}`}>
      {
        status.text
      }
    </span>
  );
}

function CaseComparisonCard({
  row,
}: {
  row:
    TopicEvalDetailRow;
}) {
  const presentation =
    outcomePresentation(
      row.outcome
    );

  return (
    <article className={`rounded-2xl border p-4 sm:p-5 ${presentation.card}`}>

      <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-black ${presentation.badge}`}>
        {
          presentation.label
        }
      </span>

      <h3 className="mt-3 text-sm font-black text-slate-950">
        {
          row.title
        }
      </h3>

      <p className="mt-2 whitespace-pre-wrap text-xs leading-6 text-slate-600">
        {
          row.question ||
          "—"
        }
      </p>

      <div className="mt-4 grid gap-3 xl:grid-cols-2">

        <RunPanel
          title="قبل از تغییر"
          run={
            row.previousRun
          }
        />

        <RunPanel
          title="بعد از تغییر"
          run={
            row.currentRun
          }
          current
        />

      </div>

    </article>
  );
}

function RunPanel({
  title,
  run,
  current = false,
}: {
  title:
    string;

  run?:
    AIEvalRun;

  current?:
    boolean;
}) {
  if (
    !run
  ) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-white p-4 text-xs font-bold text-slate-400">
        {
          title
        }
        :
        {" "}
        اجرا نشده
      </div>
    );
  }

  const failed =
    run.status ===
      "failed" ||
    run.status ===
      "error";

  return (
    <div
      className={`rounded-xl border p-4 ${
        current &&
        failed
          ? "border-rose-200 bg-rose-50/30"
          : "border-slate-200 bg-white"
      }`}
    >

      <div className="flex flex-wrap items-center justify-between gap-2">

        <span className="text-[10px] font-black text-slate-400">
          {
            title
          }
        </span>

        <RunStatus
          status={
            run.status
          }
        />

      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-[10px]">

        <InfoBadge
          label="has_answer"
          value={
            run.actualHasAnswer ===
            undefined
              ? "—"
              : run.actualHasAnswer
                ? "true"
                : "false"
          }
        />

        <InfoBadge
          label="Grounding"
          value={
            run.groundingStatus ||
            "—"
          }
        />

        <InfoBadge
          label="Verifier"
          value={
            run.verifierStatus ||
            "—"
          }
        />

        {run.actualTopic && (
          <InfoBadge
            label="Topic"
            value={
              run.actualTopic.name
            }
          />
        )}

      </div>

      {run.actualAnswer && (
        <div className="mt-3 rounded-lg bg-slate-50 p-3">

          <p className="text-[9px] font-black text-slate-400">
            پاسخ واقعی
          </p>

          <p className="mt-1 whitespace-pre-wrap text-xs leading-6 text-slate-700">
            {
              run.actualAnswer
            }
          </p>

        </div>
      )}

      {run.failureReasons.length >
        0 && (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3">

          <p className="text-[9px] font-black text-rose-700">
            علت Failure
          </p>

          <ul className="mt-2 list-disc space-y-1.5 pr-5 text-xs leading-6 text-rose-800">

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

        </div>
      )}

      {run.actualSources.length >
        0 && (
        <div className="mt-3">

          <p className="text-[9px] font-black text-slate-400">
            Sourceهای واقعی
          </p>

          <div className="mt-2 flex flex-wrap gap-1.5">

            {run.actualSources.map(
              (
                source
              ) => (
                <span
                  key={
                    source.id
                  }
                  className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700"
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

function SmallMetric({
  label,
  value,
}: {
  label:
    string;

  value:
    number;
}) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">

      <p className="text-[9px] font-black text-slate-400">
        {
          label
        }
      </p>

      <p className="mt-1 text-sm font-black text-slate-800">
        {
          value.toLocaleString(
            "fa-IR"
          )
        }
      </p>

    </div>
  );
}

function InfoBadge({
  label,
  value,
}: {
  label:
    string;

  value:
    string;
}) {
  return (
    <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[9px] font-bold text-slate-600">
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

function RunStatus({
  status,
}: {
  status:
    AIEvalRun[
      "status"
    ];
}) {
  const value =
    status ===
    "passed"
      ? {
          label:
            "PASS",

          className:
            "bg-emerald-100 text-emerald-700",
        }
      : status ===
          "failed"
        ? {
            label:
              "FAIL",

            className:
              "bg-rose-100 text-rose-700",
          }
        : status ===
            "error"
          ? {
              label:
                "ERROR",

              className:
                "bg-orange-100 text-orange-700",
            }
          : {
              label:
                "RUNNING",

              className:
                "bg-blue-100 text-blue-700",
            };

  return (
    <span className={`rounded-full px-2 py-0.5 text-[9px] font-black ${value.className}`}>
      {
        value.label
      }
    </span>
  );
}

function outcomePresentation(
  outcome:
    AIEvalComparisonOutcome
) {
  switch (
    outcome
  ) {
    case "regression":
      return {
        label:
          "PASS → FAIL · REGRESSION",

        card:
          "border-rose-300 bg-rose-50/40",

        badge:
          "bg-rose-200 text-rose-800",
      };

    case "improvement":
      return {
        label:
          "FAIL → PASS · IMPROVEMENT",

        card:
          "border-emerald-200 bg-emerald-50/30",

        badge:
          "bg-emerald-100 text-emerald-700",
      };

    case "persistent_failure":
      return {
        label:
          "FAIL → FAIL",

        card:
          "border-amber-200 bg-amber-50/30",

        badge:
          "bg-amber-100 text-amber-700",
      };

    case "error":
      return {
        label:
          "ERROR",

        card:
          "border-orange-200 bg-orange-50/30",

        badge:
          "bg-orange-100 text-orange-700",
      };

    case "new_case":
      return {
        label:
          "NEW CASE",

        card:
          "border-indigo-200 bg-indigo-50/20",

        badge:
          "bg-indigo-100 text-indigo-700",
      };

    case "removed_case":
      return {
        label:
          "REMOVED CASE",

        card:
          "border-slate-200 bg-slate-50",

        badge:
          "bg-slate-200 text-slate-700",
      };

    case "stable_pass":
    default:
      return {
        label:
          "PASS → PASS",

        card:
          "border-slate-200 bg-white",

        badge:
          "bg-slate-100 text-slate-600",
      };
  }
}

function triggerLabel(
  trigger:
    TopicEvalDetailBatch[
      "trigger"
    ]
) {
  switch (
    trigger
  ) {
    case "guidance_update":
      return "ویرایش Guidance";

    case "guidance_restore":
      return "Restore Guidance";

    case "status_change":
      return "تغییر وضعیت Topic";

    case "update":
      return "ویرایش Topic";

    default:
      return "—";
  }
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

function LoadingState() {
  return (
    <div className="space-y-4">

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7">

        {Array.from(
          {
            length:
              7,
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

      <div className="h-72 animate-pulse rounded-3xl bg-slate-100" />

    </div>
  );
}
