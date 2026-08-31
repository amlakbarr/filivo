"use client";

import Link from "next/link";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import type {
  AIEvalCase,
  AIEvalCaseInput,
  AIEvalDashboard,
  AIEvalRun,
} from "@/types/ai-evals";

type DashboardResponse =
  | {
      success:
        true;

      dashboard:
        AIEvalDashboard;
    }
  | {
      success:
        false;

      message:
        string;
    };

type RunResponse =
  | {
      success:
        true;

      runs:
        AIEvalRun[];

      summary: {
        total:
          number;

        passed:
          number;

        failed:
          number;

        error:
          number;
      };
    }
  | {
      success:
        false;

      message:
        string;
    };

type FormState = {
  id?:
    string;

  title:
    string;

  question:
    string;

  expectedTopicId:
    string;

  expectedKnowledgeItemIds:
    string[];

  expectedHasAnswer:
    boolean;

  expectedAnswer:
    string;

  requiredPhrasesText:
    string;

  forbiddenPhrasesText:
    string;

  active:
    boolean;
};

const EMPTY_FORM:
  FormState = {
  title:
    "",

  question:
    "",

  expectedTopicId:
    "",

  expectedKnowledgeItemIds:
    [],

  expectedHasAnswer:
    true,

  expectedAnswer:
    "",

  requiredPhrasesText:
    "",

  forbiddenPhrasesText:
    "",

  active:
    true,
};

export default function AIEvalTestCenterPage() {
  const [
    dashboard,
    setDashboard,
  ] =
    useState<
      AIEvalDashboard |
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
    busy,
    setBusy,
  ] =
    useState(
      ""
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

  const [
    formOpen,
    setFormOpen,
  ] =
    useState(
      false
    );

  const [
    form,
    setForm,
  ] =
    useState<
      FormState
    >(
      EMPTY_FORM
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
              "/api/admin/evals/cases",
              {
                cache:
                  "no-store",
              }
            );

          const body =
            (
              await response
                .json()
            ) as
              DashboardResponse;

          if (
            !response.ok ||
            !body.success
          ) {
            throw new Error(
              "message" in
              body
                ? body.message
                : "دریافت Test Center ناموفق بود."
            );
          }

          setDashboard(
            body.dashboard
          );
        } catch (
          loadError
        ) {
          setDashboard(
            null
          );

          setError(
            loadError instanceof
              Error
              ? loadError.message
              : "دریافت Test Center ناموفق بود."
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

  const visibleKnowledge =
    useMemo(
      () => {
        if (
          !dashboard
        ) {
          return [];
        }

        if (
          !form.expectedTopicId
        ) {
          return dashboard
            .lookups
            .knowledgeItems;
        }

        return dashboard
          .lookups
          .knowledgeItems
          .filter(
            (
              item
            ) =>
              !item.topicId ||
              item.topicId ===
                form
                  .expectedTopicId
          );
      },
      [
        dashboard,
        form.expectedTopicId,
      ]
    );

  async function saveCase() {
    setError(
      ""
    );

    setNotice(
      ""
    );

    const payload:
      AIEvalCaseInput = {
      title:
        form.title.trim(),

      question:
        form.question.trim(),

      expectedTopicId:
        form.expectedTopicId ||
        undefined,

      expectedKnowledgeItemIds:
        form
          .expectedKnowledgeItemIds,

      expectedHasAnswer:
        form.expectedHasAnswer,

      expectedAnswer:
        form.expectedAnswer.trim() ||
        undefined,

      requiredPhrases:
        parseLines(
          form.requiredPhrasesText
        ),

      forbiddenPhrases:
        parseLines(
          form.forbiddenPhrasesText
        ),

      active:
        form.active,
    };

    if (
      !payload.title ||
      !payload.question
    ) {
      setError(
        "عنوان و سؤال الزامی هستند."
      );

      return;
    }

    const editingId =
      form.id;

    setBusy(
      editingId ||
      "new"
    );

    try {
      const response =
        await fetch(
          editingId
            ? `/api/admin/evals/cases/${editingId}`
            : "/api/admin/evals/cases",
          {
            method:
              editingId
                ? "PATCH"
                : "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify(
                payload
              ),
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
          "ذخیره Test Case انجام نشد."
        );
      }

      setForm(
        EMPTY_FORM
      );

      setFormOpen(
        false
      );

      setNotice(
        editingId
          ? "Test Case با موفقیت ویرایش شد."
          : "Test Case با موفقیت ساخته شد."
      );

      await load();
    } catch (
      saveError
    ) {
      setError(
        saveError instanceof
          Error
          ? saveError.message
          : "ذخیره Test Case انجام نشد."
      );
    } finally {
      setBusy(
        ""
      );
    }
  }

  async function runCases(
    caseId?:
      string
  ) {
    setError(
      ""
    );

    setNotice(
      ""
    );

    setBusy(
      caseId ||
      "all"
    );

    try {
      const response =
        await fetch(
          "/api/admin/evals/run",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify(
                caseId
                  ? {
                      caseId,
                    }
                  : {
                      all:
                        true,
                    }
              ),
          }
        );

      const body =
        (
          await response
            .json()
        ) as
          RunResponse;

      if (
        !response.ok ||
        !body.success
      ) {
        throw new Error(
          "message" in
          body
            ? body.message
            : "اجرای تست ناموفق بود."
        );
      }

      setNotice(
        `اجرای تست تمام شد: ${body.summary.passed.toLocaleString(
          "fa-IR"
        )} PASS، ${body.summary.failed.toLocaleString(
          "fa-IR"
        )} FAIL، ${body.summary.error.toLocaleString(
          "fa-IR"
        )} ERROR`
      );

      await load();
    } catch (
      runError
    ) {
      setError(
        runError instanceof
          Error
          ? runError.message
          : "اجرای تست ناموفق بود."
      );
    } finally {
      setBusy(
        ""
      );
    }
  }

  async function deleteCase(
    item:
      AIEvalCase
  ) {
    if (
      !window.confirm(
        `Test Case «${item.title}» حذف شود؟`
      )
    ) {
      return;
    }

    setBusy(
      item.id
    );

    setError(
      ""
    );

    try {
      const response =
        await fetch(
          `/api/admin/evals/cases/${item.id}`,
          {
            method:
              "DELETE",
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
          "حذف Test Case انجام نشد."
        );
      }

      setNotice(
        "Test Case حذف شد."
      );

      await load();
    } catch (
      deleteError
    ) {
      setError(
        deleteError instanceof
          Error
          ? deleteError.message
          : "حذف Test Case انجام نشد."
      );
    } finally {
      setBusy(
        ""
      );
    }
  }

  function editCase(
    item:
      AIEvalCase
  ) {
    setForm({
      id:
        item.id,

      title:
        item.title,

      question:
        item.question,

      expectedTopicId:
        item.expectedTopic
          ?.id ||
        "",

      expectedKnowledgeItemIds:
        item
          .expectedKnowledgeItems
          .map(
            (
              knowledge
            ) =>
              knowledge.id
          ),

      expectedHasAnswer:
        item.expectedHasAnswer,

      expectedAnswer:
        item.expectedAnswer ||
        "",

      requiredPhrasesText:
        item
          .requiredPhrases
          .join(
            "\n"
          ),

      forbiddenPhrasesText:
        item
          .forbiddenPhrases
          .join(
            "\n"
          ),

      active:
        item.active,
    });

    setFormOpen(
      true
    );

    window.scrollTo({
      top:
        0,

      behavior:
        "smooth",
    });
  }

  return (
    <main
      dir="rtl"
      className="space-y-6"
    >

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">

        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">

          <div>

            <p className="text-xs font-black text-indigo-700">
              Regression & Golden Questions
            </p>

            <h1 className="mt-2 text-2xl font-black text-slate-950 sm:text-3xl">
              مرکز تست AI
            </h1>

            <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-500">
              سؤال‌های طلایی را بعد از تغییر Knowledge، Topic یا Prompt اجرا کنید تا Classification، Retrieval، Grounding و پاسخ نهایی Regression نداشته باشند.
            </p>

          </div>

          <div className="flex flex-wrap gap-2">

            <Link
              href="/admin/evals/coverage"
              className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs font-black text-amber-700"
            >
              Coverage تست‌ها
            </Link>

            <Link
              href="/admin/evals/release"
              className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-black text-emerald-700"
            >
              Release Gate
            </Link>

            <Link
              href="/admin/evals/compare"
              className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-xs font-black text-indigo-700"
            >
              مقایسه Runها
            </Link>

            <button
              type="button"
              onClick={() => {
                setForm(
                  EMPTY_FORM
                );

                setFormOpen(
                  (
                    current
                  ) =>
                    !current
                );
              }}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-black text-slate-700"
            >
              Test Case جدید
            </button>

            <button
              type="button"
              onClick={() =>
                void runCases()
              }
              disabled={
                busy !==
                  "" ||
                !dashboard
                  ?.summary
                  .active
              }
              className="rounded-xl bg-indigo-700 px-4 py-2.5 text-xs font-black text-white disabled:opacity-50"
            >
              {
                busy ===
                "all"
                  ? "در حال اجرای همه..."
                  : "اجرای همه Caseهای فعال"
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

      {formOpen &&
      dashboard && (
        <CaseForm
          form={
            form
          }
          setForm={
            setForm
          }
          dashboard={
            dashboard
          }
          knowledgeOptions={
            visibleKnowledge
          }
          saving={
            busy ===
              (
                form.id ||
                "new"
              )
          }
          onSave={
            saveCase
          }
          onCancel={() => {
            setForm(
              EMPTY_FORM
            );

            setFormOpen(
              false
            );
          }}
        />
      )}

      {dashboard && (
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">

          <Metric
            label="کل Caseها"
            value={
              dashboard
                .summary
                .total
            }
          />

          <Metric
            label="فعال"
            value={
              dashboard
                .summary
                .active
            }
          />

          <Metric
            label="PASS"
            value={
              dashboard
                .summary
                .passed
            }
            tone="success"
          />

          <Metric
            label="FAIL"
            value={
              dashboard
                .summary
                .failed
            }
            tone="danger"
          />

          <Metric
            label="ERROR"
            value={
              dashboard
                .summary
                .error
            }
            tone="warning"
          />

          <Metric
            label="اجرا نشده"
            value={
              dashboard
                .summary
                .neverRun
            }
          />

        </section>
      )}

      <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">

        <div className="border-b border-slate-100 px-5 py-5 sm:px-6">

          <h2 className="text-lg font-black text-slate-950">
            Golden Questions
          </h2>

        </div>

        <div className="space-y-4 p-4 sm:p-6">

          {loading &&
          !dashboard ? (
            <div className="py-12 text-center text-sm font-bold text-slate-400">
              در حال بارگذاری...
            </div>
          ) : dashboard &&
            dashboard
              .cases
              .length >
              0 ? (
            dashboard.cases.map(
              (
                item
              ) => (
                <CaseCard
                  key={
                    item.id
                  }
                  item={
                    item
                  }
                  busy={
                    busy ===
                    item.id
                  }
                  onRun={() =>
                    void runCases(
                      item.id
                    )
                  }
                  onEdit={() =>
                    editCase(
                      item
                    )
                  }
                  onDelete={() =>
                    void deleteCase(
                      item
                    )
                  }
                />
              )
            )
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-12 text-center text-sm font-bold text-slate-400">
              هنوز Golden Question ثبت نشده است.
            </div>
          )}

        </div>

      </section>

    </main>
  );
}

/*
 * ============================================
 * Form
 * ============================================
 */

function CaseForm({
  form,
  setForm,
  dashboard,
  knowledgeOptions,
  saving,
  onSave,
  onCancel,
}: {
  form:
    FormState;

  setForm:
    React.Dispatch<
      React.SetStateAction<
        FormState
      >
    >;

  dashboard:
    AIEvalDashboard;

  knowledgeOptions:
    AIEvalDashboard[
      "lookups"
    ][
      "knowledgeItems"
    ];

  saving:
    boolean;

  onSave:
    () => void;

  onCancel:
    () => void;
}) {
  return (
    <section className="rounded-3xl border border-indigo-200 bg-indigo-50/30 p-5 shadow-sm sm:p-6">

      <h2 className="text-lg font-black text-slate-950">
        {
          form.id
            ? "ویرایش Test Case"
            : "Test Case جدید"
        }
      </h2>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">

        <Field
          label="عنوان"
        >
          <input
            value={
              form.title
            }
            onChange={(
              event
            ) =>
              setForm(
                (
                  current
                ) => ({
                  ...current,

                  title:
                    event
                      .target
                      .value,
                })
              )
            }
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none"
          />
        </Field>

        <Field
          label="Topic مورد انتظار"
        >
          <select
            value={
              form.expectedTopicId
            }
            onChange={(
              event
            ) =>
              setForm(
                (
                  current
                ) => ({
                  ...current,

                  expectedTopicId:
                    event
                      .target
                      .value,

                  expectedKnowledgeItemIds:
                    [],
                })
              )
            }
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none"
          >
            <option value="">
              بدون الزام Topic
            </option>

            {dashboard
              .lookups
              .topics
              .map(
                (
                  topic
                ) => (
                  <option
                    key={
                      topic.id
                    }
                    value={
                      topic.id
                    }
                  >
                    {
                      topic.name
                    }
                  </option>
                )
              )}
          </select>
        </Field>

        <div className="lg:col-span-2">

          <Field
            label="سؤال"
          >
            <textarea
              rows={
                4
              }
              value={
                form.question
              }
              onChange={(
                event
              ) =>
                setForm(
                  (
                    current
                  ) => ({
                    ...current,

                    question:
                      event
                        .target
                        .value,
                  })
                )
              }
              className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm leading-7 outline-none"
            />
          </Field>

        </div>

        <Field
          label="Knowledgeهای مورد انتظار"
          hint="Ctrl/Cmd را برای انتخاب چند مورد نگه دارید."
        >
          <select
            multiple
            size={
              7
            }
            value={
              form.expectedKnowledgeItemIds
            }
            onChange={(
              event
            ) =>
              setForm(
                (
                  current
                ) => ({
                  ...current,

                  expectedKnowledgeItemIds:
                    Array.from(
                      event
                        .target
                        .selectedOptions
                    ).map(
                      (
                        option
                      ) =>
                        option.value
                    ),
                })
              )
            }
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none"
          >
            {knowledgeOptions.map(
              (
                item
              ) => (
                <option
                  key={
                    item.id
                  }
                  value={
                    item.id
                  }
                >
                  {
                    item.title
                  }
                </option>
              )
            )}
          </select>
        </Field>

        <div className="space-y-4">

          <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700">

            <input
              type="checkbox"
              checked={
                form.expectedHasAnswer
              }
              onChange={(
                event
              ) =>
                setForm(
                  (
                    current
                  ) => ({
                    ...current,

                    expectedHasAnswer:
                      event
                        .target
                        .checked,
                  })
                )
              }
            />

            انتظار داریم پاسخ معتبر وجود داشته باشد

          </label>

          <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700">

            <input
              type="checkbox"
              checked={
                form.active
              }
              onChange={(
                event
              ) =>
                setForm(
                  (
                    current
                  ) => ({
                    ...current,

                    active:
                      event
                        .target
                        .checked,
                  })
                )
              }
            />

            Case فعال باشد

          </label>

        </div>

        <Field
          label="عبارات الزامی"
          hint="هر عبارت در یک خط"
        >
          <textarea
            rows={
              5
            }
            value={
              form.requiredPhrasesText
            }
            onChange={(
              event
            ) =>
              setForm(
                (
                  current
                ) => ({
                  ...current,

                  requiredPhrasesText:
                    event
                      .target
                      .value,
                })
              )
            }
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm leading-7 outline-none"
          />
        </Field>

        <Field
          label="عبارات ممنوع"
          hint="هر عبارت در یک خط"
        >
          <textarea
            rows={
              5
            }
            value={
              form.forbiddenPhrasesText
            }
            onChange={(
              event
            ) =>
              setForm(
                (
                  current
                ) => ({
                  ...current,

                  forbiddenPhrasesText:
                    event
                      .target
                      .value,
                })
              )
            }
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm leading-7 outline-none"
          />
        </Field>

        <div className="lg:col-span-2">

          <Field
            label="Expected Answer دقیق"
            hint="اختیاری؛ اگر پر شود مقایسه پس از Normalize به‌صورت دقیق انجام می‌شود. برای تست انعطاف‌پذیرتر از Required Phrases استفاده کنید."
          >
            <textarea
              rows={
                4
              }
              value={
                form.expectedAnswer
              }
              onChange={(
                event
              ) =>
                setForm(
                  (
                    current
                  ) => ({
                    ...current,

                    expectedAnswer:
                      event
                        .target
                        .value,
                  })
                )
              }
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm leading-7 outline-none"
            />
          </Field>

        </div>

      </div>

      <div className="mt-5 flex flex-wrap gap-2">

        <button
          type="button"
          onClick={
            onSave
          }
          disabled={
            saving
          }
          className="rounded-xl bg-indigo-700 px-5 py-2.5 text-xs font-black text-white disabled:opacity-50"
        >
          {
            saving
              ? "در حال ذخیره..."
              : "ذخیره Test Case"
          }
        </button>

        <button
          type="button"
          onClick={
            onCancel
          }
          className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-xs font-black text-slate-600"
        >
          انصراف
        </button>

      </div>

    </section>
  );
}

/*
 * ============================================
 * Card
 * ============================================
 */

function CaseCard({
  item,
  busy,
  onRun,
  onEdit,
  onDelete,
}: {
  item:
    AIEvalCase;

  busy:
    boolean;

  onRun:
    () => void;

  onEdit:
    () => void;

  onDelete:
    () => void;
}) {
  const run =
    item.latestRun;

  return (
    <article
      className={`rounded-2xl border p-4 sm:p-5 ${
        run?.status ===
        "failed"
          ? "border-rose-200 bg-rose-50/30"
          : run?.status ===
              "passed"
            ? "border-emerald-200 bg-emerald-50/20"
            : "border-slate-200 bg-white"
      }`}
    >

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">

        <div className="min-w-0">

          <div className="flex flex-wrap items-center gap-2">

            <StatusBadge
              status={
                run?.status ||
                "never"
              }
            />

            {!item.active && (
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black text-slate-500">
                غیرفعال
              </span>
            )}

            {item.expectedTopic && (
              <span className="rounded-full bg-indigo-100 px-2.5 py-1 text-[10px] font-black text-indigo-700">
                {
                  item
                    .expectedTopic
                    .name
                }
              </span>
            )}

          </div>

          <h3 className="mt-3 text-base font-black text-slate-950">
            {
              item.title
            }
          </h3>

          <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-700">
            {
              item.question
            }
          </p>

        </div>

        <div className="flex shrink-0 flex-wrap gap-2">

          <button
            type="button"
            onClick={
              onRun
            }
            disabled={
              busy
            }
            className="rounded-lg bg-slate-950 px-3 py-2 text-[11px] font-black text-white disabled:opacity-50"
          >
            {
              busy
                ? "در حال اجرا..."
                : "اجرای تست"
            }
          </button>

          <button
            type="button"
            onClick={
              onEdit
            }
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-black text-slate-600"
          >
            ویرایش
          </button>

          <button
            type="button"
            onClick={
              onDelete
            }
            className="rounded-lg border border-rose-200 bg-white px-3 py-2 text-[11px] font-black text-rose-600"
          >
            حذف
          </button>

        </div>

      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">

        <div className="rounded-xl bg-slate-50 p-3">

          <p className="text-[10px] font-black text-slate-400">
            انتظار
          </p>

          <p className="mt-2 text-xs font-bold text-slate-700">
            has_answer:
            {" "}
            {
              item.expectedHasAnswer
                ? "true"
                : "false"
            }
          </p>

          {item
            .expectedKnowledgeItems
            .length >
            0 && (
            <div className="mt-2 flex flex-wrap gap-1">

              {item
                .expectedKnowledgeItems
                .map(
                  (
                    knowledge
                  ) => (
                    <span
                      key={
                        knowledge.id
                      }
                      className="rounded-full bg-white px-2 py-1 text-[10px] text-slate-600"
                    >
                      {
                        knowledge.title
                      }
                    </span>
                  )
                )}

            </div>
          )}

        </div>

        <div className="rounded-xl bg-slate-50 p-3">

          <p className="text-[10px] font-black text-slate-400">
            آخرین اجرا
          </p>

          {run ? (
            <>
              <p className="mt-2 text-xs font-bold text-slate-700">
                has_answer:
                {" "}
                {
                  run.actualHasAnswer ===
                  undefined
                    ? "—"
                    : run.actualHasAnswer
                      ? "true"
                      : "false"
                }
              </p>

              <p className="mt-1 text-[10px] text-slate-500">
                Grounding:{" "}
                {
                  run.groundingStatus ||
                  "—"
                }
                {" · "}
                Verifier:{" "}
                {
                  run.verifierStatus ||
                  "—"
                }
              </p>
            </>
          ) : (
            <p className="mt-2 text-xs text-slate-400">
              هنوز اجرا نشده است.
            </p>
          )}

        </div>

      </div>

      {run?.actualAnswer && (
        <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">

          <p className="text-[10px] font-black text-slate-400">
            پاسخ واقعی
          </p>

          <p className="mt-2 whitespace-pre-wrap text-xs leading-6 text-slate-700">
            {
              run.actualAnswer
            }
          </p>

        </div>
      )}

      {run &&
      run.failureReasons.length >
        0 && (
        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3">

          <p className="text-[10px] font-black text-rose-700">
            دلیل FAIL / ERROR
          </p>

          <ul className="mt-2 list-disc space-y-1.5 pr-5 text-xs leading-6 text-rose-800">

            {run
              .failureReasons
              .map(
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

      {run &&
      run.actualSources.length >
        0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">

          {run
            .actualSources
            .map(
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
      )}

    </article>
  );
}

/*
 * ============================================
 * Small UI
 * ============================================
 */

function Field({
  label,
  hint,
  children,
}: {
  label:
    string;

  hint?:
    string;

  children:
    React.ReactNode;
}) {
  return (
    <label className="block">

      <span className="text-xs font-black text-slate-700">
        {
          label
        }
      </span>

      {hint && (
        <span className="mr-2 text-[10px] font-medium text-slate-400">
          {
            hint
          }
        </span>
      )}

      <div className="mt-2">
        {
          children
        }
      </div>

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

function StatusBadge({
  status,
}: {
  status:
    AIEvalRun["status"] |
    "never";
}) {
  const style =
    status ===
    "passed"
      ? "bg-emerald-100 text-emerald-700"
      : status ===
          "failed"
        ? "bg-rose-100 text-rose-700"
        : status ===
            "error"
          ? "bg-amber-100 text-amber-700"
          : "bg-slate-100 text-slate-500";

  const label =
    status ===
    "passed"
      ? "PASS"
      : status ===
          "failed"
        ? "FAIL"
        : status ===
            "error"
          ? "ERROR"
          : status ===
              "pending"
            ? "RUNNING"
            : "NEVER RUN";

  return (
    <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${style}`}>
      {
        label
      }
    </span>
  );
}

function parseLines(
  value:
    string
) {
  return [
    ...new Set(
      value
        .split(
          /\r?\n/
        )
        .map(
          (
            line
          ) =>
            line.trim()
        )
        .filter(
          Boolean
        )
    ),
  ];
}
