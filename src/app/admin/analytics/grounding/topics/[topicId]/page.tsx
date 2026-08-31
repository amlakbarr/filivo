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
  GroundingRemediationBlockedItem,
  GroundingRemediationGap,
  GroundingRemediationRange,
  GroundingTopicRemediationDashboard,
} from "@/types/grounding-remediation";

type ResponseBody =
  | {
      success:
        true;

      dashboard:
        GroundingTopicRemediationDashboard;
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
      GroundingRemediationRange;

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

export default function GroundingTopicRemediationPage() {
  const params =
    useParams<{
      topicId:
        string;
    }>();

  const topicId =
    String(
      params.topicId ||
        ""
    );

  const [
    range,
    setRange,
  ] =
    useState<
      GroundingRemediationRange
    >(
      "7d"
    );

  const [
    dashboard,
    setDashboard,
  ] =
    useState<
      GroundingTopicRemediationDashboard |
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
              `/api/admin/analytics/grounding/topics/${topicId}?range=${range}`,
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
                : "دریافت اطلاعات اصلاحی ناموفق بود."
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
              : "دریافت اطلاعات اصلاحی ناموفق بود."
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
        topicId,
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

      return () =>
        controller.abort();
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
              href="/admin/analytics/grounding"
              className="text-xs font-black text-indigo-700 hover:text-indigo-800"
            >
              → بازگشت به کنترل صحت AI
            </Link>

            <p className="mt-5 text-xs font-black text-rose-600">
              اقدام اصلاحی Grounding
            </p>

            <h1 className="mt-2 text-2xl font-black text-slate-950 sm:text-3xl">
              {
                dashboard
                  ?.topic
                  .label ||
                "در حال بارگذاری موضوع..."
              }
            </h1>

            <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-500">
              Gapهای باز و سؤال‌های Block‌شده این Topic را در یک نقطه بررسی کنید و از همان سؤال وارد ساخت Knowledge اصلاحی شوید.
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
                    GroundingRemediationRange
                )
              }
              className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-black text-slate-700 outline-none"
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

      {dashboard && (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">

            <Metric
              label="Gap باز"
              value={
                dashboard
                  .totals
                  .openGaps
              }
            />

            <Metric
              label="سؤال Block شده"
              value={
                dashboard
                  .totals
                  .blockedQuestions
              }
              danger
            />

            <Metric
              label="Verifier Block"
              value={
                dashboard
                  .totals
                  .verifierBlocked
              }
              danger
            />

            <Metric
              label="بدون Evidence"
              value={
                dashboard
                  .totals
                  .withoutEvidence
              }
            />

            <Metric
              label="متصل به Gap"
              value={
                dashboard
                  .totals
                  .linkedToGap
              }
            />

            <Metric
              label="هنوز بدون Gap"
              value={
                dashboard
                  .totals
                  .unlinkedToGap
              }
            />

          </section>

          <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">

            <div className="border-b border-slate-100 px-5 py-5 sm:px-6">

              <h2 className="text-lg font-black text-slate-950">
                Knowledge Gapهای فعال
              </h2>

              <p className="mt-1 text-xs leading-6 text-slate-400">
                Gapها بر اساس Priority و آخرین مشاهده مرتب شده‌اند.
              </p>

            </div>

            <div className="space-y-3 p-4 sm:p-6">

              {dashboard
                .gaps
                .length >
              0 ? (
                dashboard.gaps.map(
                  (
                    gap
                  ) => (
                    <GapCard
                      key={
                        gap.id
                      }
                      gap={
                        gap
                      }
                      topicId={
                        dashboard
                          .topic
                          .id
                      }
                    />
                  )
                )
              ) : (
                <EmptyState text="Gap فعال برای این موضوع وجود ندارد." />
              )}

            </div>

          </section>

          <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">

            <div className="border-b border-slate-100 px-5 py-5 sm:px-6">

              <h2 className="text-lg font-black text-slate-950">
                سؤال‌های Block‌شده
              </h2>

              <p className="mt-1 text-xs leading-6 text-slate-400">
                از سؤال‌هایی که Gap دارند می‌توان مستقیم Knowledge اصلاحی ساخت.
              </p>

            </div>

            <div className="space-y-4 p-4 sm:p-6">

              {dashboard
                .blocked
                .length >
              0 ? (
                dashboard.blocked.map(
                  (
                    item
                  ) => (
                    <BlockedCard
                      key={
                        item.assistantMessageId
                      }
                      item={
                        item
                      }
                      topicId={
                        dashboard
                          .topic
                          .id
                      }
                    />
                  )
                )
              ) : (
                <EmptyState text="سؤال Block‌شده‌ای در این بازه وجود ندارد." />
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
 * Gap
 * ============================================
 */

function GapCard({
  gap,
  topicId,
}: {
  gap:
    GroundingRemediationGap;

  topicId:
    string;
}) {
  const createHref =
    buildKnowledgeHref({
      gapId:
        gap.id,

      title:
        gap.title,

      question:
        gap.sampleQuestion,

      topicId,
    });

  return (
    <article className="rounded-2xl border border-amber-200 bg-amber-50/40 p-4">

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">

        <div>

          <div className="flex flex-wrap items-center gap-2">

            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-black text-amber-800">
              {
                gap.status ===
                "in_progress"
                  ? "در حال بررسی"
                  : "باز"
              }
            </span>

            <span className="text-[10px] font-black text-slate-500">
              Priority:
              {" "}
              {
                formatNumber(
                  gap.priorityScore
                )
              }
            </span>

          </div>

          <h3 className="mt-3 text-sm font-black text-slate-950">
            {
              gap.title
            }
          </h3>

          {gap.sampleQuestion && (
            <p className="mt-2 text-xs leading-6 text-slate-600">
              {
                gap.sampleQuestion
              }
            </p>
          )}

        </div>

        <div className="flex shrink-0 flex-wrap gap-2">

          <Link
            href={`/admin/knowledge/gaps/${gap.id}`}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-black text-slate-700"
          >
            جزئیات Gap
          </Link>

          <Link
            href={
              createHref
            }
            className="rounded-lg bg-emerald-700 px-3 py-2 text-[11px] font-black text-white"
          >
            ساخت Knowledge
          </Link>

        </div>

      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-[10px] text-slate-500">

        <span>
          تکرار:
          {" "}
          {
            formatNumber(
              gap.occurrenceCount
            )
          }
        </span>

        <span>
          کاربران:
          {" "}
          {
            formatNumber(
              gap.uniqueUsersCount
            )
          }
        </span>

        <span>
          واحدها:
          {" "}
          {
            formatNumber(
              gap.uniqueDepartmentsCount
            )
          }
        </span>

      </div>

      <PriorityBreakdown
        breakdown={
          gap.priorityBreakdown
        }
      />

    </article>
  );
}

/*
 * ============================================
 * Priority Explainability
 * ============================================
 */

function PriorityBreakdown({
  breakdown,
}: {
  breakdown:
    GroundingRemediationGap["priorityBreakdown"];
}) {
  const activeFactors =
    breakdown.factors.filter(
      (
        factor
      ) =>
        factor.score >
        0
    );

  if (
    activeFactors.length ===
    0
  ) {
    return null;
  }

  const maximum =
    Math.max(
      1,
      ...activeFactors.map(
        (
          factor
        ) =>
          factor.score
      )
    );

  return (
    <details className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">

      <summary className="cursor-pointer list-none px-3.5 py-3 text-[11px] font-black text-slate-700">

        <span className="flex flex-wrap items-center justify-between gap-2">

          <span>
            چرا Priority این Gap برابر{" "}
            {
              formatNumber(
                breakdown.totalScore
              )
            }
            {" "}
            است؟
          </span>

          {breakdown
            .dominantFactors[0] && (
            <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[10px] text-indigo-700">
              عامل اصلی:{" "}
              {
                breakdown
                  .dominantFactors[0]
                  .label
              }
            </span>
          )}

        </span>

      </summary>

      <div className="space-y-3 border-t border-slate-100 p-3.5">

        {activeFactors.map(
          (
            factor
          ) => (
            <div
              key={
                factor.key
              }
            >

              <div className="flex flex-wrap items-center justify-between gap-2 text-[10px]">

                <span className="font-bold text-slate-600">
                  {
                    factor.label
                  }
                  {" · "}
                  {
                    formatNumber(
                      factor.count
                    )
                  }
                  {" × "}
                  {
                    formatNumber(
                      factor.weight
                    )
                  }
                </span>

                <span className="font-black text-slate-900">
                  +
                  {
                    formatNumber(
                      factor.score
                    )
                  }
                  {" "}
                  امتیاز
                </span>

              </div>

              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">

                <div
                  className="h-full rounded-full bg-slate-800"
                  style={{
                    width:
                      `${Math.max(
                        4,
                        (
                          factor.score /
                          maximum
                        ) *
                          100
                      )}%`,
                  }}
                />

              </div>

            </div>
          )
        )}

        <div className="rounded-lg bg-slate-50 px-3 py-2 text-[10px] leading-5 text-slate-500">
          Verifier Block وزن بیشتری دارد چون مدل Evidence پیدا کرده ولی تلاش کرده Claim اضافه‌ای تولید کند که در Knowledge پشتیبانی نشده است.
        </div>

      </div>

    </details>
  );
}

/*
 * ============================================
 * Blocked Question
 * ============================================
 */

function BlockedCard({
  item,
  topicId,
}: {
  item:
    GroundingRemediationBlockedItem;

  topicId:
    string;
}) {
  const createHref =
    item.gapId
      ? buildKnowledgeHref({
          gapId:
            item.gapId,

          title:
            item.question,

          question:
            item.question,

          topicId,
        })
      : "";

  return (
    <article className="rounded-2xl border border-rose-100 bg-rose-50/30 p-4 sm:p-5">

      <div className="flex flex-wrap items-center gap-2">

        <span className="rounded-full bg-rose-100 px-2.5 py-1 text-[10px] font-black text-rose-700">
          Blocked
        </span>

        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-black text-slate-600">
          {
            verifierLabel(
              item.verifierStatus
            )
          }
        </span>

        {item.gapId ? (
          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-black text-emerald-700">
            Gap متصل
          </span>
        ) : (
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-black text-amber-700">
            Gap در انتظار Tracking
          </span>
        )}

      </div>

      <p className="mt-4 whitespace-pre-wrap text-sm font-black leading-7 text-slate-900">
        {
          item.question ||
          "—"
        }
      </p>

      {item.unsupportedClaims.length >
      0 && (
        <div className="mt-3 rounded-xl border border-rose-200 bg-white p-3">

          <p className="text-[10px] font-black text-rose-700">
            Claimهای بدون مدرک
          </p>

          <ul className="mt-2 list-disc space-y-1.5 pr-5 text-xs leading-6 text-rose-900">

            {item.unsupportedClaims.map(
              (
                claim,
                index
              ) => (
                <li
                  key={
                    `${item.assistantMessageId}-${index}`
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
        <p className="mt-3 text-xs leading-6 text-slate-500">
          {
            item.verifierReason
          }
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">

        <SmallStat
          label="Retrieval"
          value={
            item.retrievalCount
          }
        />

        <SmallStat
          label="Relevant"
          value={
            item.relevantCount
          }
        />

        <SmallStat
          label="Source"
          value={
            item.sourceCount
          }
        />

      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-rose-100 pt-4">

        <div className="text-[10px] text-slate-400">

          {item.userName && (
            <span className="ml-3">
              {
                item.userName
              }
            </span>
          )}

          <span>
            {
              formatDateTime(
                item.created
              )
            }
          </span>

        </div>

        <div className="flex flex-wrap gap-2">

          {item.conversationId && (
            <Link
              href={`/admin/conversations/${item.conversationId}`}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-black text-slate-700"
            >
              مکالمه
            </Link>
          )}

          {item.gapId && (
            <Link
              href={`/admin/knowledge/gaps/${item.gapId}`}
              className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-[11px] font-black text-amber-700"
            >
              Gap
            </Link>
          )}

          {createHref && (
            <Link
              href={
                createHref
              }
              className="rounded-lg bg-emerald-700 px-3 py-2 text-[11px] font-black text-white"
            >
              ایجاد Knowledge اصلاحی
            </Link>
          )}

        </div>

      </div>

    </article>
  );
}

/*
 * ============================================
 * UI Helpers
 * ============================================
 */

function Metric({
  label,
  value,
  danger = false,
}: {
  label:
    string;

  value:
    number;

  danger?:
    boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 shadow-sm ${
        danger &&
        value >
          0
          ? "border-rose-200 bg-rose-50"
          : "border-slate-200 bg-white"
      }`}
    >

      <p className="text-[10px] font-black text-slate-400">
        {
          label
        }
      </p>

      <p
        className={`mt-2 text-xl font-black ${
          danger &&
          value >
            0
            ? "text-rose-800"
            : "text-slate-950"
        }`}
      >
        {
          formatNumber(
            value
          )
        }
      </p>

    </div>
  );
}

function SmallStat({
  label,
  value,
}: {
  label:
    string;

  value:
    number;
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
          formatNumber(
            value
          )
        }
      </span>
    </span>
  );
}

function EmptyState({
  text,
}: {
  text:
    string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm font-bold text-slate-400">
      {
        text
      }
    </div>
  );
}

/*
 * ============================================
 * Links
 * ============================================
 */

function buildKnowledgeHref({
  gapId,
  title,
  question,
  topicId,
}: {
  gapId:
    string;

  title:
    string;

  question:
    string;

  topicId:
    string;
}) {
  const params =
    new URLSearchParams();

  params.set(
    "gapId",
    gapId
  );

  if (
    title
  ) {
    params.set(
      "title",
      title.slice(
        0,
        200
      )
    );
  }

  if (
    question
  ) {
    params.set(
      "question",
      question.slice(
        0,
        2000
      )
    );
  }

  params.set(
    "topicId",
    topicId
  );

  return `/admin/knowledge/new?${params.toString()}`;
}

/*
 * ============================================
 * Formatting
 * ============================================
 */

function formatNumber(
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

function verifierLabel(
  value:
    string
) {
  switch (
    value
  ) {
    case "unsupported_claims":
      return "Claim بدون مدرک";

    case "no_evidence":
      return "بدون Evidence";

    case "verifier_unavailable":
      return "Verifier unavailable";

    case "budget_blocked":
      return "Budget Block";

    case "invalid_verifier_response":
      return "Verifier output نامعتبر";

    case "not_run":
      return "Hard Gate";

    default:
      return value ||
        "Blocked";
  }
}
