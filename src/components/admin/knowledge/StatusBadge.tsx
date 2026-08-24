import type { KnowledgeStatus, KnowledgeSyncStatus } from "@/types/knowledge";

const statusMap: Record<KnowledgeStatus, { label: string; className: string }> = {
  draft: { label: "پیش‌نویس", className: "bg-slate-100 text-slate-700" },
  published: { label: "منتشرشده", className: "bg-emerald-50 text-emerald-700" },
  archived: { label: "بایگانی", className: "bg-amber-50 text-amber-700" },
};
const syncMap: Record<KnowledgeSyncStatus, { label: string; className: string }> = {
  pending: { label: "در انتظار همگام‌سازی", className: "bg-blue-50 text-blue-700" },
  synced: { label: "همگام‌شده", className: "bg-emerald-50 text-emerald-700" },
  error: { label: "خطای همگام‌سازی", className: "bg-rose-50 text-rose-700" },
};

export function StatusBadge({ value }: { value: KnowledgeStatus }) {
  const config = statusMap[value] || statusMap.draft;
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${config.className}`}>{config.label}</span>;
}

export function SyncBadge({ value }: { value: KnowledgeSyncStatus }) {
  const config = syncMap[value] || syncMap.pending;
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${config.className}`}>{config.label}</span>;
}
