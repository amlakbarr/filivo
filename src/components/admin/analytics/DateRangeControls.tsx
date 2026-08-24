"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

const presets = [
  ["today", "امروز"],
  ["7d", "۷ روز اخیر"],
  ["30d", "۳۰ روز اخیر"],
  ["this_month", "این ماه"],
  ["previous_month", "ماه قبل"],
  ["custom", "بازه سفارشی"],
] as const;

export default function DateRangeControls({
  basePath,
  loading,
  onRefresh,
}: {
  basePath: string;
  loading: boolean;
  onRefresh: () => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const current = searchParams.get("range") || "7d";
  const [customFrom, setCustomFrom] = useState(searchParams.get("from") || "");
  const [customTo, setCustomTo] = useState(searchParams.get("to") || "");

  function selectRange(range: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("range", range);
    params.delete("employeePage");
    params.delete("unclassifiedPage");
    if (range !== "custom") {
      params.delete("from");
      params.delete("to");
      router.replace(`${basePath}?${params}`, { scroll: false });
    }
  }

  function applyCustom() {
    if (!customFrom || !customTo) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("range", "custom");
    params.set("from", customFrom);
    params.set("to", customTo);
    params.delete("employeePage");
    params.delete("unclassifiedPage");
    router.replace(`${basePath}?${params}`, { scroll: false });
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm xl:flex-row xl:items-center xl:justify-between">
      <div className="flex flex-wrap gap-1.5">{presets.map(([value, label]) => <button key={value} type="button" onClick={() => selectRange(value)} className={`rounded-lg px-3 py-2 text-xs font-bold transition ${current === value ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>{label}</button>)}</div>
      <div className="flex flex-wrap items-center gap-2">{current === "custom" && <><input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-2 text-xs" aria-label="تاریخ شروع" /><span className="text-xs text-slate-400">تا</span><input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-2 text-xs" aria-label="تاریخ پایان" /><button type="button" onClick={applyCustom} disabled={!customFrom || !customTo} className="rounded-lg bg-slate-800 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">اعمال</button></>}<button type="button" onClick={onRefresh} disabled={loading} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-50">{loading ? "در حال بروزرسانی..." : "↻ بروزرسانی"}</button></div>
    </div>
  );
}
