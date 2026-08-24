"use client";

import { FormEvent, useState } from "react";
import type { AccountApiError } from "@/types/account";

export default function ResetPasswordForm({ accountId }: { accountId: string }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setMessage(null);
    setErrors({});
    try {
      const response = await fetch(`/api/admin/accounts/${accountId}/password`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password, passwordConfirm }) });
      const data = await response.json() as { success: true; message: string } | AccountApiError;
      if (!response.ok || !data.success) {
        if ("fieldErrors" in data && data.fieldErrors) setErrors(data.fieldErrors);
        throw new Error(data.message || "تغییر رمز عبور ناموفق بود.");
      }
      setPassword("");
      setPasswordConfirm("");
      setMessage({ type: "success", text: data.message });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "تغییر رمز عبور ناموفق بود." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
      <div className="flex items-center justify-between gap-4"><div><h2 className="font-black text-slate-900">تغییر رمز عبور</h2><p className="mt-1 text-sm text-slate-500">رمز جدید در پاسخ یا هیچ Collection جانبی ذخیره نمی‌شود.</p></div><button type="button" onClick={() => setOpen((value) => !value)} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700">{open ? "بستن" : "تعیین رمز جدید"}</button></div>
      {open && <form onSubmit={submit} className="mt-5 grid gap-4 border-t border-slate-100 pt-5 md:grid-cols-2"><label className="block"><span className="mb-2 block text-sm font-black">رمز جدید</span><input required minLength={10} maxLength={128} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none focus:border-emerald-500" />{errors.password && <span className="mt-1 block text-xs font-bold text-rose-600">{errors.password}</span>}</label><label className="block"><span className="mb-2 block text-sm font-black">تکرار رمز جدید</span><input required minLength={10} maxLength={128} type="password" autoComplete="new-password" value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none focus:border-emerald-500" />{errors.passwordConfirm && <span className="mt-1 block text-xs font-bold text-rose-600">{errors.passwordConfirm}</span>}</label>{message && <div className={`rounded-xl px-3 py-2 text-sm font-bold md:col-span-2 ${message.type === "success" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{message.text}</div>}<button type="submit" disabled={loading} className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-black text-white disabled:opacity-50 md:col-start-2 md:justify-self-end">{loading ? "در حال تغییر..." : "تغییر رمز عبور"}</button></form>}
    </section>
  );
}
