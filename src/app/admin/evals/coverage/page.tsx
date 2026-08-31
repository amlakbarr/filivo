"use client";

import Link from "next/link";

import type {
  ReactNode,
} from "react";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import type {
  AIEvalCoverageDashboard,
  AIEvalCoverageResponse,
  AIEvalKnowledgeCoverageItem,
} from "@/types/ai-eval-coverage";

type KnowledgeFilter =
  | "all"
  | "uncovered"
  | "topic_only"
  | "strong";

export default function AIEvalCoveragePage() {
  const [
    coverage,
    setCoverage,
  ] =
    useState<
      AIEvalCoverageDashboard |
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

  const [
    knowledgeFilter,
    setKnowledgeFilter,
  ] =
    useState<
      KnowledgeFilter
    >(
      "uncovered"
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

        setError(
          ""
        );

        try {
          const response =
            await fetch(
              "/api/admin/evals/coverage",
              {
                cache:
                  "no-store",
              }
            );

          const body =
            (
              await response.json()
            ) as
              AIEvalCoverageResponse;

          if (
            !response.ok ||
            !body.success
          ) {
            throw new Error(
              "message" in
              body
                ? body.message
                : "دریافت Coverage ناموفق بود."
            );
          }

          setCoverage(
            body.coverage
          );
        } catch (
          loadError
        ) {
          setError(
            loadError instanceof
              Error
              ? loadError.message
              : "دریافت Coverage ناموفق بود."
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
    },
    [
      load,
    ]
  );

  const filteredKnowledge =
    useMemo(
      () => {
        if (
          !coverage
        ) {
          return [];
        }

        if (
          knowledgeFilter ===
          "all"
        ) {
          return coverage
            .knowledge;
        }

        return coverage
          .knowledge
          .filter(
            (
              item
            ) =>
              item.level ===
              knowledgeFilter
          );
      },
      [
        coverage,
        knowledgeFilter,
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

            <p className="mt-5 text-xs font-black text-emerald-700">
              Regression Protection Coverage
            </p>

            <h1 className="mt-2 text-2xl font-black text-slate-950 sm:text-3xl">
              پوشش Golden Tests
            </h1>

            <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-500">
              Topicها و Knowledgeهایی را پیدا کنید که تغییر آنها هنوز با Golden Question محافظت نمی‌شود.
            </p>

          </div>

          <div className="flex flex-wrap gap-2">

            <Link
              href="/admin/evals"
              className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-xs font-black text-indigo-700"
            >
              مدیریت Golden Caseها
            </Link>

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

      {loading &&
      !coverage ? (
        <LoadingState />
      ) : coverage ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">

            <Metric
              label="Golden Case فعال"
              value={
                coverage
                  .summary
                  .activeCases
              }
            />

            <Metric
              label="Topic Coverage"
              value={`${formatPercent(
                coverage
                  .summary
                  .topicCoveragePercent
              )}٪`}
              detail={`${coverage.summary.uncoveredTopics.toLocaleString(
                "fa-IR"
              )} Topic بدون پوشش`}
              tone={
                coverage
                  .summary
                  .uncoveredTopics >
                0
                  ? "warning"
                  : "success"
              }
            />

            <Metric
              label="Knowledge Coverage"
              value={`${formatPercent(
                coverage
                  .summary
                  .knowledgeCoveragePercent
              )}٪`}
              detail={`${coverage.summary.uncoveredKnowledge.toLocaleString(
                "fa-IR"
              )} Knowledge بدون پوشش`}
              tone={
                coverage
                  .summary
                  .uncoveredKnowledge >
                0
                  ? "warning"
                  : "success"
              }
            />

            <Metric
              label="Source Coverage مستقیم"
              value={`${formatPercent(
                coverage
                  .summary
                  .directKnowledgeCoveragePercent
              )}٪`}
              detail={`${coverage.summary.directKnowledge.toLocaleString(
                "fa-IR"
              )} Knowledge دارای Assertion مستقیم`}
              tone={
                coverage
                  .summary
                  .directKnowledgeCoveragePercent >=
                80
                  ? "success"
                  : "warning"
              }
            />

            <Metric
              label="فقط Topic"
              value={
                coverage
                  .summary
                  .topicOnlyKnowledge
              }
              detail="تست دارند ولی Source assertion مستقیم ندارند"
              tone={
                coverage
                  .summary
                  .topicOnlyKnowledge >
                0
                  ? "warning"
                  : "default"
              }
            />

            <Metric
              label="Knowledge منتشرشده"
              value={
                coverage
                  .summary
                  .publishedKnowledge
              }
            />

          </section>

          <CoverageExplanation />

          <section className="grid gap-5 xl:grid-cols-2">

            <TopicCoverage
              coverage={
                coverage
              }
            />

            <KnowledgeRiskSummary
              coverage={
                coverage
              }
            />

          </section>

          <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">

            <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">

              <div>

                <h2 className="text-lg font-black text-slate-950">
                  Coverage پایگاه دانش
                </h2>

                <p className="mt-1 text-xs leading-6 text-slate-400">
                  Strong یعنی حداقل یک Golden Case خود Knowledge را به‌عنوان Source مورد انتظار دارد.
                </p>

              </div>

              <div className="flex flex-wrap gap-2">

                <FilterButton
                  active={
                    knowledgeFilter ===
                    "uncovered"
                  }
                  onClick={() =>
                    setKnowledgeFilter(
                      "uncovered"
                    )
                  }
                >
                  بدون پوشش
                </FilterButton>

                <FilterButton
                  active={
                    knowledgeFilter ===
                    "topic_only"
                  }
                  onClick={() =>
                    setKnowledgeFilter(
                      "topic_only"
                    )
                  }
                >
                  فقط Topic
                </FilterButton>

                <FilterButton
                  active={
                    knowledgeFilter ===
                    "strong"
                  }
                  onClick={() =>
                    setKnowledgeFilter(
                      "strong"
                    )
                  }
                >
                  Strong
                </FilterButton>

                <FilterButton
                  active={
                    knowledgeFilter ===
                    "all"
                  }
                  onClick={() =>
                    setKnowledgeFilter(
                      "all"
                    )
                  }
                >
                  همه
                </FilterButton>

              </div>

            </div>

            <div className="overflow-x-auto">

              <table className="w-full min-w-[950px] text-right text-sm">

                <thead className="bg-slate-50 text-xs text-slate-500">

                  <tr>

                    <th className="px-4 py-3 font-bold">
                      Knowledge
                    </th>

                    <th className="px-4 py-3 font-bold">
                      Topic
                    </th>

                    <th className="px-4 py-3 font-bold">
                      Coverage
                    </th>

                    <th className="px-4 py-3 font-bold">
                      Direct Case
                    </th>

                    <th className="px-4 py-3 font-bold">
                      Topic Case
                    </th>

                    <th className="px-4 py-3 font-bold">
                      Sync
                    </th>

                    <th className="px-4 py-3 font-bold">
                      عملیات
                    </th>

                  </tr>

                </thead>

                <tbody className="divide-y divide-slate-100">

                  {filteredKnowledge.length >
                  0 ? (
                    filteredKnowledge.map(
                      (
                        item
                      ) => (
                        <KnowledgeRow
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
                    <tr>

                      <td
                        colSpan={
                          7
                        }
                        className="px-4 py-14 text-center text-sm font-bold text-slate-400"
                      >
                        موردی در این وضعیت وجود ندارد.
                      </td>

                    </tr>
                  )}

                </tbody>

              </table>

            </div>

          </section>
        </>
      ) : null}

    </main>
  );
}

/*
 * ============================================
 * Topics
 * ============================================
 */

function TopicCoverage({
  coverage,
}: {
  coverage:
    AIEvalCoverageDashboard;
}) {
  const uncovered =
    coverage.topics.filter(
      (
        topic
      ) =>
        !topic.covered
    );

  return (
    <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">

      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">

        <div>

          <h2 className="font-black text-slate-950">
            Topicهای بدون محافظ Regression
          </h2>

          <p className="mt-1 text-[10px] text-slate-400">
            Topic فعال بدون Golden Case مرتبط
          </p>

        </div>

        <Link
          href="/admin/topics"
          className="text-xs font-black text-indigo-700"
        >
          مدیریت Topicها
        </Link>

      </div>

      <div className="space-y-3 p-4 sm:p-5">

        {uncovered.length >
        0 ? (
          uncovered.map(
            (
              topic
            ) => (
              <div
                key={
                  topic.id
                }
                className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50/40 p-3 sm:flex-row sm:items-center sm:justify-between"
              >

                <div>

                  <p className="text-sm font-black text-slate-900">
                    {
                      topic.name
                    }
                  </p>

                  <p className="mt-1 text-[10px] text-slate-500">
                    Direct Case:
                    {" "}
                    {
                      topic.directCaseCount.toLocaleString(
                        "fa-IR"
                      )
                    }
                    {" · "}
                    Knowledge Case:
                    {" "}
                    {
                      topic.knowledgeCaseCount.toLocaleString(
                        "fa-IR"
                      )
                    }
                  </p>

                </div>

                <Link
                  href="/admin/evals"
                  className="shrink-0 rounded-lg bg-amber-700 px-3 py-2 text-[10px] font-black text-white"
                >
                  ساخت Golden Case
                </Link>

              </div>
            )
          )
        ) : (
          <EmptyState
            text="تمام Topicهای فعال حداقل یک Golden Case مرتبط دارند."
          />
        )}

      </div>

    </section>
  );
}

/*
 * ============================================
 * Knowledge Summary
 * ============================================
 */

function KnowledgeRiskSummary({
  coverage,
}: {
  coverage:
    AIEvalCoverageDashboard;
}) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">

      <h2 className="font-black text-slate-950">
        کیفیت Coverage پایگاه دانش
      </h2>

      <p className="mt-1 text-[10px] leading-5 text-slate-400">
        صرفاً داشتن Topic Case به معنی بررسی دقیق Source همان Knowledge نیست.
      </p>

      <div className="mt-5 space-y-4">

        <CoverageBar
          label="Strong / Source Assertion"
          value={
            coverage
              .summary
              .directKnowledge
          }
          total={
            coverage
              .summary
              .publishedKnowledge
          }
          tone="success"
        />

        <CoverageBar
          label="Topic-only Protection"
          value={
            coverage
              .summary
              .topicOnlyKnowledge
          }
          total={
            coverage
              .summary
              .publishedKnowledge
          }
          tone="warning"
        />

        <CoverageBar
          label="Uncovered"
          value={
            coverage
              .summary
              .uncoveredKnowledge
          }
          total={
            coverage
              .summary
              .publishedKnowledge
          }
          tone="danger"
        />

      </div>

    </section>
  );
}

/*
 * ============================================
 * Knowledge Row
 * ============================================
 */

function KnowledgeRow({
  item,
}: {
  item:
    AIEvalKnowledgeCoverageItem;
}) {
  const presentation =
    knowledgePresentation(
      item.level
    );

  return (
    <tr className="align-top hover:bg-slate-50/70">

      <td className="max-w-72 px-4 py-4">

        <p className="truncate font-black text-slate-900">
          {
            item.title
          }
        </p>

        <p className="mt-1 text-[10px] text-slate-400">
          Version
          {" "}
          {
            item.version.toLocaleString(
              "fa-IR"
            )
          }
        </p>

      </td>

      <td className="px-4 py-4 text-slate-600">
        {
          item.topicName ||
          "بدون Topic"
        }
      </td>

      <td className="px-4 py-4">

        <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${presentation.className}`}>
          {
            presentation.label
          }
        </span>

      </td>

      <td className="px-4 py-4 font-black text-slate-700">
        {
          item.directCaseCount.toLocaleString(
            "fa-IR"
          )
        }
      </td>

      <td className="px-4 py-4 font-black text-slate-700">
        {
          item.topicCaseCount.toLocaleString(
            "fa-IR"
          )
        }
      </td>

      <td className="px-4 py-4 text-xs text-slate-500">
        {
          item.syncStatus ||
          "—"
        }
      </td>

      <td className="px-4 py-4">

        <div className="flex flex-wrap gap-2">

          <Link
            href={`/admin/knowledge/${item.id}/edit`}
            className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[10px] font-black text-slate-700"
          >
            مشاهده Knowledge
          </Link>

          {item.level !==
            "strong" && (
            <Link
              href="/admin/evals"
              className="rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-[10px] font-black text-indigo-700"
            >
              افزودن Case
            </Link>
          )}

        </div>

      </td>

    </tr>
  );
}

/*
 * ============================================
 * Explanation
 * ============================================
 */

function CoverageExplanation() {
  return (
    <section className="grid gap-3 md:grid-cols-3">

      <CoverageLegend
        title="Strong"
        text="حداقل یک Golden Case این Knowledge را صریحاً به‌عنوان Source مورد انتظار دارد."
        className="border-emerald-200 bg-emerald-50 text-emerald-900"
      />

      <CoverageLegend
        title="Topic-only"
        text="Golden Case مرتبط با Topic وجود دارد، اما خود Knowledge Source assertion مستقیم ندارد."
        className="border-amber-200 bg-amber-50 text-amber-900"
      />

      <CoverageLegend
        title="Uncovered"
        text="تغییر این Knowledge یا Topic هیچ Golden Case مرتبط قابل اتکایی برای Regression Test ندارد."
        className="border-rose-200 bg-rose-50 text-rose-900"
      />

    </section>
  );
}

/*
 * ============================================
 * UI
 * ============================================
 */

function Metric({
  label,
  value,
  detail,
  tone = "default",
}: {
  label:
    string;

  value:
    number |
    string;

  detail?:
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

      {detail && (
        <p className="mt-2 text-[10px] leading-5 opacity-70">
          {
            detail
          }
        </p>
      )}

    </div>
  );
}

function CoverageLegend({
  title,
  text,
  className,
}: {
  title:
    string;

  text:
    string;

  className:
    string;
}) {
  return (
    <div className={`rounded-2xl border p-4 ${className}`}>

      <p className="text-xs font-black">
        {
          title
        }
      </p>

      <p className="mt-2 text-[10px] leading-5 opacity-80">
        {
          text
        }
      </p>

    </div>
  );
}

function CoverageBar({
  label,
  value,
  total,
  tone,
}: {
  label:
    string;

  value:
    number;

  total:
    number;

  tone:
    | "success"
    | "warning"
    | "danger";
}) {
  const percent =
    total >
    0
      ? Math.round(
          (
            value /
            total
          ) *
            1000
        ) /
        10
      : 0;

  const bar =
    tone ===
    "success"
      ? "bg-emerald-500"
      : tone ===
          "warning"
        ? "bg-amber-500"
        : "bg-rose-500";

  return (
    <div>

      <div className="flex items-center justify-between gap-3 text-[10px]">

        <span className="font-black text-slate-600">
          {
            label
          }
        </span>

        <span className="text-slate-400">
          {
            value.toLocaleString(
              "fa-IR"
            )
          }
          {" / "}
          {
            total.toLocaleString(
              "fa-IR"
            )
          }
          {" · "}
          {
            formatPercent(
              percent
            )
          }
          ٪
        </span>

      </div>

      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">

        <div
          className={`h-full rounded-full ${bar}`}
          style={{
            width:
              `${Math.min(
                100,
                Math.max(
                  0,
                  percent
                )
              )}%`,
          }}
        />

      </div>

    </div>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active:
    boolean;

  onClick:
    () =>
      void;

  children:
    ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={
        onClick
      }
      className={`rounded-lg px-3 py-2 text-[10px] font-black ${
        active
          ? "bg-slate-950 text-white"
          : "border border-slate-200 bg-white text-slate-600"
      }`}
    >
      {
        children
      }
    </button>
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

function knowledgePresentation(
  level:
    AIEvalKnowledgeCoverageItem[
      "level"
    ]
) {
  switch (
    level
  ) {
    case "strong":
      return {
        label:
          "STRONG",

        className:
          "bg-emerald-100 text-emerald-700",
      };

    case "topic_only":
      return {
        label:
          "TOPIC ONLY",

        className:
          "bg-amber-100 text-amber-700",
      };

    case "uncovered":
    default:
      return {
        label:
          "UNCOVERED",

        className:
          "bg-rose-100 text-rose-700",
      };
  }
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
              className="h-28 animate-pulse rounded-2xl bg-slate-100"
            />
          )
        )}

      </div>

      <div className="h-80 animate-pulse rounded-3xl bg-slate-100" />

    </div>
  );
}
