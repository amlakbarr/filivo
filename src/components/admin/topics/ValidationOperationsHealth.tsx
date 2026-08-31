"use client";

import {
  useCallback,
  useEffect,
  useState,
} from "react";

type CollectionCheck = {
  available:
    boolean;

  total:
    number;

  errorCode:
    string |
    null;
};

type HealthResponse =
  | {
      success:
        true;

      health: {
        status:
          "healthy" |
          "warning" |
          "critical";

        issues:
          Array<{
            severity:
              "critical" |
              "warning";

            code:
              string;

            message:
              string;
          }>;
      };

      config: {
        guidanceValidationTokenSecret:
          boolean;

        cronSecret:
          boolean;

        cleanupPath:
          string;

        expectedCleanupSchedule:
          string;

        expectedCleanupTimezone:
          string;
      };

      collections: {
        topics:
          CollectionCheck;

        baselines:
          CollectionCheck;

        validationUses:
          CollectionCheck;

        guidanceVersions:
          CollectionCheck;
      };

      metrics: {
        totalTopics:
          number;

        activeTopics:
          number;

        sharedBaselines:
          number;

        baselineCoverage:
          number;

        validationUseLocks:
          number;

        activeValidationUseLocks:
          number;

        expiredValidationUseLocks:
          number;

        guidanceVersions:
          number;

        latestValidationUseAt:
          string;

        latestBaselineSavedAt:
          string;

        oldestExpiredUseAt:
          string;

        oldestExpiredAgeHours:
          number |
          null;
      };

      generatedAt:
        string;

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

type CleanupResponse =
  | {
      success:
        true;

      status:
        "complete" |
        "partial" |
        "more_remaining";

      batches:
        number;

      matched:
        number;

      deleted:
        number;

      alreadyGone:
        number;

      failed:
        number;

      hasMore:
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

export default function ValidationOperationsHealth() {
  const [
    open,
    setOpen,
  ] =
    useState(false);

  const [
    loading,
    setLoading,
  ] =
    useState(false);

  const [
    data,
    setData,
  ] =
    useState<
      Extract<
        HealthResponse,
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
    error,
    setError,
  ] =
    useState("");

  const [
    cleaning,
    setCleaning,
  ] =
    useState(false);

  const [
    cleanupNotice,
    setCleanupNotice,
  ] =
    useState<{
      type:
        "success" |
        "error" |
        "warning";

      text:
        string;
    } | null>(
      null
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
              "/api/admin/topics/validation-operations",
              {
                cache:
                  "no-store",
              }
            );

          const body =
            (await safeJson(
              response
            )) as
              HealthResponse |
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
                "دریافت سلامت زیرساخت Validation ناموفق بود."
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
              : "دریافت سلامت زیرساخت Validation ناموفق بود."
          );
        } finally {
          setLoading(
            false
          );
        }
      },
      []
    );

  useEffect(() => {
    if (
      !open
    ) {
      return;
    }

    void load();
  }, [
    open,
    load,
  ]);

  async function runManualCleanup() {
    if (
      cleaning
    ) {
      return;
    }

    const expired =
      data?.metrics
        .expiredValidationUseLocks ||
      0;

    if (
      expired <=
      0
    ) {
      setCleanupNotice({
        type:
          "success",

        text:
          "رکورد منقضی برای Cleanup وجود ندارد.",
      });

      return;
    }

    const confirmed =
      window.confirm(
        `پاکسازی ${expired} رکورد منقضی Validation اجرا شود؟\n\nفقط Replay Lockهای منقضی حذف می‌شوند و Audit Logها باقی می‌مانند.`
      );

    if (
      !confirmed
    ) {
      return;
    }

    setCleaning(
      true
    );

    setCleanupNotice(
      null
    );

    try {
      const response =
        await fetch(
          "/api/admin/topics/validation-operations/cleanup",
          {
            method:
              "POST",
          }
        );

      const body =
        (await safeJson(
          response
        )) as
          CleanupResponse |
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
            "پاکسازی دستی Validation ناموفق بود."
          )
        );
      }

      setCleanupNotice({
        type:
          body.failed >
            0
            ? "warning"
            : "success",

        text:
          body.failed >
            0
            ? `Cleanup ناقص بود: ${number(
                body.deleted
              )} حذف، ${number(
                body.failed
              )} خطا.`
            : body.hasMore
              ? `${number(
                  body.deleted
                )} رکورد حذف شد؛ هنوز Backlog باقی مانده و می‌توان Cleanup را دوباره اجرا کرد.`
              : `${number(
                  body.deleted
                )} رکورد منقضی با موفقیت پاک شد.`,
      });

      await load();
    } catch (reason) {
      setCleanupNotice({
        type:
          "error",

        text:
          reason instanceof
            Error
            ? reason.message
            : "پاکسازی دستی Validation ناموفق بود.",
      });
    } finally {
      setCleaning(
        false
      );
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() =>
          setOpen(
            true
          )
        }
        className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-sky-200 bg-sky-50 px-5 py-3 text-sm font-black text-sky-800 transition hover:bg-sky-100"
      >
        سلامت Validation
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="validation-operations-title"
        >
          <div className="max-h-[90vh] w-full max-w-5xl overflow-auto rounded-3xl border border-slate-200 bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-100 bg-white/95 px-5 py-4 backdrop-blur sm:px-6">
              <div>
                <p className="text-xs font-black text-sky-700">
                  زیرساخت Guidance Validation
                </p>

                <h2
                  id="validation-operations-title"
                  className="mt-1 text-xl font-black text-slate-950"
                >
                  سلامت عملیاتی Validation
                </h2>

                <p className="mt-1 text-xs leading-6 text-slate-500">
                  وضعیت Secretها، Shared Baseline، Certificate Lockها، Version History و صف Cleanup را بدون نمایش اطلاعات حساس بررسی می‌کند.
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  setOpen(
                    false
                  )
                }
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 hover:bg-slate-50"
              >
                بستن
              </button>
            </div>

            <div className="space-y-5 p-5 sm:p-6">
              {error ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold leading-7 text-rose-700">
                  {
                    error
                  }

                  <button
                    type="button"
                    onClick={() =>
                      void load()
                    }
                    className="mr-3 rounded-lg bg-white px-3 py-1.5 text-[10px] font-black text-rose-700"
                  >
                    تلاش مجدد
                  </button>
                </div>
              ) : null}

              {cleanupNotice ? (
                <div
                  className={
                    cleanupNotice.type ===
                      "success"
                      ? "rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold leading-7 text-emerald-700"
                      : cleanupNotice.type ===
                          "warning"
                        ? "rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold leading-7 text-amber-700"
                        : "rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold leading-7 text-rose-700"
                  }
                >
                  {
                    cleanupNotice.text
                  }
                </div>
              ) : null}

              {loading &&
              !data ? (
                <LoadingState />
              ) : data ? (
                <>
                  <HealthBanner
                    status={
                      data.health
                        .status
                    }
                    issues={
                      data.health
                        .issues
                    }
                  />

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Metric
                      label="Topic فعال"
                      value={
                        number(
                          data.metrics
                            .activeTopics
                        )
                      }
                      helper={`از ${number(
                        data.metrics
                          .totalTopics
                      )} Topic`}
                    />

                    <Metric
                      label="Shared Baseline"
                      value={
                        number(
                          data.metrics
                            .sharedBaselines
                        )
                      }
                      helper={`پوشش ${percent(
                        data.metrics
                          .baselineCoverage *
                          100
                      )}`}
                    />

                    <Metric
                      label="Lock فعال"
                      value={
                        number(
                          data.metrics
                            .activeValidationUseLocks
                        )
                      }
                      helper="Certificateهای مصرف‌شده و هنوز منقضی‌نشده"
                    />

                    <Metric
                      label="منتظر Cleanup"
                      value={
                        number(
                          data.metrics
                            .expiredValidationUseLocks
                        )
                      }
                      helper={
                        data.metrics
                          .oldestExpiredAgeHours !==
                        null
                          ? `قدیمی‌ترین: ${number(
                              Math.floor(
                                data.metrics
                                  .oldestExpiredAgeHours
                              )
                            )} ساعت`
                          : "رکورد منقضی وجود ندارد"
                      }
                    />
                  </div>

                  <section className="rounded-2xl border border-slate-200 p-4">
                    <h3 className="text-sm font-black text-slate-900">
                      تنظیمات امنیتی
                    </h3>

                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <StatusRow
                        label="GUIDANCE_VALIDATION_TOKEN_SECRET"
                        ok={
                          data.config
                            .guidanceValidationTokenSecret
                        }
                        successText="تنظیم شده"
                        failureText="تنظیم نشده / کوتاه"
                      />

                      <StatusRow
                        label="CRON_SECRET"
                        ok={
                          data.config
                            .cronSecret
                        }
                        successText="تنظیم شده"
                        failureText="تنظیم نشده / کوتاه"
                      />
                    </div>
                  </section>

                  <section className="rounded-2xl border border-slate-200 p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h3 className="text-sm font-black text-slate-900">
                          Collectionهای عملیاتی
                        </h3>

                        <p className="mt-1 text-[10px] leading-5 text-slate-500">
                          نبودن هر Collection موردنیاز می‌تواند Validation، Rollback یا Replay Protection را مختل کند.
                        </p>
                      </div>

                      <button
                        type="button"
                        disabled={
                          loading
                        }
                        onClick={() =>
                          void load()
                        }
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                      >
                        {loading
                          ? "در حال بررسی..."
                          : "تازه‌سازی"}
                      </button>
                    </div>

                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <CollectionRow
                        name="topics"
                        state={
                          data.collections
                            .topics
                        }
                      />

                      <CollectionRow
                        name="topic_validation_baselines"
                        state={
                          data.collections
                            .baselines
                        }
                      />

                      <CollectionRow
                        name="topic_guidance_validation_uses"
                        state={
                          data.collections
                            .validationUses
                        }
                      />

                      <CollectionRow
                        name="topic_guidance_versions"
                        state={
                          data.collections
                            .guidanceVersions
                        }
                      />
                    </div>
                  </section>

                  <section className="rounded-2xl border border-slate-200 p-4">
                    <h3 className="text-sm font-black text-slate-900">
                      فعالیت اخیر
                    </h3>

                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      <DateMetric
                        label="آخرین مصرف Certificate"
                        value={
                          data.metrics
                            .latestValidationUseAt
                        }
                      />

                      <DateMetric
                        label="آخرین Shared Baseline"
                        value={
                          data.metrics
                            .latestBaselineSavedAt
                        }
                      />

                      <Metric
                        label="Guidance Version"
                        value={
                          number(
                            data.metrics
                              .guidanceVersions
                          )
                        }
                        helper="Snapshotهای قابل Rollback"
                      />
                    </div>
                  </section>

                  <section className="rounded-2xl border border-sky-200 bg-sky-50/60 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h3 className="text-sm font-black text-sky-900">
                          Cleanup Validation
                        </h3>

                        <p className="mt-1 text-[10px] leading-5 text-sky-700">
                          Cron روزانه Cleanup را انجام می‌دهد؛ در صورت Backlog می‌توان همین‌جا Cleanup امن را دستی اجرا کرد.
                        </p>
                      </div>

                      <button
                        type="button"
                        disabled={
                          cleaning ||
                          data.metrics
                            .expiredValidationUseLocks <=
                            0
                        }
                        onClick={() =>
                          void runManualCleanup()
                        }
                        className="min-h-10 shrink-0 rounded-xl bg-sky-800 px-4 py-2 text-xs font-black text-white transition hover:bg-sky-900 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {cleaning
                          ? "در حال Cleanup..."
                          : data.metrics
                                .expiredValidationUseLocks >
                              0
                            ? `پاکسازی ${number(
                                data.metrics
                                  .expiredValidationUseLocks
                              )} رکورد`
                            : "Cleanup لازم نیست"}
                      </button>
                    </div>

                    <div
                      dir="ltr"
                      className="mt-3 rounded-xl bg-white px-3 py-3 text-left font-mono text-[11px] leading-6 text-slate-700"
                    >
                      <div>
                        Path:{" "}
                        {
                          data.config
                            .cleanupPath
                        }
                      </div>

                      <div>
                        Schedule:{" "}
                        {
                          data.config
                            .expectedCleanupSchedule
                        }{" "}
                        {
                          data.config
                            .expectedCleanupTimezone
                        }
                      </div>
                    </div>

                    <p className="mt-2 text-[10px] leading-5 text-sky-700">
                      Cleanup دستی فقط رکوردهای منقضی `topic_guidance_validation_uses` را حذف می‌کند. Audit Log و Guidance History حذف نمی‌شوند. اجرای واقعی Cron را پس از Deploy در Vercel → Settings → Cron Jobs نیز بررسی کن.
                    </p>
                  </section>

                  <p className="text-left text-[9px] font-bold text-slate-400">
                    آخرین بررسی:{" "}
                    {
                      formatDateTime(
                        data.generatedAt
                      )
                    }
                  </p>
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function HealthBanner({
  status,
  issues,
}: {
  status:
    "healthy" |
    "warning" |
    "critical";

  issues:
    Array<{
      severity:
        "critical" |
        "warning";

      code:
        string;

      message:
        string;
    }>;
}) {
  const presentation =
    status ===
      "healthy"
      ? {
          title:
            "Validation سالم است",

          className:
            "border-emerald-200 bg-emerald-50 text-emerald-800",
        }
      : status ===
          "warning"
        ? {
            title:
              "Validation نیازمند توجه است",

            className:
              "border-amber-200 bg-amber-50 text-amber-800",
          }
        : {
            title:
              "اختلال در زیرساخت Validation",

            className:
              "border-rose-200 bg-rose-50 text-rose-800",
          };

  return (
    <section
      className={`rounded-2xl border p-4 ${presentation.className}`}
    >
      <p className="text-sm font-black">
        {
          presentation.title
        }
      </p>

      {issues.length >
      0 ? (
        <ul className="mt-2 space-y-1.5">
          {issues.map(
            (
              issue
            ) => (
              <li
                key={
                  issue.code
                }
                className="text-[10px] font-bold leading-5"
              >
                •{" "}
                {
                  issue.message
                }
              </li>
            )
          )}
        </ul>
      ) : (
        <p className="mt-1 text-[10px] font-bold leading-5">
          Secretها و Collectionهای اصلی در دسترس هستند و Backlog غیرعادی Cleanup مشاهده نشد.
        </p>
      )}
    </section>
  );
}

function Metric({
  label,
  value,
  helper,
}: {
  label:
    string;

  value:
    string;

  helper:
    string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-[10px] font-black text-slate-400">
        {
          label
        }
      </p>

      <p className="mt-2 text-xl font-black text-slate-900">
        {
          value
        }
      </p>

      <p className="mt-1 text-[9px] font-bold leading-5 text-slate-400">
        {
          helper
        }
      </p>
    </div>
  );
}

function DateMetric({
  label,
  value,
}: {
  label:
    string;

  value:
    string;
}) {
  return (
    <Metric
      label={
        label
      }
      value={
        value
          ? formatDateTime(
              value
            )
          : "—"
      }
      helper={
        value
          ? "آخرین رکورد ثبت‌شده"
          : "هنوز رکوردی وجود ندارد"
      }
    />
  );
}

function StatusRow({
  label,
  ok,
  successText,
  failureText,
}: {
  label:
    string;

  ok:
    boolean;

  successText:
    string;

  failureText:
    string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-3">
      <code
        dir="ltr"
        className="min-w-0 truncate text-[10px] font-bold text-slate-600"
      >
        {
          label
        }
      </code>

      <span
        className={
          ok
            ? "shrink-0 rounded-full bg-emerald-100 px-2 py-1 text-[9px] font-black text-emerald-700"
            : "shrink-0 rounded-full bg-rose-100 px-2 py-1 text-[9px] font-black text-rose-700"
        }
      >
        {ok
          ? successText
          : failureText}
      </span>
    </div>
  );
}

function CollectionRow({
  name,
  state,
}: {
  name:
    string;

  state:
    CollectionCheck;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-3">
      <div className="min-w-0">
        <code
          dir="ltr"
          className="block truncate text-[10px] font-bold text-slate-600"
        >
          {
            name
          }
        </code>

        <p className="mt-1 text-[9px] font-bold text-slate-400">
          {state.available
            ? `${number(
                state.total
              )} رکورد`
            : `Error: ${
                state.errorCode ||
                "UNKNOWN"
              }`}
        </p>
      </div>

      <span
        className={
          state.available
            ? "shrink-0 rounded-full bg-emerald-100 px-2 py-1 text-[9px] font-black text-emerald-700"
            : "shrink-0 rounded-full bg-rose-100 px-2 py-1 text-[9px] font-black text-rose-700"
        }
      >
        {state.available
          ? "Available"
          : "Missing"}
      </span>
    </div>
  );
}

function LoadingState() {
  return (
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
            className="h-28 animate-pulse rounded-2xl bg-slate-100"
          />
        )
      )}
    </div>
  );
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
    return "—";
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
