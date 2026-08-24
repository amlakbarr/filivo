import { Suspense } from "react";

import AccountTopics from "@/components/admin/analytics/AccountTopics";

export default async function AccountTopicsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense fallback={<div className="h-96 animate-pulse rounded-3xl bg-slate-100" />}><AccountTopics accountId={id} /></Suspense>;
}
