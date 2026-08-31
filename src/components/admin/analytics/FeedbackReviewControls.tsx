"use client";

import {
  useState,
} from "react";

import {
  useRouter,
} from "next/navigation";

type ReviewStatus =
  | "new"
  | "in_progress"
  | "resolved"
  | "ignored";

type Props = {
  feedbackId:
    string;

  initialStatus:
    ReviewStatus;

  initialNote?:
    string;

  reviewedAt?:
    string;
};

type ReviewResponse = {
  success?:
    boolean;

  message?:
    string;

  feedback?: {
    reviewStatus?:
      ReviewStatus;

    reviewNote?:
      string;

    reviewedAt?:
      string;
  };
};

const STATUS_OPTIONS: Array<{
  value:
    ReviewStatus;

  label:
    string;
}> = [
  {
    value:
      "new",

    label:
      "جدید",
  },
  {
    value:
      "in_progress",

    label:
      "در حال بررسی",
  },
  {
    value:
      "resolved",

    label:
      "رفع‌شده",
  },
  {
    value:
      "ignored",

    label:
      "نادیده گرفته‌شده",
  },
];

export default function FeedbackReviewControls({
  feedbackId,
  initialStatus,
  initialNote,
  reviewedAt,
}: Props) {
  const router =
    useRouter();

  const [
    status,
    setStatus,
  ] =
    useState<ReviewStatus>(
      initialStatus
    );

  const [
    note,
    setNote,
  ] =
    useState(
      initialNote ||
        ""
    );

  const [
    savedAt,
    setSavedAt,
  ] =
    useState(
      reviewedAt ||
        ""
    );

  const [
    busy,
    setBusy,
  ] =
    useState(
      false
    );

  const [
    error,
    setError,
  ] =
    useState(
      ""
    );

  const [
    success,
    setSuccess,
  ] =
    useState(
      ""
    );

  async function saveReview(
    nextStatus:
      ReviewStatus =
        status
  ) {
    if (
      busy
    ) {
      return;
    }

    const cleanNote =
      note
        .replace(
          /\s+/g,
          " "
        )
        .trim();

    if (
      (
        nextStatus ===
          "resolved" ||
        nextStatus ===
          "ignored"
      ) &&
      !cleanNote
    ) {
      setError(
        "برای بستن یا نادیده گرفتن بازخورد، توضیح الزامی است."
      );

      setSuccess(
        ""
      );

      return;
    }

    setBusy(
      true
    );

    setError(
      ""
    );

    setSuccess(
      ""
    );

    try {
      const response =
        await fetch(
          `/api/admin/analytics/feedback/${feedbackId}/review`,
          {
            method:
              "PATCH",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                status:
                  nextStatus,

                note:
                  cleanNote,
              }),
          }
        );

      const data =
        (await response
          .json()
          .catch(
            () => ({})
          )) as ReviewResponse;

      if (
        !response.ok ||
        !data.success ||
        !data.feedback
      ) {
        setError(
          data.message ||
            "ثبت وضعیت بررسی انجام نشد."
        );

        return;
      }

      const finalStatus =
        data.feedback
          .reviewStatus ||
        nextStatus;

      setStatus(
        finalStatus
      );

      setNote(
        data.feedback
          .reviewNote ||
          cleanNote
      );

      setSavedAt(
        data.feedback
          .reviewedAt ||
          ""
      );

      setSuccess(
        "وضعیت بررسی ذخیره شد."
      );

      router.refresh();
    } catch {
      setError(
        "خطا در ارتباط با سرور."
      );
    } finally {
      setBusy(
        false
      );
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3.5">

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">

        <div>

          <p className="text-[11px] font-black text-slate-500">
            وضعیت رسیدگی
          </p>

          <div className="mt-2 flex flex-wrap gap-2">

            {STATUS_OPTIONS.map(
              (
                option
              ) => (
                <button
                  key={
                    option.value
                  }
                  type="button"
                  disabled={
                    busy
                  }
                  onClick={() => {
                    setStatus(
                      option.value
                    );

                    void saveReview(
                      option.value
                    );
                  }}
                  className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-black transition ${
                    status ===
                    option.value
                      ? statusClass(
                          option.value
                        )
                      : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {
                    option.label
                  }
                </button>
              )
            )}

          </div>

        </div>

        {savedAt && (
          <p className="text-[10px] text-slate-400">
            آخرین اقدام:{" "}
            {
              formatDateTime(
                savedAt
              )
            }
          </p>
        )}

      </div>

      <label
        htmlFor={`review-note-${feedbackId}`}
        className="mt-4 block text-[11px] font-black text-slate-500"
      >
        یادداشت رسیدگی
      </label>

      <textarea
        id={`review-note-${feedbackId}`}
        value={
          note
        }
        onChange={(
          event
        ) =>
          setNote(
            event.target
              .value
          )
        }
        rows={
          2
        }
        maxLength={
          2000
        }
        disabled={
          busy
        }
        placeholder="نتیجه بررسی، اقدام انجام‌شده یا علت نادیده گرفتن را ثبت کنید..."
        className="mt-2 w-full resize-y rounded-xl border border-slate-200 px-3 py-2 text-xs leading-6 text-slate-700 outline-none transition focus:border-slate-400 disabled:opacity-50"
      />

      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">

        <span className="text-[10px] text-slate-400">
          {
            note.length.toLocaleString(
              "fa-IR"
            )
          }{" "}
          / ۲۰۰۰
        </span>

        <button
          type="button"
          disabled={
            busy
          }
          onClick={() =>
            void saveReview()
          }
          className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-black text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
        >
          {
            busy
              ? "در حال ذخیره..."
              : "ذخیره یادداشت"
          }
        </button>

      </div>

      {error && (
        <p className="mt-2 text-xs font-bold text-rose-600">
          {
            error
          }
        </p>
      )}

      {success && (
        <p className="mt-2 text-xs font-bold text-emerald-700">
          {
            success
          }
        </p>
      )}

    </div>
  );
}

function statusClass(
  status:
    ReviewStatus
) {
  switch (
    status
  ) {
    case "new":
      return "border-slate-300 bg-slate-100 text-slate-700";

    case "in_progress":
      return "border-amber-300 bg-amber-50 text-amber-800";

    case "resolved":
      return "border-emerald-300 bg-emerald-50 text-emerald-800";

    case "ignored":
      return "border-gray-300 bg-gray-100 text-gray-600";
  }
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
    return value;
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
