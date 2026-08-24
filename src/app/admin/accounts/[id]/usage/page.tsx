import { Suspense } from "react";
import AccountUsage from "@/components/admin/analytics/AccountUsage";

export default async function AccountUsagePage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <Suspense fallback={<div className="h-96 animate-pulse rounded-3xl bg-slate-100" />}><AccountUsage accountId={id} /></Suspense>; }
