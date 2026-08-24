"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import DateRangeControls from "@/components/admin/analytics/DateRangeControls";
import { QuestionsTable } from "@/components/admin/analytics/TopicAnalyticsDashboard";
import TopicBars from "@/components/admin/analytics/TopicBars";
import TopicTrendChart from "@/components/admin/analytics/TopicTrendChart";
import type { AccountTopicAnalytics } from "@/types/topic-analytics";

type ResponseBody =
  | { success: true; analytics: AccountTopicAnalytics }
  | { success: false; message: string };

export default function AccountTopics({ accountId }: { accountId: string }) {
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const [analytics, setAnalytics] = useState<AccountTopicAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/analytics/accounts/${accountId}/topics?${query}`, { cache: "no-store" })
      .then(async (response) => ({ response, body: (await response.json()) as ResponseBody }))
      .then(({ response, body }) => {
        if (!response.ok || !body.success) throw new Error("message" in body ? body.message : "دریافت گزارش ناموفق بود.");
        if (!cancelled) { setAnalytics(body.analytics); setError(""); }
      })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "دریافت گزارش ناموفق بود."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [accountId, query, refreshKey]);

  if (!analytics && loading) return <div className="h-96 animate-pulse rounded-3xl bg-slate-100" />;
  if (!analytics) return <ErrorState message={error} accountId={accountId} />;

  const { account, dashboard, recentClassified } = analytics;
  const rangeQuery = pickRangeQuery(searchParams);
  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><Link href={`/admin/accounts/${account.id}`} className="text-sm font-bold text-emerald-700">→ بازگشت به جزئیات کارشناس</Link><h1 className="mt-2 text-2xl font-black sm:text-3xl">تحلیل موضوعی {account.name}</h1><p className="mt-2 text-sm text-slate-500">{account.employeeCode || "بدون کد"} · {account.department || "بدون دپارتمان"} · {dashboard.range.label}</p></div><Link href={`/admin/accounts/${account.id}/usage?${rangeQuery}`} className="self-start rounded-xl border border-emerald-200 px-4 py-2.5 text-sm font-bold text-emerald-700">گزارش مصرف</Link></header>
      <DateRangeControls basePath={`/admin/accounts/${account.id}/topics`} loading={loading} onRefresh={() => { setLoading(true); setRefreshKey((value) => value + 1); }} />
      {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-800">{error}</div>}
      {dashboard.errors.length > 0 && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{dashboard.errors.join(" ")}</div>}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Kpi label="کل سؤال" value={integer(dashboard.kpis.total.value)} /><Kpi label="دسته‌بندی‌شده" value={integer(dashboard.kpis.classified.value)} /><Kpi label="بدون موضوع" value={integer(dashboard.kpis.unclassified.value)} /><Kpi label="نرخ Classification" value={percent(dashboard.kpis.classificationRate)} /></section>
      <section className="grid gap-5 xl:grid-cols-2"><Panel title="موضوع‌های پرتکرار" subtitle="موضوع دقیق سؤال‌ها"><TopicBars items={dashboard.topics.slice(0, 10)} rangeQuery={rangeQuery} /></Panel><Panel title="حوزه‌های اصلی" subtitle="تجمیع Topicهای والد"><TopicBars items={dashboard.parents.slice(0, 10)} rangeQuery={rangeQuery} /></Panel></section>
      <Panel title="روند موضوع‌ها" subtitle="تا پنج موضوع پرتکرار"><TopicTrendChart points={dashboard.trend.points} topics={dashboard.trend.topics} /></Panel>
      <Panel title="آخرین سؤال‌های دسته‌بندی‌شده" subtitle="۲۰ سؤال اخیر این کارشناس"><QuestionsTable questions={recentClassified} timezone={dashboard.range.timezone} /></Panel>
    </div>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) { return <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><h2 className="text-lg font-black">{title}</h2><p className="mt-1 text-sm text-slate-500">{subtitle}</p><div className="mt-5">{children}</div></section>; }
function Kpi({ label, value }: { label: string; value: string }) { return <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm font-bold text-slate-500">{label}</p><p className="mt-3 text-2xl font-black">{value}</p></div>; }
function ErrorState({ message, accountId }: { message: string; accountId: string }) { return <div className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-rose-800"><h1 className="font-black">گزارش در دسترس نیست</h1><p className="mt-2 text-sm">{message}</p><Link href={`/admin/accounts/${accountId}`} className="mt-4 inline-block text-sm font-bold underline">بازگشت به کارشناس</Link></div>; }
function integer(value: number) { return Math.round(value).toLocaleString("fa-IR"); }
function percent(value: number) { return `${value.toLocaleString("fa-IR", { maximumFractionDigits: 1 })}٪`; }
function pickRangeQuery(params: URLSearchParams) { const output = new URLSearchParams(); for (const key of ["range", "from", "to", "parentTopic", "topic", "status"]) { const value = params.get(key); if (value) output.set(key, value); } return output.toString(); }
