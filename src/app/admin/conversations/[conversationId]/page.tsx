"use client";

import {
  useCallback,
  useEffect,
  useState,
} from "react";

import Link from "next/link";

import {
  useParams,
} from "next/navigation";

import FeedbackReviewControls from "@/components/admin/analytics/FeedbackReviewControls";

type ReviewStatus =
  | "new"
  | "in_progress"
  | "resolved"
  | "ignored";

type DetailMessage = {
  id:
    string;

  role:
    "user" |
    "assistant";

  content:
    string;

  created:
    string;

  replyTo?:
    string;

  topic?: {
    id:
      string;

    name:
      string;
  };

  topicConfidence?:
    number;

  classificationStatus?:
    string;

  hasAnswer?:
    boolean;

  model?:
    string;

  responseTimeMs?:
    number;

  openAIResponseId?:
    string;

  sources:
    Array<{
      id:
        string;

      title:
        string;
    }>;

  feedback?: {
    id:
      string;

    rating:
      "up" |
      "down";

    reasons:
      string[];

    comment?:
      string;

    reviewStatus:
      ReviewStatus;

    reviewNote?:
      string;

    reviewedBy?:
      string;

    reviewedAt?:
      string;

    resolvedKnowledgeItem?: {
      id:
        string;

      title:
        string;
    };

    created:
      string;

    updated:
      string;
  };
};

type DetailResponse = {
  success?:
    boolean;

  message?:
    string;

  requestId?:
    string;

  conversation?: {
    id:
      string;

    title:
      string;

    status:
      string;

    created:
      string;

    updated:
      string;

    lastMessageAt?:
      string;

    user: {
      id:
        string;

      name:
        string;

      email?:
        string;

      employeeCode?:
        string;

      departmentName?:
        string;
    };

    metrics: {
      totalMessages:
        number;

      userMessages:
        number;

      assistantMessages:
        number;

      noAnswer:
        number;

      negativeFeedback:
        number;

      openNegativeFeedback:
        number;
    };
  };

  messages?:
    DetailMessage[];
};

export default function AdminConversationDetailPage() {
  const params =
    useParams<{
      conversationId:
        string;
    }>();

  const conversationId =
    typeof params
      .conversationId ===
    "string"
      ? params
          .conversationId
      : "";

  const [
    data,
    setData,
  ] =
    useState<
      DetailResponse |
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
          !conversationId
        ) {
          setError(
            "شناسه گفتگو معتبر نیست."
          );

          setLoading(
            false
          );

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
              `/api/admin/conversations/${conversationId}`,
              {
                method:
                  "GET",

                cache:
                  "no-store",

                signal,
              }
            );

          const result =
            (
              await response
                .json()
                .catch(
                  () => ({})
                )
            ) as DetailResponse;

          if (
            signal
              ?.aborted
          ) {
            return;
          }

          if (
            !response.ok ||
            !result.success
          ) {
            setData(
              null
            );

            setError(
              withRequestId(
                result.message ||
                  "دریافت جزئیات گفتگو انجام نشد.",

                result.requestId ||
                  response.headers.get(
                    "X-Request-Id"
                  ) ||
                  undefined
              )
            );

            return;
          }

          setData(
            result
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

          setData(
            null
          );

          setError(
            "خطا در ارتباط با سرور."
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
        conversationId,
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

  if (
    loading &&
    !data
  ) {
    return (
      <main
        dir="rtl"
        className="mx-auto w-full max-w-[1400px] space-y-5 px-4 py-6 sm:px-6 lg:px-8"
      >
        <div className="h-40 animate-pulse rounded-3xl bg-slate-100" />

        <div className="space-y-4">
          {[
            1,
            2,
            3,
          ].map(
            (
              item
            ) => (
              <div
                key={
                  item
                }
                className="h-48 animate-pulse rounded-2xl bg-slate-100"
              />
            )
          )}
        </div>
      </main>
    );
  }

  return (
    <main
      dir="rtl"
      className="mx-auto w-full max-w-[1400px] space-y-6 px-4 py-6 sm:px-6 lg:px-8"
    >
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">

        <div className="flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-start lg:justify-between">

          <div className="min-w-0">

            <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500">

              <Link
                href="/admin/conversations"
                className="transition hover:text-slate-900"
              >
                مکالمات
              </Link>

              <span>
                /
              </span>

              <span className="text-indigo-700">
                جزئیات
              </span>

            </div>

            <h1 className="mt-3 max-w-4xl text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">
              {
                data
                  ?.conversation
                  ?.title ||
                "جزئیات گفتگو"
              }
            </h1>

            {data
              ?.conversation && (

              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-500">

                <span className="font-black text-slate-800">
                  {
                    data
                      .conversation
                      .user
                      .name
                  }
                </span>

                {data
                  .conversation
                  .user
                  .employeeCode && (
                  <span>
                    کد:{" "}
                    {
                      data
                        .conversation
                        .user
                        .employeeCode
                    }
                  </span>
                )}

                {data
                  .conversation
                  .user
                  .departmentName && (
                  <span>
                    {
                      data
                        .conversation
                        .user
                        .departmentName
                    }
                  </span>
                )}

                <span>
                  شروع:{" "}
                  {
                    formatDateTime(
                      data
                        .conversation
                        .created
                    )
                  }
                </span>

              </div>

            )}

          </div>

          <div className="flex flex-wrap gap-2">

            <button
              type="button"
              onClick={() =>
                void load()
              }
              disabled={
                loading
              }
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-black text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
            >
              {
                loading
                  ? "در حال بروزرسانی..."
                  : "بروزرسانی"
              }
            </button>

            <Link
              href="/admin/conversations"
              className="rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-black text-white transition hover:bg-black"
            >
              بازگشت
            </Link>

          </div>

        </div>

      </section>

      {error && (
        <section className="rounded-3xl border border-rose-200 bg-rose-50 p-5 text-sm font-bold leading-7 text-rose-700">
          {
            error
          }
        </section>
      )}

      {data
        ?.conversation && (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">

          <Metric
            label="کل پیام‌ها"
            value={
              data
                .conversation
                .metrics
                .totalMessages
            }
          />

          <Metric
            label="سؤال‌ها"
            value={
              data
                .conversation
                .metrics
                .userMessages
            }
          />

          <Metric
            label="پاسخ AI"
            value={
              data
                .conversation
                .metrics
                .assistantMessages
            }
          />

          <Metric
            label="بدون پاسخ"
            value={
              data
                .conversation
                .metrics
                .noAnswer
            }
            alert={
              data
                .conversation
                .metrics
                .noAnswer >
              0
            }
          />

          <Metric
            label="Feedback منفی"
            value={
              data
                .conversation
                .metrics
                .negativeFeedback
            }
            alert={
              data
                .conversation
                .metrics
                .negativeFeedback >
              0
            }
          />

          <Metric
            label="Feedback باز"
            value={
              data
                .conversation
                .metrics
                .openNegativeFeedback
            }
            alert={
              data
                .conversation
                .metrics
                .openNegativeFeedback >
              0
            }
          />

        </section>
      )}

      {data
        ?.messages && (
        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">

          <div className="border-b border-slate-100 px-5 py-5 sm:px-6">

            <h2 className="text-lg font-black text-slate-950">
              جریان کامل مکالمه
            </h2>

            <p className="mt-1 text-xs leading-6 text-slate-400">
              پیام‌ها به ترتیب زمانی نمایش داده می‌شوند.
            </p>

          </div>

          <div className="space-y-5 p-4 sm:p-6">

            {data
              .messages
              .length >
            0 ? (
              data.messages.map(
                (
                  message
                ) => (
                  <MessageCard
                    key={
                      message.id
                    }
                    message={
                      message
                    }
                    allMessages={
                      data.messages ?? []
                    }
                  />
                )
              )
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-12 text-center text-sm font-bold text-slate-400">
                این گفتگو پیامی ندارد.
              </div>
            )}

          </div>

        </section>
      )}

    </main>
  );
}

/*
 * ============================================
 * Message
 * ============================================
 */

function MessageCard({
  message,
  allMessages,
}: {
  message:
    DetailMessage;

  allMessages:
    DetailMessage[];
}) {
  const isUser =
    message.role ===
    "user";

  const replyContext =
    !isUser &&
    message.replyTo
      ? allMessages.find(
          (
            item
          ) =>
            item.id ===
              message.replyTo &&
            item.role ===
              "user"
        )
      : undefined;

  return (
    <article
      className={`rounded-2xl border p-4 sm:p-5 ${
        isUser
          ? "border-slate-200 bg-slate-50/70"
          : message.hasAnswer ===
              false
            ? "border-amber-200 bg-amber-50/40"
            : "border-indigo-100 bg-indigo-50/25"
      }`}
    >

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">

        <div className="flex flex-wrap items-center gap-2">

          <span
            className={`rounded-full px-2.5 py-1 text-[10px] font-black ${
              isUser
                ? "bg-slate-900 text-white"
                : "bg-indigo-100 text-indigo-700"
            }`}
          >
            {
              isUser
                ? "کاربر"
                : "AI"
            }
          </span>

          {!isUser &&
            message.hasAnswer ===
              false && (
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-black text-amber-800">
                دانش کافی نبود
              </span>
            )}

          {isUser &&
            message.classificationStatus && (
              <ClassificationBadge
                status={
                  message.classificationStatus
                }
              />
            )}

        </div>

        <time className="text-[10px] text-slate-400">
          {
            formatDateTime(
              message.created
            )
          }
        </time>

      </div>

      <p className="mt-4 whitespace-pre-wrap text-sm leading-8 text-slate-800">
        {
          message.content
        }
      </p>

      {isUser ? (
        <UserMetadata
          message={
            message
          }
        />
      ) : (
        <AssistantMetadata
          message={
            message
          }
          replyContext={
            replyContext
          }
        />
      )}

    </article>
  );
}

function UserMetadata({
  message,
}: {
  message:
    DetailMessage;
}) {
  return (
    <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-200/80 pt-4">

      {message.topic && (
        <span className="rounded-full bg-indigo-100 px-2.5 py-1 text-[11px] font-bold text-indigo-700">
          Topic:{" "}
          {
            message
              .topic
              .name
          }
        </span>
      )}

      {typeof message
        .topicConfidence ===
      "number" && (
        <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-slate-600">
          Confidence:{" "}
          {
            formatConfidence(
              message
                .topicConfidence
            )
          }
        </span>
      )}

      {!message.topic && (
        <span className="rounded-full bg-slate-200 px-2.5 py-1 text-[11px] font-bold text-slate-500">
          بدون Topic
        </span>
      )}

    </div>
  );
}

function AssistantMetadata({
  message,
  replyContext,
}: {
  message:
    DetailMessage;

  replyContext?:
    DetailMessage;
}) {
  return (
    <div className="mt-4 space-y-4 border-t border-indigo-100 pt-4">

      <div className="flex flex-wrap gap-2">

        {message.model && (
          <span
            dir="ltr"
            className="rounded-full bg-white px-2.5 py-1 text-[10px] font-mono text-slate-600"
          >
            {
              message.model
            }
          </span>
        )}

        {typeof message
          .responseTimeMs ===
        "number" && (
          <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-bold text-slate-600">
            {
              formatLatency(
                message
                  .responseTimeMs
              )
            }
          </span>
        )}

        {message.hasAnswer ===
          true && (
          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-black text-emerald-700">
            has_answer = true
          </span>
        )}

      </div>

      {message.sources.length >
      0 && (
        <div>

          <p className="text-[10px] font-black text-slate-500">
            منابع پاسخ
          </p>

          <div className="mt-2 flex flex-wrap gap-2">

            {message.sources.map(
              (
                source
              ) => (
                <span
                  key={
                    source.id
                  }
                  className="rounded-full border border-indigo-100 bg-white px-2.5 py-1 text-[11px] font-bold text-indigo-700"
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

      {message.feedback && (
        <FeedbackBlock
          feedback={
            message.feedback
          }
          question={
            replyContext
              ?.content
          }
          topicId={
            replyContext
              ?.topic
              ?.id
          }
        />
      )}

    </div>
  );
}

function FeedbackBlock({
  feedback,
  question,
  topicId,
}: {
  feedback:
    NonNullable<
      DetailMessage["feedback"]
    >;

  question?:
    string;

  topicId?:
    string;
}) {
  const knowledgeHref =
    feedback.rating ===
    "down"
      ? buildKnowledgeCreateHref({
          feedbackId:
            feedback.id,

          question,

          topicId,
        })
      : "";
  return (
    <div
      className={`rounded-xl border p-3.5 ${
        feedback.rating ===
        "down"
          ? "border-rose-200 bg-rose-50/60"
          : "border-emerald-200 bg-emerald-50/60"
      }`}
    >

      <div className="flex flex-wrap items-center gap-2">

        <span className="text-sm">
          {
            feedback.rating ===
            "down"
              ? "👎"
              : "👍"
          }
        </span>

        <span className="text-xs font-black text-slate-700">
          {
            feedback.rating ===
            "down"
              ? "Feedback منفی"
              : "Feedback مثبت"
          }
        </span>

        {feedback.rating ===
          "down" && (
          <ReviewBadge
            status={
              feedback.reviewStatus
            }
          />
        )}

      </div>

      {feedback
        .reasons
        .length >
      0 && (
        <div className="mt-3 flex flex-wrap gap-2">

          {feedback.reasons.map(
            (
              reason
            ) => (
              <span
                key={
                  reason
                }
                className="rounded-full border border-rose-200 bg-white px-2.5 py-1 text-[10px] font-bold text-rose-700"
              >
                {
                  reasonLabel(
                    reason
                  )
                }
              </span>
            )
          )}

        </div>
      )}

      {feedback.comment && (
        <p className="mt-3 whitespace-pre-wrap text-xs leading-6 text-slate-700">
          {
            feedback.comment
          }
        </p>
      )}

      {feedback.resolvedKnowledgeItem && (

        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">

          <p className="text-[10px] font-black text-emerald-700">
            Knowledge اصلاحی متصل
          </p>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">

            <span className="text-xs font-bold text-emerald-900">
              {
                feedback.resolvedKnowledgeItem.title
              }
            </span>

            <Link
              href={`/admin/knowledge/${feedback.resolvedKnowledgeItem.id}/edit`}
              className="rounded-lg bg-emerald-700 px-3 py-1.5 text-[10px] font-black text-white transition hover:bg-emerald-800"
            >
              مشاهده Knowledge
            </Link>

          </div>

        </div>

      )}

      {feedback.rating ===
        "down" && (
        <>
          {!feedback.resolvedKnowledgeItem && (
          <div className="mt-3 flex flex-wrap items-center gap-2">

            <Link
              href={
                knowledgeHref
              }
              className="rounded-lg bg-indigo-700 px-3 py-2 text-[11px] font-black text-white transition hover:bg-indigo-800"
            >
              ایجاد Knowledge اصلاحی
            </Link>

            <span className="text-[10px] leading-5 text-slate-500">
              سؤال و Topic این Feedback به فرم مطلب جدید منتقل می‌شود.
            </span>

          </div>
          )}

          <FeedbackReviewControls
            feedbackId={
              feedback.id
            }
            initialStatus={
              feedback.reviewStatus
            }
            initialNote={
              feedback.reviewNote
            }
            reviewedAt={
              feedback.reviewedAt
            }
          />
        </>
      )}

    </div>
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
  alert,
}: {
  label:
    string;

  value:
    number;

  alert?:
    boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 shadow-sm ${
        alert
          ? "border-rose-200 bg-rose-50"
          : "border-slate-200 bg-white"
      }`}
    >

      <p className="text-[10px] font-black text-slate-500">
        {
          label
        }
      </p>

      <p
        className={`mt-2 text-xl font-black ${
          alert
            ? "text-rose-800"
            : "text-slate-950"
        }`}
      >
        {
          formatInteger(
            value
          )
        }
      </p>

    </div>
  );
}

function ClassificationBadge({
  status,
}: {
  status:
    string;
}) {
  const styles =
    status ===
    "classified"
      ? "bg-emerald-100 text-emerald-700"
      : status ===
          "unclassified"
        ? "bg-amber-100 text-amber-800"
        : status ===
            "error"
          ? "bg-rose-100 text-rose-700"
          : "bg-slate-200 text-slate-600";

  return (
    <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${styles}`}>
      {
        status
      }
    </span>
  );
}

function ReviewBadge({
  status,
}: {
  status:
    ReviewStatus;
}) {
  const label =
    status ===
    "new"
      ? "جدید"
      : status ===
          "in_progress"
        ? "در حال بررسی"
        : status ===
            "resolved"
          ? "رفع‌شده"
          : "نادیده گرفته‌شده";

  const styles =
    status ===
    "new"
      ? "bg-slate-100 text-slate-700"
      : status ===
          "in_progress"
        ? "bg-amber-100 text-amber-800"
        : status ===
            "resolved"
          ? "bg-emerald-100 text-emerald-700"
          : "bg-gray-100 text-gray-600";

  return (
    <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${styles}`}>
      {
        label
      }
    </span>
  );
}

/*
 * ============================================
 * Knowledge Action
 * ============================================
 */

function buildKnowledgeCreateHref({
  feedbackId,
  question,
  topicId,
}: {
  feedbackId:
    string;

  question?:
    string;

  topicId?:
    string;
}) {
  const params =
    new URLSearchParams();

  const cleanQuestion =
    String(
      question ||
        ""
    )
      .replace(
        /\s+/g,
        " "
      )
      .trim();

  if (
    cleanQuestion
  ) {
    params.set(
      "title",
      cleanQuestion.slice(
        0,
        200
      )
    );

    params.set(
      "question",
      cleanQuestion.slice(
        0,
        2000
      )
    );
  }

  if (
    topicId
  ) {
    params.set(
      "topicId",
      topicId
    );
  }

  params.set(
    "feedbackId",
    feedbackId
  );

  return `/admin/knowledge/new?${params.toString()}`;
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

function formatConfidence(
  value:
    number
) {
  const normalized =
    value <=
    1
      ? value *
        100
      : value;

  return `${normalized.toLocaleString(
    "fa-IR",
    {
      maximumFractionDigits:
        1,
    }
  )}٪`;
}

function formatLatency(
  value:
    number
) {
  if (
    value >=
    1000
  ) {
    return `${(
      value /
      1000
    ).toLocaleString(
      "fa-IR",
      {
        maximumFractionDigits:
          2,
      }
    )} ثانیه`;
  }

  return `${formatInteger(
    value
  )} ms`;
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

function reasonLabel(
  key:
    string
) {
  switch (
    key
  ) {
    case "incorrect":
      return "پاسخ اشتباه";

    case "incomplete":
      return "پاسخ ناقص";

    case "outdated":
      return "اطلاعات قدیمی";

    case "irrelevant":
      return "پاسخ نامرتبط";

    case "unclear":
      return "پاسخ مبهم";

    case "source_issue":
      return "مشکل منبع";

    case "other":
      return "سایر";

    default:
      return key;
  }
}

function withRequestId(
  message:
    string,

  requestId?:
    string
) {
  if (
    !requestId
  ) {
    return message;
  }

  return `${message} (کد پیگیری: ${requestId})`;
}
