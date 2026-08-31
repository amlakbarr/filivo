"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

type EvidenceItem = {
  id:
    string;

  content:
    string;

  guidanceText:
    string;

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

  finalTopicId:
    string |
    null;

  finalTopicName:
    string |
    null;

  finalStatus:
    string;

  reviewedAt:
    string;

  reviewSource:
    "needs_review" |
    "quality_sample";
};

type EvidenceResponse =
  | {
      success:
        true;

      topic: {
        id:
          string;

        name:
          string;

        code:
          string;

        active:
          boolean;
      };

      summary: {
        positiveCorrections:
          number;

        negativeCorrections:
          number;

        confirmedPositive:
          number;

        totalEvidence:
          number;
      };

      evidence: {
        positiveCorrections:
          EvidenceItem[];

        negativeCorrections:
          EvidenceItem[];

        confirmedPositive:
          EvidenceItem[];
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

type EvidenceValidationStatus =
  | "idle"
  | "running"
  | "passed"
  | "failed"
  | "error";

type EvidenceValidationItem = {
  id:
    string;

  expectedTopicId:
    string |
    null;

  expectedStatus:
    "classified" |
    "unclassified";

  origin:
    "baseline" |
    "fresh" |
    "current";

  status:
    EvidenceValidationStatus;

  result:
    ClassificationTestResult |
    null;

  error:
    string;
};

type ValidationBaselineEntry = {
  evidenceId:
    string;

  expectedTopicId:
    string |
    null;

  expectedStatus:
    "classified" |
    "unclassified";

  passed:
    boolean;

  resultStatus:
    "classified" |
    "unclassified";

  topicId:
    string |
    null;

  suggestedTopicId:
    string |
    null;

  confidence:
    number;
};

type ValidationBaseline = {
  id:
    string;

  version:
    1;

  topicId:
    string;

  savedAt:
    string;

  savedBy: {
    id:
      string;

    name:
      string;
  };

  entries:
    ValidationBaselineEntry[];
};

type ValidationBaselineResponse =
  | {
      success:
        true;

      baseline:
        ValidationBaseline |
        null;

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

type ValidationBaselineDeleteResponse =
  | {
      success:
        true;

      deleted:
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

type ServerGuidanceValidationResponse =
  | {
      success:
        true;

      validation: {
        items:
          Array<{
            evidenceId:
              string;

            expectedTopicId:
              string |
              null;

            expectedStatus:
              "classified" |
              "unclassified";

            origin:
              "baseline" |
              "fresh" |
              "current";

            status:
              "passed" |
              "failed" |
              "error";

            result:
              ClassificationTestResult |
              null;

            error:
              string;
          }>;

        summary: {
          total:
            number;

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

        comparison: {
          compared:
            number;

          baselineAccuracy:
            number;

          currentAccuracy:
            number;

          delta:
            number;

          improved:
            number;

          regressed:
            number;

          changedPrediction:
            number;
        };

        freshEvidence: {
          tested:
            number;

          passed:
            number;

          failed:
            number;

          errors:
            number;
        };

        evidence: {
          revision:
            string;

          stable:
            boolean;
        };

        gate: {
          status:
            "ready" |
            "blocked";

          reason:
            string;

          validatedAt:
            string;

          validationToken:
            string |
            null;

          validationId:
            string |
            null;

          expiresAt:
            string |
            null;
        };
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

export type GuidanceValidationGate = {
  status:
    | "not_required"
    | "pending"
    | "running"
    | "ready"
    | "blocked";

  reason:
    string;

  validatedAt:
    string;

  accuracy:
    number;

  failed:
    number;

  errors:
    number;

  regressed:
    number;

  improved:
    number;

  compared:
    number;

  validationToken:
    string;

  validationId:
    string;

  expiresAt:
    string;
};

export default function GuidanceEvidencePanel({
  topicId,
  keywords,
  examples,
  negativeExamples,
  classificationNote,
  draftChanged,
  onValidationGateChange,
  onAddPositive,
  onAddNegative,
}: {
  topicId:
    string;

  keywords:
    string;

  examples:
    string;

  negativeExamples:
    string;

  classificationNote:
    string;

  draftChanged:
    boolean;

  onValidationGateChange:
    (
      gate:
        GuidanceValidationGate
    ) => void;

  onAddPositive:
    (
      value:
        string
    ) => void;

  onAddNegative:
    (
      value:
        string
    ) => void;
}) {
  const [
    data,
    setData,
  ] =
    useState<
      Extract<
        EvidenceResponse,
        {
          success:
            true;
        }
      > |
      null
    >(
      null
    );

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  const [
    error,
    setError,
  ] =
    useState("");

  const [
    expanded,
    setExpanded,
  ] =
    useState(true);

  const [
    validationItems,
    setValidationItems,
  ] =
    useState<
      Record<
        string,
        EvidenceValidationItem
      >
    >({});

  const [
    validationRunning,
    setValidationRunning,
  ] =
    useState(false);

  const [
    validationNotice,
    setValidationNotice,
  ] =
    useState("");

  const [
    validationBaseline,
    setValidationBaseline,
  ] =
    useState<ValidationBaseline | null>(
      null
    );

  const [
    baselineNotice,
    setBaselineNotice,
  ] =
    useState("");

  const [
    baselineLoading,
    setBaselineLoading,
  ] =
    useState(false);

  const [
    baselineSaving,
    setBaselineSaving,
  ] =
    useState(false);

  const [
    validatedFingerprint,
    setValidatedFingerprint,
  ] =
    useState("");

  const [
    validatedAt,
    setValidatedAt,
  ] =
    useState("");

  const [
    serverGate,
    setServerGate,
  ] =
    useState<
      GuidanceValidationGate |
      null
    >(
      null
    );

  const [
    certificateSecondsLeft,
    setCertificateSecondsLeft,
  ] =
    useState(0);

  useEffect(() => {
    if (
      !topicId
    ) {
      return;
    }

    let cancelled =
      false;

    async function loadBaseline() {
      setBaselineLoading(
        true
      );

      try {
        const response =
          await fetch(
            `/api/admin/topics/${encodeURIComponent(
              topicId
            )}/validation-baseline`,
            {
              cache:
                "no-store",
            }
          );

        const body =
          (await safeJson(
            response
          )) as
            ValidationBaselineResponse |
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
              "دریافت Baseline Validation ناموفق بود."
            )
          );
        }

        if (
          !cancelled
        ) {
          setValidationBaseline(
            body.baseline
          );
        }
      } catch (reason) {
        if (
          !cancelled
        ) {
          setValidationBaseline(
            null
          );

          setBaselineNotice(
            reason instanceof
              Error
              ? reason.message
              : "دریافت Baseline Validation ناموفق بود."
          );
        }
      } finally {
        if (
          !cancelled
        ) {
          setBaselineLoading(
            false
          );
        }
      }
    }

    void loadBaseline();

    return () => {
      cancelled =
        true;
    };
  }, [
    topicId,
  ]);

  const draftFingerprint =
    useMemo(
      () =>
        guidanceFingerprint({
          topicId,

          keywords,

          examples,

          negativeExamples,

          classificationNote,
        }),
      [
        topicId,
        keywords,
        examples,
        negativeExamples,
        classificationNote,
      ]
    );

  const positiveKeys =
    useMemo(
      () =>
        guidanceLineSet(
          examples
        ),
      [
        examples,
      ]
    );

  const negativeKeys =
    useMemo(
      () =>
        guidanceLineSet(
          negativeExamples
        ),
      [
        negativeExamples,
      ]
    );

  const validationSummary =
    useMemo(
      () => {
        const items =
          Object.values(
            validationItems
          );

        const completed =
          items.filter(
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
          items.filter(
            (
              item
            ) =>
              item.status ===
              "error"
          ).length;

        return {
          completed:
            completed.length,

          passed,

          failed,

          errors,

          accuracy:
            completed.length >
            0
              ? passed /
                completed.length
              : 0,
        };
      },
      [
        validationItems,
      ]
    );

  const freshValidationSummary =
    useMemo(
      () => {
        const fresh =
          Object.values(
            validationItems
          ).filter(
            (
              item
            ) =>
              item.origin ===
              "fresh"
          );

        return {
          tested:
            fresh.length,

          passed:
            fresh.filter(
              (
                item
              ) =>
                item.status ===
                "passed"
            ).length,

          failed:
            fresh.filter(
              (
                item
              ) =>
                item.status ===
                "failed"
            ).length,

          errors:
            fresh.filter(
              (
                item
              ) =>
                item.status ===
                "error"
            ).length,
        };
      },
      [
        validationItems,
      ]
    );

  const baselineComparison =
    useMemo(
      () => {
        if (
          !validationBaseline
        ) {
          return {
            compared:
              0,

            baselineAccuracy:
              0,

            currentAccuracy:
              validationSummary.accuracy,

            delta:
              0,

            improved:
              0,

            regressed:
              0,

            changedPrediction:
              0,
          };
        }

        const baselineById =
          new Map(
            validationBaseline.entries.map(
              (
                entry
              ) => [
                entry.evidenceId,
                entry,
              ]
            )
          );

        let compared =
          0;

        let baselinePassed =
          0;

        let currentPassed =
          0;

        let improved =
          0;

        let regressed =
          0;

        let changedPrediction =
          0;

        for (
          const current of
          Object.values(
            validationItems
          )
        ) {
          if (
            !current.result ||
            (
              current.status !==
                "passed" &&
              current.status !==
                "failed"
            )
          ) {
            continue;
          }

          const baseline =
            baselineById.get(
              current.id
            );

          if (
            !baseline
          ) {
            continue;
          }

          compared +=
            1;

          if (
            baseline.passed
          ) {
            baselinePassed +=
              1;
          }

          if (
            current.status ===
            "passed"
          ) {
            currentPassed +=
              1;
          }

          if (
            !baseline.passed &&
            current.status ===
              "passed"
          ) {
            improved +=
              1;
          }

          if (
            baseline.passed &&
            current.status ===
              "failed"
          ) {
            regressed +=
              1;
          }

          const baselineTopic =
            baseline.topicId ||
            baseline.suggestedTopicId ||
            null;

          const currentTopic =
            current.result.topicId ||
            current.result.suggestedTopicId ||
            null;

          if (
            baseline.resultStatus !==
              current.result.status ||
            baselineTopic !==
              currentTopic
          ) {
            changedPrediction +=
              1;
          }
        }

        const baselineAccuracy =
          compared >
          0
            ? baselinePassed /
              compared
            : 0;

        const currentAccuracy =
          compared >
          0
            ? currentPassed /
              compared
            : validationSummary.accuracy;

        return {
          compared,

          baselineAccuracy,

          currentAccuracy,

          delta:
            currentAccuracy -
            baselineAccuracy,

          improved,

          regressed,

          changedPrediction,
        };
      },
      [
        validationBaseline,
        validationItems,
        validationSummary.accuracy,
      ]
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
              `/api/admin/topics/${encodeURIComponent(
                topicId
              )}/guidance-evidence`,
              {
                cache:
                  "no-store",
              }
            );

          const body =
            (await safeJson(
              response
            )) as
              EvidenceResponse |
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
                "دریافت شواهد Human Review ناموفق بود."
              )
            );
          }

          setData(
            body
          );
        } catch (reason) {
          setError(
            reason instanceof
              Error
              ? reason.message
              : "دریافت شواهد Human Review ناموفق بود."
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

  useEffect(() => {
    void load();
  }, [
    load,
  ]);

  useEffect(() => {
    if (
      !serverGate ||
      serverGate.status !==
        "ready" ||
      !serverGate.expiresAt
    ) {
      setCertificateSecondsLeft(
        0
      );

      return;
    }

    /*
     * TypeScript narrowing روی state داخل nested function
     * حفظ نمی‌شود، چون serverGate ممکن است بین renderها
     * تغییر کند. مقدار معتبر فعلی را capture می‌کنیم.
     */
    const activeGate =
      serverGate;

    let cancelled =
      false;

    function refresh() {
      if (
        cancelled
      ) {
        return;
      }

      const expiresAt =
        new Date(
          activeGate.expiresAt
        ).getTime();

      const remaining =
        Number.isFinite(
          expiresAt
        )
          ? Math.max(
              0,
              Math.ceil(
                (
                  expiresAt -
                  Date.now()
                ) /
                  1000
              )
            )
          : 0;

      setCertificateSecondsLeft(
        remaining
      );

      if (
        remaining >
        0
      ) {
        return;
      }

      setServerGate(
        (
          current
        ) => {
          if (
            !current ||
            current.status !==
              "ready"
          ) {
            return current;
          }

          return {
            ...current,

            status:
              "pending",

            reason:
              "اعتبار گواهی Validation منقضی شده است؛ Draft را دوباره Validation کنید.",

            validationToken:
              "",

            validationId:
              "",

            expiresAt:
              "",
          };
        }
      );

      setValidatedFingerprint(
        ""
      );

      setValidatedAt(
        ""
      );

      setValidationNotice(
        "گواهی Validation منقضی شد؛ برای ادامه Save دوباره Validation را اجرا کنید."
      );
    }

    refresh();

    const timer =
      window.setInterval(
        refresh,
        1_000
      );

    return () => {
      cancelled =
        true;

      window.clearInterval(
        timer
      );
    };
  }, [
    serverGate,
  ]);

  const validationGate =
    useMemo<GuidanceValidationGate>(
      () => {
        const base = {
          accuracy:
            validationSummary.accuracy,

          failed:
            validationSummary.failed,

          errors:
            validationSummary.errors,

          regressed:
            baselineComparison.regressed,

          improved:
            baselineComparison.improved,

          compared:
            baselineComparison.compared,

          validationToken:
            "",

          validationId:
            "",

          expiresAt:
            "",
        };

        if (
          !draftChanged
        ) {
          return {
            ...base,

            status:
              "not_required",

            reason:
              "Guidance تغییری نکرده است.",

            validatedAt:
              "",
          };
        }

        if (
          validationRunning
        ) {
          return {
            ...base,

            status:
              "running",

            reason:
              "Validation امن Draft روی سرور در حال اجرا است.",

            validatedAt:
              "",
          };
        }

        if (
          !validatedFingerprint ||
          validatedFingerprint !==
            draftFingerprint ||
          !serverGate
        ) {
          return {
            ...base,

            status:
              "pending",

            reason:
              validatedFingerprint &&
              validatedFingerprint !==
                draftFingerprint
                ? "Guidance بعد از آخرین Validation تغییر کرده است؛ Validation را دوباره اجرا کنید."
                : "قبل از ذخیره Guidance، Validation امن Draft را روی سرور اجرا کنید.",

            validatedAt:
              "",
          };
        }

        return serverGate;
      },
      [
        draftChanged,
        validationRunning,
        validatedFingerprint,
        draftFingerprint,
        serverGate,
        validationSummary.accuracy,
        validationSummary.failed,
        validationSummary.errors,
        baselineComparison.regressed,
        baselineComparison.improved,
        baselineComparison.compared,
      ]
    );

  useEffect(() => {
    onValidationGateChange(
      validationGate
    );
  }, [
    onValidationGateChange,
    validationGate,
  ]);

  async function saveValidationBaseline() {
    if (
      validationRunning ||
      baselineSaving
    ) {
      return;
    }

    if (
      draftChanged
    ) {
      setBaselineNotice(
        "Baseline باید نماینده Guidance منتشرشده باشد. ابتدا تغییرات Guidance را ذخیره کن، سپس Validation را دوباره اجرا و Baseline را ثبت کن."
      );

      return;
    }

    const completed =
      Object.values(
        validationItems
      ).filter(
        (
          item
        ) =>
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

    if (
      completed.length ===
      0
    ) {
      setBaselineNotice(
        "ابتدا Validation شواهد را اجرا کنید."
      );

      return;
    }

    if (
      completed.length !==
      Object.keys(
        validationItems
      ).length
    ) {
      setBaselineNotice(
        "برای ثبت Baseline باید همه تست‌های Validation بدون Error کامل شده باشند."
      );

      return;
    }

    const entries =
      completed.map(
        (
          item
        ) => {
          const result =
            item.result as
              ClassificationTestResult;

          return {
            evidenceId:
              item.id,

            expectedTopicId:
              item.expectedTopicId,

            expectedStatus:
              item.expectedStatus,

            passed:
              item.status ===
              "passed",

            resultStatus:
              result.status,

            topicId:
              result.topicId,

            suggestedTopicId:
              result.suggestedTopicId,

            confidence:
              result.confidence,
          } satisfies ValidationBaselineEntry;
        }
      );

    setBaselineSaving(
      true
    );

    setBaselineNotice(
      ""
    );

    try {
      const response =
        await fetch(
          `/api/admin/topics/${encodeURIComponent(
            topicId
          )}/validation-baseline`,
          {
            method:
              "PUT",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                entries,
              }),
          }
        );

      const body =
        (await safeJson(
          response
        )) as
          ValidationBaselineResponse |
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
        !body.success ||
        !body.baseline
      ) {
        throw new Error(
          apiMessage(
            body,
            "ذخیره Baseline Validation ناموفق بود."
          )
        );
      }

      setValidationBaseline(
        body.baseline
      );

      setBaselineNotice(
        "Baseline مشترک این Topic روی سرور ذخیره شد و برای سایر مدیران نیز قابل مشاهده است."
      );
    } catch (reason) {
      setBaselineNotice(
        reason instanceof
          Error
          ? reason.message
          : "ذخیره Baseline Validation ناموفق بود."
      );
    } finally {
      setBaselineSaving(
        false
      );
    }
  }

  async function clearValidationBaseline() {
    if (
      validationRunning ||
      baselineSaving ||
      !validationBaseline
    ) {
      return;
    }

    const confirmed =
      window.confirm(
        "Baseline Validation مشترک این Topic پاک شود؟ این تغییر برای همه مدیران اعمال می‌شود."
      );

    if (
      !confirmed
    ) {
      return;
    }

    setBaselineSaving(
      true
    );

    setBaselineNotice(
      ""
    );

    try {
      const response =
        await fetch(
          `/api/admin/topics/${encodeURIComponent(
            topicId
          )}/validation-baseline`,
          {
            method:
              "DELETE",
          }
        );

      const body =
        (await safeJson(
          response
        )) as
          ValidationBaselineDeleteResponse |
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
            "حذف Baseline Validation ناموفق بود."
          )
        );
      }

      setValidationBaseline(
        null
      );

      setBaselineNotice(
        "Baseline مشترک حذف شد."
      );
    } catch (reason) {
      setBaselineNotice(
        reason instanceof
          Error
          ? reason.message
          : "حذف Baseline Validation ناموفق بود."
      );
    } finally {
      setBaselineSaving(
        false
      );
    }
  }

  function buildValidationCases() {
    if (
      !data
    ) {
      return [];
    }

    const combined =
      [
        ...data.evidence
          .positiveCorrections
          .slice(
            0,
            3
          )
          .map(
            (
              item
            ) => ({
              item,

              expectedTopicId:
                topicId,

              expectedStatus:
                "classified" as const,
            })
          ),

        ...data.evidence
          .negativeCorrections
          .slice(
            0,
            3
          )
          .map(
            (
              item
            ) => ({
              item,

              expectedTopicId:
                item.finalStatus ===
                  "classified"
                  ? item.finalTopicId
                  : null,

              expectedStatus:
                item.finalStatus ===
                  "classified"
                  ? "classified" as const
                  : "unclassified" as const,
            })
          ),

        ...data.evidence
          .confirmedPositive
          .slice(
            0,
            2
          )
          .map(
            (
              item
            ) => ({
              item,

              expectedTopicId:
                topicId,

              expectedStatus:
                "classified" as const,
            })
          ),
      ];

    /*
     * Endpoint تست فعلی روی 10 درخواست در دقیقه
     * Rate Limit دارد؛ این Validation عمداً حداکثر
     * 8 نمونه را در هر اجرا تست می‌کند.
     */
    return combined.slice(
      0,
      8
    );
  }

  async function runValidation() {
    if (
      validationRunning
    ) {
      return;
    }

    setValidationRunning(
      true
    );

    setValidatedFingerprint(
      ""
    );

    setValidatedAt(
      ""
    );

    setServerGate(
      null
    );

    setValidationItems(
      {}
    );

    setValidationNotice(
      ""
    );

    try {
      const response =
        await fetch(
          `/api/admin/topics/${encodeURIComponent(
            topicId
          )}/validate-guidance`,
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                guidance: {
                  keywords,

                  examples,

                  negativeExamples,

                  classificationNote,
                },
              }),
          }
        );

      const body =
        (await safeJson(
          response
        )) as
          ServerGuidanceValidationResponse |
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
            "Validation امن Guidance روی سرور ناموفق بود."
          )
        );
      }

      setValidationItems(
        Object.fromEntries(
          body.validation.items.map(
            (
              item
            ) => [
              item.evidenceId,
              {
                id:
                  item.evidenceId,

                expectedTopicId:
                  item.expectedTopicId,

                expectedStatus:
                  item.expectedStatus,

                origin:
                  item.origin,

                status:
                  item.status,

                result:
                  item.result,

                error:
                  item.error,
              } satisfies EvidenceValidationItem,
            ]
          )
        )
      );

      const gate:
        GuidanceValidationGate = {
          status:
            body.validation
              .gate
              .status,

          reason:
            body.validation
              .gate
              .reason,

          validatedAt:
            body.validation
              .gate
              .validatedAt,

          accuracy:
            body.validation
              .summary
              .accuracy,

          failed:
            body.validation
              .summary
              .failed,

          errors:
            body.validation
              .summary
              .errors,

          regressed:
            body.validation
              .comparison
              .regressed,

          improved:
            body.validation
              .comparison
              .improved,

          compared:
            body.validation
              .comparison
              .compared,

          validationToken:
            body.validation
              .gate
              .validationToken ||
            "",

          validationId:
            body.validation
              .gate
              .validationId ||
            "",

          expiresAt:
            body.validation
              .gate
              .expiresAt ||
            "",
        };

      setServerGate(
        gate
      );

      setValidatedFingerprint(
        draftFingerprint
      );

      setValidatedAt(
        gate.validatedAt
      );

      setValidationNotice(
        gate.status ===
          "ready"
          ? "Validation امن روی سرور تأیید شد و گواهی موقت انتشار برای همین Draft صادر شد."
          : gate.reason
      );
    } catch (reason) {
      setServerGate(
        null
      );

      setValidationNotice(
        reason instanceof
          Error
          ? reason.message
          : "Validation امن Guidance روی سرور ناموفق بود."
      );
    } finally {
      setValidationRunning(
        false
      );
    }
  }



  return (
    <section className="rounded-2xl border border-sky-200 bg-sky-50/60">
      <button
        type="button"
        onClick={() =>
          setExpanded(
            (
              value
            ) =>
              !value
          )
        }
        className="flex w-full items-start justify-between gap-4 px-4 py-3 text-right"
      >
        <div>
          <p className="text-xs font-black text-sky-900">
            شواهد Human Review برای Guidance
          </p>

          <p className="mt-1 text-[10px] leading-5 text-sky-700">
            سؤال‌های واقعی که Human Review نشان داده باید به مثال مثبت یا منفی این Topic تبدیل شوند.
          </p>
        </div>

        <span className="shrink-0 rounded-lg bg-white px-2 py-1 text-[10px] font-black text-sky-700">
          {loading
            ? "..."
            : data
              ? `${number(
                  data.summary
                    .totalEvidence
                )} شاهد`
              : expanded
                ? "بستن"
                : "باز کردن"}
        </span>
      </button>

      {expanded ? (
        <div className="border-t border-sky-200/70 p-4">
          {error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-bold leading-6 text-rose-700">
              <p>
                {
                  error
                }
              </p>

              <button
                type="button"
                onClick={() =>
                  void load()
                }
                className="mt-2 rounded-lg bg-white px-3 py-1.5 text-[10px] font-black text-rose-700"
              >
                تلاش مجدد
              </button>
            </div>
          ) : loading ? (
            <div className="space-y-2">
              {Array.from({
                length:
                  3,
              }).map(
                (
                  _,
                  index
                ) => (
                  <div
                    key={
                      index
                    }
                    className="h-20 animate-pulse rounded-xl bg-white/80"
                  />
                )
              )}
            </div>
          ) : data &&
            data.summary
              .totalEvidence >
              0 ? (
            <div className="space-y-5">
              <div className="rounded-2xl border border-indigo-200 bg-indigo-50/70 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-xs font-black text-indigo-900">
                      Validation متمرکز روی این Topic
                    </p>

                    <p className="mt-1 max-w-3xl text-[10px] leading-5 text-indigo-700">
                      حداکثر ۸ نمونه Human Reviewed مستقیماً روی سرور با Classifier واقعی اجرا می‌شوند. نتیجه PASS/FAIL از Client پذیرفته نمی‌شود و در صورت موفقیت، سرور یک گواهی امضاشده و موقت برای همین Draft صادر می‌کند.
                    </p>

                    <div className="mt-2">
                      <span
                        className={
                          draftChanged
                            ? "inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-black text-amber-800"
                            : "inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-black text-emerald-800"
                        }
                      >
                        {draftChanged
                          ? "حالت تست: Draft ذخیره‌نشده"
                          : "حالت تست: Guidance منتشرشده"}
                      </span>
                    </div>

                    {draftChanged ? (
                      <div
                        className={
                          validationGate.status ===
                            "ready"
                            ? "mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5"
                            : validationGate.status ===
                                "blocked"
                              ? "mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5"
                              : "mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5"
                        }
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span
                            className={
                              validationGate.status ===
                                "ready"
                                ? "text-[10px] font-black text-emerald-700"
                                : validationGate.status ===
                                    "blocked"
                                  ? "text-[10px] font-black text-rose-700"
                                  : "text-[10px] font-black text-amber-700"
                            }
                          >
                            {validationGate.status ===
                              "ready"
                              ? "SAVE GATE: READY"
                              : validationGate.status ===
                                  "blocked"
                                ? "SAVE GATE: BLOCKED"
                                : validationGate.status ===
                                    "running"
                                  ? "SAVE GATE: VALIDATING"
                                  : "SAVE GATE: VALIDATION REQUIRED"}
                          </span>

                          {validationGate.validatedAt ? (
                            <span className="text-[9px] font-bold text-slate-400">
                              {
                                formatDateTime(
                                  validationGate
                                    .validatedAt
                                )
                              }
                            </span>
                          ) : null}
                        </div>

                        <p className="mt-1 text-[10px] font-bold leading-5 text-slate-600">
                          {
                            validationGate.reason
                          }
                        </p>

                        {validationGate.status ===
                          "ready" &&
                        validationGate.expiresAt ? (
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span
                              className={
                                certificateSecondsLeft <=
                                  120
                                  ? "rounded-full bg-amber-100 px-2 py-1 text-[9px] font-black text-amber-700"
                                  : "rounded-full bg-white px-2 py-1 text-[9px] font-black text-slate-600"
                              }
                            >
                              زمان باقی‌مانده:{" "}
                              {
                                formatCountdown(
                                  certificateSecondsLeft
                                )
                              }
                            </span>

                            <span className="text-[9px] font-bold text-slate-400">
                              تا{" "}
                              {
                                formatDateTime(
                                  validationGate
                                    .expiresAt
                                )
                              }
                            </span>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    disabled={
                      validationRunning
                    }
                    onClick={() =>
                      void runValidation()
                    }
                    className="min-h-10 shrink-0 rounded-xl bg-indigo-700 px-4 py-2 text-xs font-black text-white transition hover:bg-indigo-800 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {validationRunning
                      ? "در حال Validation..."
                      : "اجرای Validation شواهد"}
                  </button>
                </div>

                {validationSummary.completed >
                  0 ||
                validationSummary.errors >
                  0 ? (
                  <div className="mt-4 grid gap-2 sm:grid-cols-4">
                    <ValidationMetric
                      label="Accuracy"
                      value={
                        validationSummary.completed >
                        0
                          ? percent(
                              validationSummary
                                .accuracy *
                                100
                            )
                          : "—"
                      }
                    />

                    <ValidationMetric
                      label="Pass"
                      value={
                        number(
                          validationSummary
                            .passed
                        )
                      }
                    />

                    <ValidationMetric
                      label="Fail"
                      value={
                        number(
                          validationSummary
                            .failed
                        )
                      }
                    />

                    <ValidationMetric
                      label="Error"
                      value={
                        number(
                          validationSummary
                            .errors
                        )
                      }
                    />
                  </div>
                ) : null}

                {freshValidationSummary.tested >
                0 ? (
                  <div className="mt-4 rounded-2xl border border-cyan-200 bg-cyan-50/80 p-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-[10px] font-black text-cyan-900">
                          Human Review جدید بعد از Baseline
                        </p>

                        <p className="mt-1 text-[9px] leading-5 text-cyan-700">
                          این Evidenceها داخل Shared Baseline قبلی نبودند و برای جلوگیری از Blind Spot در همان Validation سرور تست شده‌اند.
                        </p>
                      </div>

                      <span
                        className={
                          freshValidationSummary.failed >
                            0 ||
                          freshValidationSummary.errors >
                            0
                            ? "rounded-full bg-rose-100 px-2.5 py-1 text-[10px] font-black text-rose-700"
                            : "rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-black text-emerald-700"
                        }
                      >
                        {freshValidationSummary.failed >
                          0 ||
                        freshValidationSummary.errors >
                          0
                          ? "Fresh Evidence نیازمند اصلاح"
                          : "Fresh Evidence PASS"}
                      </span>
                    </div>

                    <div className="mt-3 grid gap-2 sm:grid-cols-4">
                      <ValidationMetric
                        label="Fresh Tested"
                        value={
                          number(
                            freshValidationSummary
                              .tested
                          )
                        }
                      />

                      <ValidationMetric
                        label="Fresh Pass"
                        value={
                          number(
                            freshValidationSummary
                              .passed
                          )
                        }
                      />

                      <ValidationMetric
                        label="Fresh Fail"
                        value={
                          number(
                            freshValidationSummary
                              .failed
                          )
                        }
                      />

                      <ValidationMetric
                        label="Fresh Error"
                        value={
                          number(
                            freshValidationSummary
                              .errors
                          )
                        }
                      />
                    </div>
                  </div>
                ) : null}

                {validationBaseline ? (
                  <div className="mt-4 rounded-2xl border border-white/80 bg-white/70 p-3">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <p className="text-[10px] font-black text-slate-700">
                          مقایسه با Baseline Validation
                        </p>

                        <p className="mt-1 text-[9px] leading-5 text-slate-400">
                          Baseline مشترک:{" "}
                          {
                            formatDateTime(
                              validationBaseline
                                .savedAt
                            )
                          }
                          {validationBaseline
                            .savedBy
                            .name
                            ? ` · ${validationBaseline.savedBy.name}`
                            : ""}
                        </p>
                      </div>

                      <button
                        type="button"
                        disabled={
                          validationRunning ||
                          baselineSaving
                        }
                        onClick={() =>
                          void clearValidationBaseline()
                        }
                        className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-[10px] font-black text-rose-700 transition hover:bg-rose-100 disabled:opacity-40"
                      >
                        حذف Baseline
                      </button>
                    </div>

                    <div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                      <ValidationMetric
                        label="Baseline"
                        value={
                          baselineComparison.compared >
                          0
                            ? percent(
                                baselineComparison
                                  .baselineAccuracy *
                                  100
                              )
                            : "—"
                        }
                      />

                      <ValidationMetric
                        label="Current"
                        value={
                          baselineComparison.compared >
                          0
                            ? percent(
                                baselineComparison
                                  .currentAccuracy *
                                  100
                              )
                            : "—"
                        }
                      />

                      <ValidationMetric
                        label="Delta"
                        value={
                          baselineComparison.compared >
                          0
                            ? signedPercent(
                                baselineComparison
                                  .delta *
                                  100
                              )
                            : "—"
                        }
                      />

                      <ValidationMetric
                        label="Improved"
                        value={
                          number(
                            baselineComparison
                              .improved
                          )
                        }
                      />

                      <ValidationMetric
                        label="Regressed"
                        value={
                          number(
                            baselineComparison
                              .regressed
                          )
                        }
                      />

                      <ValidationMetric
                        label="Prediction Changed"
                        value={
                          number(
                            baselineComparison
                              .changedPrediction
                          )
                        }
                      />
                    </div>

                    {baselineComparison.regressed >
                    0 ? (
                      <p className="mt-3 text-[10px] font-black leading-5 text-rose-700">
                        هشدار: حداقل یک Evidence که قبلاً PASS بوده اکنون FAIL شده است؛ قبل از انتشار تغییر بعدی Guidance این Regression را بررسی کن.
                      </p>
                    ) : baselineComparison.compared >
                        0 &&
                      baselineComparison.delta >
                        0 ? (
                      <p className="mt-3 text-[10px] font-black leading-5 text-emerald-700">
                        Validation نسبت به Baseline بهتر شده است.
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={
                      validationRunning ||
                      baselineLoading ||
                      baselineSaving ||
                      draftChanged ||
                      validationSummary.completed ===
                        0 ||
                      validationSummary.errors >
                        0
                    }
                    onClick={() =>
                      void saveValidationBaseline()
                    }
                    className="rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-[10px] font-black text-indigo-700 transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {baselineSaving
                      ? "در حال ذخیره..."
                      : validationBaseline
                        ? "جایگزینی Baseline مشترک"
                        : "ثبت Baseline مشترک"}
                  </button>

                  <span className="text-[9px] font-bold text-slate-400">
                    Baseline روی PocketBase ذخیره می‌شود و بین Adminها مشترک است.
                  </span>
                </div>

                {draftChanged &&
                validationBaseline &&
                baselineComparison.compared >
                  0 ? (
                  <p
                    className={
                      baselineComparison.regressed >
                      0
                        ? "mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[10px] font-black leading-5 text-rose-700"
                        : baselineComparison.delta >
                            0
                          ? "mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[10px] font-black leading-5 text-emerald-700"
                          : "mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-bold leading-5 text-slate-600"
                    }
                  >
                    {baselineComparison.regressed >
                    0
                      ? "Draft فعلی نسبت به Baseline منتشرشده Regression دارد؛ قبل از ذخیره Guidance آن را اصلاح کن."
                      : baselineComparison.delta >
                          0
                        ? "Draft فعلی روی Evidenceهای قابل مقایسه از Baseline بهتر است؛ بعد از بررسی Regression Suite می‌توانی آن را ذخیره کنی."
                        : "Draft فعلی با Baseline مقایسه شد؛ قبل از ذخیره، Failها و Prediction Changeها را بررسی کن."}
                  </p>
                ) : null}

                {validationNotice ? (
                  <p className="mt-3 text-[10px] font-bold leading-5 text-indigo-700">
                    {
                      validationNotice
                    }
                  </p>
                ) : null}

                {baselineNotice ? (
                  <p className="mt-2 text-[10px] font-bold leading-5 text-slate-600">
                    {
                      baselineNotice
                    }
                  </p>
                ) : null}
              </div>

              <EvidenceGroup
                title="مثبت‌های اصلاح‌شده"
                description="AI قبلاً این سؤال‌ها را به این Topic نداده، ولی Human Review آنها را متعلق به این Topic تشخیص داده است."
                tone="positive"
                items={
                  data.evidence
                    .positiveCorrections
                }
                existingKeys={
                  positiveKeys
                }
                actionLabel="افزودن به examples"
                validationItems={
                  validationItems
                }
                onAdd={
                  onAddPositive
                }
              />

              <EvidenceGroup
                title="منفی‌های اصلاح‌شده"
                description="AI قبلاً این Topic را انتخاب کرده، ولی Human Review نشان داده سؤال نباید در این Topic باشد."
                tone="negative"
                items={
                  data.evidence
                    .negativeCorrections
                }
                existingKeys={
                  negativeKeys
                }
                actionLabel="افزودن به negative_examples"
                validationItems={
                  validationItems
                }
                onAdd={
                  onAddNegative
                }
              />

              <EvidenceGroup
                title="مثبت‌های تأییدشده در Quality Audit"
                description="نمونه‌هایی که AI درست انتخاب کرده و Human Review هم آنها را تأیید کرده است؛ برای پوشش Intentهای واقعی مفیدند."
                tone="confirmed"
                items={
                  data.evidence
                    .confirmedPositive
                }
                existingKeys={
                  positiveKeys
                }
                actionLabel="افزودن به examples"
                validationItems={
                  validationItems
                }
                onAdd={
                  onAddPositive
                }
              />

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() =>
                    void load()
                  }
                  className="rounded-lg border border-sky-200 bg-white px-3 py-2 text-[10px] font-black text-sky-700 transition hover:bg-sky-50"
                >
                  تازه‌سازی شواهد
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-xl bg-white px-4 py-5 text-center text-xs font-bold leading-6 text-slate-400">
              هنوز Human Review کافی برای ساخت شواهد Guidance این Topic وجود ندارد.
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

function EvidenceGroup({
  title,
  description,
  tone,
  items,
  existingKeys,
  actionLabel,
  validationItems,
  onAdd,
}: {
  title:
    string;

  description:
    string;

  tone:
    "positive" |
    "negative" |
    "confirmed";

  items:
    EvidenceItem[];

  existingKeys:
    Set<
      string
    >;

  actionLabel:
    string;

  validationItems:
    Record<
      string,
      EvidenceValidationItem
    >;

  onAdd:
    (
      value:
        string
    ) => void;
}) {
  if (
    items.length ===
    0
  ) {
    return null;
  }

  const presentation =
    tonePresentation(
      tone
    );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2.5 py-1 text-[10px] font-black ${presentation.badge}`}
        >
          {
            title
          }
        </span>

        <span className="text-[10px] font-bold text-slate-400">
          {
            number(
              items.length
            )
          }{" "}
          مورد
        </span>
      </div>

      <p className="mt-2 text-[10px] leading-5 text-slate-500">
        {
          description
        }
      </p>

      <div className="mt-2 space-y-2">
        {items.map(
          (
            item
          ) => {
            const key =
              normalizeLine(
                item.guidanceText
              );

            const alreadyAdded =
              Boolean(
                key
              ) &&
              existingKeys.has(
                key
              );

            const validation =
              validationItems[
                item.id
              ];

            return (
              <article
                key={
                  item.id
                }
                className={`rounded-xl border bg-white p-3 ${presentation.border}`}
              >
                <p className="whitespace-pre-wrap text-xs font-bold leading-6 text-slate-800">
                  {
                    item.content
                  }
                </p>

                <div className="mt-2 flex flex-wrap items-center gap-2 text-[9px] font-bold text-slate-400">
                  <span>
                    Confidence AI:{" "}
                    {
                      percent(
                        item
                          .originalConfidence *
                          100
                      )
                    }
                  </span>

                  <span>
                    •
                  </span>

                  <span>
                    {
                      item.reviewSource ===
                      "quality_sample"
                        ? "Quality Audit"
                        : "Focused Review"
                    }
                  </span>

                  {item.reviewedAt ? (
                    <>
                      <span>
                        •
                      </span>

                      <span>
                        {
                          formatDate(
                            item.reviewedAt
                          )
                        }
                      </span>
                    </>
                  ) : null}
                </div>

                {(item.originalTopicName ||
                  item.finalTopicName ||
                  item.originalStatus ===
                    "unclassified" ||
                  item.finalStatus ===
                    "unclassified") ? (
                  <p className="mt-2 text-[9px] font-bold leading-5 text-slate-500">
                    AI:{" "}
                    <span className="text-rose-700">
                      {
                        item.originalTopicName ||
                        statusLabel(
                          item.originalStatus
                        )
                      }
                    </span>
                    {" → "}
                    Human:{" "}
                    <span className="text-emerald-700">
                      {
                        item.finalTopicName ||
                        statusLabel(
                          item.finalStatus
                        )
                      }
                    </span>
                  </p>
                ) : null}

                {validation ? (
                  <EvidenceValidationResult
                    validation={
                      validation
                    }
                  />
                ) : null}

                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    disabled={
                      alreadyAdded
                    }
                    onClick={() =>
                      onAdd(
                        item.guidanceText
                      )
                    }
                    className={
                      alreadyAdded
                        ? "rounded-lg bg-slate-100 px-3 py-1.5 text-[10px] font-black text-slate-400"
                        : `rounded-lg px-3 py-1.5 text-[10px] font-black transition ${presentation.button}`
                    }
                  >
                    {alreadyAdded
                      ? "قبلاً اضافه شده"
                      : actionLabel}
                  </button>
                </div>
              </article>
            );
          }
        )}
      </div>
    </div>
  );
}

function EvidenceValidationResult({
  validation,
}: {
  validation:
    EvidenceValidationItem;
}) {
  if (
    validation.status ===
    "running"
  ) {
    return (
      <div className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-[10px] font-black text-blue-700">
        در حال تست...
      </div>
    );
  }

  if (
    validation.status ===
    "error"
  ) {
    return (
      <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[10px] font-bold leading-5 text-amber-700">
        ERROR
        {validation.error
          ? ` · ${validation.error}`
          : ""}
      </div>
    );
  }

  if (
    validation.status ===
      "passed" ||
    validation.status ===
      "failed"
  ) {
    const passed =
      validation.status ===
      "passed";

    const result =
      validation.result;

    return (
      <div
        className={
          passed
            ? "mt-3 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2"
            : "mt-3 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2"
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span
            className={
              passed
                ? "text-[10px] font-black text-emerald-700"
                : "text-[10px] font-black text-rose-700"
            }
          >
            {passed
              ? "PASS"
              : "FAIL"}
          </span>

          {result ? (
            <span className="text-[9px] font-bold text-slate-500">
              Confidence:{" "}
              {
                percent(
                  result.confidence *
                  100
                )
              }
            </span>
          ) : null}
        </div>

        {result ? (
          <p className="mt-1 text-[9px] font-bold leading-5 text-slate-500">
            نتیجه فعلی:{" "}
            <span className="font-black text-slate-700">
              {
                result.topicName ||
                result.suggestedTopicName ||
                "Unclassified"
              }
            </span>
          </p>
        ) : null}
      </div>
    );
  }

  return null;
}

function ValidationMetric({
  label,
  value,
}: {
  label:
    string;

  value:
    string;
}) {
  return (
    <div className="rounded-xl bg-white px-3 py-2.5">
      <p className="text-[9px] font-bold text-slate-400">
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

async function requestClassification(
  question:
    string,

  topicOverride: {
    topicId:
      string;

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

            context:
              [],

            topicOverride,
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
        "اجرای تست Classification ناموفق بود."
      )
    );
  }

  return body.result;
}

function tonePresentation(
  tone:
    "positive" |
    "negative" |
    "confirmed"
) {
  if (
    tone ===
    "negative"
  ) {
    return {
      badge:
        "bg-rose-100 text-rose-700",

      border:
        "border-rose-100",

      button:
        "bg-rose-700 text-white hover:bg-rose-800",
    };
  }

  if (
    tone ===
    "confirmed"
  ) {
    return {
      badge:
        "bg-emerald-100 text-emerald-700",

      border:
        "border-emerald-100",

      button:
        "bg-emerald-700 text-white hover:bg-emerald-800",
    };
  }

  return {
    badge:
      "bg-violet-100 text-violet-700",

    border:
      "border-violet-100",

    button:
      "bg-violet-700 text-white hover:bg-violet-800",
  };
}

function guidanceLineSet(
  value:
    string
) {
  return new Set(
    value
      .replace(
        /\r\n?/g,
        "\n"
      )
      .split(
        "\n"
      )
      .map(
        normalizeLine
      )
      .filter(
        Boolean
      )
  );
}

function normalizeLine(
  value:
    string
) {
  return value
    .trim()
    .replace(
      /\s+/g,
      " "
    )
    .toLocaleLowerCase(
      "fa"
    );
}

function statusLabel(
  value:
    string
) {
  return value ===
      "unclassified"
      ? "Unclassified"
      : value ===
          "error"
        ? "Error"
        : value ===
            "pending"
          ? "Pending"
          : value ||
            "نامشخص";
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

function guidanceFingerprint({
  topicId,
  keywords,
  examples,
  negativeExamples,
  classificationNote,
}: {
  topicId:
    string;

  keywords:
    string;

  examples:
    string;

  negativeExamples:
    string;

  classificationNote:
    string;
}) {
  return JSON.stringify({
    topicId:
      topicId.trim(),

    keywords:
      normalizeGuidanceFingerprintText(
        keywords
      ),

    examples:
      normalizeGuidanceFingerprintText(
        examples
      ),

    negativeExamples:
      normalizeGuidanceFingerprintText(
        negativeExamples
      ),

    classificationNote:
      normalizeGuidanceFingerprintText(
        classificationNote
      ),
  });
}

function normalizeGuidanceFingerprintText(
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
        line
          .trim()
          .replace(
            /\s+/g,
            " "
          )
    )
    .filter(
      Boolean
    )
    .join(
      "\n"
    );
}

function formatCountdown(
  seconds:
    number
) {
  const safeSeconds =
    Math.max(
      0,
      Math.trunc(
        seconds
      )
    );

  const minutes =
    Math.floor(
      safeSeconds /
      60
    );

  const remainder =
    safeSeconds %
    60;

  return `${new Intl.NumberFormat(
    "fa-IR",
    {
      minimumIntegerDigits:
        2,
      useGrouping:
        false,
    }
  ).format(
    minutes
  )}:${new Intl.NumberFormat(
    "fa-IR",
    {
      minimumIntegerDigits:
        2,
      useGrouping:
        false,
    }
  ).format(
    remainder
  )}`;
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

function formatDateTime(
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

function formatDate(
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
    }
  ).format(
    date
  );
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
