"use client";

import {
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import ClassificationReviewInsights from "@/components/admin/topics/ClassificationReviewInsights";

type TopicOption = {
  id: string;
  name: string;
  code: string;
  active: boolean;
};

type TopicListResponse = {
  success: true;
  items: TopicOption[];
  pagination: {
    page: number;
    perPage: number;
    totalItems: number;
    totalPages: number;
  };
};

type ClassificationTestResult = {
  status:
    | "classified"
    | "unclassified";

  matched:
    boolean;

  topicId:
    string |
    null;

  topicName:
    string |
    null;

  suggestedTopicId:
    string |
    null;

  suggestedTopicName:
    string |
    null;

  confidence:
    number;

  threshold:
    number;

  model:
    string;

  responseId:
    string;

  latencyMs:
    number;

  candidateCount:
    number;
};

type ClassificationTestResponse =
  | {
      success:
        true;

      result:
        ClassificationTestResult;

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

type RegressionCase = {
  id: string;
  question: string;
  expectedTopicId: string;
  result: ClassificationTestResult | null;
  status:
    | "idle"
    | "running"
    | "passed"
    | "failed"
    | "error";
  error: string;
};

const MAX_REGRESSION_CASES =
  8;

const REGRESSION_STORAGE_KEY =
  "filivo.topic-classification-regression.v1";

type PersistedRegressionSuite = {
  version:
    1;

  savedAt:
    string;

  cases:
    Array<{
      question:
        string;

      expectedTopicId:
        string;
    }>;
};

const REGRESSION_BASELINE_STORAGE_KEY =
  "filivo.topic-classification-baseline.v1";

type RegressionBaselineEntry = {
  key:
    string;

  question:
    string;

  expectedTopicId:
    string;

  passed:
    boolean;

  status:
    "classified" |
    "unclassified";

  topicId:
    string |
    null;

  suggestedTopicId:
    string |
    null;

  topicName:
    string |
    null;

  suggestedTopicName:
    string |
    null;

  confidence:
    number;

  threshold:
    number;

  model:
    string;
};

type RegressionBaseline = {
  version:
    1;

  savedAt:
    string;

  entries:
    RegressionBaselineEntry[];
};

type ReviewMode =
  | "needs_review"
  | "unclassified"
  | "low_confidence"
  | "error"
  | "quality_sample"
  | "reviewed";

type ClassificationReviewItem = {
  id:
    string;

  content:
    string;

  classificationStatus:
    string;

  confidence:
    number;

  topicId:
    string |
    null;

  topicName:
    string |
    null;

  topicCode:
    string |
    null;

  topicActive:
    boolean |
    null;

  originalTopicId:
    string |
    null;

  originalTopicName:
    string |
    null;

  originalStatus:
    string;

  originalConfidence:
    number;

  reviewed:
    boolean;

  reviewedAt:
    string;

  reviewNote:
    string;

  reviewSource:
    "needs_review" |
    "quality_sample";

  created:
    string;

  reviewReason:
    string;
};

type ClassificationReviewResponse =
  | {
      success:
        true;

      mode:
        ReviewMode;

      threshold:
        number;

      count:
        number;

      items:
        ClassificationReviewItem[];

      sampling:
        | {
            strategy:
              "topic_confidence_balanced";

            poolSize:
              number;

            selected:
              number;

            topicCount:
              number;

            bucketCount:
              number;

            bands: {
              near_threshold:
                number;

              mid_confidence:
                number;

              high_confidence:
                number;
            };
          }
        | null;

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

type ClassificationReviewUpdateResponse =
  | {
      success:
        true;

      item: {
        messageId:
          string;

        topicId:
          string |
          null;

        topicName:
          string |
          null;

        classificationStatus:
          "classified" |
          "unclassified";

        confidence:
          number;

        reviewed:
          true;

        reviewedAt:
          string;
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

export default function ClassificationLab() {
  const [
    open,
    setOpen,
  ] =
    useState(false);

  const [
    tab,
    setTab,
  ] =
    useState<
      "single" |
      "regression" |
      "production" |
      "insights"
    >(
      "single"
    );

  const [
    question,
    setQuestion,
  ] =
    useState("");

  const [
    userContext,
    setUserContext,
  ] =
    useState("");

  const [
    assistantContext,
    setAssistantContext,
  ] =
    useState("");

  const [
    loading,
    setLoading,
  ] =
    useState(false);

  const [
    error,
    setError,
  ] =
    useState("");

  const [
    result,
    setResult,
  ] =
    useState<ClassificationTestResult | null>(
      null
    );

  const [
    topics,
    setTopics,
  ] =
    useState<TopicOption[]>(
      []
    );

  const [
    topicsLoading,
    setTopicsLoading,
  ] =
    useState(false);

  const [
    regressionCases,
    setRegressionCases,
  ] =
    useState<RegressionCase[]>([
      createEmptyRegressionCase(),
    ]);

  const [
    batchRunning,
    setBatchRunning,
  ] =
    useState(false);

  const [
    regressionHydrated,
    setRegressionHydrated,
  ] =
    useState(false);

  const [
    lastSavedAt,
    setLastSavedAt,
  ] =
    useState("");

  const [
    baseline,
    setBaseline,
  ] =
    useState<RegressionBaseline | null>(
      null
    );

  const [
    reviewMode,
    setReviewMode,
  ] =
    useState<ReviewMode>(
      "needs_review"
    );

  const [
    reviewItems,
    setReviewItems,
  ] =
    useState<ClassificationReviewItem[]>(
      []
    );

  const [
    reviewLoading,
    setReviewLoading,
  ] =
    useState(false);

  const [
    reviewError,
    setReviewError,
  ] =
    useState("");

  const [
    reviewSavingId,
    setReviewSavingId,
  ] =
    useState("");

  const [
    reviewNotice,
    setReviewNotice,
  ] =
    useState("");

  const [
    reviewExpectedTopics,
    setReviewExpectedTopics,
  ] =
    useState<
      Record<
        string,
        string
      >
    >({});

  const [
    reviewThreshold,
    setReviewThreshold,
  ] =
    useState(0);

  const [
    reviewSampling,
    setReviewSampling,
  ] =
    useState<
      | {
          strategy:
            "topic_confidence_balanced";

          poolSize:
            number;

          selected:
            number;

          topicCount:
            number;

          bucketCount:
            number;

          bands: {
            near_threshold:
              number;

            mid_confidence:
              number;

            high_confidence:
              number;
          };
        }
      | null
    >(
      null
    );

  /*
   * =========================================
   * Persist Regression Suite
   *
   * این مرحله عمداً Local Storage است:
   * - بدون Schema جدید
   * - بدون API جدید
   * - بدون اثر روی داده واقعی
   * =========================================
   */

  useEffect(() => {
    try {
      const raw =
        window.localStorage.getItem(
          REGRESSION_BASELINE_STORAGE_KEY
        );

      if (
        raw
      ) {
        const parsed =
          JSON.parse(
            raw
          ) as
            Partial<RegressionBaseline>;

        if (
          parsed.version ===
            1 &&
          Array.isArray(
            parsed.entries
          )
        ) {
          const entries =
            parsed.entries
              .filter(
                (
                  entry
                ): entry is RegressionBaselineEntry =>
                  typeof entry?.key ===
                    "string" &&
                  typeof entry?.question ===
                    "string" &&
                  typeof entry?.expectedTopicId ===
                    "string" &&
                  typeof entry?.passed ===
                    "boolean" &&
                  (
                    entry?.status ===
                      "classified" ||
                    entry?.status ===
                      "unclassified"
                  )
              )
              .slice(
                0,
                MAX_REGRESSION_CASES
              );

          if (
            entries.length >
            0
          ) {
            setBaseline({
              version:
                1,

              savedAt:
                typeof parsed.savedAt ===
                "string"
                  ? parsed.savedAt
                  : "",

              entries,
            });
          }
        }
      }
    } catch {
      /*
       * Baseline خراب نباید Lab را از کار بیندازد.
       */
    }
  }, []);

  useEffect(() => {
    try {
      const raw =
        window.localStorage.getItem(
          REGRESSION_STORAGE_KEY
        );

      if (
        raw
      ) {
        const parsed =
          JSON.parse(
            raw
          ) as
            Partial<PersistedRegressionSuite>;

        if (
          parsed.version ===
            1 &&
          Array.isArray(
            parsed.cases
          )
        ) {
          const restored =
            parsed.cases
              .slice(
                0,
                MAX_REGRESSION_CASES
              )
              .map(
                (
                  item
                ) => ({
                  id:
                    crypto.randomUUID(),

                  question:
                    typeof item?.question ===
                    "string"
                      ? item.question
                          .slice(
                            0,
                            4000
                          )
                      : "",

                  expectedTopicId:
                    typeof item?.expectedTopicId ===
                    "string"
                      ? item.expectedTopicId
                      : "",

                  result:
                    null,

                  status:
                    "idle" as const,

                  error:
                    "",
                })
              );

          if (
            restored.length >
            0
          ) {
            setRegressionCases(
              restored
            );
          }

          if (
            typeof parsed.savedAt ===
            "string"
          ) {
            setLastSavedAt(
              parsed.savedAt
            );
          }
        }
      }
    } catch {
      /*
       * خراب بودن Local Storage نباید Lab را
       * از کار بیندازد.
       */
    } finally {
      setRegressionHydrated(
        true
      );
    }
  }, []);

  useEffect(() => {
    if (
      !regressionHydrated
    ) {
      return;
    }

    const savedAt =
      new Date()
        .toISOString();

    const payload:
      PersistedRegressionSuite = {
        version:
          1,

        savedAt,

        cases:
          regressionCases.map(
            (
              item
            ) => ({
              question:
                item.question,

              expectedTopicId:
                item.expectedTopicId,
            })
          ),
      };

    try {
      window.localStorage.setItem(
        REGRESSION_STORAGE_KEY,
        JSON.stringify(
          payload
        )
      );

      setLastSavedAt(
        savedAt
      );
    } catch {
      /*
       * اگر مرورگر Storage را مسدود کرده باشد،
       * تست‌ها همچنان در Session جاری کار می‌کنند.
       */
    }
  }, [
    regressionCases,
    regressionHydrated,
  ]);

  useEffect(() => {
    if (
      !open ||
      topics.length >
        0 ||
      topicsLoading
    ) {
      return;
    }

    let cancelled =
      false;

    async function loadTopics() {
      setTopicsLoading(
        true
      );

      try {
        const collected:
          TopicOption[] = [];

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
            (await safeJson(
              response
            )) as
              TopicListResponse |
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
            !body.success
          ) {
            throw new Error(
              "دریافت موضوعات فعال ناموفق بود."
            );
          }

          collected.push(
            ...body.items
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

        if (
          !cancelled
        ) {
          setTopics(
            collected
          );
        }
      } catch (reason) {
        if (
          !cancelled
        ) {
          setError(
            reason instanceof
              Error
              ? reason.message
              : "دریافت موضوعات فعال ناموفق بود."
          );
        }
      } finally {
        if (
          !cancelled
        ) {
          setTopicsLoading(
            false
          );
        }
      }
    }

    void loadTopics();

    return () => {
      cancelled =
        true;
    };
  }, [
    open,
    topics.length,
    topicsLoading,
  ]);

  useEffect(() => {
    if (
      !open ||
      tab !==
        "production"
    ) {
      return;
    }

    let cancelled =
      false;

    async function loadReviewItems() {
      setReviewLoading(
        true
      );

      setReviewError(
        ""
      );

      try {
        const params =
          new URLSearchParams({
            mode:
              reviewMode,

            limit:
              "30",
          });

        const response =
          await fetch(
            `/api/admin/topics/classification-review?${params.toString()}`,
            {
              cache:
                "no-store",
            }
          );

        const body =
          (await safeJson(
            response
          )) as
            ClassificationReviewResponse |
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
          !body.success
        ) {
          throw new Error(
            apiMessage(
              body,
              "دریافت نمونه‌های واقعی ناموفق بود."
            )
          );
        }

        if (
          cancelled
        ) {
          return;
        }

        setReviewItems(
          body.items
        );

        setReviewThreshold(
          body.threshold
        );

        setReviewSampling(
          body.sampling
        );

        /*
         * برای Low Confidence، Topic فعلی یک
         * پیشنهاد اولیه خوب برای Expected است،
         * ولی مدیر می‌تواند آن را تغییر دهد.
         */
        setReviewExpectedTopics(
          (
            current
          ) => {
            const next = {
              ...current,
            };

            for (
              const item of
              body.items
            ) {
              if (
                next[
                  item.id
                ]
              ) {
                continue;
              }

              if (
                item.topicId
              ) {
                next[
                  item.id
                ] =
                  item.topicId;

                continue;
              }

              if (
                item.classificationStatus ===
                "unclassified"
              ) {
                next[
                  item.id
                ] =
                  "__unclassified__";
              }
            }

            return next;
          }
        );
      } catch (reason) {
        if (
          !cancelled
        ) {
          setReviewError(
            reason instanceof
              Error
              ? reason.message
              : "دریافت نمونه‌های واقعی ناموفق بود."
          );

          setReviewSampling(
            null
          );
        }
      } finally {
        if (
          !cancelled
        ) {
          setReviewLoading(
            false
          );
        }
      }
    }

    void loadReviewItems();

    return () => {
      cancelled =
        true;
    };
  }, [
    open,
    tab,
    reviewMode,
  ]);

  const regressionSummary =
    useMemo(
      () => {
        const completed =
          regressionCases.filter(
            (
              item
            ) =>
              item.status ===
                "passed" ||
              item.status ===
                "failed"
          );

        const passed =
          completed.filter(
            (
              item
            ) =>
              item.status ===
              "passed"
          ).length;

        const failed =
          completed.filter(
            (
              item
            ) =>
              item.status ===
              "failed"
          ).length;

        const errors =
          regressionCases.filter(
            (
              item
            ) =>
              item.status ===
              "error"
          ).length;

        const accuracy =
          completed.length >
          0
            ? (
                passed /
                completed.length
              ) *
              100
            : 0;

        return {
          completed:
            completed.length,

          passed,

          failed,

          errors,

          accuracy,
        };
      },
      [
        regressionCases,
      ]
    );

  function close() {
    if (
      loading ||
      batchRunning
    ) {
      return;
    }

    setOpen(
      false
    );
  }

  async function runTest() {
    if (
      loading
    ) {
      return;
    }

    const cleanQuestion =
      question.trim();

    if (
      !cleanQuestion
    ) {
      setError(
        "سؤال آزمایشی را وارد کنید."
      );

      return;
    }

    const context:
      Array<{
        role:
          "user" |
          "assistant";

        content:
          string;
      }> = [];

    if (
      userContext.trim()
    ) {
      context.push({
        role:
          "user",

        content:
          userContext.trim(),
      });
    }

    if (
      assistantContext.trim()
    ) {
      context.push({
        role:
          "assistant",

        content:
          assistantContext.trim(),
      });
    }

    setLoading(
      true
    );

    setError(
      ""
    );

    setResult(
      null
    );

    try {
      const testResult =
        await requestClassification({
          question:
            cleanQuestion,

          context,
        });

      setResult(
        testResult
      );
    } catch (reason) {
      setError(
        reason instanceof
          Error
          ? reason.message
          : "اجرای تست طبقه‌بندی ناموفق بود."
      );
    } finally {
      setLoading(
        false
      );
    }
  }

  function addRegressionCase() {
    if (
      regressionCases.length >=
      MAX_REGRESSION_CASES
    ) {
      return;
    }

    setRegressionCases(
      (
        current
      ) => [
        ...current,
        createEmptyRegressionCase(),
      ]
    );
  }

  function removeRegressionCase(
    id:
      string
  ) {
    setRegressionCases(
      (
        current
      ) => {
        const next =
          current.filter(
            (
              item
            ) =>
              item.id !==
              id
          );

        return next.length >
          0
          ? next
          : [
              createEmptyRegressionCase(),
            ];
      }
    );
  }

  const baselineComparison =
    useMemo(
      () => {
        if (
          !baseline
        ) {
          return {
            available:
              false,

            baselineAccuracy:
              0,

            currentAccuracy:
              regressionSummary.accuracy,

            accuracyDelta:
              0,

            compared:
              0,

            changedPredictions:
              0,

            improved:
              0,

            regressed:
              0,
          };
        }

        const baselineByKey =
          new Map(
            baseline.entries.map(
              (
                entry
              ) => [
                entry.key,
                entry,
              ]
            )
          );

        let compared =
          0;

        let changedPredictions =
          0;

        let improved =
          0;

        let regressed =
          0;

        let baselinePassed =
          0;

        let currentPassed =
          0;

        for (
          const item of
          regressionCases
        ) {
          if (
            !item.result ||
            (
              item.status !==
                "passed" &&
              item.status !==
                "failed"
            )
          ) {
            continue;
          }

          const key =
            regressionCaseKey(
              item.question,
              item.expectedTopicId
            );

          const baselineEntry =
            baselineByKey.get(
              key
            );

          if (
            !baselineEntry
          ) {
            continue;
          }

          compared +=
            1;

          if (
            baselineEntry.passed
          ) {
            baselinePassed +=
              1;
          }

          if (
            item.status ===
            "passed"
          ) {
            currentPassed +=
              1;
          }

          const currentTopic =
            item.result.topicId ||
            item.result.suggestedTopicId ||
            null;

          const baselineTopic =
            baselineEntry.topicId ||
            baselineEntry.suggestedTopicId ||
            null;

          if (
            item.result.status !==
              baselineEntry.status ||
            currentTopic !==
              baselineTopic
          ) {
            changedPredictions +=
              1;
          }

          if (
            !baselineEntry.passed &&
            item.status ===
              "passed"
          ) {
            improved +=
              1;
          }

          if (
            baselineEntry.passed &&
            item.status ===
              "failed"
          ) {
            regressed +=
              1;
          }
        }

        const baselineAccuracy =
          compared >
          0
            ? (
                baselinePassed /
                compared
              ) *
              100
            : 0;

        const currentAccuracy =
          compared >
          0
            ? (
                currentPassed /
                compared
              ) *
              100
            : regressionSummary.accuracy;

        return {
          available:
            true,

          baselineAccuracy,

          currentAccuracy,

          accuracyDelta:
            currentAccuracy -
            baselineAccuracy,

          compared,

          changedPredictions,

          improved,

          regressed,
        };
      },
      [
        baseline,
        regressionCases,
        regressionSummary.accuracy,
      ]
    );

  function updateRegressionCase(
    id:
      string,

    patch:
      Partial<RegressionCase>
  ) {
    setRegressionCases(
      (
        current
      ) =>
        current.map(
          (
            item
          ) =>
            item.id ===
            id
              ? {
                  ...item,
                  ...patch,
                }
              : item
        )
    );
  }

  async function runRegressionCase(
    item:
      RegressionCase
  ) {
    const cleanQuestion =
      item.question.trim();

    if (
      !cleanQuestion
    ) {
      updateRegressionCase(
        item.id,
        {
          status:
            "error",

          error:
            "سؤال خالی است.",

          result:
            null,
        }
      );

      return;
    }

    updateRegressionCase(
      item.id,
      {
        status:
          "running",

        error:
          "",

        result:
          null,
      }
    );

    try {
      const testResult =
        await requestClassification({
          question:
            cleanQuestion,

          context:
            [],
        });

      const passed =
        item.expectedTopicId ===
          "__unclassified__"
          ? testResult.status ===
            "unclassified"
          : testResult.topicId ===
            item.expectedTopicId;

      updateRegressionCase(
        item.id,
        {
          status:
            passed
              ? "passed"
              : "failed",

          result:
            testResult,

          error:
            "",
        }
      );
    } catch (reason) {
      updateRegressionCase(
        item.id,
        {
          status:
            "error",

          result:
            null,

          error:
            reason instanceof
              Error
              ? reason.message
              : "اجرای تست ناموفق بود.",
        }
      );
    }
  }

  async function runAllRegressionCases() {
    if (
      batchRunning
    ) {
      return;
    }

    const runnable =
      regressionCases.filter(
        (
          item
        ) =>
          Boolean(
            item.question.trim()
          )
      );

    if (
      runnable.length ===
      0
    ) {
      setError(
        "حداقل یک تست معتبر وارد کنید."
      );

      return;
    }

    setBatchRunning(
      true
    );

    setError(
      ""
    );

    try {
      /*
       * عمداً Sequential اجرا می‌کنیم تا Burst
       * به OpenAI و Admin Rate Limit ایجاد نشود.
       */
      for (
        const item of
        runnable
      ) {
        await runRegressionCase(
          item
        );
      }
    } finally {
      setBatchRunning(
        false
      );
    }
  }

  function resetRegressionResults() {
    if (
      batchRunning
    ) {
      return;
    }

    setRegressionCases(
      (
        current
      ) =>
        current.map(
          (
            item
          ) => ({
            ...item,

            status:
              "idle",

            result:
              null,

            error:
              "",
          })
        )
    );
  }

  function saveCurrentResultsAsBaseline() {
    if (
      batchRunning
    ) {
      return;
    }

    const completed =
      regressionCases.filter(
        (
          item
        ) =>
          Boolean(
            item.question.trim()
          ) &&
          Boolean(
            item.expectedTopicId
          ) &&
          Boolean(
            item.result
          ) &&
          (
            item.status ===
              "passed" ||
            item.status ===
              "failed"
          )
      );

    const runnableCount =
      regressionCases.filter(
        (
          item
        ) =>
          Boolean(
            item.question.trim()
          ) &&
          Boolean(
            item.expectedTopicId
          )
      ).length;

    if (
      runnableCount ===
        0 ||
      completed.length !==
        runnableCount
    ) {
      setError(
        "برای ثبت Baseline ابتدا همه تست‌های دارای سؤال و نتیجه مورد انتظار را با موفقیت اجرا کنید."
      );

      return;
    }

    const savedAt =
      new Date()
        .toISOString();

    const entries =
      completed.map(
        (
          item
        ) => {
          const result =
            item.result as
              ClassificationTestResult;

          return {
            key:
              regressionCaseKey(
                item.question,
                item.expectedTopicId
              ),

            question:
              item.question.trim(),

            expectedTopicId:
              item.expectedTopicId,

            passed:
              item.status ===
              "passed",

            status:
              result.status,

            topicId:
              result.topicId,

            suggestedTopicId:
              result.suggestedTopicId,

            topicName:
              result.topicName,

            suggestedTopicName:
              result.suggestedTopicName,

            confidence:
              result.confidence,

            threshold:
              result.threshold,

            model:
              result.model,
          } satisfies RegressionBaselineEntry;
        }
      );

    const nextBaseline:
      RegressionBaseline = {
        version:
          1,

        savedAt,

        entries,
      };

    try {
      window.localStorage.setItem(
        REGRESSION_BASELINE_STORAGE_KEY,
        JSON.stringify(
          nextBaseline
        )
      );

      setBaseline(
        nextBaseline
      );

      setError(
        ""
      );
    } catch {
      setError(
        "ذخیره Baseline در مرورگر ناموفق بود."
      );
    }
  }

  function clearBaseline() {
    if (
      batchRunning ||
      !baseline
    ) {
      return;
    }

    const confirmed =
      window.confirm(
        "Baseline طبقه‌بندی پاک شود؟ مجموعه سؤال‌ها حذف نخواهد شد."
      );

    if (
      !confirmed
    ) {
      return;
    }

    try {
      window.localStorage.removeItem(
        REGRESSION_BASELINE_STORAGE_KEY
      );
    } catch {
      // Ignore storage failure.
    }

    setBaseline(
      null
    );

    setError(
      ""
    );
  }

  async function applyProductionReview({
    item,
    expectedTopicId,
    note,
  }: {
    item:
      ClassificationReviewItem;

    expectedTopicId:
      string;

    note:
      string;
  }) {
    if (
      reviewSavingId
    ) {
      return;
    }

    if (
      !expectedTopicId
    ) {
      setReviewError(
        "ابتدا نتیجه صحیح را انتخاب کنید."
      );

      return;
    }

    const expectedLabel =
      expectedTopicId ===
        "__unclassified__"
        ? "بدون موضوع / Unclassified"
        : topics.find(
            (
              topic
            ) =>
              topic.id ===
              expectedTopicId
          )?.name ||
          "موضوع انتخاب‌شده";

    const currentLabel =
      item.topicName ||
      (
        item.classificationStatus ===
        "unclassified"
          ? "Unclassified"
          : item.classificationStatus
      );

    const confirmed =
      window.confirm(
        item.reviewed
          ? `Human Review این پیام دوباره اصلاح شود؟\n\nنتیجه فعلی: ${currentLabel}\nنتیجه جدید: ${expectedLabel}\n\nنتیجه اولیه AI همچنان بدون تغییر حفظ می‌شود.`
          : `Classification این پیام تأیید/اصلاح شود؟\n\nفعلی: ${currentLabel}\nنتیجه نهایی: ${expectedLabel}\n\nاین تغییر روی داده واقعی و Analytics موضوعات اثر می‌گذارد. نتیجه AI قبلی جداگانه حفظ می‌شود.`
      );

    if (
      !confirmed
    ) {
      return;
    }

    setReviewSavingId(
      item.id
    );

    setReviewError(
      ""
    );

    setReviewNotice(
      ""
    );

    try {
      const response =
        await fetch(
          `/api/admin/topics/classification-review/${item.id}`,
          {
            method:
              "PATCH",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                topicId:
                  expectedTopicId ===
                  "__unclassified__"
                    ? null
                    : expectedTopicId,

                note:
                  note.trim(),

                source:
                  item.reviewSource ===
                    "quality_sample" ||
                  reviewMode ===
                    "quality_sample"
                    ? "quality_sample"
                    : "needs_review",
              }),
          }
        );

      const body =
        (await safeJson(
          response
        )) as
          ClassificationReviewUpdateResponse |
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
        !body.success
      ) {
        throw new Error(
          apiMessage(
            body,
            "ذخیره بررسی Classification ناموفق بود."
          )
        );
      }

      if (
        reviewMode ===
        "reviewed"
      ) {
        setReviewItems(
          (
            current
          ) =>
            current.map(
              (
                candidate
              ) =>
                candidate.id ===
                item.id
                  ? {
                      ...candidate,

                      topicId:
                        body.item
                          .topicId,

                      topicName:
                        body.item
                          .topicName,

                      classificationStatus:
                        body.item
                          .classificationStatus,

                      confidence:
                        body.item
                          .confidence,

                      reviewed:
                        true,

                      reviewedAt:
                        body.item
                          .reviewedAt,

                      reviewNote:
                        note.trim(),
                    }
                  : candidate
            )
        );

        setReviewExpectedTopics(
          (
            current
          ) => ({
            ...current,

            [item.id]:
              body.item
                .topicId ||
              "__unclassified__",
          })
        );

        setReviewNotice(
          expectedTopicId ===
            "__unclassified__"
            ? "بازبینی مجدد ثبت شد؛ نتیجه نهایی Unclassified است."
            : `بازبینی مجدد با موفقیت روی «${expectedLabel}» ثبت شد.`
        );
      } else {
        setReviewItems(
          (
            current
          ) =>
            current.filter(
              (
                candidate
              ) =>
                candidate.id !==
                item.id
            )
        );

        setReviewExpectedTopics(
          (
            current
          ) => {
            const next = {
              ...current,
            };

            delete next[
              item.id
            ];

            return next;
          }
        );

        setReviewNotice(
          expectedTopicId ===
            "__unclassified__"
            ? "پیام به‌عنوان Unclassified تأیید شد و از صف بررسی خارج شد."
            : `Classification پیام با موفقیت روی «${expectedLabel}» ثبت شد.`
        );
      }
    } catch (reason) {
      setReviewError(
        reason instanceof
          Error
          ? reason.message
          : "ذخیره بررسی Classification ناموفق بود."
      );
    } finally {
      setReviewSavingId(
        ""
      );
    }
  }

  function addReviewItemToRegression(
    item:
      ClassificationReviewItem
  ) {
    const expectedTopicId =
      reviewExpectedTopics[
        item.id
      ] ||
      "";

    if (
      !expectedTopicId
    ) {
      setReviewError(
        "برای این نمونه ابتدا نتیجه مورد انتظار را انتخاب کنید."
      );

      return;
    }

    const normalizedQuestion =
      item.content
        .trim()
        .replace(
          /\s+/g,
          " "
        );

    const duplicate =
      regressionCases.some(
        (
          existing
        ) =>
          existing.question
            .trim()
            .replace(
              /\s+/g,
              " "
            ) ===
          normalizedQuestion
      );

    if (
      duplicate
    ) {
      setReviewError(
        "این سؤال قبلاً در مجموعه تست وجود دارد."
      );

      return;
    }

    const meaningfulCases =
      regressionCases.filter(
        (
          existing
        ) =>
          Boolean(
            existing.question.trim()
          )
      );

    if (
      meaningfulCases.length >=
      MAX_REGRESSION_CASES
    ) {
      setReviewError(
        `مجموعه تست فعلی به سقف ${number(
          MAX_REGRESSION_CASES
        )} مورد رسیده است.`
      );

      return;
    }

    const nextCase:
      RegressionCase = {
        id:
          crypto.randomUUID(),

        question:
          item.content,

        expectedTopicId,

        result:
          null,

        status:
          "idle",

        error:
          "",
      };

    setRegressionCases(
      (
        current
      ) => {
        /*
         * اگر تنها Row خالی اولیه وجود دارد،
         * همان را جایگزین می‌کنیم.
         */
        if (
          current.length ===
            1 &&
          !current[0]
            .question
            .trim() &&
          !current[0]
            .expectedTopicId
        ) {
          return [
            nextCase,
          ];
        }

        return [
          ...current,
          nextCase,
        ];
      }
    );

    setReviewError(
      ""
    );
  }

  function useReviewItemAsSingleTest(
    item:
      ClassificationReviewItem
  ) {
    setQuestion(
      item.content
    );

    setResult(
      null
    );

    setError(
      ""
    );

    setTab(
      "single"
    );
  }

  function exportRegressionSuite() {
    const savedAt =
      new Date()
        .toISOString();

    const payload:
      PersistedRegressionSuite = {
        version:
          1,

        savedAt,

        cases:
          regressionCases.map(
            (
              item
            ) => ({
              question:
                item.question,

              expectedTopicId:
                item.expectedTopicId,
            })
          ),
      };

    const blob =
      new Blob(
        [
          JSON.stringify(
            payload,
            null,
            2
          ),
        ],
        {
          type:
            "application/json;charset=utf-8",
        }
      );

    const url =
      URL.createObjectURL(
        blob
      );

    const anchor =
      document.createElement(
        "a"
      );

    anchor.href =
      url;

    anchor.download =
      `classification-regression-${savedAt.slice(
        0,
        10
      )}.json`;

    document.body.appendChild(
      anchor
    );

    anchor.click();

    anchor.remove();

    URL.revokeObjectURL(
      url
    );
  }

  async function importRegressionSuite(
    file:
      File
  ) {
    try {
      const raw =
        await file.text();

      const parsed =
        JSON.parse(
          raw
        ) as
          Partial<PersistedRegressionSuite>;

      if (
        parsed.version !==
          1 ||
        !Array.isArray(
          parsed.cases
        )
      ) {
        throw new Error(
          "ساختار فایل مجموعه تست معتبر نیست."
        );
      }

      const restored =
        parsed.cases
          .slice(
            0,
            MAX_REGRESSION_CASES
          )
          .map(
            (
              item
            ) => ({
              id:
                crypto.randomUUID(),

              question:
                typeof item?.question ===
                "string"
                  ? item.question
                      .slice(
                        0,
                        4000
                      )
                  : "",

              expectedTopicId:
                typeof item?.expectedTopicId ===
                "string"
                  ? item.expectedTopicId
                  : "",

              result:
                null,

              status:
                "idle" as const,

              error:
                "",
            })
          );

      if (
        restored.length ===
        0
      ) {
        throw new Error(
          "فایل مجموعه تست خالی است."
        );
      }

      setRegressionCases(
        restored
      );

      setError(
        ""
      );
    } catch (reason) {
      setError(
        reason instanceof
          Error
          ? reason.message
          : "خواندن فایل مجموعه تست ناموفق بود."
      );
    }
  }

  function clearRegressionSuite() {
    if (
      batchRunning
    ) {
      return;
    }

    const confirmed =
      window.confirm(
        "همه تست‌های ذخیره‌شده پاک شوند؟"
      );

    if (
      !confirmed
    ) {
      return;
    }

    setRegressionCases([
      createEmptyRegressionCase(),
    ]);

    setError(
      ""
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(
            true
          );

          setError(
            ""
          );
        }}
        className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-violet-200 bg-violet-50 px-5 py-3 text-sm font-black text-violet-700 transition hover:bg-violet-100"
      >
        تست طبقه‌بندی
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="classification-lab-title"
        >
          <button
            type="button"
            aria-label="بستن"
            onClick={
              close
            }
            className="absolute inset-0 cursor-default"
          />

          <div className="relative z-10 max-h-[94vh] w-full max-w-5xl overflow-y-auto rounded-3xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex flex-col gap-4 border-b border-slate-100 p-6 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-black text-violet-700">
                  Classification Lab
                </p>

                <h2
                  id="classification-lab-title"
                  className="mt-1 text-xl font-black text-slate-950"
                >
                  آزمایشگاه طبقه‌بندی موضوعی
                </h2>

                <p className="mt-2 max-w-3xl text-xs leading-6 text-slate-500">
                  از همان Prompt، Topicهای فعال، Guidance و Threshold سیستم واقعی استفاده می‌شود و هیچ Message آزمایشی ذخیره نمی‌شود.
                </p>
              </div>

              <button
                type="button"
                disabled={
                  loading ||
                  batchRunning
                }
                onClick={
                  close
                }
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-lg text-slate-500 transition hover:bg-slate-50 disabled:opacity-50"
              >
                ×
              </button>
            </div>

            <div className="border-b border-slate-100 px-6 pt-4">
              <div className="flex gap-2">
                <TabButton
                  active={
                    tab ===
                    "single"
                  }
                  onClick={() =>
                    setTab(
                      "single"
                    )
                  }
                >
                  تست تکی
                </TabButton>

                <TabButton
                  active={
                    tab ===
                    "regression"
                  }
                  onClick={() =>
                    setTab(
                      "regression"
                    )
                  }
                >
                  مجموعه تست
                </TabButton>

                <TabButton
                  active={
                    tab ===
                    "production"
                  }
                  onClick={() =>
                    setTab(
                      "production"
                    )
                  }
                >
                  نمونه‌های واقعی
                </TabButton>

                <TabButton
                  active={
                    tab ===
                    "insights"
                  }
                  onClick={() =>
                    setTab(
                      "insights"
                    )
                  }
                >
                  کیفیت واقعی
                </TabButton>
              </div>
            </div>

            <div className="p-6">
              {tab ===
              "single" ? (
                <SingleTestPanel
                  question={
                    question
                  }
                  userContext={
                    userContext
                  }
                  assistantContext={
                    assistantContext
                  }
                  loading={
                    loading
                  }
                  error={
                    error
                  }
                  result={
                    result
                  }
                  onQuestion={
                    setQuestion
                  }
                  onUserContext={
                    setUserContext
                  }
                  onAssistantContext={
                    setAssistantContext
                  }
                  onRun={() =>
                    void runTest()
                  }
                />
              ) : tab ===
                "regression" ? (
                <RegressionPanel
                  topics={
                    topics
                  }
                  topicsLoading={
                    topicsLoading
                  }
                  items={
                    regressionCases
                  }
                  summary={
                    regressionSummary
                  }
                  batchRunning={
                    batchRunning
                  }
                  onChange={
                    updateRegressionCase
                  }
                  onRemove={
                    removeRegressionCase
                  }
                  onAdd={
                    addRegressionCase
                  }
                  onRunOne={(
                    item
                  ) =>
                    void runRegressionCase(
                      item
                    )
                  }
                  onRunAll={() =>
                    void runAllRegressionCases()
                  }
                  onReset={
                    resetRegressionResults
                  }
                  onExport={
                    exportRegressionSuite
                  }
                  onImport={
                    importRegressionSuite
                  }
                  onClear={
                    clearRegressionSuite
                  }
                  lastSavedAt={
                    lastSavedAt
                  }
                  baseline={
                    baseline
                  }
                  baselineComparison={
                    baselineComparison
                  }
                  onSaveBaseline={
                    saveCurrentResultsAsBaseline
                  }
                  onClearBaseline={
                    clearBaseline
                  }
                />
              ) : tab ===
                "production" ? (
                <ProductionReviewPanel
                  topics={
                    topics
                  }
                  topicsLoading={
                    topicsLoading
                  }
                  mode={
                    reviewMode
                  }
                  items={
                    reviewItems
                  }
                  loading={
                    reviewLoading
                  }
                  error={
                    reviewError
                  }
                  notice={
                    reviewNotice
                  }
                  savingId={
                    reviewSavingId
                  }
                  threshold={
                    reviewThreshold
                  }
                  sampling={
                    reviewSampling
                  }
                  expectedTopics={
                    reviewExpectedTopics
                  }
                  onMode={
                    setReviewMode
                  }
                  onExpectedTopic={(
                    id,
                    value
                  ) =>
                    setReviewExpectedTopics(
                      (
                        current
                      ) => ({
                        ...current,

                        [id]:
                          value,
                      })
                    )
                  }
                  onAddToRegression={
                    addReviewItemToRegression
                  }
                  onApplyReview={
                    applyProductionReview
                  }
                  onUseAsSingle={
                    useReviewItemAsSingleTest
                  }
                />
              ) : (
                <ClassificationReviewInsights />
              )}

              <div className="mt-5 flex justify-end">
                <button
                  type="button"
                  disabled={
                    loading ||
                    batchRunning
                  }
                  onClick={
                    close
                  }
                  className="min-h-11 rounded-xl border border-slate-200 bg-white px-5 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  بستن
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function SingleTestPanel({
  question,
  userContext,
  assistantContext,
  loading,
  error,
  result,
  onQuestion,
  onUserContext,
  onAssistantContext,
  onRun,
}: {
  question:
    string;
  userContext:
    string;
  assistantContext:
    string;
  loading:
    boolean;
  error:
    string;
  result:
    ClassificationTestResult |
    null;
  onQuestion:
    (
      value:
        string
    ) => void;
  onUserContext:
    (
      value:
        string
    ) => void;
  onAssistantContext:
    (
      value:
        string
    ) => void;
  onRun:
    () => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <label
          htmlFor="classification-test-question"
          className="mb-2 block text-sm font-black text-slate-700"
        >
          سؤال آزمایشی
        </label>

        <textarea
          id="classification-test-question"
          value={
            question
          }
          maxLength={
            4000
          }
          rows={
            5
          }
          onChange={(
            event
          ) =>
            onQuestion(
              event.target
                .value
            )
          }
          placeholder="مثلاً: کد تایید برای من ارسال نمی‌شود"
          className="w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-7 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:bg-white"
        />
      </div>

      <details className="rounded-2xl border border-slate-200 bg-slate-50">
        <summary className="cursor-pointer px-4 py-3 text-sm font-black text-slate-700">
          Context اختیاری
        </summary>

        <div className="grid gap-4 border-t border-slate-200 p-4 md:grid-cols-2">
          <ContextField
            id="classification-test-user-context"
            label="پیام قبلی کاربر"
            value={
              userContext
            }
            onChange={
              onUserContext
            }
          />

          <ContextField
            id="classification-test-assistant-context"
            label="پاسخ قبلی دستیار"
            value={
              assistantContext
            }
            onChange={
              onAssistantContext
            }
          />
        </div>
      </details>

      <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs font-bold leading-6 text-blue-800">
        این تست یک OpenAI Call واقعی انجام می‌دهد، اما نتیجه را داخل Messages و Analytics گفتگوها ذخیره نمی‌کند.
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold leading-7 text-rose-700">
          {
            error
          }
        </div>
      ) : null}

      {result ? (
        <ResultCard
          result={
            result
          }
        />
      ) : null}

      <div className="flex justify-end">
        <button
          type="button"
          disabled={
            loading ||
            !question.trim()
          }
          onClick={
            onRun
          }
          className="min-h-11 rounded-xl bg-violet-700 px-6 text-sm font-black text-white transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading
            ? "در حال تست..."
            : "اجرای تست"}
        </button>
      </div>
    </div>
  );
}

function ProductionReviewPanel({
  topics,
  topicsLoading,
  mode,
  items,
  loading,
  error,
  notice,
  savingId,
  threshold,
  sampling,
  expectedTopics,
  onMode,
  onExpectedTopic,
  onAddToRegression,
  onApplyReview,
  onUseAsSingle,
}: {
  topics:
    TopicOption[];

  topicsLoading:
    boolean;

  mode:
    ReviewMode;

  items:
    ClassificationReviewItem[];

  loading:
    boolean;

  error:
    string;

  notice:
    string;

  savingId:
    string;

  threshold:
    number;

  sampling:
    | {
        strategy:
          "topic_confidence_balanced";

        poolSize:
          number;

        selected:
          number;

        topicCount:
          number;

        bucketCount:
          number;

        bands: {
          near_threshold:
            number;

          mid_confidence:
            number;

          high_confidence:
            number;
        };
      }
    | null;

  expectedTopics:
    Record<
      string,
      string
    >;

  onMode:
    (
      value:
        ReviewMode
    ) => void;

  onExpectedTopic:
    (
      id:
        string,
      value:
        string
    ) => void;

  onAddToRegression:
    (
      item:
        ClassificationReviewItem
    ) => void;

  onApplyReview:
    (
      input: {
        item:
          ClassificationReviewItem;

        expectedTopicId:
          string;

        note:
          string;
      }
    ) => void;

  onUseAsSingle:
    (
      item:
        ClassificationReviewItem
    ) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs font-bold leading-6 text-blue-800">
        این بخش سؤال‌های واقعی کاربران را فقط برای QA نمایش می‌دهد. هیچ تغییری روی Message اصلی انجام نمی‌شود. پس از تعیین نتیجه صحیح، می‌توانی نمونه را وارد Regression Suite کنی.
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-black text-slate-700">
            صف بررسی Classification
          </p>

          <p className="mt-1 text-[10px] leading-5 text-slate-400">
            Threshold فعلی:{" "}
            {
              percent(
                threshold *
                100
              )
            }
          </p>

          {mode ===
            "quality_sample" ? (
            <p className="mt-1 max-w-2xl text-[10px] font-bold leading-5 text-emerald-700">
              این فیلتر از یک Pool بزرگ‌تر، نمونه‌ای متوازن بین Topicها و سه بازه Confidence انتخاب می‌کند؛ بنابراین نسبت به نمایش صرفاً آخرین پیام‌ها Bias کمتری دارد.
            </p>
          ) : mode ===
              "reviewed" ? (
            <p className="mt-1 max-w-2xl text-[10px] font-bold leading-5 text-blue-700">
              اینجا Human Reviewهای قبلی را می‌بینی. نتیجه اولیه AI حفظ شده و می‌توانی در صورت اشتباه انسانی، نتیجه نهایی را دوباره اصلاح کنی.
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <ReviewModeButton
            active={
              mode ===
              "needs_review"
            }
            onClick={() =>
              onMode(
                "needs_review"
              )
            }
          >
            نیازمند بررسی
          </ReviewModeButton>

          <ReviewModeButton
            active={
              mode ===
              "quality_sample"
            }
            onClick={() =>
              onMode(
                "quality_sample"
              )
            }
          >
            کنترل کیفیت
          </ReviewModeButton>

          <ReviewModeButton
            active={
              mode ===
              "reviewed"
            }
            onClick={() =>
              onMode(
                "reviewed"
              )
            }
          >
            تاریخچه بررسی
          </ReviewModeButton>

          <ReviewModeButton
            active={
              mode ===
              "unclassified"
            }
            onClick={() =>
              onMode(
                "unclassified"
              )
            }
          >
            Unclassified
          </ReviewModeButton>

          <ReviewModeButton
            active={
              mode ===
              "low_confidence"
            }
            onClick={() =>
              onMode(
                "low_confidence"
              )
            }
          >
            Confidence پایین
          </ReviewModeButton>

          <ReviewModeButton
            active={
              mode ===
              "error"
            }
            onClick={() =>
              onMode(
                "error"
              )
            }
          >
            Error
          </ReviewModeButton>
        </div>
      </div>

      {mode ===
        "quality_sample" &&
      sampling ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-black text-emerald-800">
                نمونه‌گیری متوازن Quality Audit
              </p>

              <p className="mt-1 text-[10px] leading-5 text-emerald-700">
                از Pool شامل{" "}
                {
                  number(
                    sampling.poolSize
                  )
                }{" "}
                پیام،{" "}
                {
                  number(
                    sampling.selected
                  )
                }{" "}
                نمونه از{" "}
                {
                  number(
                    sampling.topicCount
                  )
                }{" "}
                Topic انتخاب شده است.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <SamplingBadge
                label="نزدیک Threshold"
                value={
                  sampling.bands
                    .near_threshold
                }
              />

              <SamplingBadge
                label="Confidence متوسط"
                value={
                  sampling.bands
                    .mid_confidence
                }
              />

              <SamplingBadge
                label="Confidence بالا"
                value={
                  sampling.bands
                    .high_confidence
                }
              />

              <SamplingBadge
                label="Strata"
                value={
                  sampling.bucketCount
                }
              />
            </div>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold leading-7 text-rose-700">
          {
            error
          }
        </div>
      ) : null}

      {notice ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold leading-7 text-emerald-700">
          {
            notice
          }
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-3">
          {Array.from({
            length:
              4,
          }).map(
            (
              _,
              index
            ) => (
              <div
                key={
                  index
                }
                className="h-36 animate-pulse rounded-2xl bg-slate-100"
              />
            )
          )}
        </div>
      ) : items.length >
        0 ? (
        <div className="space-y-3">
          {items.map(
            (
              item
            ) => (
              <ProductionReviewRow
                key={
                  item.id
                }
                item={
                  item
                }
                topics={
                  topics
                }
                topicsLoading={
                  topicsLoading
                }
                expectedTopicId={
                  expectedTopics[
                    item.id
                  ] ||
                  ""
                }
                saving={
                  savingId ===
                  item.id
                }
                onExpectedTopic={(
                  value
                ) =>
                  onExpectedTopic(
                    item.id,
                    value
                  )
                }
                onAdd={() =>
                  onAddToRegression(
                    item
                  )
                }
                onApply={(
                  note
                ) =>
                  onApplyReview({
                    item,

                    expectedTopicId:
                      expectedTopics[
                        item.id
                      ] ||
                      "",

                    note,
                  })
                }
                onUseAsSingle={() =>
                  onUseAsSingle(
                    item
                  )
                }
              />
            )
          )}
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-8 text-center text-sm font-bold text-slate-400">
          نمونه‌ای برای این فیلتر پیدا نشد.
        </div>
      )}
    </div>
  );
}

function ProductionReviewRow({
  item,
  topics,
  topicsLoading,
  expectedTopicId,
  saving,
  onExpectedTopic,
  onAdd,
  onApply,
  onUseAsSingle,
}: {
  item:
    ClassificationReviewItem;

  topics:
    TopicOption[];

  topicsLoading:
    boolean;

  expectedTopicId:
    string;

  saving:
    boolean;

  onExpectedTopic:
    (
      value:
        string
    ) => void;

  onAdd:
    () => void;

  onApply:
    (
      note:
        string
    ) => void;

  onUseAsSingle:
    () => void;
}) {
  const [
    note,
    setNote,
  ] =
    useState(
      item.reviewNote ||
      ""
    );

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <ReviewReasonBadge
              reason={
                item.reviewReason
              }
            />

            <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-500">
              Confidence{" "}
              {
                percent(
                  item.confidence *
                  100
                )
              }
            </span>

            {item.topicName ? (
              <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-black text-blue-700">
                فعلی:{" "}
                {
                  item.topicName
                }
              </span>
            ) : null}

            {item.topicActive ===
              false ? (
              <span className="rounded-full bg-rose-50 px-2 py-1 text-[10px] font-black text-rose-700">
                Topic فعلی غیرفعال
              </span>
            ) : null}
          </div>

          <p className="mt-3 whitespace-pre-wrap text-sm font-bold leading-7 text-slate-800">
            {
              item.content
            }
          </p>

          <p className="mt-2 text-[10px] text-slate-400">
            {
              formatMessageDate(
                item.created
              )
            }
          </p>
        </div>
      </div>

      {item.reviewed ? (
        <div className="mt-4 grid gap-3 rounded-2xl border border-blue-100 bg-blue-50/50 p-4 sm:grid-cols-2">
          <div>
            <p className="text-[10px] font-black text-slate-400">
              نتیجه اولیه AI
            </p>

            <p className="mt-1 text-xs font-black text-rose-700">
              {item.originalTopicName ||
                (
                  item.originalStatus ===
                  "unclassified"
                    ? "Unclassified"
                    : item.originalStatus
                ) ||
                "نامشخص"}
            </p>

            <p className="mt-1 text-[10px] font-bold text-slate-400">
              Confidence:{" "}
              {
                percent(
                  item.originalConfidence *
                  100
                )
              }
            </p>
          </div>

          <div>
            <p className="text-[10px] font-black text-slate-400">
              نتیجه Human Review
            </p>

            <p className="mt-1 text-xs font-black text-emerald-700">
              {item.topicName ||
                (
                  item.classificationStatus ===
                  "unclassified"
                    ? "Unclassified"
                    : item.classificationStatus
                )}
            </p>

            <p className="mt-1 text-[10px] font-bold text-slate-400">
              {
                item.reviewSource ===
                "quality_sample"
                  ? "منبع: Quality Audit"
                  : "منبع: صف نیازمند بررسی"
              }
              {item.reviewedAt
                ? ` · ${formatMessageDate(
                    item.reviewedAt
                  )}`
                : ""}
            </p>
          </div>
        </div>
      ) : null}

      <div className="mt-4 grid gap-2 lg:grid-cols-2">
        <select
          value={
            expectedTopicId
          }
          disabled={
            topicsLoading
          }
          onChange={(
            event
          ) =>
            onExpectedTopic(
              event.target
                .value
            )
          }
          className="min-h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-violet-400 focus:bg-white disabled:opacity-60"
        >
          <option value="">
            نتیجه صحیح را انتخاب کنید
          </option>

          <option value="__unclassified__">
            بدون موضوع / Unclassified
          </option>

          {topics.map(
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
                {topic.name} — {topic.code}
              </option>
            )
          )}
        </select>

        <input
          type="text"
          value={
            note
          }
          maxLength={
            1000
          }
          disabled={
            saving
          }
          onChange={(
            event
          ) =>
            setNote(
              event.target
                .value
            )
          }
          placeholder="یادداشت بررسی (اختیاری)"
          className="min-h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-violet-400 focus:bg-white disabled:opacity-60"
        />

        <button
          type="button"
          disabled={
            saving
          }
          onClick={
            onUseAsSingle
          }
          className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-2.5 text-xs font-black text-violet-700 transition hover:bg-violet-100"
        >
          تست تکی
        </button>

        <button
          type="button"
          disabled={
            saving ||
            !expectedTopicId
          }
          onClick={
            onAdd
          }
          className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-black text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          افزودن به مجموعه تست
        </button>

        <button
          type="button"
          disabled={
            saving ||
            !expectedTopicId
          }
          onClick={() =>
            onApply(
              note
            )
          }
          className="rounded-xl bg-emerald-700 px-4 py-2.5 text-xs font-black text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving
            ? "در حال ثبت..."
            : item.reviewed
              ? "ثبت بازبینی مجدد"
              : "تأیید و اعمال به داده واقعی"}
        </button>
      </div>
    </article>
  );
}

function SamplingBadge({
  label,
  value,
}: {
  label:
    string;

  value:
    number;
}) {
  return (
    <span className="rounded-xl bg-white px-3 py-2 text-[10px] font-black text-emerald-700">
      {
        label
      }:{" "}
      {
        number(
          value
        )
      }
    </span>
  );
}

function ReviewReasonBadge({
  reason,
}: {
  reason:
    string;
}) {
  if (
    reason ===
    "reviewed"
  ) {
    return (
      <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-black text-blue-700">
        Human Reviewed
      </span>
    );
  }

  if (
    reason ===
    "quality_sample"
  ) {
    return (
      <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-black text-emerald-700">
        Quality Audit
      </span>
    );
  }

  if (
    reason ===
    "unclassified"
  ) {
    return (
      <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-black text-amber-700">
        Unclassified
      </span>
    );
  }

  if (
    reason ===
    "error"
  ) {
    return (
      <span className="rounded-full bg-rose-50 px-2 py-1 text-[10px] font-black text-rose-700">
        Error
      </span>
    );
  }

  return (
    <span className="rounded-full bg-violet-50 px-2 py-1 text-[10px] font-black text-violet-700">
      Confidence پایین
    </span>
  );
}

function ReviewModeButton({
  active,
  onClick,
  children,
}: {
  active:
    boolean;

  onClick:
    () => void;

  children:
    ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={
        onClick
      }
      className={
        active
          ? "rounded-xl bg-slate-950 px-3 py-2 text-xs font-black text-white"
          : "rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 transition hover:bg-slate-50"
      }
    >
      {
        children
      }
    </button>
  );
}

function RegressionPanel({
  topics,
  topicsLoading,
  items,
  summary,
  batchRunning,
  onChange,
  onRemove,
  onAdd,
  onRunOne,
  onRunAll,
  onReset,
  onExport,
  onImport,
  onClear,
  lastSavedAt,
  baseline,
  baselineComparison,
  onSaveBaseline,
  onClearBaseline,
}: {
  topics:
    TopicOption[];
  topicsLoading:
    boolean;
  items:
    RegressionCase[];
  summary: {
    completed:
      number;
    passed:
      number;
    failed:
      number;
    errors:
      number;
    accuracy:
      number;
  };
  batchRunning:
    boolean;
  onChange:
    (
      id:
        string,
      patch:
        Partial<RegressionCase>
    ) => void;
  onRemove:
    (
      id:
        string
    ) => void;
  onAdd:
    () => void;
  onRunOne:
    (
      item:
        RegressionCase
    ) => void;
  onRunAll:
    () => void;
  onReset:
    () => void;

  onExport:
    () => void;

  onImport:
    (
      file:
        File
    ) => void;

  onClear:
    () => void;

  lastSavedAt:
    string;

  baseline:
    RegressionBaseline |
    null;

  baselineComparison: {
    available:
      boolean;

    baselineAccuracy:
      number;

    currentAccuracy:
      number;

    accuracyDelta:
      number;

    compared:
      number;

    changedPredictions:
      number;

    improved:
      number;

    regressed:
      number;
  };

  onSaveBaseline:
    () => void;

  onClearBaseline:
    () => void;
}) {
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-xs font-bold leading-6 text-violet-800">
        برای هر سؤال، نتیجه مورد انتظار را مشخص کن. اجرای مجموعه به‌صورت ترتیبی انجام می‌شود تا فشار ناگهانی به OpenAI و Rate Limit وارد نشود.
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-black text-slate-700">
            مجموعه تست مرورگر
          </p>

          <p className="mt-1 text-[10px] leading-5 text-slate-400">
            تغییرات این مجموعه به‌صورت خودکار در همین مرورگر ذخیره می‌شود.
            {lastSavedAt
              ? ` آخرین ذخیره: ${formatSavedAt(
                  lastSavedAt
                )}`
              : ""}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <label className="cursor-pointer rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 transition hover:bg-slate-50">
            ورود JSON

            <input
              type="file"
              accept="application/json,.json"
              className="hidden"
              disabled={
                batchRunning
              }
              onChange={(
                event
              ) => {
                const file =
                  event.target
                    .files?.[0];

                if (
                  file
                ) {
                  onImport(
                    file
                  );
                }

                event.currentTarget.value =
                  "";
              }}
            />
          </label>

          <button
            type="button"
            disabled={
              batchRunning
            }
            onClick={
              onExport
            }
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
          >
            خروجی JSON
          </button>

          <button
            type="button"
            disabled={
              batchRunning
            }
            onClick={
              onClear
            }
            className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-black text-rose-700 transition hover:bg-rose-100 disabled:opacity-40"
          >
            پاک‌کردن مجموعه
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-black text-slate-700">
              Baseline و تشخیص Regression
            </p>

            <p className="mt-1 text-[10px] leading-5 text-slate-400">
              {baseline
                ? `Baseline ذخیره‌شده: ${formatSavedAt(
                    baseline.savedAt
                  )}`
                : "بعد از اجرای کامل مجموعه، نتایج فعلی را به‌عنوان Baseline ثبت کن. اجرای بعدی با آن مقایسه می‌شود."}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={
                batchRunning
              }
              onClick={
                onSaveBaseline
              }
              className="rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-black text-white transition hover:bg-slate-800 disabled:opacity-40"
            >
              {baseline
                ? "جایگزینی Baseline"
                : "ثبت Baseline"}
            </button>

            {baseline ? (
              <button
                type="button"
                disabled={
                  batchRunning
                }
                onClick={
                  onClearBaseline
                }
                className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs font-black text-rose-700 transition hover:bg-rose-100 disabled:opacity-40"
              >
                حذف Baseline
              </button>
            ) : null}
          </div>
        </div>

        {baseline ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <SummaryMetric
              label="Baseline Accuracy"
              value={
                baselineComparison.compared >
                0
                  ? percent(
                      baselineComparison
                        .baselineAccuracy
                    )
                  : "—"
              }
            />

            <SummaryMetric
              label="Current Accuracy"
              value={
                baselineComparison.compared >
                0
                  ? percent(
                      baselineComparison
                        .currentAccuracy
                    )
                  : "—"
              }
            />

            <SummaryMetric
              label="Delta"
              value={
                baselineComparison.compared >
                0
                  ? signedPercent(
                      baselineComparison
                        .accuracyDelta
                    )
                  : "—"
              }
            />

            <SummaryMetric
              label="Prediction Changed"
              value={
                number(
                  baselineComparison
                    .changedPredictions
                )
              }
            />

            <SummaryMetric
              label="Improved"
              value={
                number(
                  baselineComparison
                    .improved
                )
              }
            />

            <SummaryMetric
              label="Regressed"
              value={
                number(
                  baselineComparison
                    .regressed
                )
              }
            />
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <SummaryMetric
          label="Accuracy"
          value={
            summary.completed >
            0
              ? percent(
                  summary.accuracy
                )
              : "—"
          }
        />

        <SummaryMetric
          label="Pass"
          value={
            number(
              summary.passed
            )
          }
        />

        <SummaryMetric
          label="Fail"
          value={
            number(
              summary.failed
            )
          }
        />

        <SummaryMetric
          label="Error"
          value={
            number(
              summary.errors
            )
          }
        />
      </div>

      <div className="space-y-3">
        {items.map(
          (
            item,
            index
          ) => (
            <RegressionRow
              key={
                item.id
              }
              index={
                index
              }
              item={
                item
              }
              baselineEntry={
                baseline
                  ? baseline.entries.find(
                      (
                        entry
                      ) =>
                        entry.key ===
                        regressionCaseKey(
                          item.question,
                          item.expectedTopicId
                        )
                    ) ||
                    null
                  : null
              }
              topics={
                topics
              }
              topicsLoading={
                topicsLoading
              }
              disabled={
                batchRunning
              }
              onChange={
                onChange
              }
              onRemove={
                onRemove
              }
              onRun={
                onRunOne
              }
            />
          )
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={
            batchRunning ||
            items.length >=
              MAX_REGRESSION_CASES
          }
          onClick={
            onAdd
          }
          className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
        >
          + تست جدید
        </button>

        <button
          type="button"
          disabled={
            batchRunning
          }
          onClick={
            onReset
          }
          className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-black text-slate-500 transition hover:bg-slate-50 disabled:opacity-40"
        >
          پاک‌کردن نتایج
        </button>

        <button
          type="button"
          disabled={
            batchRunning
          }
          onClick={
            onRunAll
          }
          className="mr-auto rounded-xl bg-violet-700 px-5 py-2.5 text-xs font-black text-white transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {batchRunning
            ? "در حال اجرای مجموعه..."
            : "اجرای همه تست‌ها"}
        </button>
      </div>
    </div>
  );
}

function RegressionRow({
  index,
  item,
  baselineEntry,
  topics,
  topicsLoading,
  disabled,
  onChange,
  onRemove,
  onRun,
}: {
  index:
    number;
  item:
    RegressionCase;

  baselineEntry:
    RegressionBaselineEntry |
    null;

  topics:
    TopicOption[];
  topicsLoading:
    boolean;
  disabled:
    boolean;
  onChange:
    (
      id:
        string,
      patch:
        Partial<RegressionCase>
    ) => void;
  onRemove:
    (
      id:
        string
    ) => void;
  onRun:
    (
      item:
        RegressionCase
    ) => void;
}) {
  return (
    <div
      className={
        item.status ===
          "passed"
          ? "rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4"
          : item.status ===
              "failed"
            ? "rounded-2xl border border-rose-200 bg-rose-50/40 p-4"
            : item.status ===
                "error"
              ? "rounded-2xl border border-amber-200 bg-amber-50/40 p-4"
              : "rounded-2xl border border-slate-200 bg-white p-4"
      }
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-black text-slate-400">
          تست{" "}
          {
            number(
              index +
                1
            )
          }
        </span>

        <RegressionStatus
          status={
            item.status
          }
        />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_280px_auto]">
        <textarea
          value={
            item.question
          }
          rows={
            3
          }
          maxLength={
            4000
          }
          disabled={
            disabled ||
            item.status ===
              "running"
          }
          onChange={(
            event
          ) =>
            onChange(
              item.id,
              {
                question:
                  event.target
                    .value,

                status:
                  "idle",

                result:
                  null,

                error:
                  "",
              }
            )
          }
          placeholder="سؤال آزمایشی..."
          className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm leading-6 outline-none focus:border-violet-400 disabled:opacity-60"
        />

        <select
          value={
            item.expectedTopicId
          }
          disabled={
            disabled ||
            topicsLoading ||
            item.status ===
              "running"
          }
          onChange={(
            event
          ) =>
            onChange(
              item.id,
              {
                expectedTopicId:
                  event.target
                    .value,

                status:
                  "idle",

                result:
                  null,

                error:
                  "",
              }
            )
          }
          className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-violet-400 disabled:opacity-60"
        >
          <option value="">
            موضوع مورد انتظار
          </option>

          <option value="__unclassified__">
            بدون موضوع / Unclassified
          </option>

          {item.expectedTopicId &&
          item.expectedTopicId !==
            "__unclassified__" &&
          !topics.some(
            (
              topic
            ) =>
              topic.id ===
              item.expectedTopicId
          ) ? (
            <option
              value={
                item.expectedTopicId
              }
            >
              Topic قبلی / غیرفعال
            </option>
          ) : null}

          {topics.map(
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
                {topic.name} — {topic.code}
              </option>
            )
          )}
        </select>

        <div className="flex gap-2 lg:flex-col">
          <button
            type="button"
            disabled={
              disabled ||
              item.status ===
                "running" ||
              !item.question.trim()
            }
            onClick={() =>
              onRun(
                item
              )
            }
            className="flex-1 rounded-xl bg-slate-950 px-3 py-2 text-xs font-black text-white transition hover:bg-slate-800 disabled:opacity-40"
          >
            {item.status ===
              "running"
              ? "..."
              : "اجرا"}
          </button>

          <button
            type="button"
            disabled={
              disabled ||
              item.status ===
                "running"
            }
            onClick={() =>
              onRemove(
                item.id
              )
            }
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-500 transition hover:bg-slate-50 disabled:opacity-40"
          >
            حذف
          </button>
        </div>
      </div>

      {item.result ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-lg bg-white px-2.5 py-1.5 font-black text-slate-700">
            نتیجه:{" "}
            {item.result.topicName ||
              item.result.suggestedTopicName ||
              "Unclassified"}
          </span>

          <span className="rounded-lg bg-white px-2.5 py-1.5 font-bold text-slate-500">
            Confidence:{" "}
            {
              percent(
                item.result
                  .confidence *
                  100
              )
            }
          </span>

          <span className="rounded-lg bg-white px-2.5 py-1.5 font-bold text-slate-500">
            {
              number(
                item.result
                  .latencyMs
              )
            }{" "}
            ms
          </span>
        </div>
      ) : null}

      {baselineEntry ? (
        <BaselineRowComparison
          baseline={
            baselineEntry
          }
          current={
            item.result
          }
          currentStatus={
            item.status
          }
        />
      ) : null}

      {item.error ? (
        <p className="mt-3 text-xs font-bold text-rose-700">
          {
            item.error
          }
        </p>
      ) : null}
    </div>
  );
}

function BaselineRowComparison({
  baseline,
  current,
  currentStatus,
}: {
  baseline:
    RegressionBaselineEntry;

  current:
    ClassificationTestResult |
    null;

  currentStatus:
    RegressionCase["status"];
}) {
  if (
    !current ||
    (
      currentStatus !==
        "passed" &&
      currentStatus !==
        "failed"
    )
  ) {
    return (
      <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-bold text-slate-400">
        Baseline موجود است؛ این تست را اجرا کن تا Drift مشخص شود.
      </div>
    );
  }

  const baselineTopic =
    baseline.topicId ||
    baseline.suggestedTopicId ||
    null;

  const currentTopic =
    current.topicId ||
    current.suggestedTopicId ||
    null;

  const predictionChanged =
    baseline.status !==
      current.status ||
    baselineTopic !==
      currentTopic;

  const currentPassed =
    currentStatus ===
    "passed";

  const outcome =
    !baseline.passed &&
    currentPassed
      ? "improved"
      : baseline.passed &&
          !currentPassed
        ? "regressed"
        : predictionChanged
          ? "changed"
          : "stable";

  const confidenceDelta =
    (
      current.confidence -
      baseline.confidence
    ) *
    100;

  const className =
    outcome ===
      "improved"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : outcome ===
          "regressed"
        ? "border-rose-200 bg-rose-50 text-rose-700"
        : outcome ===
            "changed"
          ? "border-amber-200 bg-amber-50 text-amber-700"
          : "border-slate-200 bg-slate-50 text-slate-600";

  const label =
    outcome ===
      "improved"
      ? "IMPROVED"
      : outcome ===
          "regressed"
        ? "REGRESSION"
        : outcome ===
            "changed"
          ? "PREDICTION CHANGED"
          : "STABLE";

  return (
    <div
      className={`mt-3 rounded-xl border px-3 py-2.5 ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] font-black">
          {
            label
          }
        </span>

        <span className="text-[10px] font-bold">
          Confidence Δ:{" "}
          {
            signedPercent(
              confidenceDelta
            )
          }
        </span>
      </div>

      {predictionChanged ? (
        <p className="mt-1 text-[10px] font-bold leading-5">
          Baseline:{" "}
          {
            baseline.topicName ||
            baseline.suggestedTopicName ||
            "Unclassified"
          }
          {" → "}
          Current:{" "}
          {
            current.topicName ||
            current.suggestedTopicName ||
            "Unclassified"
          }
        </p>
      ) : null}
    </div>
  );
}

function RegressionStatus({
  status,
}: {
  status:
    RegressionCase["status"];
}) {
  if (
    status ===
    "passed"
  ) {
    return (
      <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-black text-emerald-700">
        PASS
      </span>
    );
  }

  if (
    status ===
    "failed"
  ) {
    return (
      <span className="rounded-full bg-rose-100 px-2.5 py-1 text-[10px] font-black text-rose-700">
        FAIL
      </span>
    );
  }

  if (
    status ===
    "error"
  ) {
    return (
      <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-black text-amber-700">
        ERROR
      </span>
    );
  }

  if (
    status ===
    "running"
  ) {
    return (
      <span className="rounded-full bg-blue-100 px-2.5 py-1 text-[10px] font-black text-blue-700">
        RUNNING
      </span>
    );
  }

  return (
    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black text-slate-500">
      READY
    </span>
  );
}

function ContextField({
  id,
  label,
  value,
  onChange,
}: {
  id:
    string;
  label:
    string;
  value:
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
        className="mb-2 block text-xs font-black text-slate-600"
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
          300
        }
        rows={
          4
        }
        onChange={(
          event
        ) =>
          onChange(
            event.target
              .value
          )
        }
        className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs leading-6 outline-none focus:border-violet-400"
      />
    </div>
  );
}

function ResultCard({
  result,
}: {
  result:
    ClassificationTestResult;
}) {
  const confidence =
    result.confidence *
    100;

  const threshold =
    result.threshold *
    100;

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <span
            className={
              result.status ===
                "classified"
                ? "inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700"
                : "inline-flex rounded-full bg-amber-50 px-3 py-1 text-xs font-black text-amber-700"
            }
          >
            {result.status ===
              "classified"
              ? "Classified"
              : "Unclassified"}
          </span>

          <h3 className="mt-3 text-xl font-black text-slate-950">
            {result.topicName ||
              result.suggestedTopicName ||
              "بدون موضوع"}
          </h3>

          {result.status ===
            "unclassified" &&
          result.suggestedTopicName ? (
            <p className="mt-2 text-xs font-bold leading-6 text-amber-700">
              AI موضوع «
              {
                result.suggestedTopicName
              }
              » را پیشنهاد داده، اما Confidence از Threshold کمتر بوده است.
            </p>
          ) : null}
        </div>

        <div className="text-left">
          <p className="text-3xl font-black text-slate-950">
            {
              percent(
                confidence
              )
            }
          </p>

          <p className="mt-1 text-[10px] font-bold text-slate-400">
            Confidence
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryMetric
          label="Threshold"
          value={
            percent(
              threshold
            )
          }
        />

        <SummaryMetric
          label="Candidateها"
          value={
            number(
              result.candidateCount
            )
          }
        />

        <SummaryMetric
          label="زمان پاسخ"
          value={`${number(
            result.latencyMs
          )} ms`}
        />

        <SummaryMetric
          label="Matched خام"
          value={
            result.matched
              ? "بله"
              : "خیر"
          }
        />
      </div>

      <div
        dir="ltr"
        className="mt-4 rounded-xl bg-slate-50 px-3 py-2 text-left font-mono text-[10px] text-slate-400"
      >
        {result.model}
        {result.responseId
          ? ` · ${result.responseId}`
          : ""}
      </div>
    </div>
  );
}

function SummaryMetric({
  label,
  value,
}: {
  label:
    string;
  value:
    string;
}) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-3">
      <p className="text-[10px] font-bold text-slate-400">
        {
          label
        }
      </p>

      <p className="mt-1 text-sm font-black text-slate-800">
        {
          value
        }
      </p>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active:
    boolean;
  onClick:
    () => void;
  children:
    ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={
        onClick
      }
      className={
        active
          ? "border-b-2 border-violet-700 px-4 py-3 text-sm font-black text-violet-700"
          : "border-b-2 border-transparent px-4 py-3 text-sm font-black text-slate-400 transition hover:text-slate-700"
      }
    >
      {
        children
      }
    </button>
  );
}

function formatMessageDate(
  value:
    string
) {
  const date =
    new Date(
      value
    );

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return "";
  }

  return new Intl.DateTimeFormat(
    "fa-IR",
    {
      dateStyle:
        "short",

      timeStyle:
        "short",
    }
  ).format(
    date
  );
}

function regressionCaseKey(
  question:
    string,

  expectedTopicId:
    string
) {
  const normalizedQuestion =
    question
      .trim()
      .replace(
        /\s+/g,
        " "
      )
      .toLocaleLowerCase(
        "fa"
      );

  return `${expectedTopicId.trim()}::${normalizedQuestion}`;
}

function signedPercent(
  value:
    number
) {
  if (
    !Number.isFinite(
      value
    )
  ) {
    return "—";
  }

  const sign =
    value >
    0
      ? "+"
      : "";

  return `${sign}${new Intl.NumberFormat(
    "fa-IR",
    {
      maximumFractionDigits:
        1,
    }
  ).format(
    value
  )}٪`;
}

function formatSavedAt(
  value:
    string
) {
  const date =
    new Date(
      value
    );

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return "";
  }

  return new Intl.DateTimeFormat(
    "fa-IR",
    {
      dateStyle:
        "short",

      timeStyle:
        "short",
    }
  ).format(
    date
  );
}

function createEmptyRegressionCase(): RegressionCase {
  return {
    id:
      crypto.randomUUID(),

    question:
      "",

    expectedTopicId:
      "",

    result:
      null,

    status:
      "idle",

    error:
      "",
  };
}

async function requestClassification({
  question,
  context,
}: {
  question:
    string;

  context:
    Array<{
      role:
        "user" |
        "assistant";

      content:
        string;
    }>;
}) {
  const response =
    await fetch(
      "/api/admin/topics/test-classification",
      {
        method:
          "POST",

        headers: {
          "Content-Type":
            "application/json",
        },

        body:
          JSON.stringify({
            question,
            context,
          }),
      }
    );

  const body =
    (await safeJson(
      response
    )) as
      ClassificationTestResponse |
      null;

  if (
    response.status ===
    401
  ) {
    window.location.assign(
      "/login"
    );

    throw new Error(
      "UNAUTHORIZED"
    );
  }

  if (
    !response.ok ||
    !body ||
    !body.success
  ) {
    throw new Error(
      apiMessage(
        body,
        "اجرای تست طبقه‌بندی ناموفق بود."
      )
    );
  }

  return body.result;
}

function number(
  value:
    number
) {
  return new Intl.NumberFormat(
    "fa-IR"
  ).format(
    value
  );
}

function percent(
  value:
    number
) {
  return `${new Intl.NumberFormat(
    "fa-IR",
    {
      maximumFractionDigits:
        1,
    }
  ).format(
    value
  )}٪`;
}

async function safeJson(
  response:
    Response
): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function apiMessage(
  value:
    unknown,

  fallback:
    string
) {
  if (
    typeof value ===
      "object" &&
    value !==
      null &&
    "message" in
      value &&
    typeof (
      value as {
        message?:
          unknown;
      }
    ).message ===
      "string"
  ) {
    return (
      value as {
        message:
          string;
      }
    ).message;
  }

  return fallback;
}
