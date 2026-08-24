"use client";

import Link from "next/link";

import {
  useRouter,
} from "next/navigation";

import {
  KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  StatusBadge,
  SyncBadge,
} from "@/components/admin/knowledge/StatusBadge";

import type {
  DepartmentOption,
  KnowledgeApiError,
  KnowledgeItem,
  KnowledgeSourceType,
  TopicOption,
} from "@/types/knowledge";

/*
 * =========================================
 * Types
 * =========================================
 */

type LookupsResponse = {
  success: true;
  topics: TopicOption[];
  departments: DepartmentOption[];
};

type ItemResponse = {
  success: true;

  item: KnowledgeItem;

  message?: string;

  sync?: {
    success: boolean;
    message?: string;
  } | null;
};

type ResolveResponse =
  | {
      success: true;

      alreadyResolved?: boolean;

      gap: {
        id: string;
        status: string;
        resolvedKnowledgeItem?: string;
        resolvedAt?: string;
      };
    }
  | {
      success: false;
      message: string;
    };

type Props = {
  knowledgeId?: string;

  /*
   * این Props وقتی فرم از روی
   * Knowledge Gap باز شده باشد
   * مقدار خواهند داشت.
   */

  gapId?: string;
  gapTitle?: string;
  gapQuestion?: string;
  gapTopicId?: string;
};

/*
 * =========================================
 * Component
 * =========================================
 */

export default function KnowledgeForm({
  knowledgeId,

  gapId,
  gapTitle,
  gapQuestion,
  gapTopicId,
}: Props) {
  const router =
    useRouter();

  const fileRef =
    useRef<HTMLInputElement>(
      null
    );

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  const [
    saving,
    setSaving,
  ] =
    useState(false);

  const [
    preview,
    setPreview,
  ] =
    useState(false);

  const [
    topics,
    setTopics,
  ] =
    useState<
      TopicOption[]
    >([]);

  const [
    departments,
    setDepartments,
  ] =
    useState<
      DepartmentOption[]
    >([]);

  const [
    item,
    setItem,
  ] =
    useState<
      KnowledgeItem | null
    >(null);

  const [
    title,
    setTitle,
  ] =
    useState("");

  const [
    content,
    setContent,
  ] =
    useState("");

  const [
    topic,
    setTopic,
  ] =
    useState("");

  const [
    selectedDepartments,
    setSelectedDepartments,
  ] =
    useState<
      string[]
    >([]);

  const [
    tags,
    setTags,
  ] =
    useState<
      string[]
    >([]);

  const [
    tagInput,
    setTagInput,
  ] =
    useState("");

  const [
    sourceType,
    setSourceType,
  ] =
    useState<KnowledgeSourceType>(
      "text"
    );

  const [
    file,
    setFile,
  ] =
    useState<File | null>(
      null
    );

  const [
    fieldErrors,
    setFieldErrors,
  ] =
    useState<
      Record<
        string,
        string
      >
    >({});

  const [
    notice,
    setNotice,
  ] =
    useState<{
      type:
        | "success"
        | "error";

      text:
        string;
    } | null>(
      null
    );

  /*
   * =========================================
   * Load
   * =========================================
   */

  useEffect(() => {
    let active =
      true;

    async function load() {
      try {
        const [
          lookupsResponse,
          itemResponse,
        ] =
          await Promise.all([
            fetch(
              "/api/admin/knowledge/lookups",
              {
                cache:
                  "no-store",
              }
            ),

            knowledgeId
              ? fetch(
                  `/api/admin/knowledge/${knowledgeId}`,
                  {
                    cache:
                      "no-store",
                  }
                )
              : null,
          ]);

        const lookups =
          (await lookupsResponse.json()) as
            | LookupsResponse
            | KnowledgeApiError;

        if (
          !lookupsResponse.ok ||
          !lookups.success
        ) {
          throw new Error(
            "message" in
            lookups
              ? lookups.message
              : "دریافت اطلاعات فرم ناموفق بود."
          );
        }

        if (!active) {
          return;
        }

        setTopics(
          lookups.topics
        );

        setDepartments(
          lookups.departments
        );

        /*
         * =====================================
         * Prefill از Knowledge Gap
         * فقط برای Knowledge جدید
         * =====================================
         */

        if (
          !knowledgeId
        ) {
          if (
            gapTitle
          ) {
            setTitle(
              gapTitle
            );
          }

          if (
            gapTopicId &&
            lookups.topics.some(
              (
                option
              ) =>
                option.id ===
                gapTopicId
            )
          ) {
            setTopic(
              gapTopicId
            );
          }
        }

        /*
         * =====================================
         * Edit existing Knowledge
         * =====================================
         */

        if (
          itemResponse
        ) {
          const itemData =
            (await itemResponse.json()) as
              | ItemResponse
              | KnowledgeApiError;

          if (
            !itemResponse.ok ||
            !itemData.success
          ) {
            throw new Error(
              itemData.message ||
                "مطلب پیدا نشد."
            );
          }

          if (!active) {
            return;
          }

          setItem(
            itemData.item
          );

          setTitle(
            itemData.item.title
          );

          setContent(
            itemData.item.content
          );

          setTopic(
            itemData.item.topic
          );

          setSelectedDepartments(
            itemData.item
              .departments
          );

          setTags(
            itemData.item.tags
          );

          setSourceType(
            itemData.item
              .source_type
          );
        }
      } catch (error) {
        if (active) {
          setNotice({
            type:
              "error",

            text:
              error instanceof
              Error
                ? error.message
                : "بارگذاری فرم ناموفق بود.",
          });
        }
      } finally {
        if (active) {
          setLoading(
            false
          );
        }
      }
    }

    void load();

    return () => {
      active =
        false;
    };
  }, [
    knowledgeId,
    gapTitle,
    gapTopicId,
  ]);

  /*
   * =========================================
   * Tags
   * =========================================
   */

  function addTag(
    rawValue =
      tagInput
  ) {
    const value =
      rawValue
        .trim()
        .replace(
          /\s+/g,
          " "
        )
        .slice(
          0,
          50
        );

    if (
      value &&
      !tags.some(
        (tag) =>
          tag.localeCompare(
            value,
            "fa",
            {
              sensitivity:
                "base",
            }
          ) === 0
      ) &&
      tags.length <
        20
    ) {
      setTags(
        (
          current
        ) => [
          ...current,
          value,
        ]
      );
    }

    setTagInput(
      ""
    );
  }

  function tagKeyDown(
    event:
      KeyboardEvent<HTMLInputElement>
  ) {
    if (
      event.key ===
        "Enter" ||
      event.key === ","
    ) {
      event.preventDefault();

      addTag();
    }

    if (
      event.key ===
        "Backspace" &&
      !tagInput &&
      tags.length
    ) {
      setTags(
        (
          current
        ) =>
          current.slice(
            0,
            -1
          )
      );
    }
  }

  /*
   * =========================================
   * Departments
   * =========================================
   */

  function toggleDepartment(
    id: string
  ) {
    setSelectedDepartments(
      (current) =>
        current.includes(
          id
        )
          ? current.filter(
              (
                value
              ) =>
                value !==
                id
            )
          : [
              ...current,
              id,
            ]
    );
  }

  /*
   * =========================================
   * Resolve Gap
   * =========================================
   */

  async function resolveGap(
    knowledgeItemId: string
  ): Promise<{
    success: boolean;
    message?: string;
  }> {
    if (!gapId) {
      return {
        success:
          false,

        message:
          "Knowledge Gap مشخص نیست.",
      };
    }

    try {
      const response =
        await fetch(
          `/api/admin/knowledge/gaps/${gapId}/resolve`,
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify(
                {
                  knowledgeItemId,
                }
              ),
          }
        );

      const data =
        (await response.json()) as
          ResolveResponse;

      if (
        !response.ok ||
        !data.success
      ) {
        return {
          success:
            false,

          message:
            "message" in
            data
              ? data.message
              : "حل Knowledge Gap انجام نشد.",
        };
      }

      return {
        success:
          true,
      };
    } catch {
      return {
        success:
          false,

        message:
          "ارتباط با سرویس Knowledge Gap برقرار نشد.",
      };
    }
  }

  /*
   * =========================================
   * Save / Publish
   * =========================================
   */

  async function save(
    status:
      | "draft"
      | "published"
  ) {
    if (saving) {
      return;
    }

    setSaving(
      true
    );

    setNotice(
      null
    );

    setFieldErrors(
      {}
    );

    const formData =
      new FormData();

    formData.set(
      "title",
      title
    );

    formData.set(
      "content",
      content
    );

    formData.set(
      "topic",
      topic
    );

    formData.set(
      "departments",
      JSON.stringify(
        selectedDepartments
      )
    );

    formData.set(
      "tags",
      JSON.stringify(
        tags
      )
    );

    formData.set(
      "source_type",
      sourceType
    );

    formData.set(
      "status",
      status
    );

    if (file) {
      formData.set(
        "attachment",
        file
      );
    }

    try {
      /*
       * =====================================
       * Create / Edit Knowledge
       * =====================================
       */

      const response =
        await fetch(
          knowledgeId
            ? `/api/admin/knowledge/${knowledgeId}`
            : "/api/admin/knowledge",
          {
            method:
              knowledgeId
                ? "PATCH"
                : "POST",

            body:
              formData,
          }
        );

      const data =
        (await response.json()) as
          | ItemResponse
          | KnowledgeApiError;

      if (
        !response.ok ||
        !data.success
      ) {
        if (
          "fieldErrors" in
            data &&
          data.fieldErrors
        ) {
          setFieldErrors(
            data.fieldErrors
          );
        }

        throw new Error(
          data.message ||
            "ذخیره مطلب ناموفق بود."
        );
      }

      setItem(
        data.item
      );

      setFile(
        null
      );

      if (
        fileRef.current
      ) {
        fileRef.current.value =
          "";
      }

      /*
       * =====================================
       * آیا Sync موفق بوده؟
       * =====================================
       */

      const syncSucceeded =
        data.item
          .sync_status ===
          "synced" ||
        data.sync?.success ===
          true;

      /*
       * =====================================
       * Resolve Gap
       * فقط اگر:
       *
       * - از Gap آمده باشیم
       * - Published باشد
       * - Sync واقعی موفق باشد
       * =====================================
       */

      let gapResolved =
        false;

      let resolveMessage:
        | string
        | undefined;

      if (
        gapId &&
        status ===
          "published" &&
        syncSucceeded
      ) {
        const result =
          await resolveGap(
            data.item.id
          );

        gapResolved =
          result.success;

        resolveMessage =
          result.message;
      }

      /*
       * =====================================
       * Notification
       * =====================================
       */

      if (
        data.sync &&
        !data.sync.success
      ) {
        setNotice({
          type:
            "error",

          text:
            data.message ||
            data.sync
              .message ||
            "مطلب ذخیره شد، اما همگام‌سازی با پایگاه دانش ناموفق بود.",
        });
      } else if (
        gapId &&
        status ===
          "published" &&
        syncSucceeded &&
        !gapResolved
      ) {
        setNotice({
          type:
            "error",

          text:
            `مطلب منتشر و همگام شد، اما Knowledge Gap حل نشد.${
              resolveMessage
                ? ` ${resolveMessage}`
                : ""
            }`,
        });
      } else if (
        gapResolved
      ) {
        setNotice({
          type:
            "success",

          text:
            "مطلب منتشر و همگام شد و Knowledge Gap با موفقیت حل شد.",
        });
      } else if (
        gapId &&
        status ===
          "draft"
      ) {
        setNotice({
          type:
            "success",

          text:
            "پیش‌نویس ذخیره شد. Knowledge Gap تا زمان انتشار و همگام‌سازی موفق باز می‌ماند.",
        });
      } else {
        setNotice({
          type:
            "success",

          text:
            data.message ||
            "مطلب با موفقیت ذخیره شد.",
        });
      }

      /*
       * =====================================
       * Navigation
       * =====================================
       */

      /*
       * Gap حل شده:
       * به صفحه همان Gap برگرد.
       */

      if (
        gapResolved &&
        gapId
      ) {
        window.setTimeout(
          () =>
            router.replace(
              `/admin/knowledge/gaps/${gapId}`
            ),
          900
        );

        return;
      }

      /*
       * Knowledge جدید ساخته شده ولی Gap
       * هنوز حل نشده؛ مثلاً Draft بوده
       * یا Sync شکست خورده.
       *
       * به Edit برو ولی gapId را حفظ کن.
       */

      if (
        !knowledgeId
      ) {
        window.setTimeout(
          () =>
            router.replace(
              buildEditHref(
                data.item.id,
                gapId,
                gapQuestion
              )
            ),
          700
        );

        return;
      }

      router.refresh();
    } catch (error) {
      setNotice(
        (
          current
        ) =>
          current?.type ===
          "error"
            ? current
            : {
                type:
                  "error",

                text:
                  error instanceof
                  Error
                    ? error.message
                    : "ذخیره مطلب ناموفق بود.",
              }
      );
    } finally {
      setSaving(
        false
      );
    }
  }

  /*
   * =========================================
   * Loading
   * =========================================
   */

  if (loading) {
    return (
      <div className="space-y-4">

        <div className="h-24 animate-pulse rounded-3xl bg-slate-100" />

        <div className="h-[520px] animate-pulse rounded-3xl bg-slate-100" />

      </div>
    );
  }

  /*
   * =========================================
   * Render
   * =========================================
   */

  return (
    <div className="space-y-5">

      {/* Header */}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">

        <div>

          <Link
            href={
              gapId
                ? `/admin/knowledge/gaps/${gapId}`
                : "/admin/knowledge"
            }
            className="text-sm font-bold text-emerald-700 hover:text-emerald-800"
          >
            →
            {" "}
            {gapId
              ? "بازگشت به Knowledge Gap"
              : "بازگشت به فهرست"}
          </Link>

          <h1 className="mt-2 text-2xl font-black sm:text-3xl">
            {knowledgeId
              ? "ویرایش مطلب"
              : "مطلب جدید"}
          </h1>

          {item && (
            <div className="mt-3 flex flex-wrap items-center gap-2">

              <StatusBadge
                value={
                  item.status
                }
              />

              <SyncBadge
                value={
                  item.sync_status
                }
              />

              <span className="text-xs text-slate-500">
                نسخه{" "}
                {item.version.toLocaleString(
                  "fa-IR"
                )}
              </span>

            </div>
          )}

        </div>

        <button
          type="button"
          onClick={() =>
            setPreview(
              (value) =>
                !value
            )
          }
          className="self-start rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
        >
          {preview
            ? "بستن پیش‌نمایش"
            : "پیش‌نمایش"}
        </button>

      </div>

      {/* Gap Context */}

      {gapId && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:p-5">

          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">

            <div>

              <p className="text-xs font-black text-amber-700">
                این مطلب برای حل یک Knowledge Gap ایجاد شده است
              </p>

              {gapQuestion && (
                <p className="mt-2 whitespace-pre-wrap text-sm font-medium leading-7 text-amber-950">
                  سؤال کارشناس:
                  {" "}
                  {gapQuestion}
                </p>
              )}

              <p className="mt-2 text-xs leading-6 text-amber-700">
                پاسخ واقعی و تأییدشده شرکت را در بخش محتوا وارد کنید. تا زمانی که مطلب منتشر و با OpenAI همگام نشود، Gap حل‌شده محسوب نمی‌شود.
              </p>

            </div>

            <Link
              href={`/admin/knowledge/gaps/${gapId}`}
              className="shrink-0 text-xs font-black text-amber-800 underline underline-offset-4"
            >
              مشاهده Gap
            </Link>

          </div>

        </div>
      )}

      {/* Notice */}

      {notice && (
        <div
          role="status"
          className={`rounded-2xl border px-4 py-3 text-sm font-bold ${
            notice.type ===
            "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-rose-200 bg-rose-50 text-rose-800"
          }`}
        >
          {
            notice.text
          }
        </div>
      )}

      {/* Sync Error */}

      {item?.sync_error && (
        <details className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">

          <summary className="cursor-pointer font-black">
            جزئیات آخرین خطای همگام‌سازی
          </summary>

          <p className="mt-3 whitespace-pre-wrap break-words leading-7">
            {
              item.sync_error
            }
          </p>

        </details>
      )}

      <div
        className={`grid gap-5 ${
          preview
            ? "xl:grid-cols-2"
            : ""
        }`}
      >

        {/* Form */}

        <form
          onSubmit={(
            event
          ) =>
            event.preventDefault()
          }
          className="space-y-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"
        >

          {/* Title */}

          <Field
            label="عنوان"
            required
            error={
              fieldErrors.title
            }
          >
            <input
              value={
                title
              }
              onChange={(
                event
              ) =>
                setTitle(
                  event.target
                    .value
                )
              }
              maxLength={
                200
              }
              className={
                inputClass(
                  Boolean(
                    fieldErrors.title
                  )
                )
              }
              placeholder="مثلاً نحوه لغو سفارش مشتری"
            />
          </Field>

          {/* Source Type */}

          <fieldset>

            <legend className="mb-2 text-sm font-black text-slate-700">
              نوع منبع
            </legend>

            <div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1.5">

              {(
                [
                  "text",
                  "file",
                ] as const
              ).map(
                (
                  value
                ) => (
                  <button
                    key={
                      value
                    }
                    type="button"
                    onClick={() =>
                      setSourceType(
                        value
                      )
                    }
                    className={`rounded-xl px-4 py-2.5 text-sm font-bold transition ${
                      sourceType ===
                      value
                        ? "bg-white text-emerald-700 shadow-sm"
                        : "text-slate-500"
                    }`}
                  >
                    {value ===
                    "text"
                      ? "متن"
                      : "فایل"}
                  </button>
                )
              )}

            </div>

          </fieldset>

          {/* Content */}

          {sourceType ===
          "text" ? (
            <Field
              label="محتوا"
              required
              error={
                fieldErrors.content
              }
            >

              <textarea
                value={
                  content
                }
                onChange={(
                  event
                ) =>
                  setContent(
                    event.target
                      .value
                  )
                }
                rows={
                  14
                }
                maxLength={
                  200000
                }
                className={`${inputClass(
                  Boolean(
                    fieldErrors.content
                  )
                )} resize-y leading-8`}
                placeholder="پاسخ و محتوای دقیق، رسمی و قابل استناد شرکت را وارد کنید..."
              />

              <p className="mt-1 text-left text-xs text-slate-400">
                {content.length.toLocaleString(
                  "fa-IR"
                )}
                {" "}
                نویسه
              </p>

            </Field>
          ) : (
            <Field
              label="فایل منبع"
              required={
                !item?.attachment
              }
              error={
                fieldErrors.attachment
              }
            >

              <label
                className={`flex cursor-pointer flex-col items-center rounded-2xl border-2 border-dashed px-5 py-8 text-center transition hover:bg-slate-50 ${
                  fieldErrors.attachment
                    ? "border-rose-300"
                    : "border-slate-300"
                }`}
              >

                <span className="text-2xl">
                  ⇧
                </span>

                <span className="mt-2 text-sm font-black text-slate-700">
                  {file
                    ? file.name
                    : item?.attachment
                      ? `فایل فعلی: ${item.attachment}`
                      : "انتخاب فایل"}
                </span>

                <span className="mt-1 text-xs text-slate-400">
                  PDF، DOCX، TXT یا MD — حداکثر ۱۰ مگابایت
                </span>

                <input
                  ref={
                    fileRef
                  }
                  type="file"
                  accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
                  onChange={(
                    event
                  ) =>
                    setFile(
                      event.target
                        .files?.[0] ||
                        null
                    )
                  }
                  className="sr-only"
                />

              </label>

              {item?.attachment_url &&
                !file && (
                  <a
                    href={
                      item.attachment_url
                    }
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-block text-xs font-bold text-emerald-700"
                  >
                    مشاهده فایل فعلی
                  </a>
                )}

            </Field>
          )}

          {/* Topic + Departments */}

          <div className="grid gap-5 md:grid-cols-2">

            <Field
              label="موضوع"
              error={
                fieldErrors.topic
              }
            >

              <select
                value={
                  topic
                }
                onChange={(
                  event
                ) =>
                  setTopic(
                    event.target
                      .value
                  )
                }
                className={
                  inputClass(
                    Boolean(
                      fieldErrors.topic
                    )
                  )
                }
              >

                <option value="">
                  بدون موضوع
                </option>

                {topics.map(
                  (
                    option
                  ) => (
                    <option
                      key={
                        option.id
                      }
                      value={
                        option.id
                      }
                    >
                      {
                        option.label
                      }
                    </option>
                  )
                )}

              </select>

            </Field>

            <Field
              label="واحدها"
              hint="بدون انتخاب = عمومی"
              error={
                fieldErrors.departments
              }
            >

              <div className="max-h-44 space-y-1 overflow-auto rounded-xl border border-slate-300 p-2">

                {departments.length ? (
                  departments.map(
                    (
                      department
                    ) => (
                      <label
                        key={
                          department.id
                        }
                        className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-slate-50"
                      >

                        <input
                          type="checkbox"
                          checked={
                            selectedDepartments.includes(
                              department.id
                            )
                          }
                          onChange={() =>
                            toggleDepartment(
                              department.id
                            )
                          }
                          className="size-4 accent-emerald-600"
                        />

                        {
                          department.name
                        }

                      </label>
                    )
                  )
                ) : (
                  <p className="px-2 py-3 text-xs text-slate-400">
                    واحد فعالی ثبت نشده است.
                  </p>
                )}

              </div>

            </Field>

          </div>

          {/* Tags */}

          <Field
            label="برچسب‌ها"
            hint="با Enter یا ویرگول اضافه کنید"
            error={
              fieldErrors.tags
            }
          >

            <div className="flex min-h-12 flex-wrap items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 focus-within:border-emerald-500">

              {tags.map(
                (
                  tag
                ) => (
                  <span
                    key={
                      tag
                    }
                    className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700"
                  >

                    {
                      tag
                    }

                    <button
                      type="button"
                      onClick={() =>
                        setTags(
                          (
                            current
                          ) =>
                            current.filter(
                              (
                                value
                              ) =>
                                value !==
                                tag
                            )
                        )
                      }
                      className="text-emerald-900"
                      aria-label={`حذف برچسب ${tag}`}
                    >
                      ×
                    </button>

                  </span>
                )
              )}

              <input
                value={
                  tagInput
                }
                onChange={(
                  event
                ) =>
                  setTagInput(
                    event.target
                      .value
                  )
                }
                onKeyDown={
                  tagKeyDown
                }
                onBlur={() =>
                  addTag()
                }
                className="min-w-32 flex-1 border-0 bg-transparent py-1 text-sm outline-none"
                placeholder={
                  tags.length
                    ? "برچسب دیگر..."
                    : "مثلاً سفارش"
                }
              />

            </div>

          </Field>

          {/* Buttons */}

          <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-5 sm:flex-row sm:justify-end">

            <button
              type="button"
              onClick={() =>
                save(
                  "draft"
                )
              }
              disabled={
                saving
              }
              className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {saving
                ? "در حال ذخیره..."
                : "ذخیره پیش‌نویس"}
            </button>

            <button
              type="button"
              onClick={() =>
                save(
                  "published"
                )
              }
              disabled={
                saving
              }
              className="rounded-xl bg-emerald-600 px-6 py-3 text-sm font-black text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
            >
              {saving
                ? "در حال انتشار..."
                : gapId
                  ? "انتشار و حل Gap"
                  : "انتشار"}
            </button>

          </div>

        </form>

        {/* Preview */}

        {preview && (
          <aside className="self-start rounded-3xl border border-slate-200 bg-white p-6 shadow-sm xl:sticky xl:top-8">

            <p className="text-xs font-bold text-emerald-700">
              پیش‌نمایش مطلب
            </p>

            <h2 className="mt-3 text-2xl font-black text-slate-950">
              {title.trim() ||
                "عنوان مطلب"}
            </h2>

            {topic && (
              <p className="mt-2 text-sm text-slate-500">
                موضوع:
                {" "}
                {
                  topics.find(
                    (
                      option
                    ) =>
                      option.id ===
                      topic
                  )?.label
                }
              </p>
            )}

            <div className="mt-6 whitespace-pre-wrap break-words border-t border-slate-100 pt-6 text-sm leading-8 text-slate-700">

              {sourceType ===
              "text"
                ? content ||
                  "محتوایی برای پیش‌نمایش وارد نشده است."
                : file?.name ||
                  item?.attachment ||
                  "فایلی انتخاب نشده است."}

            </div>

            {tags.length >
              0 && (
              <div className="mt-6 flex flex-wrap gap-2">

                {tags.map(
                  (
                    tag
                  ) => (
                    <span
                      key={
                        tag
                      }
                      className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600"
                    >
                      #
                      {
                        tag
                      }
                    </span>
                  )
                )}

              </div>
            )}

          </aside>
        )}

      </div>

    </div>
  );
}

/*
 * =========================================
 * Field
 * =========================================
 */

function Field({
  label,
  required,
  hint,
  error,
  children,
}: {
  label:
    string;

  required?:
    boolean;

  hint?:
    string;

  error?:
    string;

  children:
    React.ReactNode;
}) {
  return (
    <label className="block">

      <span className="mb-2 flex items-center gap-1 text-sm font-black text-slate-700">

        {
          label
        }

        {required && (
          <span className="text-rose-500">
            *
          </span>
        )}

        {hint && (
          <span className="mr-auto text-xs font-normal text-slate-400">
            {
              hint
            }
          </span>
        )}

      </span>

      {
        children
      }

      {error && (
        <span className="mt-1 block text-xs font-bold text-rose-600">
          {
            error
          }
        </span>
      )}

    </label>
  );
}

/*
 * =========================================
 * Input Class
 * =========================================
 */

function inputClass(
  error: boolean
) {
  return `w-full rounded-xl border bg-white px-3 py-2.5 text-sm outline-none transition focus:ring-2 focus:ring-emerald-100 ${
    error
      ? "border-rose-300 focus:border-rose-400"
      : "border-slate-300 focus:border-emerald-500"
  }`;
}

/*
 * =========================================
 * Edit URL
 * =========================================
 */

function buildEditHref(
  knowledgeItemId:
    string,

  gapId?:
    string,

  gapQuestion?:
    string
) {
  const base =
    `/admin/knowledge/${knowledgeItemId}/edit`;

  if (!gapId) {
    return base;
  }

  const params =
    new URLSearchParams();

  params.set(
    "gapId",
    gapId
  );

  if (
    gapQuestion
  ) {
    params.set(
      "question",
      gapQuestion
    );
  }

  return `${base}?${params.toString()}`;
}