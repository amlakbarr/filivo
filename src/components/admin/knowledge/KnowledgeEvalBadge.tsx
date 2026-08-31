"use client";

import Link from "next/link";

import type {
  KnowledgeEvalStatusItem,
  KnowledgeEvalStatusValue,
} from "@/types/knowledge-eval-status";

export default function KnowledgeEvalBadge({
  value,
}: {
  value?:
    KnowledgeEvalStatusItem;
}) {
  if (
    !value
  ) {
    return (
      <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black text-slate-400">
        ...
      </span>
    );
  }

  const presentation =
    statusPresentation(
      value.status
    );

  const hasBatch =
    Boolean(
      value.batchId
    );

  return (
    <div className="max-w-52">

      <div className="flex flex-wrap items-center gap-1.5">

        <span
          title={
            value.message
          }
          className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-black ${presentation.className}`}
        >
          {
            presentation.label
          }
        </span>

        {value.total >
          0 && (
          <span className="text-[10px] font-bold text-slate-400">
            {
              value.passed
                .toLocaleString(
                  "fa-IR"
                )
            }
            /
            {
              value.total
                .toLocaleString(
                  "fa-IR"
                )
            }
          </span>
        )}

      </div>

      <p className="mt-1.5 text-[10px] leading-5 text-slate-400">
        {
          value.message
        }
      </p>

      {hasBatch ? (
        <Link
          href={`/admin/knowledge/${value.knowledgeId}/evals`}
          className="mt-1 inline-block text-[10px] font-black text-indigo-700 underline underline-offset-2"
        >
          جزئیات و Regression
        </Link>
      ) : (
        (
          value.status ===
            "no_cases" ||
          value.status ===
            "never_run"
        ) && (
          <Link
            href="/admin/evals"
            className="mt-1 inline-block text-[10px] font-black text-indigo-700 underline underline-offset-2"
          >
            مدیریت Golden Caseها
          </Link>
        )
      )}

    </div>
  );
}

function statusPresentation(
  status:
    KnowledgeEvalStatusValue
) {
  switch (
    status
  ) {
    case "passed":
      return {
        label:
          "PASS",

        className:
          "bg-emerald-100 text-emerald-700",
      };

    case "failed":
      return {
        label:
          "FAIL",

        className:
          "bg-rose-100 text-rose-700",
      };

    case "error":
      return {
        label:
          "ERROR",

        className:
          "bg-orange-100 text-orange-700",
      };

    case "running":
      return {
        label:
          "در حال تست",

        className:
          "bg-blue-100 text-blue-700",
      };

    case "stale":
      return {
        label:
          "نیاز به تست",

        className:
          "bg-amber-100 text-amber-700",
      };

    case "no_cases":
      return {
        label:
          "بدون Case",

        className:
          "bg-violet-100 text-violet-700",
      };

    case "never_run":
      return {
        label:
          "اجرا نشده",

        className:
          "bg-slate-100 text-slate-600",
      };

    case "not_applicable":
    default:
      return {
        label:
          "—",

        className:
          "bg-slate-100 text-slate-400",
      };
  }
}
