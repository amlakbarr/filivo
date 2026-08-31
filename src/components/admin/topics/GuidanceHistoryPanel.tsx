"use client";

import {
  useCallback,
  useEffect,
  useState,
} from "react";

type GuidanceSnapshot = {
  keywords:
    string;

  examples:
    string;

  negativeExamples:
    string;

  classificationNote:
    string;
};

type HistoryVersion = {
  id:
    string;

  snapshot:
    GuidanceSnapshot;

  source:
    "before_update" |
    "before_restore";

  note:
    string;

  createdBy: {
    id:
      string;

    name:
      string;
  };

  created:
    string;
};

type HistoryResponse =
  | {
      success:
        true;

      current: {
        snapshot:
          GuidanceSnapshot;

        updated:
          string;
      };

      versions:
        HistoryVersion[];

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

type RestoreResponse =
  | {
      success:
        true;

      item: {
        keywords:
          string;

        examples:
          string;

        negativeExamples:
          string;

        classificationNote:
          string;
      };

      restoredVersionId:
        string;

      backupVersionId:
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

export default function GuidanceHistoryPanel({
  topicId,
  onRestored,
}: {
  topicId:
    string;

  onRestored:
    (
      snapshot:
        GuidanceSnapshot
    ) => void;
}) {
  const [
    data,
    setData,
  ] =
    useState<
      Extract<
        HistoryResponse,
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
    restoringId,
    setRestoringId,
  ] =
    useState("");

  const [
    error,
    setError,
  ] =
    useState("");

  const [
    notice,
    setNotice,
  ] =
    useState("");

  const [
    expanded,
    setExpanded,
  ] =
    useState(false);

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
              )}/guidance-history`,
              {
                cache:
                  "no-store",
              }
            );

          const body =
            (await safeJson(
              response
            )) as
              HistoryResponse |
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
                "دریافت تاریخچه Guidance ناموفق بود."
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
              : "دریافت تاریخچه Guidance ناموفق بود."
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

  async function restore(
    version:
      HistoryVersion
  ) {
    if (
      restoringId
    ) {
      return;
    }

    const confirmed =
      window.confirm(
        "این نسخه Guidance روی داده واقعی بازگردانی شود؟\n\nقبل از Rollback از Guidance فعلی هم یک نسخه پشتیبان ساخته می‌شود، بنابراین این عملیات قابل برگشت است."
      );

    if (
      !confirmed
    ) {
      return;
    }

    setRestoringId(
      version.id
    );

    setError(
      ""
    );

    setNotice(
      ""
    );

    try {
      const response =
        await fetch(
          `/api/admin/topics/${encodeURIComponent(
            topicId
          )}/guidance-history/${encodeURIComponent(
            version.id
          )}/restore`,
          {
            method:
              "POST",
          }
        );

      const body =
        (await safeJson(
          response
        )) as
          RestoreResponse |
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
            "بازگردانی Guidance ناموفق بود."
          )
        );
      }

      onRestored({
        keywords:
          body.item.keywords,

        examples:
          body.item.examples,

        negativeExamples:
          body.item.negativeExamples,

        classificationNote:
          body.item.classificationNote,
      });

      setNotice(
        "نسخه انتخاب‌شده بازگردانی شد. از Guidance قبلی نیز یک Backup جدید ساخته شد."
      );

      await load();
    } catch (reason) {
      setError(
        reason instanceof
          Error
          ? reason.message
          : "بازگردانی Guidance ناموفق بود."
      );
    } finally {
      setRestoringId(
        ""
      );
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white">
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
          <p className="text-xs font-black text-slate-800">
            تاریخچه و Rollback Guidance
          </p>

          <p className="mt-1 text-[10px] leading-5 text-slate-500">
            قبل از هر تغییر واقعی Guidance یک Snapshot ساخته می‌شود تا بتوان نسخه قبلی را بازگرداند.
          </p>
        </div>

        <span className="shrink-0 rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-600">
          {loading
            ? "..."
            : data
              ? `${number(
                  data.versions
                    .length
                )} نسخه`
              : expanded
                ? "بستن"
                : "باز کردن"}
        </span>
      </button>

      {expanded ? (
        <div className="border-t border-slate-100 p-4">
          {error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-bold leading-6 text-rose-700">
              {
                error
              }
            </div>
          ) : null}

          {notice ? (
            <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs font-bold leading-6 text-emerald-700">
              {
                notice
              }
            </div>
          ) : null}

          {loading ? (
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
                    className="h-20 animate-pulse rounded-xl bg-slate-100"
                  />
                )
              )}
            </div>
          ) : data &&
            data.versions
              .length >
              0 ? (
            <div className="space-y-2">
              {data.versions.map(
                (
                  version,
                  index
                ) => (
                  <HistoryCard
                    key={
                      version.id
                    }
                    version={
                      version
                    }
                    index={
                      index
                    }
                    restoring={
                      restoringId ===
                      version.id
                    }
                    disabled={
                      Boolean(
                        restoringId
                      )
                    }
                    onRestore={() =>
                      void restore(
                        version
                      )
                    }
                  />
                )
              )}

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  disabled={
                    Boolean(
                      restoringId
                    )
                  }
                  onClick={() =>
                    void load()
                  }
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[10px] font-black text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
                >
                  تازه‌سازی تاریخچه
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-xl bg-slate-50 px-4 py-5 text-center text-xs font-bold leading-6 text-slate-400">
              هنوز نسخه قبلی ثبت نشده است. اولین بار که Guidance را تغییر بدهی، Snapshot خودکار ساخته می‌شود.
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

function HistoryCard({
  version,
  index,
  restoring,
  disabled,
  onRestore,
}: {
  version:
    HistoryVersion;

  index:
    number;

  restoring:
    boolean;

  disabled:
    boolean;

  onRestore:
    () => void;
}) {
  return (
    <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-white px-2 py-1 text-[10px] font-black text-slate-600">
              نسخه قبلی{" "}
              {
                number(
                  index +
                    1
                )
              }
            </span>

            <span
              className={
                version.source ===
                "before_restore"
                  ? "rounded-full bg-amber-100 px-2 py-1 text-[10px] font-black text-amber-700"
                  : "rounded-full bg-violet-100 px-2 py-1 text-[10px] font-black text-violet-700"
              }
            >
              {version.source ===
                "before_restore"
                ? "Backup قبل از Rollback"
                : "Backup قبل از ویرایش"}
            </span>
          </div>

          <p className="mt-2 text-[10px] font-bold text-slate-400">
            {
              formatDate(
                version.created
              )
            }
            {version.createdBy
              .name
              ? ` · ${version.createdBy.name}`
              : ""}
          </p>

          {version.note ? (
            <div className="mt-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2">
              <p className="text-[9px] font-black text-blue-500">
                دلیل تغییر
              </p>

              <p className="mt-1 text-[10px] font-bold leading-5 text-blue-800">
                {
                  humanizeHistoryNote(
                    version.note
                  )
                }
              </p>
            </div>
          ) : null}

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <SnapshotMetric
              label="Keywords"
              value={
                lineCount(
                  version.snapshot
                    .keywords
                )
              }
            />

            <SnapshotMetric
              label="Examples"
              value={
                lineCount(
                  version.snapshot
                    .examples
                )
              }
            />

            <SnapshotMetric
              label="Negative"
              value={
                lineCount(
                  version.snapshot
                    .negativeExamples
                )
              }
            />

            <SnapshotMetric
              label="Note"
              value={
                version.snapshot
                  .classificationNote
                  ? 1
                  : 0
              }
            />
          </div>
        </div>

        <button
          type="button"
          disabled={
            disabled
          }
          onClick={
            onRestore
          }
          className="min-h-10 shrink-0 rounded-xl bg-slate-950 px-4 py-2 text-xs font-black text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {restoring
            ? "در حال Rollback..."
            : "بازگردانی این نسخه"}
        </button>
      </div>
    </article>
  );
}

function SnapshotMetric({
  label,
  value,
}: {
  label:
    string;

  value:
    number;
}) {
  return (
    <div className="rounded-lg bg-white px-2.5 py-2">
      <span className="text-[9px] font-bold text-slate-400">
        {
          label
        }
      </span>

      <span className="mr-2 text-[10px] font-black text-slate-700">
        {
          number(
            value
          )
        }
      </span>
    </div>
  );
}

function humanizeHistoryNote(
  value:
    string
) {
  if (
    value ===
    "Automatic backup before guidance update"
  ) {
    return "نسخه پشتیبان خودکار قبل از ویرایش Guidance.";
  }

  if (
    value.startsWith(
      "Automatic backup before restore "
    )
  ) {
    return "نسخه پشتیبان خودکار قبل از Rollback Guidance.";
  }

  return value;
}

function lineCount(
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
        item
      ) =>
        item.trim()
    )
    .filter(
      Boolean
    )
    .length;
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
