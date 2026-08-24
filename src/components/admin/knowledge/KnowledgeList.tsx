"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";

import { StatusBadge, SyncBadge } from "@/components/admin/knowledge/StatusBadge";
import type { KnowledgeApiError, KnowledgeItem, TopicOption } from "@/types/knowledge";

type ListResponse = { success: true; items: KnowledgeItem[]; page: number; perPage: number; totalItems: number; totalPages: number };
type LookupsResponse = { success: true; topics: TopicOption[] };

export default function KnowledgeList() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [searchInput, setSearchInput] = useState(searchParams.get("search") || "");
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [topics, setTopics] = useState<TopicOption[]>([]);
  const [meta, setMeta] = useState({ page: Number(searchParams.get("page")) || 1, totalPages: 1, totalItems: 0 });
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState("");
  const [bulkLoading, setBulkLoading] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const queryString = searchParams.toString();
  const loadItems = useCallback(async () => {
    try {
      const response = await fetch(`/api/admin/knowledge?${queryString}`, { cache: "no-store" });
      const data = (await response.json()) as ListResponse | KnowledgeApiError;
      if (!response.ok || !data.success) throw new Error("message" in data ? data.message : "دریافت اطلاعات ناموفق بود.");
      setItems(data.items);
      setMeta({ page: data.page, totalPages: Math.max(data.totalPages, 1), totalItems: data.totalItems });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "دریافت اطلاعات ناموفق بود." });
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/knowledge?${queryString}`, { cache: "no-store" })
      .then(async (response) => ({ response, data: (await response.json()) as ListResponse | KnowledgeApiError }))
      .then(({ response, data }) => {
        if (!response.ok || !data.success) throw new Error("message" in data ? data.message : "دریافت اطلاعات ناموفق بود.");
        if (!cancelled) {
          setItems(data.items);
          setMeta({ page: data.page, totalPages: Math.max(data.totalPages, 1), totalItems: data.totalItems });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setNotice({ type: "error", text: error instanceof Error ? error.message : "دریافت اطلاعات ناموفق بود." });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [queryString]);
  useEffect(() => {
    fetch("/api/admin/knowledge/lookups", { cache: "no-store" })
      .then(async (response) => ({ response, data: (await response.json()) as LookupsResponse | KnowledgeApiError }))
      .then(({ response, data }) => { if (response.ok && data.success) setTopics(data.topics); })
      .catch(() => undefined);
  }, []);

  function updateParams(changes: Record<string, string>) {
    setLoading(true);
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    }
    if (!("page" in changes)) params.delete("page");
    router.replace(`/admin/knowledge${params.size ? `?${params}` : ""}`, { scroll: false });
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    updateParams({ search: searchInput.trim() });
  }

  async function itemAction(item: KnowledgeItem, action: "sync" | "archive" | "delete") {
    const confirmation = action === "archive"
      ? "این مطلب بایگانی و از Vector Store خارج شود؟"
      : action === "delete"
        ? "این پیش‌نویس برای همیشه حذف شود؟ این عملیات بازگشت‌پذیر نیست."
        : "";
    if (confirmation && !window.confirm(confirmation)) return;
    setActionId(`${item.id}:${action}`);
    setNotice(null);
    try {
      const path = action === "sync" ? `/api/admin/knowledge/${item.id}/sync` : action === "archive" ? `/api/admin/knowledge/${item.id}/archive` : `/api/admin/knowledge/${item.id}`;
      const response = await fetch(path, { method: action === "delete" ? "DELETE" : "POST" });
      const data = (await response.json()) as { success: boolean; message?: string; code?: string };
      if (!response.ok || !data.success) throw new Error(data.message || "عملیات ناموفق بود.");
      setNotice({ type: "success", text: data.message || (action === "sync" ? "همگام‌سازی با موفقیت انجام شد." : "عملیات با موفقیت انجام شد.") });
      await loadItems();
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "عملیات ناموفق بود." });
      await loadItems();
    } finally {
      setActionId("");
    }
  }

  async function bulkSync() {
    if (bulkLoading) return;
    setBulkLoading(true);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/knowledge/sync-pending", { method: "POST" });
      const data = await response.json() as { success: boolean; message?: string; summary?: { succeeded: number; failed: number; total: number } };
      if (!response.ok) throw new Error(data.message || "همگام‌سازی گروهی ناموفق بود.");
      const summary = data.summary;
      setNotice({ type: summary?.failed ? "error" : "success", text: summary ? `همگام‌سازی تمام شد: ${summary.succeeded.toLocaleString("fa-IR")} موفق و ${summary.failed.toLocaleString("fa-IR")} ناموفق از ${summary.total.toLocaleString("fa-IR")} مورد.` : "همگام‌سازی گروهی تمام شد." });
      await loadItems();
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "همگام‌سازی گروهی ناموفق بود." });
    } finally {
      setBulkLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-sm font-bold text-emerald-700">مدیریت محتوا</p><h1 className="mt-1 text-2xl font-black sm:text-3xl">پایگاه دانش</h1><p className="mt-2 text-sm text-slate-500">{meta.totalItems.toLocaleString("fa-IR")} مطلب ثبت‌شده</p></div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={bulkSync} disabled={bulkLoading} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">{bulkLoading ? "در حال همگام‌سازی..." : "همگام‌سازی موارد در انتظار"}</button>
          <Link href="/admin/knowledge/new" className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-emerald-700">+ مطلب جدید</Link>
        </div>
      </div>

      {notice && <div role="status" className={`rounded-2xl border px-4 py-3 text-sm font-bold ${notice.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"}`}>{notice.text}</div>}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <form onSubmit={submitSearch} className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <div className="flex xl:col-span-2"><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="جستجو بر اساس عنوان..." className="min-w-0 flex-1 rounded-r-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-emerald-500" /><button className="rounded-l-xl bg-slate-800 px-4 text-sm font-bold text-white">جستجو</button></div>
          <FilterSelect label="همه وضعیت‌ها" value={searchParams.get("status") || ""} onChange={(value) => updateParams({ status: value })} options={[["draft", "پیش‌نویس"], ["published", "منتشرشده"], ["archived", "بایگانی"]]} />
          <FilterSelect label="همه وضعیت‌های Sync" value={searchParams.get("sync_status") || ""} onChange={(value) => updateParams({ sync_status: value })} options={[["pending", "در انتظار"], ["synced", "همگام‌شده"], ["error", "خطا"]]} />
          <FilterSelect label="همه موضوعات" value={searchParams.get("topic") || ""} onChange={(value) => updateParams({ topic: value })} options={topics.map((topic) => [topic.id, topic.label])} />
          <FilterSelect label="جدیدترین" value={searchParams.get("order") || "newest"} onChange={(value) => updateParams({ order: value === "newest" ? "" : value })} options={[["oldest", "قدیمی‌ترین"]]} />
        </form>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {loading ? <LoadingRows /> : items.length === 0 ? <div className="px-6 py-20 text-center"><div className="mx-auto grid size-14 place-items-center rounded-2xl bg-slate-100 text-2xl">◫</div><h2 className="mt-4 font-black text-slate-800">مطلبی پیدا نشد</h2><p className="mt-2 text-sm text-slate-500">فیلترها را تغییر دهید یا اولین مطلب را بسازید.</p></div> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-right text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{["عنوان", "موضوع", "واحد", "وضعیت", "وضعیت Sync", "نسخه", "آخرین بروزرسانی", "عملیات"].map((heading) => <th key={heading} className="px-4 py-3 font-bold">{heading}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{items.map((item) => (
            <tr key={item.id} className="align-top hover:bg-slate-50/70"><td className="max-w-64 px-4 py-4"><p className="truncate font-black text-slate-900">{item.title}</p><p className="mt-1 text-xs text-slate-400">{item.source_type === "file" ? `فایل: ${item.attachment}` : "متن"}</p></td><td className="px-4 py-4 text-slate-600">{item.topic_name || "بدون موضوع"}</td><td className="px-4 py-4 text-slate-600">{item.department_names.length ? item.department_names.join("، ") : "عمومی"}</td><td className="px-4 py-4"><StatusBadge value={item.status} /></td><td className="px-4 py-4"><SyncBadge value={item.sync_status} />{item.sync_error && <details className="mt-2 max-w-56 text-xs text-rose-600"><summary className="cursor-pointer font-bold">مشاهده خطا</summary><p className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-rose-50 p-2 leading-5">{item.sync_error}</p></details>}</td><td className="px-4 py-4 font-bold text-slate-700">{item.version.toLocaleString("fa-IR")}</td><td className="whitespace-nowrap px-4 py-4 text-xs text-slate-500">{formatDate(item.updated || item.created)}</td><td className="px-4 py-4"><div className="flex flex-wrap gap-2"><Link href={`/admin/knowledge/${item.id}/edit`} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-white">ویرایش</Link>{item.status === "published" && <button type="button" disabled={Boolean(actionId)} onClick={() => itemAction(item, "sync")} className="rounded-lg border border-blue-200 px-2.5 py-1.5 text-xs font-bold text-blue-700 disabled:opacity-50">{actionId === `${item.id}:sync` ? "..." : "همگام‌سازی مجدد"}</button>}{item.status === "published" && <button type="button" disabled={Boolean(actionId)} onClick={() => itemAction(item, "archive")} className="rounded-lg border border-amber-200 px-2.5 py-1.5 text-xs font-bold text-amber-700 disabled:opacity-50">{actionId === `${item.id}:archive` ? "..." : "بایگانی"}</button>}{item.status === "draft" && <button type="button" disabled={Boolean(actionId)} onClick={() => itemAction(item, "delete")} className="rounded-lg border border-rose-200 px-2.5 py-1.5 text-xs font-bold text-rose-700 disabled:opacity-50">{actionId === `${item.id}:delete` ? "..." : "حذف"}</button>}</div></td></tr>
          ))}</tbody></table></div>
        )}
        {!loading && meta.totalPages > 1 && <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3"><button type="button" disabled={meta.page <= 1} onClick={() => updateParams({ page: String(meta.page - 1) })} className="rounded-lg border px-3 py-1.5 text-sm font-bold disabled:opacity-40">قبلی</button><span className="text-sm text-slate-500">صفحه {meta.page.toLocaleString("fa-IR")} از {meta.totalPages.toLocaleString("fa-IR")}</span><button type="button" disabled={meta.page >= meta.totalPages} onClick={() => updateParams({ page: String(meta.page + 1) })} className="rounded-lg border px-3 py-1.5 text-sm font-bold disabled:opacity-40">بعدی</button></div>}
      </section>
    </div>
  );
}

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: string[][]; onChange: (value: string) => void }) { return <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-emerald-500"><option value="">{label}</option>{options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select>; }
function LoadingRows() { return <div className="space-y-3 p-5" aria-label="در حال بارگذاری">{Array.from({ length: 6 }, (_, index) => <div key={index} className="h-14 animate-pulse rounded-xl bg-slate-100" />)}</div>; }
function formatDate(value: string) { if (!value) return "—"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short" }).format(date); }
