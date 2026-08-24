"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import DateRangeControls from "@/components/admin/analytics/DateRangeControls";
import TopicBars from "@/components/admin/analytics/TopicBars";
import TopicTrendChart from "@/components/admin/analytics/TopicTrendChart";
import type {
  TopicAnalyticsDashboard as Dashboard,
  TopicAnalyticsMetric,
  TopicQuestion,
} from "@/types/topic-analytics";

type ResponseBody =
  | { success: true; dashboard: Dashboard }
  | { success: false; message: string };

export default function TopicAnalyticsDashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/analytics/topics?${queryString}`, {
      cache: "no-store",
    })
      .then(async (response) => ({
        response,
        body: (await response.json()) as ResponseBody,
      }))
      .then(({ response, body }) => {
        if (!response.ok || !body.success) {
          throw new Error(
            "message" in body
              ? body.message
              : "دریافت تحلیل موضوعی ناموفق بود."
          );
        }
        if (!cancelled) {
          setData(body.dashboard);
          setError("");
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(
            reason instanceof Error
              ? reason.message
              : "دریافت تحلیل موضوعی ناموفق بود."
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [queryString, refreshKey]);

  function updateFilters(changes: Record<string, string>) {
    setLoading(true);
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    if (!("employeePage" in changes)) params.delete("employeePage");
    if (!("unclassifiedPage" in changes)) params.delete("unclassifiedPage");
    router.replace(`/admin/analytics/topics?${params}`, {
      scroll: false,
    });
  }

  if (!data && loading) {
    return (
      <div className="space-y-5">
        <div className="h-28 animate-pulse rounded-3xl bg-slate-100" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="h-28 animate-pulse rounded-2xl bg-slate-100" />
          ))}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-rose-800">
        <h1 className="font-black">تحلیل موضوعی در دسترس نیست</h1>
        <p className="mt-2 text-sm">{error}</p>
      </div>
    );
  }

  const rangeQuery = pickRangeQuery(searchParams);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-bold text-emerald-700">تحلیل طبقه‌بندی سؤال‌ها</p>
          <h1 className="mt-1 text-2xl font-black sm:text-3xl">گزارش موضوعات</h1>
          <p className="mt-2 text-sm text-slate-500">{data.range.label} · {data.range.timezone}</p>
        </div>
        {loading && <span className="text-xs font-bold text-emerald-700">در حال بروزرسانی...</span>}
      </div>

      <DateRangeControls
        basePath="/admin/analytics/topics"
        loading={loading}
        onRefresh={() => {
          setLoading(true);
          setRefreshKey((value) => value + 1);
        }}
      />

      <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-2 xl:grid-cols-5">
        <Filter label="همه واحدها" value={data.filters.department} onChange={(value) => updateFilters({ department: value, account: "" })} options={data.lookups.departments.map((item) => [item.id, `${item.name}${item.active ? "" : " (غیرفعال)"}`])} />
        <Filter label="همه کارشناسان" value={data.filters.account} onChange={(value) => updateFilters({ account: value })} options={data.lookups.accounts.filter((item) => !data.filters.department || item.departmentId === data.filters.department).map((item) => [item.id, `${item.name} — ${item.employeeCode}`])} />
        <Filter label="همه حوزه‌های اصلی" value={data.filters.parentTopic} onChange={(value) => updateFilters({ parentTopic: value, topic: "" })} options={data.lookups.parentTopics.map((item) => [item.id, item.name])} />
        <Filter label="همه موضوعات" value={data.filters.topic} onChange={(value) => updateFilters({ topic: value, parentTopic: "" })} options={data.lookups.topics.map((item) => [item.id, `${item.path}${item.active ? "" : " (غیرفعال)"}`])} />
        <Filter label="همه وضعیت‌ها" value={data.filters.status} onChange={(value) => updateFilters({ status: value })} options={[["classified", "دسته‌بندی‌شده"], ["unclassified", "بدون دسته‌بندی"], ["pending", "در انتظار"], ["error", "خطا"]]} />
      </section>

      {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-800">{error}</div>}
      {data.errors.length > 0 && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{data.errors.join(" ")}</div>}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <MetricCard label="کل سؤال‌ها" metric={data.kpis.total} />
        <MetricCard label="دسته‌بندی‌شده" metric={data.kpis.classified} color="text-emerald-700" />
        <MetricCard label="بدون دسته‌بندی" metric={data.kpis.unclassified} color="text-amber-700" />
        <SimpleCard label="خطای Classification" value={data.kpis.error.toLocaleString("fa-IR")} detail={`${data.kpis.pending.toLocaleString("fa-IR")} در انتظار`} />
        <SimpleCard label="Topicهای استفاده‌شده" value={data.kpis.usedTopics.toLocaleString("fa-IR")} detail={`نرخ Classification: ${percent(data.kpis.classificationRate)}`} />
        <SimpleCard label="بیشترین Topic" value={data.kpis.topTopic?.path || "—"} detail={data.kpis.topTopic ? `${data.kpis.topTopic.count.toLocaleString("fa-IR")} سؤال · ${comparison(data.kpis.topTopic.count, data.kpis.topTopic.previousCount)}` : "بدون داده"} compact />
      </section>

      {!data.kpis.classified.value && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">
          در بازه انتخاب‌شده سؤال دسته‌بندی‌شده‌ای وجود ندارد.
        </div>
      )}

      <section className="grid gap-5 xl:grid-cols-2">
        <Panel title="بیشترین موضوعات پرسیده‌شده" subtitle="۱۰ Topic واقعی با بیشترین سؤال">
          <TopicBars items={data.topics.slice(0, 10)} rangeQuery={rangeQuery} />
        </Panel>
        <Panel title="حوزه‌های اصلی سؤال‌ها" subtitle="تجمیع Child Topicها در Parent بدون تغییر Total">
          <TopicBars items={data.parents.slice(0, 10)} rangeQuery={rangeQuery} />
        </Panel>
      </section>

      <Panel title="روند سؤال‌ها بر اساس موضوع" subtitle="حداکثر پنج موضوع را برای مقایسه انتخاب کنید">
        <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center">
          <select
            multiple
            value={data.filters.trendTopics}
            onChange={(event) => {
              const values = [...event.target.selectedOptions]
                .map((option) => option.value)
                .slice(0, 5);
              updateFilters({ trendTopics: values.join(",") });
            }}
            className="min-h-24 min-w-72 rounded-xl border border-slate-300 p-2 text-xs"
            aria-label="موضوع‌های نمودار روند"
          >
            {data.lookups.topics.map((topic) => (
              <option key={topic.id} value={topic.id}>{topic.path}</option>
            ))}
          </select>
          <p className="text-xs leading-6 text-slate-400">برای انتخاب چند مورد از Ctrl استفاده کنید. نمودار بر اساس {data.range.granularity === "hour" ? "ساعت" : "روز"} گروه‌بندی شده است.</p>
        </div>
        <TopicTrendChart points={data.trend.points} topics={data.trend.topics} />
      </Panel>

      <Panel title="سؤال‌های کارشناسان به تفکیک موضوع" subtitle="Top Topicهای هر کارشناس در بازه انتخاب‌شده">
        {data.employees.items.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[950px] text-right text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500"><tr>{["کارشناس", "واحد", "کل", "Classified", "Unclassified", "موضوع‌های پرتکرار"].map((heading) => <th key={heading} className="px-4 py-3">{heading}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data.employees.items.map((employee) => (
                  <tr key={employee.id}>
                    <td className="px-4 py-4"><Link href={`/admin/accounts/${employee.id}/topics?${rangeQuery}`} className="font-black text-slate-900 hover:text-emerald-700">{employee.name}</Link><p className="mt-1 text-xs text-slate-400">{employee.employeeCode}</p></td>
                    <td className="px-4 py-4 text-slate-600">{employee.department || "—"}</td>
                    <td className="px-4 py-4 font-black">{employee.total.toLocaleString("fa-IR")}</td>
                    <td className="px-4 py-4 text-emerald-700">{employee.classified.toLocaleString("fa-IR")}</td>
                    <td className="px-4 py-4 text-amber-700">{employee.unclassified.toLocaleString("fa-IR")}</td>
                    <td className="px-4 py-4"><div className="flex flex-wrap gap-1.5">{employee.topTopics.slice(0, 3).map((topic) => <span key={topic.id} className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">{topic.path}: {topic.count.toLocaleString("fa-IR")}</span>)}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty />}
        {data.employees.totalPages > 1 && <Pagination page={data.employees.page} total={data.employees.totalPages} onPage={(page) => updateFilters({ employeePage: String(page) })} />}
      </Panel>

      <Panel title="موضوعات به تفکیک واحد" subtitle="تعداد کارشناس فعال و Top 5 Topic هر Department">
        {data.departments.length ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.departments.map((department) => (
              <details key={department.id} className="rounded-2xl border border-slate-200 p-4 open:bg-slate-50">
                <summary className="cursor-pointer list-none"><div className="flex items-start justify-between gap-3"><div><h3 className="font-black">{department.name}</h3><p className="mt-1 text-xs text-slate-400">{department.activeUsers.toLocaleString("fa-IR")} کارشناس فعال</p></div><span className="text-xl font-black">{department.total.toLocaleString("fa-IR")}</span></div><p className="mt-3 text-xs text-slate-500">{department.classified.toLocaleString("fa-IR")} دسته‌بندی‌شده · {department.unclassified.toLocaleString("fa-IR")} بدون موضوع</p></summary>
                <div className="mt-4 space-y-2 border-t border-slate-200 pt-3">{department.topTopics.map((topic) => <div key={topic.id} className="flex justify-between gap-3 text-xs"><span className="truncate text-slate-600">{topic.path}</span><b>{topic.count.toLocaleString("fa-IR")}</b></div>)}</div>
              </details>
            ))}
          </div>
        ) : <Empty />}
      </Panel>

      <Panel title="Heatmap واحد × موضوع" subtitle="شدت رنگ بر اساس تعداد سؤال؛ برای Performance به Top Topicها محدود شده">
        {data.heatmap.rows.length && data.heatmap.topics.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[750px] text-center text-xs">
              <thead><tr><th className="px-3 py-3 text-right">واحد</th>{data.heatmap.topics.map((topic) => <th key={topic.id} className="max-w-28 px-2 py-3"><span className="line-clamp-2">{topic.path}</span></th>)}</tr></thead>
              <tbody>{data.heatmap.rows.map((row) => <tr key={row.id} className="border-t border-slate-100"><th className="px-3 py-3 text-right font-bold">{row.name}</th>{data.heatmap.topics.map((topic) => { const value = row.values[topic.id] || 0; const opacity = data.heatmap.maxValue ? 0.08 + (value / data.heatmap.maxValue) * 0.72 : 0; return <td key={topic.id} className="p-1"><div className="rounded-lg px-2 py-3 font-black" style={{ backgroundColor: `rgba(5, 150, 105, ${opacity})`, color: opacity > 0.45 ? "white" : "#334155" }}>{value.toLocaleString("fa-IR")}</div></td>; })}</tr>)}</tbody>
            </table>
          </div>
        ) : <Empty />}
      </Panel>

      <section className="grid gap-5 xl:grid-cols-2">
        <Panel title="کیفیت Classification" subtitle="فقط پیام‌های classified در Average و Median">
          <dl className="grid gap-3 sm:grid-cols-2"><Info label="میانگین Confidence" value={percent(data.confidence.average * 100)} /><Info label="Median Confidence" value={percent(data.confidence.median * 100)} /><Info label={`کمتر از Threshold ${percent(data.confidence.threshold * 100)}`} value={data.confidence.belowThreshold.toLocaleString("fa-IR")} /><Info label="نرخ Classification" value={percent(data.kpis.classificationRate)} /></dl>
          <h3 className="mt-5 text-sm font-black">Topicهای با Confidence پایین‌تر</h3>
          <div className="mt-3 space-y-2">{data.confidence.lowestTopics.map((topic) => <div key={topic.id} className="flex justify-between rounded-xl bg-slate-50 p-3 text-xs"><span>{topic.path}</span><b>{percent(topic.average * 100)} · {topic.count.toLocaleString("fa-IR")} سؤال</b></div>)}</div>
        </Panel>
        <Panel title="Breakdown وضعیت Classification" subtitle="Pending در نرخ Classified محاسبه نمی‌شود">
          <div className="space-y-4"><StatusBar label="دسته‌بندی‌شده" value={data.kpis.classified.value} total={data.kpis.total.value} color="bg-emerald-500" /><StatusBar label="بدون دسته‌بندی" value={data.kpis.unclassified.value} total={data.kpis.total.value} color="bg-amber-500" /><StatusBar label="خطا" value={data.kpis.error} total={data.kpis.total.value} color="bg-rose-500" /><StatusBar label="در انتظار" value={data.kpis.pending} total={data.kpis.total.value} color="bg-blue-500" /></div>
        </Panel>
      </section>

      <Panel title="سؤال‌های بدون موضوع" subtitle="۲۰ مورد اخیر؛ ورودی آینده بهبود Taxonomy">
        <QuestionsTable questions={data.unclassified} timezone={data.range.timezone} showTopic={false} />
        {data.unclassifiedTotalPages > 1 && <Pagination page={data.filters.unclassifiedPage} total={data.unclassifiedTotalPages} onPage={(page) => updateFilters({ unclassifiedPage: String(page) })} />}
      </Panel>
    </div>
  );
}

export function QuestionsTable({ questions, timezone, showTopic = true }: { questions: TopicQuestion[]; timezone: string; showTopic?: boolean }) {
  if (!questions.length) return <Empty />;
  return (
    <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-right text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{["سؤال", "کارشناس", "واحد", ...(showTopic ? ["موضوع"] : []), "Confidence", "تاریخ", "Conversation"].map((heading) => <th key={heading} className="px-4 py-3">{heading}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{questions.map((question) => <tr key={question.id}><td className="max-w-sm px-4 py-4 text-xs leading-6 text-slate-700"><span className="line-clamp-3">{question.content}</span></td><td className="px-4 py-4">{question.userId ? <Link href={`/admin/accounts/${question.userId}/topics`} className="font-bold hover:text-emerald-700">{question.userName}</Link> : <span className="font-bold">{question.userName}</span>}</td><td className="px-4 py-4 text-slate-600">{question.departmentName || "—"}</td>{showTopic && <td className="px-4 py-4 text-slate-600">{question.topicPath || "—"}</td>}<td className="px-4 py-4">{percent(question.confidence * 100)}</td><td className="whitespace-nowrap px-4 py-4 text-xs text-slate-500">{formatDate(question.created, timezone)}</td><td className="px-4 py-4 font-mono text-[10px] text-slate-400">{question.conversationId || "—"}</td></tr>)}</tbody></table></div>
  );
}

function Filter({ label, value, options, onChange }: { label: string; value: string; options: string[][]; onChange: (value: string) => void }) { return <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-emerald-500"><option value="">{label}</option>{options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>; }
function MetricCard({ label, metric, color = "text-slate-950" }: { label: string; metric: TopicAnalyticsMetric; color?: string }) { return <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm font-bold text-slate-500">{label}</p><div className="mt-3 flex items-end justify-between gap-2"><p className={`text-2xl font-black ${color}`}>{metric.value.toLocaleString("fa-IR")}</p><Change value={metric.changePercent} /></div><p className="mt-2 text-[10px] text-slate-400">دوره قبل: {metric.previous.toLocaleString("fa-IR")}</p></div>; }
function SimpleCard({ label, value, detail, compact }: { label: string; value: string; detail: string; compact?: boolean }) { return <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm font-bold text-slate-500">{label}</p><p className={`mt-3 font-black text-slate-950 ${compact ? "line-clamp-2 text-base" : "text-2xl"}`}>{value}</p><p className="mt-2 text-[10px] text-slate-400">{detail}</p></div>; }
function Change({ value }: { value: number | null }) { if (value === null) return <span className="text-[10px] text-slate-400">بدون مبنا</span>; return <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${value > 0 ? "bg-emerald-50 text-emerald-700" : value < 0 ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-500"}`}>{value > 0 ? "+" : ""}{value.toLocaleString("fa-IR", { maximumFractionDigits: 1 })}٪</span>; }
function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) { return <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><h2 className="text-lg font-black">{title}</h2><p className="mt-1 text-sm text-slate-500">{subtitle}</p><div className="mt-5">{children}</div></section>; }
function Info({ label, value }: { label: string; value: string }) { return <div className="rounded-xl bg-slate-50 p-4"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-2 text-lg font-black">{value}</dd></div>; }
function StatusBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) { const ratio = total ? (value / total) * 100 : 0; return <div><div className="mb-2 flex justify-between text-sm"><span className="font-bold text-slate-600">{label}</span><span>{value.toLocaleString("fa-IR")} · {percent(ratio)}</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full ${color}`} style={{ width: `${ratio}%` }} /></div></div>; }
function Pagination({ page, total, onPage }: { page: number; total: number; onPage: (page: number) => void }) { return <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4"><button disabled={page <= 1} onClick={() => onPage(page - 1)} className="rounded-lg border px-3 py-1.5 text-sm font-bold disabled:opacity-40">قبلی</button><span className="text-xs text-slate-500">صفحه {page.toLocaleString("fa-IR")} از {total.toLocaleString("fa-IR")}</span><button disabled={page >= total} onClick={() => onPage(page + 1)} className="rounded-lg border px-3 py-1.5 text-sm font-bold disabled:opacity-40">بعدی</button></div>; }
function Empty() { return <p className="py-12 text-center text-sm text-slate-400">داده‌ای برای نمایش وجود ندارد.</p>; }
function percent(value: number) { return `${value.toLocaleString("fa-IR", { maximumFractionDigits: 1 })}٪`; }
function formatDate(value: string, timezone: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("fa-IR", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" }).format(date); }
function comparison(value: number, previous: number) { if (!previous) return value ? "بدون مبنای دوره قبل" : "بدون تغییر"; const change = ((value - previous) / previous) * 100; return `${change > 0 ? "+" : ""}${change.toLocaleString("fa-IR", { maximumFractionDigits: 1 })}٪ نسبت به دوره قبل`; }
function pickRangeQuery(params: URLSearchParams) { const output = new URLSearchParams(); for (const key of ["range", "from", "to", "department", "account", "parentTopic", "topic", "status"]) { const value = params.get(key); if (value) output.set(key, value); } return output.toString(); }
