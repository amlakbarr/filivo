"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import AnalyticsChart from "@/components/admin/analytics/AnalyticsChart";
import DateRangeControls from "@/components/admin/analytics/DateRangeControls";
import type { ManagedAccount } from "@/types/account";
import type { AnalyticsDashboard } from "@/types/analytics";

type Conversation = { id: string; title: string; status: string; created: string; updated: string; last_message_at: string };
type ResponseBody = { success: true; account: ManagedAccount; dashboard: AnalyticsDashboard; conversations: Conversation[] } | { success: false; message: string };

export default function AccountUsage({ accountId }: { accountId: string }) {
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();
  const [data, setData] = useState<Extract<ResponseBody, { success: true }> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/analytics/accounts/${accountId}?${queryString}`, { cache: "no-store" })
      .then(async (response) => ({ response, body: (await response.json()) as ResponseBody }))
      .then(({ response, body }) => { if (!response.ok || !body.success) throw new Error("message" in body ? body.message : "دریافت گزارش ناموفق بود."); if (!cancelled) { setData(body); setError(""); } })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "دریافت گزارش ناموفق بود."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [accountId, queryString, refreshKey]);

  if (!data && loading) return <div className="h-96 animate-pulse rounded-3xl bg-slate-100" />;
  if (!data) return <div className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-rose-800"><h1 className="font-black">گزارش در دسترس نیست</h1><p className="mt-2 text-sm">{error}</p></div>;

  const { account, dashboard, conversations } = data;
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><Link href={`/admin/accounts/${account.id}`} className="text-sm font-bold text-emerald-700">→ بازگشت به جزئیات کارشناس</Link><h1 className="mt-2 text-2xl font-black sm:text-3xl">مصرف {account.name || account.email}</h1><p className="mt-2 text-sm text-slate-500">{account.employee_code || account.email} · {dashboard.range.label}</p></div><Link href={`/admin/accounts/${account.id}/edit`} className="self-start rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700">ویرایش حساب</Link></div>
      <DateRangeControls basePath={`/admin/accounts/${account.id}/usage`} loading={loading} onRefresh={() => { setLoading(true); setRefreshKey((value) => value + 1); }} />
      {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-800">{error}</div>}
      {dashboard.errors.length > 0 && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{dashboard.errors.join(" ")}</div>}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5"><Kpi label="تعداد سؤال" value={integer(dashboard.kpis.questions.value)} /><Kpi label="Conversation" value={integer(dashboard.employees.items[0]?.conversations || 0)} /><Kpi label="Token" value={integer(dashboard.kpis.totalTokens.value)} /><Kpi label="هزینه" value={cost(dashboard.kpis.cost.value)} warning={dashboard.kpis.unpricedRequests > 0} /><Kpi label="Avg Chat Latency" value={latency(dashboard.kpis.avgChatLatency)} /></section>
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><h2 className="text-lg font-black">روند مصرف</h2><p className="mt-1 text-sm text-slate-500">Token و سؤال در بازه انتخاب‌شده</p><div className="mt-5"><AnalyticsChart points={dashboard.series} series={[{ key: "totalTokens", label: "Total Token", color: "#2563eb", format: integer }, { key: "questions", label: "تعداد سؤال", color: "#059669", format: integer }]} /></div></section>
      <section className="grid gap-5 xl:grid-cols-2"><Breakdown title="تفکیک نوع درخواست" items={dashboard.requestBreakdown} /><Breakdown title="تفکیک مدل" items={dashboard.modelBreakdown} /></section>
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 px-5 py-4"><h2 className="text-lg font-black">آخرین Conversationها</h2><p className="mt-1 text-sm text-slate-500">در بازه انتخاب‌شده</p></div>{conversations.length ? <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-right text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-5 py-3">عنوان</th><th className="px-5 py-3">وضعیت</th><th className="px-5 py-3">آخرین فعالیت</th></tr></thead><tbody className="divide-y divide-slate-100">{conversations.map((item) => <tr key={item.id}><td className="px-5 py-4 font-bold">{item.title}</td><td className="px-5 py-4">{item.status === "active" ? "فعال" : item.status || "—"}</td><td className="px-5 py-4 text-xs text-slate-500">{date(item.last_message_at || item.updated || item.created, dashboard.range.timezone)}</td></tr>)}</tbody></table></div> : <div className="p-10 text-center text-sm text-slate-400">گفتگویی در این بازه ثبت نشده است.</div>}</section>
    </div>
  );
}

function Kpi({ label, value, warning }: { label: string; value: string; warning?: boolean }) { return <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm font-bold text-slate-500">{label}</p><p className="mt-3 text-xl font-black">{value}</p>{warning && <p className="mt-2 text-[10px] font-bold text-amber-700">بعضی درخواست‌ها Pricing ندارند</p>}</div>; }
function Breakdown({ title, items }: { title: string; items: AnalyticsDashboard["requestBreakdown"] }) { return <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 px-5 py-4"><h2 className="text-lg font-black">{title}</h2></div>{items.length ? <div className="divide-y divide-slate-100">{items.map((item) => <div key={item.key} className="flex items-center justify-between gap-4 px-5 py-4"><div><p className="font-black">{item.label}</p><p className="mt-1 text-xs text-slate-400">{integer(item.requests)} درخواست · {latency(item.avgLatency)}</p></div><div className="text-left"><p className="font-bold">{integer(item.totalTokens)} Token</p><p className="mt-1 text-xs text-slate-500">{cost(item.cost)}</p></div></div>)}</div> : <div className="p-10 text-center text-sm text-slate-400">داده‌ای وجود ندارد.</div>}</section>; }
function integer(value: number) { return Math.round(value).toLocaleString("fa-IR"); }
function cost(value: number) { return value ? `$${value.toLocaleString("en-US", { minimumFractionDigits: value < 0.01 ? 6 : 4, maximumFractionDigits: 8 })}` : "$0"; }
function latency(value: number) { return value ? `${Math.round(value).toLocaleString("fa-IR")} ms` : "—"; }
function date(value: string, timezone: string) { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? "—" : new Intl.DateTimeFormat("fa-IR", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" }).format(parsed); }
