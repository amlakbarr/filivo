"use client";

import Link from "next/link";

import ClassificationLab from "@/components/admin/topics/ClassificationLab";
import ValidationOperationsHealth from "@/components/admin/topics/ValidationOperationsHealth";
import GuidanceEvidencePanel, {
  type GuidanceValidationGate,
} from "@/components/admin/topics/GuidanceEvidencePanel";
import GuidanceHistoryPanel from "@/components/admin/topics/GuidanceHistoryPanel";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from "react";

import type {
  TopicAnalyticsDashboard as AnalyticsDashboard,
} from "@/types/topic-analytics";

type AnalyticsTopic =
  AnalyticsDashboard["topics"][number];

type TopicItem = {
  id: string;
  name: string;
  code: string;
  description: string;
  keywords: string;
  examples: string;
  negativeExamples: string;
  classificationNote: string;
  active: boolean;
  sortOrder: number;
  classifiedMessages: number;
  created: string;
  updated: string;
};

type Pagination = {
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
};

type TopicListResponse = {
  success: true;
  items: TopicItem[];
  pagination: Pagination;
  requestId: string;
};

type TopicMutationResponse = {
  success: true;
  item: TopicItem;
  requestId: string;
};

type TopicBulkStatusResponse =
  | {
      success:
        true;

      partial:
        boolean;

      active:
        boolean;

      updatedIds:
        string[];

      failedIds:
        string[];

      summary: {
        requested:
          number;

        succeeded:
          number;

        failed:
          number;
      };

      requestId:
        string;
    }
  | {
      success:
        false;

      message?:
        string;

      requestId?:
        string;
    };

type TopicMergeResponse =
  | {
      success:
        true;

      partial:
        boolean;

      message:
        string;

      sourceTopicId:
        string;

      targetTopicId:
        string;

      summary: {
        messages:
          number;

        knowledgeItems:
          number;

        knowledgeGaps:
          number;

        gapOccurrences:
          number;

        knowledgeSyncPending:
          number;
      };

      knowledgeSyncRequired:
        boolean;

      requestId:
        string;
    }
  | {
      success:
        false;

      message?:
        string;

      requestId?:
        string;
    };

type TopicAnalyticsResponse =
  | {
      success:
        true;

      dashboard:
        AnalyticsDashboard;
    }
  | {
      success:
        false;

      message?:
        string;
    };

type ApiErrorResponse = {
  success?: false;
  code?: string;
  message?: string;
  requestId?: string;
  field?: string;
  retryAfterSeconds?: number;
};

type StatusFilter = "" | "active" | "inactive";

type FormState = {
  name: string;
  code: string;
  description: string;
  keywords: string;
  examples: string;
  negativeExamples: string;
  classificationNote: string;
  active: boolean;
  sortOrder: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  code: "",
  description: "",
  keywords: "",
  examples: "",
  negativeExamples: "",
  classificationNote: "",
  active: true,
  sortOrder: "0",
};

const PAGE_SIZE = 20;

export default function TopicsManager() {
  const [items, setItems] = useState<TopicItem[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    perPage: PAGE_SIZE,
    totalItems: 0,
    totalPages: 1,
  });
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("");
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTopic, setEditingTopic] = useState<TopicItem | null>(null);
  const [focusGuidance, setFocusGuidance] = useState(false);
  const [deepLinkLoading, setDeepLinkLoading] = useState(false);
  const [guidanceChangeNote, setGuidanceChangeNote] = useState("");
  const [
    guidanceValidationGate,
    setGuidanceValidationGate,
  ] =
    useState<GuidanceValidationGate>({
      status:
        "not_required",

      reason:
        "Guidance تغییری نکرده است.",

      validatedAt:
        "",

      accuracy:
        0,

      failed:
        0,

      errors:
        0,

      regressed:
        0,

      improved:
        0,

      compared:
        0,

      validationToken:
        "",

      validationId:
        "",

      expiresAt:
        "",
    });
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [formField, setFormField] = useState("");
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState("");
  const [sortingId, setSortingId] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkNotice, setBulkNotice] = useState("");
  const [mergeSource, setMergeSource] = useState<TopicItem | null>(null);
  const [mergeTargets, setMergeTargets] = useState<TopicItem[]>([]);
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [mergeTargetsLoading, setMergeTargetsLoading] = useState(false);
  const [mergeLoading, setMergeLoading] = useState(false);
  const [mergeError, setMergeError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [analyticsReloadKey, setAnalyticsReloadKey] = useState(0);

  const [
    analytics,
    setAnalytics,
  ] =
    useState<AnalyticsDashboard | null>(
      null
    );

  const [
    analyticsLoading,
    setAnalyticsLoading,
  ] =
    useState(true);

  const [
    analyticsError,
    setAnalyticsError,
  ] =
    useState("");

  const loadTopics = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setPageError("");

    const params = new URLSearchParams({
      page: String(pagination.page),
      perPage: String(PAGE_SIZE),
    });

    if (search) params.set("search", search);
    if (status) params.set("status", status);

    try {
      const response = await fetch(
        `/api/admin/topics?${params.toString()}`,
        {
          method: "GET",
          cache: "no-store",
          signal,
        }
      );

      const body = await safeJson(response);

      if (response.status === 401) {
        window.location.assign("/login");
        return;
      }

      if (!response.ok || !isTopicListResponse(body)) {
        throw new Error(
          getApiMessage(body, "دریافت فهرست موضوعات ناموفق بود.")
        );
      }

      setItems(body.items);
      setPagination(body.pagination);

      setSelectedIds(
        (
          current
        ) =>
          current.filter(
            (
              id
            ) =>
              body.items.some(
                (
                  item
                ) =>
                  item.id ===
                  id
              )
          )
      );
    } catch (error) {
      if (isAbortError(error)) return;

      setPageError(
        getErrorMessage(error, "دریافت فهرست موضوعات ناموفق بود.")
      );
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [pagination.page, search, status]);

  useEffect(() => {
    const controller = new AbortController();
    void loadTopics(controller.signal);

    return () => controller.abort();
  }, [loadTopics, reloadKey]);

  /*
   * =========================================
   * Analytics snapshot
   *
   * از همان API گزارش موضوعات استفاده می‌کنیم
   * تا محاسبات آماری در دو جای مختلف تکرار نشود.
   * =========================================
   */

  useEffect(() => {
    let cancelled =
      false;

    async function loadAnalytics() {
      setAnalyticsLoading(
        true
      );

      try {
        const response =
          await fetch(
            "/api/admin/analytics/topics",
            {
              cache:
                "no-store",
            }
          );

        const body =
          (await response.json()) as
            TopicAnalyticsResponse;

        if (
          response.status ===
          401
        ) {
          window.location.assign(
            "/login"
          );

          return;
        }

        if (
          !response.ok ||
          !body.success
        ) {
          throw new Error(
            "message" in
            body &&
            body.message
              ? body.message
              : "دریافت آمار موضوعات ناموفق بود."
          );
        }

        if (
          cancelled
        ) {
          return;
        }

        setAnalytics(
          body.dashboard
        );

        setAnalyticsError(
          ""
        );
      } catch (error) {
        if (
          cancelled
        ) {
          return;
        }

        setAnalyticsError(
          getErrorMessage(
            error,
            "دریافت آمار موضوعات ناموفق بود."
          )
        );
      } finally {
        if (
          !cancelled
        ) {
          setAnalyticsLoading(
            false
          );
        }
      }
    }

    void loadAnalytics();

    return () => {
      cancelled =
        true;
    };
  }, [
    analyticsReloadKey,
  ]);

  const analyticsByTopic =
    useMemo(
      () =>
        new Map<
          string,
          AnalyticsTopic
        >(
          (
            analytics?.topics ||
            []
          ).map(
            (
              item
            ) => [
              item.id,
              item,
            ]
          )
        ),
      [
        analytics,
      ]
    );

  const topicRankById =
    useMemo(
      () =>
        new Map<
          string,
          number
        >(
          (
            analytics?.topics ||
            []
          )
            .slice()
            .sort(
              (
                first,
                second
              ) =>
                second.count -
                first.count
            )
            .slice(
              0,
              3
            )
            .map(
              (
                item,
                index
              ) => [
                item.id,
                index +
                  1,
              ]
            )
        ),
      [
        analytics,
      ]
    );

  const pageUsageHealth =
    useMemo(
      () => {
        let usedInPeriod =
          0;

        let unusedInPeriod =
          0;

        let neverUsed =
          0;

        for (
          const topic of
          items
        ) {
          const analyticsItem =
            analyticsByTopic.get(
              topic.id
            );

          if (
            (
              analyticsItem?.count ||
              0
            ) >
              0
          ) {
            usedInPeriod +=
              1;

            continue;
          }

          if (
            topic.classifiedMessages >
            0
          ) {
            unusedInPeriod +=
              1;
          } else {
            neverUsed +=
              1;
          }
        }

        return {
          usedInPeriod,
          unusedInPeriod,
          neverUsed,
        };
      },
      [
        items,
        analyticsByTopic,
      ]
    );

  const visibleIds =
    useMemo(
      () =>
        items.map(
          (
            item
          ) =>
            item.id
        ),
      [
        items,
      ]
    );

  const allVisibleSelected =
    visibleIds.length >
      0 &&
    visibleIds.every(
      (
        id
      ) =>
        selectedIds.includes(
          id
        )
    );

  const selectedTopics =
    useMemo(
      () =>
        items.filter(
          (
            item
          ) =>
            selectedIds.includes(
              item.id
            )
        ),
      [
        items,
        selectedIds,
      ]
    );

  const pageActiveCount = useMemo(
    () => items.filter((item) => item.active).length,
    [items]
  );

  const pageInactiveCount = items.length - pageActiveCount;

  const pageClassifiedMessages = useMemo(
    () =>
      items.reduce(
        (total, item) => total + item.classifiedMessages,
        0
      ),
    [items]
  );

  /*
   * =========================================
   * Deep Link: Guidance Remediation
   *
   * /admin/topics?editTopic=<id>&focus=guidance
   *
   * Topic مستقیماً از API خوانده می‌شود تا حتی
   * اگر روی Page فعلی List نباشد Modal باز شود.
   * =========================================
   */

  useEffect(() => {
    if (
      typeof window ===
      "undefined"
    ) {
      return;
    }

    const params =
      new URLSearchParams(
        window.location.search
      );

    const topicId =
      String(
        params.get(
          "editTopic"
        ) ||
          ""
      ).trim();

    if (
      !topicId ||
      deepLinkLoading ||
      modalOpen
    ) {
      return;
    }

    let cancelled =
      false;

    async function openDeepLinkedTopic() {
      setDeepLinkLoading(
        true
      );

      try {
        const response =
          await fetch(
            `/api/admin/topics/${encodeURIComponent(
              topicId
            )}`,
            {
              cache:
                "no-store",
            }
          );

        const body =
          (await safeJson(
            response
          )) as
            TopicMutationResponse |
            {
              success?:
                false;

              message?:
                string;
            } |
            null;

        if (
          response.status ===
          401
        ) {
          window.location.assign(
            "/login"
          );

          return;
        }

        if (
          !response.ok ||
          !body ||
          body.success !==
            true ||
          !(
            "item" in
            body
          )
        ) {
          throw new Error(
            getApiMessage(
              body,
              "موضوع موردنظر برای ویرایش پیدا نشد."
            )
          );
        }

        if (
          cancelled
        ) {
          return;
        }

        const topic =
          body.item;

        setEditingTopic(
          topic
        );

        setForm({
          name:
            topic.name,

          code:
            topic.code,

          description:
            topic.description,

          keywords:
            topic.keywords,

          examples:
            topic.examples,

          negativeExamples:
            topic.negativeExamples,

          classificationNote:
            topic.classificationNote,

          active:
            topic.active,

          sortOrder:
            String(
              topic.sortOrder
            ),
        });

        setFormError(
          ""
        );

        setFormField(
          ""
        );

        setGuidanceChangeNote(
          ""
        );

    setGuidanceValidationGate({
      status:
        "not_required",

      reason:
        "Guidance تغییری نکرده است.",

      validatedAt:
        "",

      accuracy:
        0,

      failed:
        0,

      errors:
        0,

      regressed:
        0,

      improved:
        0,

      compared:
        0,

      validationToken:
        "",

      validationId:
        "",

      expiresAt:
        "",
    });

        setFocusGuidance(
          params.get(
            "focus"
          ) ===
            "guidance"
        );

        setModalOpen(
          true
        );

        const cleanUrl =
          new URL(
            window.location.href
          );

        cleanUrl.searchParams.delete(
          "editTopic"
        );

        cleanUrl.searchParams.delete(
          "focus"
        );

        window.history.replaceState(
          {},
          "",
          `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`
        );
      } catch (reason) {
        if (
          !cancelled
        ) {
          setPageError(
            getErrorMessage(
              reason,
              "باز کردن موضوع برای ویرایش ناموفق بود."
            )
          );
        }
      } finally {
        if (
          !cancelled
        ) {
          setDeepLinkLoading(
            false
          );
        }
      }
    }

    void openDeepLinkedTopic();

    return () => {
      cancelled =
        true;
    };
  }, [
    deepLinkLoading,
    modalOpen,
  ]);

  function applySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPagination((current) => ({ ...current, page: 1 }));
    setSearch(searchInput.trim());
  }

  function changeStatus(value: StatusFilter) {
    setPagination((current) => ({ ...current, page: 1 }));
    setStatus(value);
  }

  function openCreate() {
    setFocusGuidance(false);
    setGuidanceChangeNote("");
    setGuidanceValidationGate({
      status:
        "not_required",

      reason:
        "Guidance تغییری نکرده است.",

      validatedAt:
        "",

      accuracy:
        0,

      failed:
        0,

      errors:
        0,

      regressed:
        0,

      improved:
        0,

      compared:
        0,

      validationToken:
        "",

      validationId:
        "",

      expiresAt:
        "",
    });
    setEditingTopic(null);
    setForm(EMPTY_FORM);
    setFormError("");
    setFormField("");
    setModalOpen(true);
  }

  function openEdit(topic: TopicItem) {
    setFocusGuidance(false);
    setGuidanceChangeNote("");
    setGuidanceValidationGate({
      status:
        "not_required",

      reason:
        "Guidance تغییری نکرده است.",

      validatedAt:
        "",

      accuracy:
        0,

      failed:
        0,

      errors:
        0,

      regressed:
        0,

      improved:
        0,

      compared:
        0,

      validationToken:
        "",

      validationId:
        "",

      expiresAt:
        "",
    });
    setEditingTopic(topic);
    setForm({
      name: topic.name,
      code: topic.code,
      description: topic.description,
      keywords: topic.keywords,
      examples: topic.examples,
      negativeExamples: topic.negativeExamples,
      classificationNote: topic.classificationNote,
      active: topic.active,
      sortOrder: String(topic.sortOrder),
    });
    setFormError("");
    setFormField("");
    setModalOpen(true);
  }

  function closeModal() {
    if (saving) return;
    closeModalAfterSave();
  }

  function closeModalAfterSave() {
    setModalOpen(false);
    setFocusGuidance(false);
    setGuidanceChangeNote("");
    setGuidanceValidationGate({
      status:
        "not_required",

      reason:
        "Guidance تغییری نکرده است.",

      validatedAt:
        "",

      accuracy:
        0,

      failed:
        0,

      errors:
        0,

      regressed:
        0,

      improved:
        0,

      compared:
        0,

      validationToken:
        "",

      validationId:
        "",

      expiresAt:
        "",
    });
    setEditingTopic(null);
    setForm(EMPTY_FORM);
    setFormError("");
    setFormField("");
  }

  async function submitTopic(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    setFormError("");
    setFormField("");

    const name = form.name.trim();
    const code = normalizeCode(form.code);
    const description = form.description.trim();
    const keywords = normalizeMultiline(form.keywords);
    const examples = normalizeMultiline(form.examples);
    const negativeExamples = normalizeMultiline(
      form.negativeExamples
    );
    const classificationNote =
      form.classificationNote.trim();
    const sortOrder = Number(form.sortOrder);

    const guidanceChanges =
      editingTopic
        ? topicGuidanceChangedFields(
            editingTopic,
            {
              keywords,
              examples,
              negativeExamples,
              classificationNote,
            }
          )
        : [];

    if (!name) {
      setFormField("name");
      setFormError("نام موضوع الزامی است.");
      return;
    }

    if (!code) {
      setFormField("code");
      setFormError("کد موضوع الزامی است.");
      return;
    }

    if (!/^[a-z0-9]+(?:[_-][a-z0-9]+)*$/.test(code)) {
      setFormField("code");
      setFormError(
        "کد فقط می‌تواند شامل حروف کوچک انگلیسی، عدد، خط تیره و زیرخط باشد."
      );
      return;
    }

    if (!Number.isSafeInteger(sortOrder) || sortOrder < 0) {
      setFormField("sort_order");
      setFormError(
        "ترتیب نمایش باید یک عدد صحیح صفر یا بزرگ‌تر باشد."
      );
      return;
    }

    if (
      guidanceChanges.length >
        0 &&
      !guidanceChangeNote.trim()
    ) {
      setFormField(
        "guidance_change_note"
      );

      setFormError(
        "برای تغییر Guidance یک دلیل کوتاه ثبت کنید تا در تاریخچه قابل پیگیری باشد."
      );

      return;
    }

    if (
      guidanceChanges.length >
        0 &&
      (
        guidanceValidationGate.status !==
          "ready" ||
        !guidanceValidationGate
          .validationToken
      )
    ) {
      setFormField(
        "guidance_validation"
      );

      setFormError(
        guidanceValidationGate.status ===
          "blocked"
          ? `ذخیره Guidance مسدود است: ${guidanceValidationGate.reason}`
          : "قبل از ذخیره Guidance باید Validation Draft فعلی را با موفقیت اجرا کنید."
      );

      return;
    }

    setSaving(true);

    try {
      const isEdit = Boolean(editingTopic);
      const response = await fetch(
        isEdit
          ? `/api/admin/topics/${editingTopic?.id}`
          : "/api/admin/topics",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name,
            code,
            description,
            keywords,
            examples,
            negative_examples: negativeExamples,
            classification_note: classificationNote,
            active: form.active,
            sort_order: sortOrder,

            guidance_change_note:
              guidanceChanges.length >
              0
                ? guidanceChangeNote
                    .trim()
                : undefined,

            guidance_validation_token:
              guidanceChanges.length >
              0
                ? guidanceValidationGate
                    .validationToken
                : undefined,
          }),
        }
      );

      const body = await safeJson(response);

      if (response.status === 401) {
        window.location.assign("/login");
        return;
      }

      if (!response.ok || !isTopicMutationResponse(body)) {
        const apiError = asApiError(body);

        if (
          apiError.field ===
          "guidance_validation"
        ) {
          setGuidanceValidationGate(
            (
              current
            ) => ({
              ...current,

              status:
                "pending",

              reason:
                apiError.message ||
                "گواهی Validation معتبر نیست؛ Draft را دوباره Validation کنید.",

              validationToken:
                "",

              validationId:
                "",

              expiresAt:
                "",
            })
          );
        }

        setFormField(apiError.field || "");
        throw new Error(
          apiError.message ||
            (isEdit
              ? "ویرایش موضوع ناموفق بود."
              : "ساخت موضوع ناموفق بود.")
        );
      }

      closeModalAfterSave();
      setReloadKey((value) => value + 1);
    } catch (error) {
      setFormError(
        getErrorMessage(
          error,
          editingTopic
            ? "ویرایش موضوع ناموفق بود."
            : "ساخت موضوع ناموفق بود."
        )
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleTopic(topic: TopicItem) {
    if (togglingId) return;

    const nextActive = !topic.active;
    const confirmed = window.confirm(
      nextActive
        ? `موضوع «${topic.name}» فعال شود؟`
        : `موضوع «${topic.name}» غیرفعال شود؟\n\nاز این پس این موضوع در طبقه‌بندی‌های جدید استفاده نمی‌شود؛ داده‌های تاریخی حذف نخواهند شد.`
    );

    if (!confirmed) return;

    setTogglingId(topic.id);
    setPageError("");

    try {
      const response = await fetch(`/api/admin/topics/${topic.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          active: nextActive,
        }),
      });

      const body = await safeJson(response);

      if (response.status === 401) {
        window.location.assign("/login");
        return;
      }

      if (!response.ok || !isTopicMutationResponse(body)) {
        throw new Error(
          getApiMessage(body, "تغییر وضعیت موضوع ناموفق بود.")
        );
      }

      setItems((current) =>
        current.map((item) =>
          item.id === body.item.id ? body.item : item
        )
      );
    } catch (error) {
      setPageError(
        getErrorMessage(error, "تغییر وضعیت موضوع ناموفق بود.")
      );
    } finally {
      setTogglingId("");
    }
  }

  async function updateSortOrder(
    topic: TopicItem,
    nextSortOrder: number
  ) {
    if (
      sortingId ||
      !Number.isSafeInteger(nextSortOrder) ||
      nextSortOrder < 0 ||
      nextSortOrder === topic.sortOrder
    ) {
      return;
    }

    setSortingId(topic.id);
    setPageError("");

    try {
      const response = await fetch(
        `/api/admin/topics/${topic.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sort_order: nextSortOrder,
          }),
        }
      );

      const body = await safeJson(response);

      if (response.status === 401) {
        window.location.assign("/login");
        return;
      }

      if (!response.ok || !isTopicMutationResponse(body)) {
        throw new Error(
          getApiMessage(
            body,
            "تغییر ترتیب موضوع ناموفق بود."
          )
        );
      }

      setReloadKey((value) => value + 1);
    } catch (error) {
      setPageError(
        getErrorMessage(
          error,
          "تغییر ترتیب موضوع ناموفق بود."
        )
      );
    } finally {
      setSortingId("");
    }
  }

  function toggleSelected(
    id:
      string
  ) {
    setSelectedIds(
      (
        current
      ) =>
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

  function toggleSelectAllVisible() {
    if (
      allVisibleSelected
    ) {
      setSelectedIds(
        []
      );

      return;
    }

    setSelectedIds(
      visibleIds
    );
  }

  async function bulkSetStatus(
    active:
      boolean
  ) {
    if (
      bulkLoading ||
      selectedIds.length ===
        0
    ) {
      return;
    }

    const actionLabel =
      active
        ? "فعال"
        : "غیرفعال";

    const historicalCount =
      selectedTopics.reduce(
        (
          total,
          topic
        ) =>
          total +
          (
            topic.classifiedMessages >
              0
              ? 1
              : 0
          ),
        0
      );

    const confirmation =
      active
        ? `${formatNumber(
            selectedIds.length
          )} موضوع انتخاب‌شده فعال شوند؟`
        : `${formatNumber(
            selectedIds.length
          )} موضوع انتخاب‌شده غیرفعال شوند؟${
            historicalCount >
              0
              ? `\n\n${formatNumber(
                  historicalCount
                )} مورد دارای داده تاریخی هستند. داده‌های قبلی حذف نمی‌شوند، اما این موضوعات در Classificationهای جدید استفاده نخواهند شد.`
              : ""
          }`;

    if (
      !window.confirm(
        confirmation
      )
    ) {
      return;
    }

    setBulkLoading(
      true
    );

    setBulkNotice(
      ""
    );

    setPageError(
      ""
    );

    try {
      const response =
        await fetch(
          "/api/admin/topics/bulk-status",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                ids:
                  selectedIds,

                active,
              }),
          }
        );

      const body =
        (await safeJson(
          response
        )) as
          TopicBulkStatusResponse |
          null;

      if (
        response.status ===
        401
      ) {
        window.location.assign(
          "/login"
        );

        return;
      }

      if (
        !response.ok &&
        response.status !==
          207
      ) {
        throw new Error(
          getApiMessage(
            body,
            "عملیات گروهی موضوعات ناموفق بود."
          )
        );
      }

      if (
        !body ||
        !body.success
      ) {
        throw new Error(
          getApiMessage(
            body,
            "عملیات گروهی موضوعات ناموفق بود."
          )
        );
      }

      const successText =
        body.partial
          ? `${formatNumber(
              body.summary.succeeded
            )} موضوع ${actionLabel} شد و ${formatNumber(
              body.summary.failed
            )} مورد ناموفق بود.`
          : `${formatNumber(
              body.summary.succeeded
            )} موضوع با موفقیت ${actionLabel} شد.`;

      setBulkNotice(
        successText
      );

      setSelectedIds(
        []
      );

      setReloadKey(
        (
          value
        ) =>
          value +
          1
      );
    } catch (error) {
      setPageError(
        getErrorMessage(
          error,
          "عملیات گروهی موضوعات ناموفق بود."
        )
      );
    } finally {
      setBulkLoading(
        false
      );
    }
  }

  async function openMerge(
    topic:
      TopicItem
  ) {
    if (
      mergeLoading
    ) {
      return;
    }

    setMergeSource(
      topic
    );

    setMergeTargetId(
      ""
    );

    setMergeTargets(
      []
    );

    setMergeError(
      ""
    );

    setMergeTargetsLoading(
      true
    );

    try {
      const targets:
        TopicItem[] = [];

      let page =
        1;

      let totalPages =
        1;

      do {
        const params =
          new URLSearchParams({
            status:
              "active",

            page:
              String(
                page
              ),

            perPage:
              "50",
          });

        const response =
          await fetch(
            `/api/admin/topics?${params.toString()}`,
            {
              cache:
                "no-store",
            }
          );

        const body =
          await safeJson(
            response
          );

        if (
          response.status ===
          401
        ) {
          window.location.assign(
            "/login"
          );

          return;
        }

        if (
          !response.ok ||
          !isTopicListResponse(
            body
          )
        ) {
          throw new Error(
            getApiMessage(
              body,
              "دریافت موضوعات مقصد ناموفق بود."
            )
          );
        }

        targets.push(
          ...body.items.filter(
            (
              item
            ) =>
              item.id !==
              topic.id
          )
        );

        totalPages =
          Math.max(
            1,
            body.pagination
              .totalPages
          );

        page +=
          1;
      } while (
        page <=
        totalPages
      );

      setMergeTargets(
        targets
      );
    } catch (error) {
      setMergeError(
        getErrorMessage(
          error,
          "دریافت موضوعات مقصد ناموفق بود."
        )
      );
    } finally {
      setMergeTargetsLoading(
        false
      );
    }
  }

  function closeMerge() {
    if (
      mergeLoading
    ) {
      return;
    }

    setMergeSource(
      null
    );

    setMergeTargets(
      []
    );

    setMergeTargetId(
      ""
    );

    setMergeError(
      ""
    );
  }

  async function submitMerge() {
    if (
      !mergeSource ||
      !mergeTargetId ||
      mergeLoading
    ) {
      return;
    }

    const target =
      mergeTargets.find(
        (
          item
        ) =>
          item.id ===
          mergeTargetId
      );

    if (
      !target
    ) {
      setMergeError(
        "موضوع مقصد معتبر نیست."
      );

      return;
    }

    const confirmed =
      window.confirm(
        `موضوع «${mergeSource.name}» داخل «${target.name}» ادغام شود؟\n\nتمام پیام‌ها، مطالب پایگاه دانش و Knowledge Gapهای مرتبط به موضوع مقصد منتقل می‌شوند. موضوع مبدا حذف نمی‌شود و فقط غیرفعال خواهد شد.`
      );

    if (
      !confirmed
    ) {
      return;
    }

    setMergeLoading(
      true
    );

    setMergeError(
      ""
    );

    setPageError(
      ""
    );

    setBulkNotice(
      ""
    );

    try {
      const response =
        await fetch(
          `/api/admin/topics/${mergeSource.id}/merge`,
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                targetTopicId:
                  mergeTargetId,
              }),
          }
        );

      const body =
        (await safeJson(
          response
        )) as
          TopicMergeResponse |
          null;

      if (
        response.status ===
        401
      ) {
        window.location.assign(
          "/login"
        );

        return;
      }

      if (
        !response.ok &&
        response.status !==
          207
      ) {
        throw new Error(
          getApiMessage(
            body,
            "ادغام موضوع ناموفق بود."
          )
        );
      }

      if (
        !body ||
        !body.success
      ) {
        throw new Error(
          getApiMessage(
            body,
            "ادغام موضوع ناموفق بود."
          )
        );
      }

      const summary =
        body.summary;

      const movedTotal =
        summary.messages +
        summary.knowledgeItems +
        summary.knowledgeGaps +
        summary.gapOccurrences;

      const syncText =
        summary.knowledgeSyncPending >
          0
          ? ` ${formatNumber(
              summary.knowledgeSyncPending
            )} مطلب منتشرشده نیازمند همگام‌سازی مجدد است؛ در صفحه پایگاه دانش «همگام‌سازی موارد در انتظار» را اجرا کنید.`
          : "";

      if (
        body.partial
      ) {
        setPageError(
          `ادغام ناقص بود. ${formatNumber(
            movedTotal
          )} Relation منتقل شد. موضوع مبدا غیرفعال است؛ همین ادغام را دوباره اجرا کنید تا موارد باقی‌مانده منتقل شوند.${syncText}`
        );
      } else {
        setBulkNotice(
          `موضوع «${mergeSource.name}» با موفقیت داخل «${target.name}» ادغام شد. ${formatNumber(
            movedTotal
          )} Relation منتقل شد.${syncText}`
        );
      }

      setMergeSource(
        null
      );

      setMergeTargets(
        []
      );

      setMergeTargetId(
        ""
      );

      setSelectedIds(
        []
      );

      setReloadKey(
        (
          value
        ) =>
          value +
          1
      );

      setAnalyticsReloadKey(
        (
          value
        ) =>
          value +
          1
      );
    } catch (error) {
      setMergeError(
        getErrorMessage(
          error,
          "ادغام موضوع ناموفق بود."
        )
      );
    } finally {
      setMergeLoading(
        false
      );
    }
  }

  function goToPage(page: number) {
    if (
      page < 1 ||
      page > pagination.totalPages ||
      page === pagination.page
    ) {
      return;
    }

    setPagination((current) => ({
      ...current,
      page,
    }));
  }

  return (
    <section className="space-y-6" dir="rtl">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <span className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">
              مدیریت طبقه‌بندی
            </span>

            <h1 className="mt-4 text-2xl font-black text-slate-950 sm:text-3xl">
              موضوعات
            </h1>

            <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-500">
              موضوعات مورد استفاده در طبقه‌بندی خودکار گفتگوها را بسازید،
              ویرایش کنید و در صورت نیاز بدون حذف اطلاعات تاریخی غیرفعال کنید.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <ClassificationLab />

            <ValidationOperationsHealth />

            <Link
              href="/admin/analytics/topics"
              className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-700 transition hover:bg-slate-50"
            >
              تحلیل موضوعات
            </Link>

            <button
              type="button"
              onClick={openCreate}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-white transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
            >
              <span className="text-lg leading-none">+</span>
              موضوع جدید
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="کل موضوعات"
          value={formatNumber(pagination.totalItems)}
          helper="براساس فیلتر فعلی"
        />
        <SummaryCard
          label="فعال در این صفحه"
          value={formatNumber(pageActiveCount)}
          helper="قابل استفاده در طبقه‌بندی"
        />
        <SummaryCard
          label="غیرفعال در این صفحه"
          value={formatNumber(pageInactiveCount)}
          helper="داده‌های تاریخی حفظ می‌شوند"
        />
        <SummaryCard
          label="پیام‌های مرتبط"
          value={formatNumber(pageClassifiedMessages)}
          helper="مجموع موضوعات این صفحه"
        />
      </div>

      <AnalyticsOverview
        data={
          analytics
        }
        loading={
          analyticsLoading
        }
        error={
          analyticsError
        }
      />

      <UsageHealthOverview
        usedInPeriod={
          pageUsageHealth.usedInPeriod
        }
        unusedInPeriod={
          pageUsageHealth.unusedInPeriod
        }
        neverUsed={
          pageUsageHealth.neverUsed
        }
        pageItems={
          items.length
        }
      />

      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <form
            onSubmit={applySearch}
            className="flex w-full max-w-2xl gap-2"
          >
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="جستجو در نام، کد یا توضیحات..."
              className="min-h-11 flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:bg-white"
            />
            <button
              type="submit"
              className="min-h-11 rounded-2xl border border-slate-200 bg-white px-5 text-sm font-black text-slate-700 transition hover:bg-slate-50"
            >
              جستجو
            </button>
          </form>

          <div className="flex flex-wrap gap-2">
            <FilterButton
              active={status === ""}
              onClick={() => changeStatus("")}
            >
              همه
            </FilterButton>
            <FilterButton
              active={status === "active"}
              onClick={() => changeStatus("active")}
            >
              فعال
            </FilterButton>
            <FilterButton
              active={status === "inactive"}
              onClick={() => changeStatus("inactive")}
            >
              غیرفعال
            </FilterButton>
          </div>
        </div>
      </div>

      {pageError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-bold leading-7 text-rose-700">
          {pageError}
        </div>
      ) : null}

      {bulkNotice ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-bold leading-7 text-emerald-700">
          {bulkNotice}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h2 className="font-black text-slate-900">
                فهرست موضوعات
              </h2>

              <span className="mt-1 block text-xs font-bold text-slate-400">
                صفحه {formatNumber(pagination.page)} از{" "}
                {formatNumber(Math.max(1, pagination.totalPages))}
              </span>
            </div>

            <BulkToolbar
              selectedCount={
                selectedIds.length
              }
              allVisibleSelected={
                allVisibleSelected
              }
              loading={
                bulkLoading
              }
              onToggleAll={
                toggleSelectAllVisible
              }
              onActivate={() =>
                void bulkSetStatus(
                  true
                )
              }
              onDeactivate={() =>
                void bulkSetStatus(
                  false
                )
              }
              onClear={() =>
                setSelectedIds(
                  []
                )
              }
            />
          </div>
        </div>

        {loading ? (
          <TopicsLoading />
        ) : items.length === 0 ? (
          <EmptyState onCreate={openCreate} />
        ) : (
          <>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[1120px] border-collapse text-right">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/80 text-xs font-black text-slate-500">
                    <th className="w-12 px-4 py-4 text-center">
                      <input
                        type="checkbox"
                        aria-label="انتخاب همه موضوعات این صفحه"
                        checked={
                          allVisibleSelected
                        }
                        onChange={
                          toggleSelectAllVisible
                        }
                        className="size-4 accent-emerald-600"
                      />
                    </th>
                    <th className="px-6 py-4">موضوع</th>
                    <th className="px-4 py-4">کد</th>
                    <th className="px-4 py-4">وضعیت</th>
                    <th className="px-4 py-4">ترتیب</th>
                    <th className="px-4 py-4">پیام‌های مرتبط</th>
                    <th className="px-4 py-4">آمار دوره</th>
                    <th className="px-6 py-4 text-left">عملیات</th>
                  </tr>
                </thead>

                <tbody>
                  {items.map((topic) => (
                    <TopicRow
                      key={topic.id}
                      topic={topic}
                      selected={
                        selectedIds.includes(
                          topic.id
                        )
                      }
                      toggling={togglingId === topic.id}
                      sorting={sortingId === topic.id}
                      analytics={
                        analyticsByTopic.get(
                          topic.id
                        ) ||
                        null
                      }
                      rank={
                        topicRankById.get(
                          topic.id
                        ) ||
                        null
                      }
                      onSelect={() =>
                        toggleSelected(
                          topic.id
                        )
                      }
                      onMerge={() =>
                        void openMerge(
                          topic
                        )
                      }
                      onEdit={() => openEdit(topic)}
                      onToggle={() => void toggleTopic(topic)}
                      onSort={(value) =>
                        void updateSortOrder(topic, value)
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-slate-100 lg:hidden">
              {items.map((topic) => (
                <TopicMobileCard
                  key={topic.id}
                  topic={topic}
                  selected={
                    selectedIds.includes(
                      topic.id
                    )
                  }
                  toggling={togglingId === topic.id}
                  sorting={sortingId === topic.id}
                  analytics={
                    analyticsByTopic.get(
                      topic.id
                    ) ||
                    null
                  }
                  rank={
                    topicRankById.get(
                      topic.id
                    ) ||
                    null
                  }
                  onSelect={() =>
                    toggleSelected(
                      topic.id
                    )
                  }
                  onMerge={() =>
                    void openMerge(
                      topic
                    )
                  }
                  onEdit={() => openEdit(topic)}
                  onToggle={() => void toggleTopic(topic)}
                  onSort={(value) =>
                    void updateSortOrder(topic, value)
                  }
                />
              ))}
            </div>
          </>
        )}

        <PaginationControls
          pagination={pagination}
          disabled={loading}
          onPage={goToPage}
        />
      </div>

      {mergeSource ? (
        <TopicMergeModal
          source={
            mergeSource
          }
          targets={
            mergeTargets
          }
          targetId={
            mergeTargetId
          }
          targetsLoading={
            mergeTargetsLoading
          }
          loading={
            mergeLoading
          }
          error={
            mergeError
          }
          onTarget={
            setMergeTargetId
          }
          onClose={
            closeMerge
          }
          onSubmit={() =>
            void submitMerge()
          }
        />
      ) : null}

      {modalOpen ? (
        <TopicModal
          editingTopic={editingTopic}
          focusGuidance={focusGuidance}
          form={form}
          setForm={setForm}
          guidanceChangeNote={guidanceChangeNote}
          setGuidanceChangeNote={setGuidanceChangeNote}
          guidanceValidationGate={guidanceValidationGate}
          setGuidanceValidationGate={setGuidanceValidationGate}
          fieldError={formField}
          error={formError}
          saving={saving}
          onClose={closeModal}
          onSubmit={submitTopic}
        />
      ) : null}
    </section>
  );
}

function UsageHealthOverview({
  usedInPeriod,
  unusedInPeriod,
  neverUsed,
  pageItems,
}: {
  usedInPeriod:
    number;

  unusedInPeriod:
    number;

  neverUsed:
    number;

  pageItems:
    number;
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-black text-slate-500">
            سلامت استفاده در این صفحه
          </p>

          <p className="mt-1 text-xs leading-6 text-slate-400">
            این شاخص‌ها فقط موضوعات صفحه فعلی را بررسی می‌کنند.
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-4 lg:min-w-[620px]">
          <HealthChip
            label="موضوع این صفحه"
            value={
              pageItems
            }
            tone="neutral"
          />

          <HealthChip
            label="استفاده‌شده در دوره"
            value={
              usedInPeriod
            }
            tone="success"
          />

          <HealthChip
            label="بدون استفاده در دوره"
            value={
              unusedInPeriod
            }
            tone="warning"
          />

          <HealthChip
            label="بدون سابقه استفاده"
            value={
              neverUsed
            }
            tone="danger"
          />
        </div>
      </div>
    </div>
  );
}

function HealthChip({
  label,
  value,
  tone,
}: {
  label:
    string;

  value:
    number;

  tone:
    "neutral" |
    "success" |
    "warning" |
    "danger";
}) {
  const className =
    tone ===
      "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : tone ===
          "warning"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : tone ===
            "danger"
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : "border-slate-200 bg-slate-50 text-slate-700";

  return (
    <div
      className={`rounded-2xl border px-4 py-3 ${className}`}
    >
      <p className="text-[10px] font-bold opacity-75">
        {
          label
        }
      </p>

      <p className="mt-1 text-lg font-black">
        {
          formatNumber(
            value
          )
        }
      </p>
    </div>
  );
}

function TopicUsageBadge({
  active,
  historicalMessages,
  analytics,
  rank,
}: {
  active:
    boolean;

  historicalMessages:
    number;

  analytics:
    AnalyticsTopic |
    null;

  rank:
    number |
    null;
}) {
  if (
    !active
  ) {
    return (
      <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-500">
        غیرفعال
      </span>
    );
  }

  if (
    historicalMessages <=
      0
  ) {
    return (
      <span className="rounded-full bg-rose-50 px-2 py-1 text-[10px] font-black text-rose-700">
        بدون سابقه استفاده
      </span>
    );
  }

  if (
    (
      analytics?.count ||
      0
    ) <=
      0
  ) {
    return (
      <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-black text-amber-700">
        بدون استفاده در دوره
      </span>
    );
  }

  if (
    rank &&
    rank <=
      3
  ) {
    return (
      <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-black text-blue-700">
        رتبه{" "}
        {
          formatNumber(
            rank
          )
        }{" "}
        دوره
      </span>
    );
  }

  return (
    <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-black text-emerald-700">
      فعال در دوره
    </span>
  );
}

function BulkToolbar({
  selectedCount,
  allVisibleSelected,
  loading,
  onToggleAll,
  onActivate,
  onDeactivate,
  onClear,
}: {
  selectedCount:
    number;

  allVisibleSelected:
    boolean;

  loading:
    boolean;

  onToggleAll:
    () => void;

  onActivate:
    () => void;

  onDeactivate:
    () => void;

  onClear:
    () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={
          onToggleAll
        }
        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 transition hover:bg-slate-50"
      >
        {allVisibleSelected
          ? "لغو انتخاب همه"
          : "انتخاب همه صفحه"}
      </button>

      {selectedCount >
        0 ? (
        <>
          <span className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-600">
            {
              formatNumber(
                selectedCount
              )
            }{" "}
            انتخاب
          </span>

          <button
            type="button"
            disabled={
              loading
            }
            onClick={
              onActivate
            }
            className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading
              ? "در حال ثبت..."
              : "فعال‌سازی گروهی"}
          </button>

          <button
            type="button"
            disabled={
              loading
            }
            onClick={
              onDeactivate
            }
            className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-black text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading
              ? "در حال ثبت..."
              : "غیرفعال‌سازی گروهی"}
          </button>

          <button
            type="button"
            disabled={
              loading
            }
            onClick={
              onClear
            }
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-500 transition hover:bg-slate-50 disabled:opacity-50"
          >
            پاک‌کردن انتخاب
          </button>
        </>
      ) : null}
    </div>
  );
}

function AnalyticsOverview({
  data,
  loading,
  error,
}: {
  data:
    AnalyticsDashboard |
    null;

  loading:
    boolean;

  error:
    string;
}) {
  if (
    loading &&
    !data
  ) {
    return (
      <div className="h-24 animate-pulse rounded-3xl bg-slate-100" />
    );
  }

  if (
    !data
  ) {
    return (
      <div className="rounded-3xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm leading-7 text-amber-800">
        آمار دوره‌ای موضوعات در دسترس نیست.
        {error
          ? ` ${error}`
          : ""}
      </div>
    );
  }

  const topTopic =
    data.kpis.topTopic;

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-black text-emerald-700">
            نمای آماری دوره
          </p>

          <p className="mt-1 text-sm font-bold text-slate-800">
            {
              data.range.label
            }
          </p>
        </div>

        <div className="grid flex-1 gap-3 sm:grid-cols-3 lg:max-w-3xl">
          <MiniMetric
            label="نرخ Classification"
            value={
              formatPercent(
                data.kpis
                  .classificationRate
              )
            }
          />

          <MiniMetric
            label="موضوع استفاده‌شده"
            value={
              formatNumber(
                data.kpis
                  .usedTopics
              )
            }
          />

          <MiniMetric
            label="پرتکرارترین موضوع"
            value={
              topTopic?.path ||
              "—"
            }
            compact
          />
        </div>
      </div>

      {error ? (
        <p className="mt-3 text-xs font-bold text-amber-700">
          بروزرسانی آمار با خطا همراه بود:{" "}
          {
            error
          }
        </p>
      ) : null}
    </div>
  );
}

function MiniMetric({
  label,
  value,
  compact = false,
}: {
  label:
    string;

  value:
    string;

  compact?:
    boolean;
}) {
  return (
    <div className="rounded-2xl bg-slate-50 px-4 py-3">
      <p className="text-[11px] font-bold text-slate-400">
        {
          label
        }
      </p>

      <p
        className={
          compact
            ? "mt-1 line-clamp-1 text-sm font-black text-slate-800"
            : "mt-1 text-lg font-black text-slate-900"
        }
      >
        {
          value
        }
      </p>
    </div>
  );
}

function TopicAnalyticsCell({
  analytics,
  compact = false,
}: {
  analytics:
    AnalyticsTopic |
    null;

  compact?:
    boolean;
}) {
  if (
    !analytics
  ) {
    return (
      <span className="text-xs font-bold text-slate-400">
        بدون داده
      </span>
    );
  }

  const trend =
    topicTrend(
      analytics.count,
      analytics.previousCount
    );

  return (
    <div
      className={
        compact
          ? "flex flex-wrap items-center gap-2"
          : "min-w-36 space-y-1.5"
      }
    >
      <div className="flex items-center gap-2">
        <strong className="text-sm font-black text-slate-800">
          {
            formatNumber(
              analytics.count
            )
          }
        </strong>

        <span className="text-[10px] font-bold text-slate-400">
          {
            formatPercent(
              analytics.percentage
            )
          }
        </span>
      </div>

      <span
        className={`inline-flex rounded-full px-2 py-1 text-[10px] font-black ${trend.className}`}
      >
        {
          trend.label
        }
      </span>

      {!compact && (
        <p className="text-[10px] text-slate-400">
          دوره قبل:{" "}
          {
            formatNumber(
              analytics.previousCount
            )
          }
        </p>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-black text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-black tracking-tight text-slate-950">
        {value}
      </p>
      <p className="mt-2 text-xs leading-6 text-slate-400">{helper}</p>
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "min-h-10 rounded-xl bg-slate-950 px-4 text-xs font-black text-white"
          : "min-h-10 rounded-xl border border-slate-200 bg-white px-4 text-xs font-black text-slate-600 transition hover:bg-slate-50"
      }
    >
      {children}
    </button>
  );
}

function TopicRow({
  topic,
  selected,
  toggling,
  sorting,
  analytics,
  rank,
  onSelect,
  onMerge,
  onEdit,
  onToggle,
  onSort,
}: {
  topic: TopicItem;
  selected: boolean;
  toggling: boolean;
  sorting: boolean;
  analytics: AnalyticsTopic | null;
  rank: number | null;
  onSelect: () => void;
  onMerge: () => void;
  onEdit: () => void;
  onToggle: () => void;
  onSort: (value: number) => void;
}) {
  return (
    <tr
      className={
        selected
          ? "border-b border-emerald-100 bg-emerald-50/40 last:border-b-0"
          : "border-b border-slate-100 last:border-b-0 hover:bg-slate-50/60"
      }
    >
      <td className="px-4 py-5 text-center align-top">
        <input
          type="checkbox"
          aria-label={`انتخاب موضوع ${topic.name}`}
          checked={
            selected
          }
          onChange={
            onSelect
          }
          className="size-4 accent-emerald-600"
        />
      </td>

      <td className="px-6 py-5 align-top">
        <div className="max-w-md">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-black text-slate-900">
              {topic.name}
            </p>

            <TopicUsageBadge
              active={
                topic.active
              }
              historicalMessages={
                topic.classifiedMessages
              }
              analytics={
                analytics
              }
              rank={
                rank
              }
            />

            {hasTopicGuidance(
              topic
            ) ? (
              <span className="rounded-full bg-violet-50 px-2 py-1 text-[10px] font-black text-violet-700">
                راهنمای AI
              </span>
            ) : null}
          </div>

          <p className="mt-1 line-clamp-2 text-xs leading-6 text-slate-500">
            {topic.description || "بدون توضیحات"}
          </p>
        </div>
      </td>

      <td className="px-4 py-5 align-top">
        <code
          dir="ltr"
          className="inline-flex rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-bold text-slate-700"
        >
          {topic.code}
        </code>
      </td>

      <td className="px-4 py-5 align-top">
        <StatusBadge active={topic.active} />
      </td>

      <td className="px-4 py-5 align-top">
        <QuickSortOrder
          value={topic.sortOrder}
          saving={sorting}
          onSave={onSort}
        />
      </td>

      <td className="px-4 py-5 align-top">
        <Link
          href={`/admin/analytics/topics/${topic.id}`}
          title="مشاهده تحلیل این موضوع"
          className="inline-flex min-w-12 justify-center rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-black text-slate-700 transition hover:bg-emerald-50 hover:text-emerald-700"
        >
          {formatNumber(topic.classifiedMessages)}
        </Link>
      </td>

      <td className="px-4 py-5 align-top">
        <TopicAnalyticsCell
          analytics={
            analytics
          }
        />
      </td>

      <td className="px-6 py-5 align-top">
        <div className="flex justify-end gap-2">
          <Link
            href={`/admin/analytics/topics/${topic.id}`}
            className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-black text-blue-700 transition hover:bg-blue-100"
          >
            تحلیل
          </Link>

          <button
            type="button"
            onClick={
              onMerge
            }
            className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-black text-violet-700 transition hover:bg-violet-100"
          >
            ادغام
          </button>

          <button
            type="button"
            onClick={onEdit}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 transition hover:bg-slate-50"
          >
            ویرایش
          </button>

          <button
            type="button"
            disabled={toggling}
            onClick={onToggle}
            className={
              topic.active
                ? "rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-black text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                : "rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
            }
          >
            {toggling
              ? "در حال ثبت..."
              : topic.active
                ? "غیرفعال"
                : "فعال"}
          </button>
        </div>
      </td>
    </tr>
  );
}

function TopicMobileCard({
  topic,
  selected,
  toggling,
  sorting,
  analytics,
  rank,
  onSelect,
  onMerge,
  onEdit,
  onToggle,
  onSort,
}: {
  topic: TopicItem;
  selected: boolean;
  toggling: boolean;
  sorting: boolean;
  analytics: AnalyticsTopic | null;
  rank: number | null;
  onSelect: () => void;
  onMerge: () => void;
  onEdit: () => void;
  onToggle: () => void;
  onSort: (value: number) => void;
}) {
  return (
    <article
      className={
        selected
          ? "bg-emerald-50/40 p-5"
          : "p-5"
      }
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-black text-slate-500">
          <input
            type="checkbox"
            checked={
              selected
            }
            onChange={
              onSelect
            }
            className="size-4 accent-emerald-600"
          />

          انتخاب
        </label>
      </div>

      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-black text-slate-900">
              {topic.name}
            </p>

            <TopicUsageBadge
              active={
                topic.active
              }
              historicalMessages={
                topic.classifiedMessages
              }
              analytics={
                analytics
              }
              rank={
                rank
              }
            />

            {hasTopicGuidance(
              topic
            ) ? (
              <span className="rounded-full bg-violet-50 px-2 py-1 text-[10px] font-black text-violet-700">
                راهنمای AI
              </span>
            ) : null}
          </div>

          <code
            dir="ltr"
            className="mt-2 inline-flex rounded-lg bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600"
          >
            {topic.code}
          </code>
        </div>

        <StatusBadge active={topic.active} />
      </div>

      <p className="mt-4 text-sm leading-7 text-slate-500">
        {topic.description || "بدون توضیحات"}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <div className="rounded-xl bg-slate-50 p-3">
          <span className="text-slate-400">ترتیب</span>
          <div className="mt-2">
            <QuickSortOrder
              value={topic.sortOrder}
              saving={sorting}
              onSave={onSort}
              compact
            />
          </div>
        </div>

        <Link
          href={`/admin/analytics/topics/${topic.id}`}
          className="rounded-xl bg-slate-50 p-3 transition hover:bg-emerald-50"
        >
          <span className="text-slate-400">پیام مرتبط</span>
          <strong className="mt-1 block text-slate-800">
            {formatNumber(topic.classifiedMessages)}
          </strong>
        </Link>
        <div className="col-span-2 rounded-xl border border-slate-100 bg-white p-3">
          <span className="text-slate-400">
            آمار دوره اخیر
          </span>

          <div className="mt-2">
            <TopicAnalyticsCell
              analytics={
                analytics
              }
              compact
            />
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Link
          href={`/admin/analytics/topics/${topic.id}`}
          className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5 text-center text-xs font-black text-blue-700"
        >
          تحلیل
        </Link>

        <button
          type="button"
          onClick={
            onMerge
          }
          className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2.5 text-xs font-black text-violet-700"
        >
          ادغام
        </button>

        <button
          type="button"
          onClick={onEdit}
          className="rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-black text-slate-700"
        >
          ویرایش
        </button>

        <button
          type="button"
          disabled={toggling}
          onClick={onToggle}
          className={
            topic.active
              ? "flex-1 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-black text-rose-700 disabled:opacity-50"
              : "flex-1 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs font-black text-emerald-700 disabled:opacity-50"
          }
        >
          {toggling
            ? "در حال ثبت..."
            : topic.active
              ? "غیرفعال"
              : "فعال"}
        </button>
      </div>
    </article>
  );
}

function QuickSortOrder({
  value,
  saving,
  onSave,
  compact = false,
}: {
  value: number;
  saving: boolean;
  onSave: (value: number) => void;
  compact?: boolean;
}) {
  const [draft, setDraft] =
    useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const parsed =
    Number(draft);

  const valid =
    Number.isSafeInteger(parsed) &&
    parsed >= 0;

  const dirty =
    valid &&
    parsed !== value;

  return (
    <div
      className={
        compact
          ? "flex items-center gap-1"
          : "flex min-w-40 items-center gap-1.5"
      }
      dir="ltr"
    >
      <button
        type="button"
        aria-label="کاهش ترتیب"
        disabled={
          saving ||
          value <= 0
        }
        onClick={() =>
          onSave(
            Math.max(
              0,
              value - 10
            )
          )
        }
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-slate-200 bg-white text-sm font-black text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        −
      </button>

      <input
        type="number"
        min={0}
        step={1}
        value={draft}
        disabled={saving}
        onChange={(event) =>
          setDraft(
            event.target.value
          )
        }
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            dirty
          ) {
            event.preventDefault();
            onSave(parsed);
          }
        }}
        className={
          compact
            ? "h-9 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-center text-xs font-black text-slate-700 outline-none focus:border-emerald-400"
            : "h-9 w-16 rounded-lg border border-slate-200 bg-white px-2 text-center text-xs font-black text-slate-700 outline-none focus:border-emerald-400"
        }
      />

      <button
        type="button"
        aria-label="افزایش ترتیب"
        disabled={saving}
        onClick={() =>
          onSave(value + 10)
        }
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-slate-200 bg-white text-sm font-black text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        +
      </button>

      {!compact && (
        <button
          type="button"
          disabled={
            saving ||
            !dirty
          }
          onClick={() =>
            onSave(parsed)
          }
          className="h-9 rounded-lg bg-slate-950 px-2.5 text-[11px] font-black text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-30"
        >
          {saving
            ? "..."
            : "ثبت"}
        </button>
      )}
    </div>
  );
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={
        active
          ? "inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700"
          : "inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-500"
      }
    >
      {active ? "فعال" : "غیرفعال"}
    </span>
  );
}

function PaginationControls({
  pagination,
  disabled,
  onPage,
}: {
  pagination: Pagination;
  disabled: boolean;
  onPage: (page: number) => void;
}) {
  const hasPrevious = pagination.page > 1;
  const hasNext = pagination.page < pagination.totalPages;

  return (
    <div className="flex flex-col gap-3 border-t border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <p className="text-xs font-bold text-slate-400">
        {formatNumber(pagination.totalItems)} موضوع
      </p>

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={disabled || !hasPrevious}
          onClick={() => onPage(pagination.page - 1)}
          className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-black text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          قبلی
        </button>

        <span className="min-w-20 text-center text-xs font-black text-slate-600">
          {formatNumber(pagination.page)} /{" "}
          {formatNumber(Math.max(1, pagination.totalPages))}
        </span>

        <button
          type="button"
          disabled={disabled || !hasNext}
          onClick={() => onPage(pagination.page + 1)}
          className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-black text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          بعدی
        </button>
      </div>
    </div>
  );
}

function TopicsLoading() {
  return (
    <div className="space-y-3 p-5 sm:p-6">
      {Array.from({ length: 5 }).map((_, index) => (
        <div
          key={index}
          className="h-20 animate-pulse rounded-2xl bg-slate-100"
        />
      ))}
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="px-6 py-16 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-2xl">
        #
      </div>

      <h3 className="mt-5 font-black text-slate-900">موضوعی پیدا نشد</h3>

      <p className="mx-auto mt-2 max-w-md text-sm leading-7 text-slate-500">
        فیلتر یا عبارت جستجو را تغییر دهید، یا یک موضوع جدید برای طبقه‌بندی
        گفتگوها ایجاد کنید.
      </p>

      <button
        type="button"
        onClick={onCreate}
        className="mt-5 rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-black text-white"
      >
        ساخت موضوع جدید
      </button>
    </div>
  );
}

function TopicMergeModal({
  source,
  targets,
  targetId,
  targetsLoading,
  loading,
  error,
  onTarget,
  onClose,
  onSubmit,
}: {
  source:
    TopicItem;

  targets:
    TopicItem[];

  targetId:
    string;

  targetsLoading:
    boolean;

  loading:
    boolean;

  error:
    string;

  onTarget:
    (
      value:
        string
    ) => void;

  onClose:
    () => void;

  onSubmit:
    () => void;
}) {
  const target =
    targets.find(
      (
        item
      ) =>
        item.id ===
        targetId
    ) ||
    null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="topic-merge-title"
    >
      <button
        type="button"
        aria-label="بستن"
        onClick={
          onClose
        }
        className="absolute inset-0 cursor-default"
      />

      <div className="relative z-10 w-full max-w-2xl rounded-3xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-6">
          <div>
            <p className="text-xs font-black text-violet-700">
              نگهداری Taxonomy
            </p>

            <h2
              id="topic-merge-title"
              className="mt-1 text-xl font-black text-slate-950"
            >
              ادغام موضوع
            </h2>
          </div>

          <button
            type="button"
            disabled={
              loading
            }
            onClick={
              onClose
            }
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-lg text-slate-500 transition hover:bg-slate-50 disabled:opacity-50"
          >
            ×
          </button>
        </div>

        <div className="space-y-5 p-6">
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
            <p className="text-xs font-bold text-rose-600">
              موضوع مبدا
            </p>

            <p className="mt-1 font-black text-rose-900">
              {
                source.name
              }
            </p>

            <code
              dir="ltr"
              className="mt-2 inline-flex rounded-lg bg-white/70 px-2 py-1 text-xs font-bold text-rose-700"
            >
              {
                source.code
              }
            </code>

            <p className="mt-3 text-xs leading-6 text-rose-700">
              پس از ادغام، این Topic حذف نمی‌شود؛ فقط غیرفعال خواهد شد.
            </p>
          </div>

          <div>
            <label
              htmlFor="merge-target-topic"
              className="mb-2 block text-sm font-black text-slate-700"
            >
              موضوع مقصد
            </label>

            <select
              id="merge-target-topic"
              value={
                targetId
              }
              disabled={
                loading ||
                targetsLoading
              }
              onChange={(
                event
              ) =>
                onTarget(
                  event.target
                    .value
                )
              }
              className="min-h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-900 outline-none transition focus:border-violet-400 focus:bg-white disabled:cursor-wait disabled:opacity-60"
            >
              <option value="">
                {targetsLoading
                  ? "در حال دریافت موضوعات..."
                  : "موضوع مقصد را انتخاب کنید"}
              </option>

              {targets.map(
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
                    {item.name} — {item.code}
                  </option>
                )
              )}
            </select>
          </div>

          {target ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-7 text-emerald-800">
              تمام Relationهای «
              <b>
                {
                  source.name
                }
              </b>
              » به «
              <b>
                {
                  target.name
                }
              </b>
              » منتقل خواهند شد.
            </div>
          ) : null}

          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs font-bold leading-7 text-amber-800">
            پیام‌ها، مطالب پایگاه دانش، Knowledge Gapها و Occurrenceهای مرتبط منتقل می‌شوند. مطالب منتشرشده‌ای که Topic آنها تغییر کند، برای همگام‌سازی مجدد OpenAI روی Pending قرار می‌گیرند.
          </div>

          {error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold leading-7 text-rose-700">
              {
                error
              }
            </div>
          ) : null}

          {!targetsLoading &&
          targets.length ===
            0 ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
              موضوع فعال دیگری برای مقصد ادغام وجود ندارد.
            </div>
          ) : null}

          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={
                loading
              }
              onClick={
                onClose
              }
              className="min-h-11 rounded-xl border border-slate-200 bg-white px-5 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              انصراف
            </button>

            <button
              type="button"
              disabled={
                loading ||
                targetsLoading ||
                !targetId
              }
              onClick={
                onSubmit
              }
              className="min-h-11 rounded-xl bg-violet-700 px-6 text-sm font-black text-white transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading
                ? "در حال ادغام..."
                : "تأیید ادغام"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TopicModal({
  editingTopic,
  focusGuidance,
  form,
  setForm,
  guidanceChangeNote,
  setGuidanceChangeNote,
  guidanceValidationGate,
  setGuidanceValidationGate,
  fieldError,
  error,
  saving,
  onClose,
  onSubmit,
}: {
  editingTopic: TopicItem | null;
  focusGuidance: boolean;
  form: FormState;
  setForm: Dispatch<SetStateAction<FormState>>;
  guidanceChangeNote: string;
  setGuidanceChangeNote: Dispatch<SetStateAction<string>>;
  guidanceValidationGate: GuidanceValidationGate;
  setGuidanceValidationGate: Dispatch<
    SetStateAction<GuidanceValidationGate>
  >;
  fieldError: string;
  error: string;
  saving: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const guidanceChanges =
    editingTopic
      ? topicGuidanceChangedFields(
          editingTopic,
          {
            keywords:
              normalizeMultiline(
                form.keywords
              ),

            examples:
              normalizeMultiline(
                form.examples
              ),

            negativeExamples:
              normalizeMultiline(
                form.negativeExamples
              ),

            classificationNote:
              form.classificationNote
                .trim(),
          }
        )
      : [];

  useEffect(() => {
    if (
      !focusGuidance
    ) {
      return;
    }

    const timer =
      window.setTimeout(
        () => {
          document
            .getElementById(
              "topic-guidance-section"
            )
            ?.scrollIntoView({
              behavior:
                "smooth",

              block:
                "center",
            });

          document
            .getElementById(
              "topic-keywords"
            )
            ?.focus({
              preventScroll:
                true,
            });
        },
        120
      );

    return () => {
      window.clearTimeout(
        timer
      );
    };
  }, [
    focusGuidance,
  ]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="topic-modal-title"
    >
      <button
        type="button"
        aria-label="بستن"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />

      <div className="relative z-10 max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-6">
          <div>
            <p className="text-xs font-black text-emerald-700">
              مدیریت موضوع
            </p>
            <h2
              id="topic-modal-title"
              className="mt-1 text-xl font-black text-slate-950"
            >
              {editingTopic ? "ویرایش موضوع" : "موضوع جدید"}
            </h2>

            {focusGuidance ? (
              <p className="mt-2 max-w-lg text-xs font-bold leading-6 text-violet-700">
                این Topic از بخش «اولویت اصلاح Guidance» باز شده است. پس از اصلاح، Regression Suite و Quality Audit را دوباره بررسی کن.
              </p>
            ) : null}
          </div>

          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-lg text-slate-500 transition hover:bg-slate-50 disabled:opacity-50"
          >
            ×
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-5 p-6">
          <div>
            <label
              htmlFor="topic-name"
              className="mb-2 block text-sm font-black text-slate-700"
            >
              نام موضوع
            </label>
            <input
              id="topic-name"
              value={form.name}
              maxLength={120}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
              className={inputClass(fieldError === "name")}
              placeholder="مثلاً مشکلات ورود به حساب"
            />
          </div>

          <div>
            <label
              htmlFor="topic-code"
              className="mb-2 block text-sm font-black text-slate-700"
            >
              کد موضوع
            </label>
            <input
              id="topic-code"
              dir="ltr"
              value={form.code}
              maxLength={80}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  code: normalizeCode(event.target.value),
                }))
              }
              className={inputClass(fieldError === "code")}
              placeholder="login_issues"
            />
            <p className="mt-2 text-xs leading-6 text-slate-400">
              فقط حروف کوچک انگلیسی، عدد، خط تیره و زیرخط. بعد از استفاده
              گسترده بهتر است کد موضوع را بی‌دلیل تغییر ندهید.
            </p>
          </div>

          <div>
            <label
              htmlFor="topic-description"
              className="mb-2 block text-sm font-black text-slate-700"
            >
              توضیحات
            </label>
            <textarea
              id="topic-description"
              value={form.description}
              maxLength={2000}
              rows={5}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
              className="w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-7 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:bg-white"
              placeholder="این موضوع چه نوع سؤال‌ها یا مشکلاتی را پوشش می‌دهد؟"
            />
          </div>

          <div
            id="topic-guidance-section"
            className={
              focusGuidance
                ? "rounded-2xl border border-violet-400 bg-violet-50/70 p-4 ring-4 ring-violet-100 sm:p-5"
                : "rounded-2xl border border-violet-200 bg-violet-50/50 p-4 sm:p-5"
            }
          >
            <div>
              <p className="text-sm font-black text-violet-900">
                راهنمای طبقه‌بندی برای AI
              </p>

              <p className="mt-1 text-xs leading-6 text-violet-700">
                این فیلدها اختیاری‌اند. هرچه مرز موضوع با موضوعات مشابه دقیق‌تر تعریف شود، Classification قابل‌اعتمادتر خواهد بود.
              </p>
            </div>

            <div className="mt-5 space-y-4">
              <GuidanceTextarea
                id="topic-keywords"
                label="کلیدواژه‌ها و عبارت‌های مرتبط"
                hint="هر مورد را در یک خط بنویسید."
                value={
                  form.keywords
                }
                maxLength={
                  1000
                }
                rows={
                  4
                }
                placeholder={"ورود\nلاگین\nرمز عبور\nکد تایید"}
                onChange={(
                  value
                ) =>
                  setForm(
                    (
                      current
                    ) => ({
                      ...current,
                      keywords:
                        value,
                    })
                  )
                }
              />

              <GuidanceTextarea
                id="topic-examples"
                label="نمونه سؤال‌های مثبت"
                hint="سؤال‌هایی که باید در این موضوع قرار بگیرند؛ هر نمونه در یک خط."
                value={
                  form.examples
                }
                maxLength={
                  4000
                }
                rows={
                  5
                }
                placeholder={"نمی‌توانم وارد حسابم شوم\nکد تایید برای من ارسال نمی‌شود"}
                onChange={(
                  value
                ) =>
                  setForm(
                    (
                      current
                    ) => ({
                      ...current,
                      examples:
                        value,
                    })
                  )
                }
              />

              <GuidanceTextarea
                id="topic-negative-examples"
                label="نمونه سؤال‌های منفی"
                hint="سؤال‌های مشابهی که نباید در این موضوع قرار بگیرند."
                value={
                  form.negativeExamples
                }
                maxLength={
                  4000
                }
                rows={
                  5
                }
                placeholder={"چطور رمز عبورم را تغییر بدهم؟\nچطور حساب جدید بسازم؟"}
                onChange={(
                  value
                ) =>
                  setForm(
                    (
                      current
                    ) => ({
                      ...current,
                      negativeExamples:
                        value,
                    })
                  )
                }
              />

              <GuidanceTextarea
                id="topic-classification-note"
                label="یادداشت مرزبندی"
                hint="یک توضیح کوتاه برای تمایز این Topic از موضوعات نزدیک."
                value={
                  form.classificationNote
                }
                maxLength={
                  2000
                }
                rows={
                  4
                }
                placeholder="فقط مشکلات ورود به حساب؛ تغییر اطلاعات حساب در این موضوع قرار نگیرد."
                onChange={(
                  value
                ) =>
                  setForm(
                    (
                      current
                    ) => ({
                      ...current,
                      classificationNote:
                        value,
                    })
                  )
                }
              />

              {editingTopic ? (
                <>
                  <GuidanceEvidencePanel
                    topicId={
                      editingTopic.id
                    }
                    keywords={
                      form.keywords
                    }
                    examples={
                      form.examples
                    }
                    negativeExamples={
                      form.negativeExamples
                    }
                    classificationNote={
                      form.classificationNote
                    }
                    draftChanged={
                      guidanceChanges.length >
                      0
                    }
                    onValidationGateChange={
                      setGuidanceValidationGate
                    }
                    onAddPositive={(
                      value
                    ) =>
                      setForm(
                        (
                          current
                        ) => ({
                          ...current,

                          examples:
                            appendGuidanceLine(
                              current.examples,
                              value,
                              4000
                            ),
                        })
                      )
                    }
                    onAddNegative={(
                      value
                    ) =>
                      setForm(
                        (
                          current
                        ) => ({
                          ...current,

                          negativeExamples:
                            appendGuidanceLine(
                              current.negativeExamples,
                              value,
                              4000
                            ),
                        })
                      )
                    }
                  />

                  <GuidanceHistoryPanel
                    topicId={
                      editingTopic.id
                    }
                    onRestored={(
                      snapshot
                    ) =>
                      setForm(
                        (
                          current
                        ) => ({
                          ...current,

                          keywords:
                            snapshot.keywords,

                          examples:
                            snapshot.examples,

                          negativeExamples:
                            snapshot.negativeExamples,

                          classificationNote:
                            snapshot.classificationNote,
                        })
                      )
                    }
                  />

                  {guidanceChanges.length >
                  0 ? (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                      <p className="text-xs font-black text-amber-900">
                        مرور تغییرات Guidance قبل از ذخیره
                      </p>

                      <p className="mt-1 text-[10px] leading-5 text-amber-700">
                        این تغییرات مستقیماً روی Classificationهای بعدی اثر می‌گذارند. قبل از ذخیره می‌توانی در «Validation متمرکز روی این Topic» همین Draft ذخیره‌نشده را با Evidenceهای واقعی تست کنی؛ نسخه فعلی نیز هنگام ذخیره خودکار در History نگه داشته می‌شود.
                      </p>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {guidanceChanges.map(
                          (
                            label
                          ) => (
                            <span
                              key={
                                label
                              }
                              className="rounded-full bg-white px-2.5 py-1 text-[10px] font-black text-amber-700"
                            >
                              {
                                label
                              }
                            </span>
                          )
                        )}
                      </div>

                      <div
                        className={
                          guidanceValidationGate.status ===
                            "ready"
                            ? "mt-4 rounded-xl border border-emerald-200 bg-white px-3 py-2.5"
                            : guidanceValidationGate.status ===
                                "blocked"
                              ? "mt-4 rounded-xl border border-rose-200 bg-white px-3 py-2.5"
                              : "mt-4 rounded-xl border border-amber-200 bg-white px-3 py-2.5"
                        }
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span
                            className={
                              guidanceValidationGate.status ===
                                "ready"
                                ? "text-[10px] font-black text-emerald-700"
                                : guidanceValidationGate.status ===
                                    "blocked"
                                  ? "text-[10px] font-black text-rose-700"
                                  : "text-[10px] font-black text-amber-700"
                            }
                          >
                            {guidanceValidationGate.status ===
                              "ready"
                              ? "Validation سرور تأیید شده است"
                              : guidanceValidationGate.status ===
                                  "blocked"
                                ? "ذخیره Guidance مسدود است"
                                : "Draft Validation لازم است"}
                          </span>

                          {guidanceValidationGate.status ===
                            "ready" ? (
                            <span className="text-[9px] font-black text-emerald-600">
                              Accuracy:{" "}
                              {
                                new Intl.NumberFormat(
                                  "fa-IR",
                                  {
                                    maximumFractionDigits:
                                      1,
                                  }
                                ).format(
                                  guidanceValidationGate
                                    .accuracy *
                                    100
                                )
                              }٪
                            </span>
                          ) : null}
                        </div>

                        <p className="mt-1 text-[10px] font-bold leading-5 text-slate-600">
                          {
                            guidanceValidationGate.reason
                          }
                        </p>
                      </div>

                      <div className="mt-4">
                        <label
                          htmlFor="topic-guidance-change-note"
                          className="mb-2 block text-xs font-black text-amber-900"
                        >
                          دلیل این تغییر
                        </label>

                        <textarea
                          id="topic-guidance-change-note"
                          value={
                            guidanceChangeNote
                          }
                          maxLength={
                            500
                          }
                          rows={
                            3
                          }
                          onChange={(
                            event
                          ) =>
                            setGuidanceChangeNote(
                              event.target
                                .value
                            )
                          }
                          placeholder="مثلاً: بر اساس ۵ Human Review، مرز این Topic با تغییر رمز عبور دقیق‌تر شد."
                          className={
                            fieldError ===
                            "guidance_change_note"
                              ? "w-full resize-y rounded-xl border border-rose-300 bg-white px-3 py-2.5 text-xs leading-6 outline-none ring-2 ring-rose-100 focus:border-rose-400"
                              : "w-full resize-y rounded-xl border border-amber-200 bg-white px-3 py-2.5 text-xs leading-6 outline-none focus:border-amber-400"
                          }
                        />

                        <p className="mt-1 text-[9px] font-bold text-amber-600">
                          این متن همراه Snapshot نسخه قبلی ذخیره می‌شود و در تاریخچه Guidance نمایش داده خواهد شد.
                        </p>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="topic-sort-order"
                className="mb-2 block text-sm font-black text-slate-700"
              >
                ترتیب نمایش
              </label>
              <input
                id="topic-sort-order"
                type="number"
                min={0}
                step={1}
                value={form.sortOrder}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    sortOrder: event.target.value,
                  }))
                }
                className={inputClass(fieldError === "sort_order")}
              />
            </div>

            <div>
              <span className="mb-2 block text-sm font-black text-slate-700">
                وضعیت
              </span>

              <button
                type="button"
                onClick={() =>
                  setForm((current) => ({
                    ...current,
                    active: !current.active,
                  }))
                }
                className={
                  form.active
                    ? "flex min-h-12 w-full items-center justify-between rounded-2xl border border-emerald-200 bg-emerald-50 px-4 text-sm font-black text-emerald-700"
                    : "flex min-h-12 w-full items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-black text-slate-600"
                }
              >
                <span>{form.active ? "فعال" : "غیرفعال"}</span>
                <span
                  className={
                    form.active
                      ? "relative h-6 w-11 rounded-full bg-emerald-500"
                      : "relative h-6 w-11 rounded-full bg-slate-300"
                  }
                  aria-hidden="true"
                >
                  <span
                    className={
                      form.active
                        ? "absolute left-1 top-1 h-4 w-4 rounded-full bg-white transition-transform"
                        : "absolute left-1 top-1 h-4 w-4 translate-x-5 rounded-full bg-white transition-transform"
                    }
                  />
                </span>
              </button>
            </div>
          </div>

          {error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold leading-7 text-rose-700">
              {error}
            </div>
          ) : null}

          {editingTopic && editingTopic.classifiedMessages > 0 ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold leading-6 text-amber-800">
              این موضوع به {formatNumber(editingTopic.classifiedMessages)} پیام
              تاریخی متصل است. غیرفعال‌سازی امن است، اما تغییر کد را فقط در
              صورت نیاز انجام دهید.
            </div>
          ) : null}

          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={saving}
              onClick={onClose}
              className="min-h-11 rounded-xl border border-slate-200 bg-white px-5 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              انصراف
            </button>

            <button
              type="submit"
              disabled={saving}
              className="min-h-11 rounded-xl bg-slate-950 px-6 text-sm font-black text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving
                ? "در حال ذخیره..."
                : editingTopic
                  ? "ذخیره تغییرات"
                  : "ساخت موضوع"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function GuidanceTextarea({
  id,
  label,
  hint,
  value,
  maxLength,
  rows,
  placeholder,
  onChange,
}: {
  id:
    string;

  label:
    string;

  hint:
    string;

  value:
    string;

  maxLength:
    number;

  rows:
    number;

  placeholder:
    string;

  onChange:
    (
      value:
        string
    ) => void;
}) {
  return (
    <div>
      <label
        htmlFor={
          id
        }
        className="mb-2 block text-xs font-black text-violet-900"
      >
        {
          label
        }
      </label>

      <textarea
        id={
          id
        }
        value={
          value
        }
        maxLength={
          maxLength
        }
        rows={
          rows
        }
        onChange={(
          event
        ) =>
          onChange(
            event.target
              .value
          )
        }
        className="w-full resize-y rounded-xl border border-violet-200 bg-white px-3 py-2.5 text-sm leading-7 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-violet-400"
        placeholder={
          placeholder
        }
      />

      <div className="mt-1 flex items-start justify-between gap-3 text-[10px] leading-5 text-violet-600">
        <span>
          {
            hint
          }
        </span>

        <span className="shrink-0">
          {
            formatNumber(
              value.length
            )
          }
          /
          {
            formatNumber(
              maxLength
            )
          }
        </span>
      </div>
    </div>
  );
}

function inputClass(error: boolean) {
  return [
    "min-h-12 w-full rounded-2xl border bg-slate-50 px-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:bg-white",
    error
      ? "border-rose-300 focus:border-rose-400"
      : "border-slate-200 focus:border-slate-400",
  ].join(" ");
}

function topicGuidanceChangedFields(
  topic:
    TopicItem,

  guidance: {
    keywords:
      string;

    examples:
      string;

    negativeExamples:
      string;

    classificationNote:
      string;
  }
) {
  const changes:
    string[] = [];

  if (
    normalizeMultiline(
      topic.keywords
    ) !==
    normalizeMultiline(
      guidance.keywords
    )
  ) {
    changes.push(
      "کلیدواژه‌ها"
    );
  }

  if (
    normalizeMultiline(
      topic.examples
    ) !==
    normalizeMultiline(
      guidance.examples
    )
  ) {
    changes.push(
      "نمونه‌های مثبت"
    );
  }

  if (
    normalizeMultiline(
      topic.negativeExamples
    ) !==
    normalizeMultiline(
      guidance.negativeExamples
    )
  ) {
    changes.push(
      "نمونه‌های منفی"
    );
  }

  if (
    topic.classificationNote
      .trim() !==
    guidance.classificationNote
      .trim()
  ) {
    changes.push(
      "یادداشت مرزبندی"
    );
  }

  return changes;
}

function appendGuidanceLine(
  current:
    string,

  value:
    string,

  maxLength:
    number
) {
  const candidate =
    value
      .trim()
      .replace(
        /\s+/g,
        " "
      );

  if (
    !candidate
  ) {
    return current;
  }

  const normalizedCurrent =
    normalizeMultiline(
      current
    );

  const existing =
    new Set(
      normalizedCurrent
        .split(
          "\n"
        )
        .map(
          (
            line
          ) =>
            line
              .trim()
              .replace(
                /\s+/g,
                " "
              )
              .toLocaleLowerCase(
                "fa"
              )
        )
        .filter(
          Boolean
        )
    );

  const key =
    candidate
      .toLocaleLowerCase(
        "fa"
      );

  if (
    existing.has(
      key
    )
  ) {
    return normalizedCurrent;
  }

  const next =
    normalizedCurrent
      ? `${normalizedCurrent}\n${candidate}`
      : candidate;

  /*
   * Line را نصفه ذخیره نمی‌کنیم؛ اگر ظرفیت
   * Textarea کافی نباشد مقدار قبلی حفظ می‌شود.
   */
  return next.length <=
    maxLength
    ? next
    : normalizedCurrent;
}

function normalizeMultiline(
  value:
    string
) {
  return value
    .replace(
      /\r\n?/g,
      "\n"
    )
    .split(
      "\n"
    )
    .map(
      (
        line
      ) =>
        line.trim()
    )
    .filter(
      (
        line,
        index,
        lines
      ) =>
        Boolean(
          line
        ) &&
        lines.indexOf(
          line
        ) ===
          index
    )
    .join(
      "\n"
    );
}

function hasTopicGuidance(
  topic:
    TopicItem
) {
  return Boolean(
    topic.keywords ||
    topic.examples ||
    topic.negativeExamples ||
    topic.classificationNote
  );
}

function normalizeCode(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function formatPercent(
  value:
    number
) {
  const safe =
    Number.isFinite(
      value
    )
      ? value
      : 0;

  return `${new Intl.NumberFormat(
    "fa-IR",
    {
      maximumFractionDigits:
        1,
    }
  ).format(
    safe
  )}٪`;
}

function topicTrend(
  current:
    number,

  previous:
    number
) {
  if (
    previous <=
      0
  ) {
    if (
      current >
      0
    ) {
      return {
        label:
          "جدید",

        className:
          "bg-blue-50 text-blue-700",
      };
    }

    return {
      label:
        "بدون تغییر",

      className:
        "bg-slate-100 text-slate-500",
    };
  }

  const change =
    (
      (
        current -
        previous
      ) /
      previous
    ) *
    100;

  if (
    Math.abs(
      change
    ) <
      0.05
  ) {
    return {
      label:
        "بدون تغییر",

      className:
        "bg-slate-100 text-slate-500",
    };
  }

  const formatted =
    new Intl.NumberFormat(
      "fa-IR",
      {
        maximumFractionDigits:
          1,
      }
    ).format(
      Math.abs(
        change
      )
    );

  return change >
    0
    ? {
        label:
          `↑ ${formatted}٪`,

        className:
          "bg-emerald-50 text-emerald-700",
      }
    : {
        label:
          `↓ ${formatted}٪`,

        className:
          "bg-rose-50 text-rose-700",
      };
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("fa-IR").format(value);
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function isTopicListResponse(value: unknown): value is TopicListResponse {
  if (typeof value !== "object" || value === null) return false;

  const body = value as {
    success?: unknown;
    items?: unknown;
    pagination?: unknown;
  };

  return (
    body.success === true &&
    Array.isArray(body.items) &&
    typeof body.pagination === "object" &&
    body.pagination !== null
  );
}

function isTopicMutationResponse(
  value: unknown
): value is TopicMutationResponse {
  if (typeof value !== "object" || value === null) return false;

  const body = value as {
    success?: unknown;
    item?: unknown;
  };

  return (
    body.success === true &&
    typeof body.item === "object" &&
    body.item !== null
  );
}

function asApiError(value: unknown): ApiErrorResponse {
  if (typeof value !== "object" || value === null) return {};
  return value as ApiErrorResponse;
}

function getApiMessage(value: unknown, fallback: string) {
  const error = asApiError(value);

  return typeof error.message === "string" && error.message
    ? error.message
    : fallback;
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}
