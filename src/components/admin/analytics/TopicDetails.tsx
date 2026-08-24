"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import DateRangeControls from "@/components/admin/analytics/DateRangeControls";
import { QuestionsTable } from "@/components/admin/analytics/TopicAnalyticsDashboard";
import TopicBars from "@/components/admin/analytics/TopicBars";
import TopicTrendChart from "@/components/admin/analytics/TopicTrendChart";
import type { TopicDetailsAnalytics } from "@/types/topic-analytics";

type ResponseBody =
  | { success: true; details: TopicDetailsAnalytics }
  | { success: false; message: string };

export default function TopicDetails({ topicId }: { topicId: string }) {
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const [details, setDetails] = useState<TopicDetailsAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/analytics/topics/${topicId}?${query}`, { cache: "no-store" })
      .then(async (response) => ({ response, body: (await response.json()) as ResponseBody }))
      .then(({ response, body }) => {
        if (!response.ok || !body.success) throw new Error("message" in body ? body.message : "دریافت گزارش ناموفق بود.");
        if (!cancelled) { setDetails(body.details); setError(""); }
      })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "دریافت گزارش ناموفق بود."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [query, refreshKey, topicId]);

  if (!details && loading) return <div className="h-96 animate-pulse rounded-3xl bg-slate-100" />;
  if (!details) return <ErrorState message={error} />;

  const rangeQuery = pickRangeQuery(searchParams);
  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link href={`/admin/analytics/topics?${rangeQuery}`} className="text-sm font-bold text-emerald-700">→ بازگشت به تحلیل موضوعی</Link>
          <div className="mt-2 flex flex-wrap items-center gap-2"><h1 className="text-2xl font-black sm:text-3xl">{details.topic.path}</h1>{!details.topic.active && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-500">غیرفعال</span>}</div>
          <p className="mt-2 text-sm text-slate-500">{details.topic.description || `جزئیات موضوع در ${details.range.label}`}</p>
        </div>
      </header>
      <DateRangeControls basePath={`/admin/analytics/topics/${topicId}`} loading={loading} onRefresh={() => { setLoading(true); setRefreshKey((value) => value + 1); }} />
      {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-800">{error}</div>}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Kpi label="تعداد سؤال" value={integer(details.total)} /><Kpi label="کارشناس یکتا" value={integer(details.uniqueUsers)} /><Kpi label="دپارتمان یکتا" value={integer(details.uniqueDepartments)} /><Kpi label="میانگین Confidence" value={percent(details.averageConfidence * 100)} /></section>
      <Panel title="روند موضوع" subtitle="حداکثر پنج زیرموضوع پرتکرار در بازه انتخاب‌شده"><TopicTrendChart points={details.trend.points} topics={details.trend.topics} /></Panel>
      {details.childBreakdown.length > 0 && <Panel title="تفکیک زیرموضوع‌ها" subtitle="سهم زیرموضوع‌های مستقیم این Topic"><TopicBars items={details.childBreakdown} rangeQuery={rangeQuery} /></Panel>}
      <Panel title="کارشناسان پرتکرار" subtitle="بر اساس تعداد سؤال در این موضوع"><Employees items={details.topEmployees} accountQuery={rangeQuery} /></Panel>
      <Panel title="آخرین سؤال‌های دسته‌بندی‌شده" subtitle="۲۰ سؤال اخیر این موضوع"><QuestionsTable questions={details.recentQuestions} timezone={details.range.timezone} /></Panel>
    </div>
  );
}

function Employees({ items, accountQuery }: { items: TopicDetailsAnalytics["topEmployees"]; accountQuery: string }) {
  if (!items.length) return <Empty />;
  return <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-right text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-4 py-3">کارشناس</th><th className="px-4 py-3">دپارتمان</th><th className="px-4 py-3">کل سؤال</th><th className="px-4 py-3">دسته‌بندی‌شده</th></tr></thead><tbody className="divide-y divide-slate-100">{items.map((item) => <tr key={item.id}><td className="px-4 py-4"><Link href={`/admin/accounts/${item.id}/topics?${accountQuery}`} className="font-black hover:text-emerald-700">{item.name}</Link><p className="mt-1 text-xs text-slate-400">{item.employeeCode || "—"}</p></td><td className="px-4 py-4 text-slate-600">{item.department || "—"}</td><td className="px-4 py-4">{integer(item.total)}</td><td className="px-4 py-4">{integer(item.classified)}</td></tr>)}</tbody></table></div>;
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) { return <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><h2 className="text-lg font-black">{title}</h2><p className="mt-1 text-sm text-slate-500">{subtitle}</p><div className="mt-5">{children}</div></section>; }
function Kpi({ label, value }: { label: string; value: string }) { return <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm font-bold text-slate-500">{label}</p><p className="mt-3 text-2xl font-black">{value}</p></div>; }
function Empty() { return <p className="py-12 text-center text-sm text-slate-400">داده‌ای برای نمایش وجود ندارد.</p>; }
function ErrorState({ message }: { message: string }) { return <div className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-rose-800"><h1 className="font-black">گزارش در دسترس نیست</h1><p className="mt-2 text-sm">{message}</p><Link href="/admin/analytics/topics" className="mt-4 inline-block text-sm font-bold underline">بازگشت به تحلیل موضوعی</Link></div>; }
function integer(value: number) { return Math.round(value).toLocaleString("fa-IR"); }
function percent(value: number) { return `${value.toLocaleString("fa-IR", { maximumFractionDigits: 1 })}٪`; }
function pickRangeQuery(params: URLSearchParams) { const output = new URLSearchParams(); for (const key of ["range", "from", "to", "department", "account", "status"]) { const value = params.get(key); if (value) output.set(key, value); } return output.toString(); }
