"use client";

import Link from "next/link";

import {
  useEffect,
  useState,
} from "react";

type ReviewRange =
  | "7d"
  | "30d"
  | "90d"
  | "all";

type Dashboard = {
  range: {
    value:
      ReviewRange;

    label:
      string;
  };

  kpis: {
    reviewed:
      number;

    correct:
      number;

    corrected:
      number;

    accuracy:
      number;

    correctionRate:
      number;

    missedFromUnclassified:
      number;

    falsePositive:
      number;

    topicToTopic:
      number;

    qualitySampleReviewed:
      number;

    qualitySampleCorrect:
      number;

    qualitySampleAccuracy:
      number;

    focusedReviewed:
      number;

    focusedCorrectionRate:
      number;

    averageOriginalConfidence:
      number;

    averageCorrectConfidence:
      number;

    averageCorrectedConfidence:
      number;
  };

  calibration: {
    eligibleReviewedClassified:
      number;

    currentThreshold:
      number;

    current: {
      threshold:
        number;

      accepted:
        number;

      correctAccepted:
        number;

      wrongAccepted:
        number;

      precision:
        number;

      coverage:
        number;
    };

    recommendation: {
      available:
        boolean;

      reason:
        string;

      threshold:
        number |
        null;

      precision:
        number;

      coverage:
        number;

      accepted:
        number;

      wrongAccepted:
        number;
    };

    points:
      Array<{
        threshold:
          number;

        accepted:
          number;

        correctAccepted:
          number;

        wrongAccepted:
          number;

        precision:
          number;

        coverage:
          number;
      }>;
  };

  confusionPairs:
    Array<{
      fromTopicId:
        string |
        null;

      fromLabel:
        string;

      toTopicId:
        string |
        null;

      toLabel:
        string;

      count:
        number;
    }>;

  guidancePriorities:
    Array<{
      topicId:
        string;

      topicName:
        string;

      topicCode:
        string;

      priority:
        "critical" |
        "high" |
        "medium" |
        "low";

      issueCount:
        number;

      predictedReviewed:
        number;

      predictedWrong:
        number;

      predictedAccuracy:
        number |
        null;

      qualitySampleReviewed:
        number;

      qualityAuditAccuracy:
        number |
        null;

      falsePositive:
        number;

      outgoingTopicConfusions:
        number;

      incomingTopicConfusions:
        number;

      missedFromUnclassified:
        number;

      topOutgoing:
        | {
            label:
              string;

            count:
              number;
          }
        | null;

      topIncoming:
        | {
            label:
              string;

            count:
              number;
          }
        | null;

      actions:
        string[];
    }>;

  perTopic:
    Array<{
      topicId:
        string;

      topicName:
        string;

      topicCode:
        string;

      reviewed:
        number;

      correct:
        number;

      corrected:
        number;

      missedFromUnclassified:
        number;

      accuracy:
        number;
    }>;
};

type ApiResponse =
  | {
      success:
        true;

      dashboard:
        Dashboard;

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

export default function ClassificationReviewInsights() {
  const [
    range,
    setRange,
  ] =
    useState<ReviewRange>(
      "30d"
    );

  const [
    dashboard,
    setDashboard,
  ] =
    useState<Dashboard | null>(
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

  useEffect(() => {
    let cancelled =
      false;

    async function load() {
      setLoading(
        true
      );

      setError(
        ""
      );

      try {
        const params =
          new URLSearchParams({
            range,
          });

        const response =
          await fetch(
            `/api/admin/topics/classification-review/analytics?${params.toString()}`,
            {
              cache:
                "no-store",
            }
          );

        const body =
          (await safeJson(
            response
          )) as
            ApiResponse |
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
              "دریافت تحلیل کیفیت Classification ناموفق بود."
            )
          );
        }

        if (
          !cancelled
        ) {
          setDashboard(
            body.dashboard
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
              : "دریافت تحلیل کیفیت Classification ناموفق بود."
          );
        }
      } finally {
        if (
          !cancelled
        ) {
          setLoading(
            false
          );
        }
      }
    }

    void load();

    return () => {
      cancelled =
        true;
    };
  }, [
    range,
  ]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-black text-slate-700">
            کیفیت AI در برابر Human Review
          </p>

          <p className="mt-1 text-[10px] leading-5 text-slate-400">
            فقط پیام‌هایی محاسبه می‌شوند که مدیر نتیجه Classification آنها را تأیید یا اصلاح کرده است.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {(
            [
              [
                "7d",
                "۷ روز",
              ],
              [
                "30d",
                "۳۰ روز",
              ],
              [
                "90d",
                "۹۰ روز",
              ],
              [
                "all",
                "همه",
              ],
            ] as const
          ).map(
            (
              [
                value,
                label,
              ]
            ) => (
              <button
                key={
                  value
                }
                type="button"
                onClick={() =>
                  setRange(
                    value
                  )
                }
                className={
                  range ===
                    value
                    ? "rounded-xl bg-slate-950 px-3 py-2 text-xs font-black text-white"
                    : "rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 transition hover:bg-slate-50"
                }
              >
                {
                  label
                }
              </button>
            )
          )}
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold leading-7 text-rose-700">
          {
            error
          }
        </div>
      ) : null}

      {loading &&
      !dashboard ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({
            length:
              8,
          }).map(
            (
              _,
              index
            ) => (
              <div
                key={
                  index
                }
                className="h-24 animate-pulse rounded-2xl bg-slate-100"
              />
            )
          )}
        </div>
      ) : dashboard ? (
        <>
          <section className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-xs font-black text-emerald-800">
                  Quality Audit — Precision Accepted Predictions
                </p>

                <p className="mt-1 max-w-3xl text-[10px] leading-5 text-emerald-700">
                  این شاخص فقط از پیام‌هایی می‌آید که عمداً از بین Classificationهای Accepted برای کنترل کیفیت انسانی انتخاب شده‌اند؛ بنابراین برای تخمین Precision واقعی سیستم قابل اتکاتر از صف خطا/Low Confidence است.
                </p>
              </div>

              <span className="rounded-xl bg-white px-3 py-2 text-xs font-black text-emerald-700">
                Support:{" "}
                {
                  number(
                    dashboard.kpis
                      .qualitySampleReviewed
                  )
                }
              </span>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Metric
                label="Quality Audit Accuracy"
                value={
                  dashboard.kpis
                    .qualitySampleReviewed >
                  0
                    ? percent(
                        dashboard.kpis
                          .qualitySampleAccuracy *
                          100
                      )
                    : "—"
                }
                tone={
                  dashboard.kpis
                    .qualitySampleReviewed ===
                  0
                    ? "neutral"
                    : dashboard.kpis
                          .qualitySampleAccuracy >=
                        0.9
                      ? "success"
                      : dashboard.kpis
                            .qualitySampleAccuracy >=
                          0.8
                        ? "warning"
                        : "danger"
                }
              />

              <Metric
                label="Quality Audit صحیح"
                value={
                  number(
                    dashboard.kpis
                      .qualitySampleCorrect
                  )
                }
              />

              <Metric
                label="Focused Review Correction"
                value={
                  dashboard.kpis
                    .focusedReviewed >
                  0
                    ? percent(
                        dashboard.kpis
                          .focusedCorrectionRate *
                          100
                      )
                    : "—"
                }
              />
            </div>

            {dashboard.kpis
              .qualitySampleReviewed <
            20 ? (
              <p className="mt-3 text-[10px] font-bold leading-5 text-amber-700">
                برای تصمیم مهم درباره Threshold یا Prompt بهتر است حداقل حدود ۲۰ نمونه Quality Audit بررسی شود.
              </p>
            ) : null}
          </section>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric
              label="پیام بررسی‌شده"
              value={
                number(
                  dashboard.kpis
                    .reviewed
                )
              }
            />

            <Metric
              label="Accuracy AI"
              value={
                percent(
                  dashboard.kpis
                    .accuracy *
                    100
                )
              }
              tone={
                dashboard.kpis
                  .accuracy >=
                0.85
                  ? "success"
                  : dashboard.kpis
                        .accuracy >=
                      0.7
                    ? "warning"
                    : "danger"
              }
            />

            <Metric
              label="نرخ اصلاح انسانی"
              value={
                percent(
                  dashboard.kpis
                    .correctionRate *
                    100
                )
              }
            />

            <Metric
              label="اصلاح‌شده"
              value={
                number(
                  dashboard.kpis
                    .corrected
                )
              }
            />

            <Metric
              label="Miss از Unclassified"
              value={
                number(
                  dashboard.kpis
                    .missedFromUnclassified
                )
              }
            />

            <Metric
              label="False Positive"
              value={
                number(
                  dashboard.kpis
                    .falsePositive
                )
              }
            />

            <Metric
              label="Topic → Topic"
              value={
                number(
                  dashboard.kpis
                    .topicToTopic
                )
              }
            />

            <Metric
              label="Confidence اولیه"
              value={
                percent(
                  dashboard.kpis
                    .averageOriginalConfidence *
                    100
                )
              }
            />
          </div>

          <ThresholdCalibration
            calibration={
              dashboard.calibration
            }
          />

          <div className="grid gap-5 xl:grid-cols-2">
            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-black text-slate-900">
                    پرتکرارترین Confusionها
                  </h3>

                  <p className="mt-1 text-[10px] leading-5 text-slate-400">
                    مسیرهایی که AI بیشتر نیاز به اصلاح انسانی داشته است.
                  </p>
                </div>
              </div>

              {dashboard
                .confusionPairs
                .length >
              0 ? (
                <div className="mt-4 space-y-2">
                  {dashboard.confusionPairs.map(
                    (
                      item,
                      index
                    ) => (
                      <div
                        key={`${item.fromLabel}-${item.toLabel}-${index}`}
                        className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-3"
                      >
                        <div className="min-w-0 text-xs font-black text-slate-700">
                          <span className="text-rose-700">
                            {
                              item.fromLabel
                            }
                          </span>

                          <span className="mx-2 text-slate-300">
                            ←
                          </span>

                          <span className="text-emerald-700">
                            {
                              item.toLabel
                            }
                          </span>
                        </div>

                        <span className="shrink-0 rounded-lg bg-white px-2 py-1 text-xs font-black text-slate-600">
                          {
                            number(
                              item.count
                            )
                          }
                        </span>
                      </div>
                    )
                  )}
                </div>
              ) : (
                <Empty text="هنوز Confusion اصلاح‌شده‌ای برای این بازه ثبت نشده است." />
              )}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <h3 className="text-sm font-black text-slate-900">
                Confidence: درست در برابر اصلاح‌شده
              </h3>

              <p className="mt-1 text-[10px] leading-5 text-slate-400">
                اگر Confidence موارد اشتباه بالا باشد، Threshold به‌تنهایی مشکل را حل نمی‌کند و Guidance/Prompt باید اصلاح شود.
              </p>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Metric
                  label="میانگین Confidence صحیح"
                  value={
                    percent(
                      dashboard.kpis
                        .averageCorrectConfidence *
                        100
                    )
                  }
                  tone="success"
                />

                <Metric
                  label="میانگین Confidence اصلاح‌شده"
                  value={
                    percent(
                      dashboard.kpis
                        .averageCorrectedConfidence *
                        100
                    )
                  }
                  tone="danger"
                />
              </div>

              <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs font-bold leading-6 text-blue-800">
                بازه فعلی:{" "}
                {
                  dashboard.range
                    .label
                }
              </div>
            </section>
          </div>

          <section className="rounded-2xl border border-violet-200 bg-violet-50/30 p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h3 className="text-sm font-black text-violet-900">
                  اولویت اصلاح Guidance
                </h3>

                <p className="mt-1 max-w-3xl text-[10px] leading-5 text-violet-700">
                  این پیشنهادها از Human Review، Confusionها، Missهای Unclassified و Quality Audit ساخته می‌شوند. هدف این است که قبل از دستکاری Threshold بدانیم کدام Topic و کدام بخش Guidance نیاز به اصلاح دارد.
                </p>
              </div>

              <span className="rounded-xl bg-white px-3 py-2 text-xs font-black text-violet-700">
                {
                  number(
                    dashboard
                      .guidancePriorities
                      .length
                  )
                }{" "}
                Topic نیازمند توجه
              </span>
            </div>

            {dashboard
              .guidancePriorities
              .length >
            0 ? (
              <div className="mt-4 grid gap-3 xl:grid-cols-2">
                {dashboard.guidancePriorities.map(
                  (
                    item
                  ) => (
                    <GuidancePriorityCard
                      key={
                        item.topicId
                      }
                      item={
                        item
                      }
                    />
                  )
                )}
              </div>
            ) : (
              <Empty text="در این بازه سیگنال کافی برای پیشنهاد اصلاح Guidance دیده نشد." />
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <h3 className="text-sm font-black text-slate-900">
              کیفیت به تفکیک Topic نهایی
            </h3>

            <p className="mt-1 text-[10px] leading-5 text-slate-400">
              Topicهایی با Support بیشتر و Accuracy پایین‌تر بهترین اولویت برای اصلاح Guidance هستند.
            </p>

            {dashboard.perTopic
              .length >
            0 ? (
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-[760px] w-full text-right text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50 text-slate-400">
                      <th className="px-3 py-3">
                        Topic
                      </th>

                      <th className="px-3 py-3">
                        بررسی‌شده
                      </th>

                      <th className="px-3 py-3">
                        Accuracy
                      </th>

                      <th className="px-3 py-3">
                        اصلاح
                      </th>

                      <th className="px-3 py-3">
                        Miss از Unclassified
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {dashboard.perTopic.map(
                      (
                        topic
                      ) => (
                        <tr
                          key={
                            topic.topicId
                          }
                          className="border-b border-slate-100 last:border-b-0"
                        >
                          <td className="px-3 py-3">
                            <p className="font-black text-slate-800">
                              {
                                topic.topicName
                              }
                            </p>

                            <code
                              dir="ltr"
                              className="mt-1 block text-[10px] text-slate-400"
                            >
                              {
                                topic.topicCode
                              }
                            </code>
                          </td>

                          <td className="px-3 py-3 font-black text-slate-700">
                            {
                              number(
                                topic.reviewed
                              )
                            }
                          </td>

                          <td className="px-3 py-3">
                            <span
                              className={
                                topic.accuracy >=
                                0.85
                                  ? "font-black text-emerald-700"
                                  : topic.accuracy >=
                                      0.7
                                    ? "font-black text-amber-700"
                                    : "font-black text-rose-700"
                              }
                            >
                              {
                                percent(
                                  topic.accuracy *
                                    100
                                )
                              }
                            </span>
                          </td>

                          <td className="px-3 py-3 font-black text-slate-700">
                            {
                              number(
                                topic.corrected
                              )
                            }
                          </td>

                          <td className="px-3 py-3 font-black text-slate-700">
                            {
                              number(
                                topic.missedFromUnclassified
                              )
                            }
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty text="داده Human Review کافی برای تحلیل Topicها وجود ندارد." />
            )}
          </section>
        </>
      ) : (
        <Empty text="هنوز داده‌ای برای تحلیل Human Review وجود ندارد." />
      )}
    </div>
  );
}

function ThresholdCalibration({
  calibration,
}: {
  calibration:
    Dashboard["calibration"];
}) {
  const recommendation =
    calibration.recommendation;

  const current =
    calibration.current;

  const recommendedThreshold =
    recommendation.threshold;

  const delta =
    recommendation.available &&
    recommendedThreshold !==
      null
      ? recommendedThreshold -
        calibration.currentThreshold
      : 0;

  return (
    <section className="rounded-2xl border border-violet-200 bg-violet-50/40 p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-black text-violet-800">
            Calibration پیشنهادی Threshold
          </p>

          <p className="mt-1 max-w-3xl text-[10px] leading-5 text-violet-700">
            این تحلیل فقط روی خروجی‌هایی انجام می‌شود که AI در ابتدا Classified کرده بود و نسبت Precision به Coverage را می‌سنجد. پیشنهاد به‌صورت خودکار ENV را تغییر نمی‌دهد.
          </p>
        </div>

        <span className="rounded-xl bg-white px-3 py-2 text-xs font-black text-violet-700">
          Support:{" "}
          {
            number(
              calibration
                .eligibleReviewedClassified
            )
          }
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Threshold فعلی"
          value={
            decimal(
              calibration
                .currentThreshold
            )
          }
        />

        <Metric
          label="Precision فعلی"
          value={
            percent(
              current.precision *
                100
            )
          }
        />

        <Metric
          label="Coverage فعلی"
          value={
            percent(
              current.coverage *
                100
            )
          }
        />

        <Metric
          label="Wrong Accepted فعلی"
          value={
            number(
              current
                .wrongAccepted
            )
          }
          tone={
            current.wrongAccepted >
            0
              ? "danger"
              : "success"
          }
        />
      </div>

      {recommendation.available &&
      recommendedThreshold !==
        null ? (
        <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-black text-emerald-800">
                Threshold پیشنهادی:{" "}
                <span
                  dir="ltr"
                  className="inline-block"
                >
                  {
                    decimal(
                      recommendedThreshold
                    )
                  }
                </span>
              </p>

              <p className="mt-1 text-[10px] leading-5 text-emerald-700">
                {recommendation.reason ===
                "target_precision"
                  ? "این نقطه حداقل ۹۰٪ Precision را با بیشترین Coverage موجود حفظ می‌کند."
                  : "داده فعلی به ۹۰٪ Precision نرسیده؛ بهترین نقطه موجود نمایش داده شده است."}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <CalibrationBadge
                label="Precision"
                value={
                  percent(
                    recommendation
                      .precision *
                      100
                  )
                }
              />

              <CalibrationBadge
                label="Coverage"
                value={
                  percent(
                    recommendation
                      .coverage *
                      100
                  )
                }
              />

              <CalibrationBadge
                label="Wrong"
                value={
                  number(
                    recommendation
                      .wrongAccepted
                  )
                }
              />

              <CalibrationBadge
                label="Δ Threshold"
                value={
                  signedDecimal(
                    delta
                  )
                }
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold leading-6 text-amber-800">
          برای پیشنهاد Threshold حداقل ۵ نمونه Human Reviewed که AI در ابتدا Classified کرده باشد لازم است.
        </div>
      )}

      {calibration.points.length >
      0 ? (
        <div className="mt-5 overflow-x-auto">
          <table className="min-w-[720px] w-full text-right text-xs">
            <thead>
              <tr className="border-b border-violet-100 text-violet-500">
                <th className="px-3 py-3">
                  Threshold
                </th>

                <th className="px-3 py-3">
                  Accepted
                </th>

                <th className="px-3 py-3">
                  Precision
                </th>

                <th className="px-3 py-3">
                  Coverage
                </th>

                <th className="px-3 py-3">
                  Wrong Accepted
                </th>
              </tr>
            </thead>

            <tbody>
              {calibration.points.map(
                (
                  point
                ) => {
                  const isCurrent =
                    Math.abs(
                      point.threshold -
                      calibration
                        .currentThreshold
                    ) <
                    0.0001;

                  const isRecommended =
                    recommendedThreshold !==
                      null &&
                    Math.abs(
                      point.threshold -
                      recommendedThreshold
                    ) <
                      0.0001;

                  return (
                    <tr
                      key={
                        point.threshold
                      }
                      className={
                        isRecommended
                          ? "border-b border-emerald-100 bg-emerald-50/70"
                          : isCurrent
                            ? "border-b border-blue-100 bg-blue-50/70"
                            : "border-b border-violet-100/70"
                      }
                    >
                      <td className="px-3 py-3 font-black text-slate-800">
                        {
                          decimal(
                            point.threshold
                          )
                        }

                        {isCurrent ? (
                          <span className="mr-2 rounded-full bg-blue-100 px-2 py-0.5 text-[9px] font-black text-blue-700">
                            فعلی
                          </span>
                        ) : null}

                        {isRecommended ? (
                          <span className="mr-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-black text-emerald-700">
                            پیشنهاد
                          </span>
                        ) : null}
                      </td>

                      <td className="px-3 py-3 font-black text-slate-700">
                        {
                          number(
                            point.accepted
                          )
                        }
                      </td>

                      <td className="px-3 py-3 font-black text-slate-700">
                        {
                          percent(
                            point.precision *
                              100
                          )
                        }
                      </td>

                      <td className="px-3 py-3 font-black text-slate-700">
                        {
                          percent(
                            point.coverage *
                              100
                          )
                        }
                      </td>

                      <td className="px-3 py-3 font-black text-rose-700">
                        {
                          number(
                            point.wrongAccepted
                          )
                        }
                      </td>
                    </tr>
                  );
                }
              )}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function CalibrationBadge({
  label,
  value,
}: {
  label:
    string;

  value:
    string;
}) {
  return (
    <span className="rounded-xl bg-white px-3 py-2 text-[10px] font-black text-emerald-700">
      {
        label
      }:{" "}
      {
        value
      }
    </span>
  );
}

function GuidancePriorityCard({
  item,
}: {
  item:
    Dashboard["guidancePriorities"][number];
}) {
  const priority =
    priorityPresentation(
      item.priority
    );

  return (
    <article className="rounded-2xl border border-violet-100 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2.5 py-1 text-[10px] font-black ${priority.className}`}
            >
              {
                priority.label
              }
            </span>

            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black text-slate-500">
              {
                number(
                  item.issueCount
                )
              }{" "}
              سیگنال خطا
            </span>
          </div>

          <h4 className="mt-3 text-sm font-black text-slate-900">
            {
              item.topicName
            }
          </h4>

          <code
            dir="ltr"
            className="mt-1 block text-[10px] text-slate-400"
          >
            {
              item.topicCode
            }
          </code>
        </div>

        {item.qualityAuditAccuracy !==
          null ? (
          <div className="shrink-0 text-left">
            <p className="text-lg font-black text-slate-900">
              {
                percent(
                  item
                    .qualityAuditAccuracy *
                    100
                )
              }
            </p>

            <p className="text-[9px] font-bold text-slate-400">
              Quality Audit
            </p>
          </div>
        ) : null}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MiniDiagnostic
          label="AI اشتباه"
          value={
            item.predictedWrong
          }
        />

        <MiniDiagnostic
          label="False Positive"
          value={
            item.falsePositive
          }
        />

        <MiniDiagnostic
          label="ورودی از Topic دیگر"
          value={
            item.incomingTopicConfusions
          }
        />

        <MiniDiagnostic
          label="Miss از Unclassified"
          value={
            item.missedFromUnclassified
          }
        />
      </div>

      {(item.topOutgoing ||
        item.topIncoming) ? (
        <div className="mt-3 space-y-1 rounded-xl bg-slate-50 px-3 py-2.5 text-[10px] font-bold leading-5 text-slate-600">
          {item.topOutgoing ? (
            <p>
              بیشترین خروج اشتباه:{" "}
              <span className="font-black text-rose-700">
                {
                  item.topOutgoing
                    .label
                }
              </span>
              {" · "}
              {
                number(
                  item.topOutgoing
                    .count
                )
              }
            </p>
          ) : null}

          {item.topIncoming ? (
            <p>
              بیشترین ورودی اصلاح‌شده:{" "}
              <span className="font-black text-emerald-700">
                {
                  item.topIncoming
                    .label
                }
              </span>
              {" · "}
              {
                number(
                  item.topIncoming
                    .count
                )
              }
            </p>
          ) : null}
        </div>
      ) : null}

      {item.actions.length >
      0 ? (
        <div className="mt-3 rounded-xl border border-violet-100 bg-violet-50/50 px-3 py-3">
          <p className="text-[10px] font-black text-violet-800">
            اقدام پیشنهادی
          </p>

          <ul className="mt-2 space-y-1.5">
            {item.actions.map(
              (
                action,
                index
              ) => (
                <li
                  key={
                    index
                  }
                  className="text-[10px] font-bold leading-5 text-violet-700"
                >
                  •{" "}
                  {
                    action
                  }
                </li>
              )
            )}
          </ul>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href={`/admin/topics?editTopic=${encodeURIComponent(
            item.topicId
          )}&focus=guidance`}
          className="inline-flex min-h-10 items-center justify-center rounded-xl bg-violet-700 px-4 py-2 text-xs font-black text-white transition hover:bg-violet-800"
        >
          ویرایش Guidance
        </Link>

        <span className="inline-flex min-h-10 items-center rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-bold leading-5 text-slate-500">
          بعد از اصلاح، Regression Suite را دوباره اجرا کن.
        </span>
      </div>
    </article>
  );
}

function MiniDiagnostic({
  label,
  value,
}: {
  label:
    string;

  value:
    number;
}) {
  return (
    <div className="rounded-xl bg-slate-50 px-2.5 py-2">
      <p className="text-[9px] font-bold text-slate-400">
        {
          label
        }
      </p>

      <p className="mt-1 text-sm font-black text-slate-800">
        {
          number(
            value
          )
        }
      </p>
    </div>
  );
}

function priorityPresentation(
  value:
    "critical" |
    "high" |
    "medium" |
    "low"
) {
  if (
    value ===
    "critical"
  ) {
    return {
      label:
        "بحرانی",

      className:
        "bg-rose-100 text-rose-700",
    };
  }

  if (
    value ===
    "high"
  ) {
    return {
      label:
        "بالا",

      className:
        "bg-orange-100 text-orange-700",
    };
  }

  if (
    value ===
    "medium"
  ) {
    return {
      label:
        "متوسط",

      className:
        "bg-amber-100 text-amber-700",
    };
  }

  return {
    label:
      "پایین",

    className:
      "bg-slate-100 text-slate-600",
  };
}

function Metric({
  label,
  value,
  tone =
    "neutral",
}: {
  label:
    string;

  value:
    string;

  tone?:
    "neutral" |
    "success" |
    "warning" |
    "danger";
}) {
  const className =
    tone ===
      "success"
      ? "border-emerald-200 bg-emerald-50"
      : tone ===
          "warning"
        ? "border-amber-200 bg-amber-50"
        : tone ===
            "danger"
          ? "border-rose-200 bg-rose-50"
          : "border-slate-200 bg-white";

  return (
    <div
      className={`rounded-2xl border p-4 ${className}`}
    >
      <p className="text-[10px] font-bold text-slate-400">
        {
          label
        }
      </p>

      <p className="mt-2 text-xl font-black text-slate-900">
        {
          value
        }
      </p>
    </div>
  );
}

function Empty({
  text,
}: {
  text:
    string;
}) {
  return (
    <div className="mt-4 rounded-xl bg-slate-50 px-4 py-6 text-center text-xs font-bold leading-6 text-slate-400">
      {
        text
      }
    </div>
  );
}

function decimal(
  value:
    number
) {
  return new Intl.NumberFormat(
    "fa-IR",
    {
      minimumFractionDigits:
        2,

      maximumFractionDigits:
        2,
    }
  ).format(
    value
  );
}

function signedDecimal(
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
      minimumFractionDigits:
        2,

      maximumFractionDigits:
        2,
    }
  ).format(
    value
  )}`;
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
