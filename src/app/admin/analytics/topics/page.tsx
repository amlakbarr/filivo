import { Suspense } from "react";
import TopicAnalyticsDashboard from "@/components/admin/analytics/TopicAnalyticsDashboard";

export default function TopicAnalyticsPage() {
  return <Suspense fallback={<div className="h-96 animate-pulse rounded-3xl bg-slate-100" />}><TopicAnalyticsDashboard /></Suspense>;
}
