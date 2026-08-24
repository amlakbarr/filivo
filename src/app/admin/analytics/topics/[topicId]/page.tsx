import { Suspense } from "react";

import TopicDetails from "@/components/admin/analytics/TopicDetails";

export default async function TopicDetailsPage({ params }: { params: Promise<{ topicId: string }> }) {
  const { topicId } = await params;
  return <Suspense fallback={<div className="h-96 animate-pulse rounded-3xl bg-slate-100" />}><TopicDetails topicId={topicId} /></Suspense>;
}
