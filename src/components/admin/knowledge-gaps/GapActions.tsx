"use client";

import {
  useState,
} from "react";

import {
  useRouter,
} from "next/navigation";

type GapStatus =
  | "open"
  | "in_progress"
  | "resolved"
  | "ignored";

type Props = {
  gapId: string;
  currentStatus: GapStatus;
  currentIgnoreNote?: string;
};

export default function GapActions({
  gapId,
  currentStatus,
  currentIgnoreNote = "",
}: Props) {
  const router =
    useRouter();

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
    showIgnore,
    setShowIgnore,
  ] =
    useState(false);

  const [
    ignoreNote,
    setIgnoreNote,
  ] =
    useState(
      currentIgnoreNote
    );

  async function updateStatus(
    status:
      | "open"
      | "in_progress"
      | "ignored",
    note = ""
  ) {
    if (loading) {
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response =
        await fetch(
          `/api/admin/knowledge/gaps/${gapId}`,
          {
            method:
              "PATCH",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                status,
                note,
              }),
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        setError(
          data.message ||
            "عملیات انجام نشد."
        );

        return;
      }

      setShowIgnore(
        false
      );

      router.refresh();
    } catch {
      setError(
        "خطا در ارتباط با سرور."
      );
    } finally {
      setLoading(
        false
      );
    }
  }

  return (
    <div className="space-y-4">

      <div className="flex flex-wrap gap-2">

        {currentStatus !==
          "in_progress" &&
          currentStatus !==
            "resolved" && (
            <button
              type="button"
              disabled={
                loading
              }
              onClick={() =>
                updateStatus(
                  "in_progress"
                )
              }
              className="rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-amber-600 disabled:opacity-50"
            >
              در حال بررسی
            </button>
          )}

        {currentStatus !==
          "ignored" &&
          currentStatus !==
            "resolved" && (
            <button
              type="button"
              disabled={
                loading
              }
              onClick={() =>
                setShowIgnore(
                  true
                )
              }
              className="rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
            >
              نادیده گرفتن
            </button>
          )}

        {(currentStatus ===
          "ignored" ||
          currentStatus ===
            "in_progress") && (
          <button
            type="button"
            disabled={
              loading
            }
            onClick={() =>
              updateStatus(
                "open"
              )
            }
            className="rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
          >
            باز کردن مجدد
          </button>
        )}

      </div>

      {showIgnore && (
        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">

          <label
            htmlFor="ignore-note"
            className="block text-sm font-medium text-gray-700"
          >
            دلیل نادیده گرفتن
          </label>

          <textarea
            id="ignore-note"
            value={
              ignoreNote
            }
            onChange={(
              event
            ) =>
              setIgnoreNote(
                event.target
                  .value
              )
            }
            rows={3}
            maxLength={2000}
            placeholder="مثلاً: این سؤال مربوط به اطلاعات داخلی شرکت نیست."
            className="mt-2 w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm leading-7 outline-none focus:border-gray-400"
          />

          <div className="mt-3 flex flex-wrap gap-2">

            <button
              type="button"
              disabled={
                loading
              }
              onClick={() =>
                updateStatus(
                  "ignored",
                  ignoreNote
                )
              }
              className="rounded-xl bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              تأیید
            </button>

            <button
              type="button"
              disabled={
                loading
              }
              onClick={() =>
                setShowIgnore(
                  false
                )
              }
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm text-gray-600"
            >
              انصراف
            </button>

          </div>

        </div>
      )}

      {loading && (
        <p className="text-sm text-gray-500">
          در حال انجام عملیات...
        </p>
      )}

      {error && (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

    </div>
  );
}