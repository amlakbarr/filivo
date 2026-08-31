"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import Link from "next/link";

import {
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";

type ConversationStatus =
  | "all"
  | "active"
  | "inactive";

type ConversationTopicSummary = {
  id:
    string;

  name:
    string;

  count:
    number;
};

type ConversationReasonSummary = {
  key:
    string;

  count:
    number;
};

type ConversationListItem = {
  id:
    string;

  title:
    string;

  status:
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

  created:
    string;

  updated:
    string;

  lastMessageAt?:
    string;

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

    unreviewedNegativeFeedback:
      number;
  };

  topics:
    ConversationTopicSummary[];

  negativeReasons:
    ConversationReasonSummary[];

  lastQuestion?:
    string;

  lastAnswer?:
    string;

  needsAttention:
    boolean;
};

type ConversationsResponse = {
  success?:
    boolean;

  code?:
    string;

  message?:
    string;

  requestId?:
    string;

  items?:
    ConversationListItem[];

  page?:
    number;

  perPage?:
    number;

  totalItems?:
    number;

  totalPages?:
    number;
};

const STATUS_OPTIONS: Array<{
  value:
    ConversationStatus;

  label:
    string;
}> = [
  {
    value:
      "all",

    label:
      "همه وضعیت‌ها",
  },
  {
    value:
      "active",

    label:
      "فعال",
  },
  {
    value:
      "inactive",

    label:
      "غیرفعال",
  },
];

const PER_PAGE =
  20;

export default function AdminConversationsPage() {
  const router =
    useRouter();

  const pathname =
    usePathname();

  const searchParams =
    useSearchParams();

  const page =
    positiveInteger(
      searchParams.get(
        "page"
      ),
      1
    );

  const search =
    searchParams.get(
      "search"
    ) ||
    "";

  const status =
    normalizeStatus(
      searchParams.get(
        "status"
      )
    );

  const from =
    searchParams.get(
      "from"
    ) ||
    "";

  const to =
    searchParams.get(
      "to"
    ) ||
    "";

  const [
    searchDraft,
    setSearchDraft,
  ] =
    useState(
      search
    );

  const [
    fromDraft,
    setFromDraft,
  ] =
    useState(
      from
    );

  const [
    toDraft,
    setToDraft,
  ] =
    useState(
      to
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
    items,
    setItems,
  ] =
    useState<
      ConversationListItem[]
    >([]);

  const [
    totalItems,
    setTotalItems,
  ] =
    useState(
      0
    );

  const [
    totalPages,
    setTotalPages,
  ] =
    useState(
      0
    );

  /*
   * ==========================================
   * Keep form draft in sync with URL
   * ==========================================
   */

  useEffect(
    () => {
      setSearchDraft(
        search
      );

      setFromDraft(
        from
      );

      setToDraft(
        to
      );
    },
    [
      search,
      from,
      to,
    ]
  );

  /*
   * ==========================================
   * Load
   * ==========================================
   */

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

        const query =
          new URLSearchParams();

        query.set(
          "page",
          String(
            page
          )
        );

        query.set(
          "perPage",
          String(
            PER_PAGE
          )
        );

        if (
          search
        ) {
          query.set(
            "search",
            search
          );
        }

        if (
          status !==
          "all"
        ) {
          query.set(
            "status",
            status
          );
        }

        if (
          from
        ) {
          query.set(
            "from",
            startOfDayIso(
              from
            )
          );
        }

        if (
          to
        ) {
          query.set(
            "to",
            endOfDayIso(
              to
            )
          );
        }

        try {
          const response =
            await fetch(
              `/api/admin/conversations?${query.toString()}`,
              {
                method:
                  "GET",

                cache:
                  "no-store",

                signal,
              }
            );

          const data =
            (
              await response
                .json()
                .catch(
                  () => ({})
                )
            ) as ConversationsResponse;

          if (
            signal
              ?.aborted
          ) {
            return;
          }

          if (
            !response.ok ||
            !data.success
          ) {
            setItems(
              []
            );

            setTotalItems(
              0
            );

            setTotalPages(
              0
            );

            setError(
              withRequestId(
                data.message ||
                  "دریافت مکالمات انجام نشد.",

                data.requestId ||
                  response.headers.get(
                    "X-Request-Id"
                  ) ||
                  undefined
              )
            );

            return;
          }

          setItems(
            data.items ||
            []
          );

          setTotalItems(
            Number(
              data.totalItems ||
                0
            )
          );

          setTotalPages(
            Number(
              data.totalPages ||
                0
            )
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

          setItems(
            []
          );

          setTotalItems(
            0
          );

          setTotalPages(
            0
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
        page,
        search,
        status,
        from,
        to,
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

  /*
   * ==========================================
   * URL helpers
   * ==========================================
   */

  function updateQuery(
    values:
      Record<
        string,
        string |
        undefined
      >
  ) {
    const next =
      new URLSearchParams(
        searchParams.toString()
      );

    for (
      const [
        key,
        value,
      ] of
      Object.entries(
        values
      )
    ) {
      if (
        value ===
          undefined ||
        value ===
          ""
      ) {
        next.delete(
          key
        );
      } else {
        next.set(
          key,
          value
        );
      }
    }

    router.replace(
      `${pathname}?${next.toString()}`,
      {
        scroll:
          false,
      }
    );
  }

  function submitFilters(
    event:
      FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    updateQuery({
      page:
        "1",

      search:
        searchDraft
          .trim() ||
        undefined,

      from:
        fromDraft ||
        undefined,

      to:
        toDraft ||
        undefined,
    });
  }

  function resetFilters() {
    setSearchDraft(
      ""
    );

    setFromDraft(
      ""
    );

    setToDraft(
      ""
    );

    router.replace(
      pathname,
      {
        scroll:
          false,
      }
    );
  }

  const attentionCount =
    useMemo(
      () =>
        items.filter(
          (
            item
          ) =>
            item.needsAttention
        ).length,
      [
        items,
      ]
    );

  const pageNumbers =
    useMemo(
      () =>
        buildPageNumbers(
          page,
          totalPages
        ),
      [
        page,
        totalPages,
      ]
    );

  return (
    <main
      dir="rtl"
      className="mx-auto w-full max-w-[1500px] space-y-6 px-4 py-6 sm:px-6 lg:px-8"
    >
      {/* =====================================
          Header
          ===================================== */}

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">

        <div className="flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">

          <div>

            <p className="text-xs font-black text-indigo-700">
              کنترل کیفیت مکالمات
            </p>

            <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">
              مکالمات کاربران با AI
            </h1>

            <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-500">
              مرور مکالمات واقعی، پاسخ‌های بدون دانش، Topicها و Feedbackهای منفی برای پیدا کردن نقاط ضعف سیستم.
            </p>

          </div>

          <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap">

            <HeaderMetric
              label="کل نتایج"
              value={
                formatInteger(
                  totalItems
                )
              }
            />

            <HeaderMetric
              label="نیازمند بررسی در این صفحه"
              value={
                formatInteger(
                  attentionCount
                )
              }
              alert={
                attentionCount >
                0
              }
            />

          </div>

        </div>

      </section>

      {/* =====================================
          Filters
          ===================================== */}

      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">

        <form
          onSubmit={
            submitFilters
          }
          className="space-y-4"
        >

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_220px_180px_180px_auto]">

            <div>

              <label
                htmlFor="conversation-search"
                className="mb-1.5 block text-xs font-black text-slate-600"
              >
                جست‌وجو
              </label>

              <input
                id="conversation-search"
                value={
                  searchDraft
                }
                onChange={(
                  event
                ) =>
                  setSearchDraft(
                    event.target
                      .value
                  )
                }
                maxLength={
                  200
                }
                placeholder="عنوان، نام، ایمیل یا کد کارشناس..."
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-slate-400"
              />

            </div>

            <div>

              <label
                htmlFor="conversation-status"
                className="mb-1.5 block text-xs font-black text-slate-600"
              >
                وضعیت گفتگو
              </label>

              <select
                id="conversation-status"
                value={
                  status
                }
                onChange={(
                  event
                ) =>
                  updateQuery({
                    page:
                      "1",

                    status:
                      event.target
                        .value ===
                      "all"
                        ? undefined
                        : event.target
                            .value,
                  })
                }
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none transition focus:border-slate-400"
              >

                {STATUS_OPTIONS.map(
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

            </div>

            <div>

              <label
                htmlFor="conversation-from"
                className="mb-1.5 block text-xs font-black text-slate-600"
              >
                از تاریخ
              </label>

              <input
                id="conversation-from"
                type="date"
                value={
                  fromDraft
                }
                onChange={(
                  event
                ) =>
                  setFromDraft(
                    event.target
                      .value
                  )
                }
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-slate-400"
              />

            </div>

            <div>

              <label
                htmlFor="conversation-to"
                className="mb-1.5 block text-xs font-black text-slate-600"
              >
                تا تاریخ
              </label>

              <input
                id="conversation-to"
                type="date"
                value={
                  toDraft
                }
                onChange={(
                  event
                ) =>
                  setToDraft(
                    event.target
                      .value
                  )
                }
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-slate-400"
              />

            </div>

            <div className="flex items-end gap-2">

              <button
                type="submit"
                className="h-11 rounded-xl bg-slate-950 px-4 text-xs font-black text-white transition hover:bg-black"
              >
                اعمال
              </button>

              <button
                type="button"
                onClick={
                  resetFilters
                }
                className="h-11 rounded-xl border border-slate-200 bg-white px-4 text-xs font-black text-slate-600 transition hover:bg-slate-50"
              >
                پاک‌کردن
              </button>

            </div>

          </div>

        </form>

      </section>

      {/* =====================================
          Error
          ===================================== */}

      {error && (

        <section className="rounded-3xl border border-rose-200 bg-rose-50 p-5 text-sm font-bold leading-7 text-rose-700">
          {
            error
          }
        </section>

      )}

      {/* =====================================
          List
          ===================================== */}

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">

        <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">

          <div>

            <h2 className="text-lg font-black text-slate-950">
              فهرست مکالمات
            </h2>

            <p className="mt-1 text-xs leading-6 text-slate-400">
              صفحه{" "}
              {
                formatInteger(
                  page
                )
              }
              {" "}
              از{" "}
              {
                formatInteger(
                  Math.max(
                    totalPages,
                    1
                  )
                )
              }
            </p>

          </div>

          <button
            type="button"
            onClick={() =>
              void load()
            }
            disabled={
              loading
            }
            className="w-fit rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
          >
            {
              loading
                ? "در حال بروزرسانی..."
                : "بروزرسانی"
            }
          </button>

        </div>

        <div className="p-4 sm:p-5">

          {loading &&
          items.length ===
            0 ? (

            <LoadingList />

          ) : items.length ===
            0 ? (

            <EmptyState />

          ) : (

            <div className="space-y-4">

              {items.map(
                (
                  item
                ) => (
                  <ConversationCard
                    key={
                      item.id
                    }
                    item={
                      item
                    }
                  />
                )
              )}

            </div>

          )}

        </div>

      </section>

      {/* =====================================
          Pagination
          ===================================== */}

      {totalPages >
      1 && (

        <nav className="flex flex-wrap items-center justify-center gap-2">

          <PageButton
            label="قبلی"
            disabled={
              page <=
              1
            }
            onClick={() =>
              updateQuery({
                page:
                  String(
                    Math.max(
                      1,
                      page -
                        1
                    )
                  ),
              })
            }
          />

          {pageNumbers.map(
            (
              pageNumber
            ) => (
              <PageButton
                key={
                  pageNumber
                }
                label={
                  formatInteger(
                    pageNumber
                  )
                }
                active={
                  pageNumber ===
                  page
                }
                onClick={() =>
                  updateQuery({
                    page:
                      String(
                        pageNumber
                      ),
                  })
                }
              />
            )
          )}

          <PageButton
            label="بعدی"
            disabled={
              page >=
              totalPages
            }
            onClick={() =>
              updateQuery({
                page:
                  String(
                    Math.min(
                      totalPages,
                      page +
                        1
                    )
                  ),
              })
            }
          />

        </nav>

      )}

    </main>
  );
}

/*
 * ============================================
 * Conversation Card
 * ============================================
 */

function ConversationCard({
  item,
}: {
  item:
    ConversationListItem;
}) {
  return (
    <article
      className={`overflow-hidden rounded-2xl border ${
        item.needsAttention
          ? "border-amber-200 bg-amber-50/30"
          : "border-slate-200 bg-white"
      }`}
    >

      <div className="p-4 sm:p-5">

        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">

          <div className="min-w-0">

            <div className="flex flex-wrap items-center gap-2">

              <h3
                title={
                  item.title
                }
                className="max-w-2xl truncate text-base font-black text-slate-950"
              >
                {
                  item.title
                }
              </h3>

              <StatusBadge
                status={
                  item.status
                }
              />

              {item.needsAttention && (
                <span className="rounded-full border border-amber-200 bg-amber-100 px-2.5 py-1 text-[10px] font-black text-amber-800">
                  نیازمند بررسی
                </span>
              )}

            </div>

            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">

              <span className="font-bold text-slate-700">
                {
                  item.user
                    .name
                }
              </span>

              {item.user
                .employeeCode && (
                <span>
                  کد:{" "}
                  {
                    item.user
                      .employeeCode
                  }
                </span>
              )}

              {item.user
                .departmentName && (
                <span>
                  {
                    item.user
                      .departmentName
                  }
                </span>
              )}

              {item.user
                .email && (
                <span>
                  {
                    item.user
                      .email
                  }
                </span>
              )}

            </div>

            <p className="mt-2 text-[11px] text-slate-400">
              آخرین فعالیت:{" "}
              {
                formatDateTime(
                  item.lastMessageAt ||
                    item.updated
                )
              }
            </p>

          </div>

          <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-3 2xl:grid-cols-6">

            <MetricPill
              label="پیام"
              value={
                item.metrics
                  .totalMessages
              }
            />

            <MetricPill
              label="سؤال"
              value={
                item.metrics
                  .userMessages
              }
            />

            <MetricPill
              label="پاسخ AI"
              value={
                item.metrics
                  .assistantMessages
              }
            />

            <MetricPill
              label="بدون پاسخ"
              value={
                item.metrics
                  .noAnswer
              }
              alert={
                item.metrics
                  .noAnswer >
                0
              }
            />

            <MetricPill
              label="👎"
              value={
                item.metrics
                  .negativeFeedback
              }
              alert={
                item.metrics
                  .negativeFeedback >
                0
              }
            />

            <MetricPill
              label="👎 باز"
              value={
                item.metrics
                  .unreviewedNegativeFeedback
              }
              alert={
                item.metrics
                  .unreviewedNegativeFeedback >
                0
              }
            />

          </div>

        </div>

        {/* Topics */}

        {item.topics.length >
        0 && (

          <div className="mt-4">

            <p className="text-[10px] font-black text-slate-400">
              Topicهای مکالمه
            </p>

            <div className="mt-2 flex flex-wrap gap-2">

              {item.topics.map(
                (
                  topic
                ) => (
                  <span
                    key={
                      topic.id
                    }
                    className="rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-bold text-indigo-700"
                  >
                    {
                      topic.name
                    }
                    {" · "}
                    {
                      formatInteger(
                        topic.count
                      )
                    }
                  </span>
                )
              )}

            </div>

          </div>

        )}

        {/* Negative reasons */}

        {item
          .negativeReasons
          .length >
        0 && (

          <div className="mt-4">

            <p className="text-[10px] font-black text-rose-500">
              دلایل Feedback منفی
            </p>

            <div className="mt-2 flex flex-wrap gap-2">

              {item
                .negativeReasons
                .map(
                  (
                    reason
                  ) => (
                    <span
                      key={
                        reason.key
                      }
                      className="rounded-full border border-rose-100 bg-rose-50 px-2.5 py-1 text-[11px] font-bold text-rose-700"
                    >
                      {
                        reasonLabel(
                          reason.key
                        )
                      }
                      {" · "}
                      {
                        formatInteger(
                          reason.count
                        )
                      }
                    </span>
                  )
                )}

            </div>

          </div>

        )}

        {/* Last Q/A */}

        <div className="mt-4 grid gap-3 lg:grid-cols-2">

          <PreviewBox
            title="آخرین سؤال"
            value={
              item.lastQuestion
            }
          />

          <PreviewBox
            title="آخرین پاسخ"
            value={
              item.lastAnswer
            }
          />

        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">

          <span className="text-[10px] text-slate-400">
            شناسه گفتگو:{" "}
            {
              item.id
            }
          </span>

          <Link
            href={`/admin/conversations/${item.id}`}
            className="rounded-lg bg-slate-950 px-3 py-2 text-[11px] font-black text-white transition hover:bg-black"
          >
            مشاهده جزئیات کامل
          </Link>

        </div>

      </div>

    </article>
  );
}

/*
 * ============================================
 * Small Components
 * ============================================
 */

function HeaderMetric({
  label,
  value,
  alert,
}: {
  label:
    string;

  value:
    string;

  alert?:
    boolean;
}) {
  return (
    <div
      className={`min-w-[150px] rounded-2xl border px-4 py-3 ${
        alert
          ? "border-amber-200 bg-amber-50"
          : "border-slate-200 bg-slate-50"
      }`}
    >

      <p className="text-[10px] font-black text-slate-500">
        {
          label
        }
      </p>

      <p
        className={`mt-1 text-xl font-black ${
          alert
            ? "text-amber-800"
            : "text-slate-950"
        }`}
      >
        {
          value
        }
      </p>

    </div>
  );
}

function MetricPill({
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
      className={`min-w-[82px] rounded-xl border px-3 py-2 text-center ${
        alert
          ? "border-rose-200 bg-rose-50"
          : "border-slate-200 bg-slate-50"
      }`}
    >

      <p className="text-[9px] font-black text-slate-400">
        {
          label
        }
      </p>

      <p
        className={`mt-1 text-sm font-black ${
          alert
            ? "text-rose-700"
            : "text-slate-800"
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

function PreviewBox({
  title,
  value,
}: {
  title:
    string;

  value?:
    string;
}) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3.5">

      <p className="text-[10px] font-black text-slate-400">
        {
          title
        }
      </p>

      <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs leading-6 text-slate-700">
        {
          value ||
          "—"
        }
      </p>

    </div>
  );
}

function StatusBadge({
  status,
}: {
  status:
    string;
}) {
  if (
    status ===
    "active"
  ) {
    return (
      <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-black text-emerald-700">
        فعال
      </span>
    );
  }

  if (
    status ===
    "inactive"
  ) {
    return (
      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black text-slate-600">
        غیرفعال
      </span>
    );
  }

  return (
    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black text-slate-500">
      {
        status ||
        "نامشخص"
      }
    </span>
  );
}

function PageButton({
  label,
  onClick,
  disabled,
  active,
}: {
  label:
    string;

  onClick:
    () => void;

  disabled?:
    boolean;

  active?:
    boolean;
}) {
  return (
    <button
      type="button"
      onClick={
        onClick
      }
      disabled={
        disabled
      }
      className={`min-w-10 rounded-xl border px-3 py-2 text-xs font-black transition ${
        active
          ? "border-slate-950 bg-slate-950 text-white"
          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
      } disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {
        label
      }
    </button>
  );
}

function LoadingList() {
  return (
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
            className="h-52 animate-pulse rounded-2xl bg-slate-100"
          />
        )
      )}

    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-14 text-center">

      <p className="text-sm font-black text-slate-600">
        مکالمه‌ای پیدا نشد
      </p>

      <p className="mt-2 text-xs leading-6 text-slate-400">
        فیلترها یا عبارت جست‌وجو را تغییر دهید.
      </p>

    </div>
  );
}

/*
 * ============================================
 * Helpers
 * ============================================
 */

function positiveInteger(
  value:
    string |
    null,

  fallback:
    number
) {
  const parsed =
    Number(
      value
    );

  if (
    !Number.isSafeInteger(
      parsed
    ) ||
    parsed <
      1
  ) {
    return fallback;
  }

  return parsed;
}

function normalizeStatus(
  value:
    string |
    null
):
  ConversationStatus {
  if (
    value ===
      "active" ||
    value ===
      "inactive"
  ) {
    return value;
  }

  return "all";
}

function startOfDayIso(
  value:
    string
) {
  const date =
    new Date(
      `${value}T00:00:00`
    );

  return date.toISOString();
}

function endOfDayIso(
  value:
    string
) {
  const date =
    new Date(
      `${value}T23:59:59.999`
    );

  return date.toISOString();
}

function buildPageNumbers(
  current:
    number,

  total:
    number
) {
  if (
    total <=
    0
  ) {
    return [];
  }

  const start =
    Math.max(
      1,
      Math.min(
        current -
          2,
        total -
          4
      )
    );

  const end =
    Math.min(
      total,
      start +
        4
    );

  const pages:
    number[] =
      [];

  for (
    let value =
      start;
    value <=
    end;
    value +=
      1
  ) {
    pages.push(
      value
    );
  }

  return pages;
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

function formatInteger(
  value:
    number
) {
  const safe =
    Number.isFinite(
      value
    )
      ? Math.max(
          0,
          Math.round(
            value
          )
        )
      : 0;

  return safe.toLocaleString(
    "fa-IR"
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
