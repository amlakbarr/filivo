import { Suspense } from "react";
import AccountsList from "@/components/admin/accounts/AccountsList";

export default function AccountsPage() { return <Suspense fallback={<div className="h-72 animate-pulse rounded-3xl bg-slate-100" />}><AccountsList /></Suspense>; }
