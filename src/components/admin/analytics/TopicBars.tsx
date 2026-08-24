"use client";

import Link from "next/link";
import type { TopicCount } from "@/types/topic-analytics";

export default function TopicBars({
  items,
  rangeQuery,
}: {
  items: TopicCount[];
  rangeQuery: string;
}) {
  const max = Math.max(0, ...items.map((item) => item.count));

  if (!items.length) {
    return <p className="py-16 text-center text-sm text-slate-400">در بازه انتخاب‌شده سؤال دسته‌بندی‌شده‌ای وجود ندارد.</p>;
  }

  return (
    <div className="space-y-4">
      {items.map((item) => (
        <div key={item.id}>
          <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
            <Link href={`/admin/analytics/topics/${item.id}?${rangeQuery}`} className="truncate font-bold text-slate-700 hover:text-emerald-700">
              {item.path}
              {!item.active && <span className="mr-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">غیرفعال</span>}
            </Link>
            <span className="whitespace-nowrap font-black text-slate-900">{item.count.toLocaleString("fa-IR")} <span className="text-[10px] font-normal text-slate-400">({item.percentage.toLocaleString("fa-IR", { maximumFractionDigits: 1 })}٪)</span></span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${max ? (item.count / max) * 100 : 0}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
