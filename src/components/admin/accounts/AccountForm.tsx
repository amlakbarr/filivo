"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

import ResetPasswordForm from "@/components/admin/accounts/ResetPasswordForm";
import type { AccountApiError, AccountRole, ManagedAccount } from "@/types/account";

type Department = { id: string; name: string; active: boolean };
type LookupsResponse = { success: true; departments: Department[] };
type ItemResponse = { success: true; account: ManagedAccount; currentAccountId?: string; message?: string };

export default function AccountForm({ accountId }: { accountId?: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [currentAccountId, setCurrentAccountId] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [employeeCode, setEmployeeCode] = useState("");
  const [department, setDepartment] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [role, setRole] = useState<AccountRole>("employee");
  const [active, setActive] = useState(true);
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const isSelf = Boolean(accountId && accountId === currentAccountId);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [lookupResponse, itemResponse] = await Promise.all([
          fetch("/api/admin/accounts/lookups", { cache: "no-store" }),
          accountId ? fetch(`/api/admin/accounts/${accountId}`, { cache: "no-store" }) : null,
        ]);
        const lookupData = await lookupResponse.json() as LookupsResponse | AccountApiError;
        if (!lookupResponse.ok || !lookupData.success) throw new Error("message" in lookupData ? lookupData.message : "دریافت دپارتمان‌ها ناموفق بود.");
        if (cancelled) return;
        setDepartments(lookupData.departments);
        if (itemResponse) {
          const itemData = await itemResponse.json() as ItemResponse | AccountApiError;
          if (!itemResponse.ok || !itemData.success) throw new Error("message" in itemData ? itemData.message : "حساب پیدا نشد.");
          if (cancelled) return;
          setCurrentAccountId(itemData.currentAccountId || "");
          setName(itemData.account.name);
          setEmail(itemData.account.email);
          setEmployeeCode(itemData.account.employee_code);
          setDepartment(itemData.account.department);
          setJobTitle(itemData.account.job_title);
          setRole(itemData.account.role);
          setActive(itemData.account.active);
        }
      } catch (error) {
        if (!cancelled) setNotice({ type: "error", text: error instanceof Error ? error.message : "بارگذاری فرم ناموفق بود." });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [accountId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setNotice(null);
    setFieldErrors({});
    try {
      const response = await fetch(accountId ? `/api/admin/accounts/${accountId}` : "/api/admin/accounts", {
        method: accountId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          employee_code: employeeCode,
          department,
          job_title: jobTitle,
          role,
          active,
          ...(!accountId ? { password, passwordConfirm } : {}),
        }),
      });
      const data = await response.json() as ItemResponse | AccountApiError;
      if (!response.ok || !data.success) {
        if ("fieldErrors" in data && data.fieldErrors) setFieldErrors(data.fieldErrors);
        throw new Error("message" in data ? data.message : "ذخیره حساب ناموفق بود.");
      }
      setNotice({ type: "success", text: data.message || "اطلاعات با موفقیت ذخیره شد." });
      if (!accountId) window.setTimeout(() => router.replace(`/admin/accounts/${data.account.id}/edit`), 700);
      else router.refresh();
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "ذخیره حساب ناموفق بود." });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="space-y-4"><div className="h-24 animate-pulse rounded-3xl bg-slate-100" /><div className="h-[520px] animate-pulse rounded-3xl bg-slate-100" /></div>;

  const availableDepartments = departments.filter((item) => item.active || (Boolean(accountId) && item.id === department));

  return (
    <div className="space-y-5">
      <div><Link href="/admin/accounts" className="text-sm font-bold text-emerald-700">→ بازگشت به کارشناسان</Link><h1 className="mt-2 text-2xl font-black sm:text-3xl">{accountId ? "ویرایش حساب" : "کاربر جدید"}</h1><p className="mt-2 text-sm text-slate-500">اطلاعات هویتی و سطح دسترسی کاربر را مدیریت کنید.</p></div>
      {notice && <div role="status" className={`rounded-2xl border px-4 py-3 text-sm font-bold ${notice.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"}`}>{notice.text}</div>}
      {isSelf && <div className="rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-800">این حساب متعلق به شماست؛ غیرفعال‌سازی و کاهش Role آن برای حفظ دسترسی مدیریت مسدود است.</div>}
      <form onSubmit={submit} className="space-y-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="نام" required error={fieldErrors.name}><input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} className={inputClass(Boolean(fieldErrors.name))} /></Field>
          <Field label="ایمیل" required error={fieldErrors.email}><input required type="email" dir="ltr" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} className={`${inputClass(Boolean(fieldErrors.email))} text-left`} placeholder="name@company.com" /></Field>
          <Field label="کد کارشناس" required error={fieldErrors.employee_code}><input required maxLength={50} value={employeeCode} onChange={(event) => setEmployeeCode(event.target.value)} className={inputClass(Boolean(fieldErrors.employee_code))} /></Field>
          <Field label="سمت شغلی" error={fieldErrors.job_title}><input maxLength={120} value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} className={inputClass(Boolean(fieldErrors.job_title))} placeholder="مثلاً کارشناس پشتیبانی" /></Field>
          <Field label="دپارتمان" error={fieldErrors.department}><select value={department} onChange={(event) => setDepartment(event.target.value)} className={inputClass(Boolean(fieldErrors.department))}><option value="">بدون دپارتمان</option>{availableDepartments.map((item) => <option key={item.id} value={item.id}>{item.name}{!item.active ? " (غیرفعال)" : ""}</option>)}</select></Field>
          <Field label="Role" required error={fieldErrors.role}><select value={role} onChange={(event) => setRole(event.target.value as AccountRole)} disabled={isSelf} className={`${inputClass(Boolean(fieldErrors.role))} disabled:bg-slate-100`}><option value="employee">کارشناس</option><option value="admin">مدیر</option></select></Field>
        </div>

        {!accountId && <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><h2 className="font-black text-slate-800">رمز عبور اولیه</h2><p className="mt-1 text-xs text-slate-500">حداقل ۱۰ نویسه شامل یک حرف و یک عدد</p><div className="mt-4 grid gap-5 md:grid-cols-2"><Field label="رمز عبور" required error={fieldErrors.password}><input required minLength={10} maxLength={128} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className={inputClass(Boolean(fieldErrors.password))} /></Field><Field label="تکرار رمز عبور" required error={fieldErrors.passwordConfirm}><input required minLength={10} maxLength={128} type="password" autoComplete="new-password" value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} className={inputClass(Boolean(fieldErrors.passwordConfirm))} /></Field></div></section>}

        <label className={`flex items-center justify-between rounded-2xl border border-slate-200 p-4 ${isSelf ? "cursor-not-allowed bg-slate-50" : "cursor-pointer"}`}><span><span className="block text-sm font-black text-slate-800">حساب فعال باشد</span><span className="mt-1 block text-xs text-slate-500">حساب غیرفعال امکان ورود یا استفاده از APIهای محافظت‌شده را ندارد.</span></span><input type="checkbox" checked={active} disabled={isSelf} onChange={(event) => setActive(event.target.checked)} className="size-5 accent-emerald-600" /></label>

        <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-5 sm:flex-row sm:justify-end"><Link href="/admin/accounts" className="rounded-xl border border-slate-300 px-5 py-3 text-center text-sm font-black text-slate-700">انصراف</Link><button type="submit" disabled={saving} className="rounded-xl bg-emerald-600 px-6 py-3 text-sm font-black text-white hover:bg-emerald-700 disabled:opacity-50">{saving ? "در حال ذخیره..." : accountId ? "ذخیره تغییرات" : "ساخت حساب"}</button></div>
      </form>
      {accountId && <ResetPasswordForm accountId={accountId} />}
    </div>
  );
}

function Field({ label, required, error, children }: { label: string; required?: boolean; error?: string; children: React.ReactNode }) { return <label className="block"><span className="mb-2 block text-sm font-black text-slate-700">{label}{required && <span className="mr-1 text-rose-500">*</span>}</span>{children}{error && <span className="mt-1 block text-xs font-bold text-rose-600">{error}</span>}</label>; }
function inputClass(error: boolean) { return `w-full rounded-xl border bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-100 ${error ? "border-rose-300" : "border-slate-300 focus:border-emerald-500"}`; }
