import type { AccountRole } from "@/types/account";

export function ActiveBadge({ active }: { active: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
      <span className={`size-1.5 rounded-full ${active ? "bg-emerald-500" : "bg-slate-400"}`} />
      {active ? "فعال" : "غیرفعال"}
    </span>
  );
}

export function RoleBadge({ role }: { role: AccountRole }) {
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${role === "admin" ? "bg-violet-50 text-violet-700" : "bg-blue-50 text-blue-700"}`}>{role === "admin" ? "مدیر" : "کارشناس"}</span>;
}
