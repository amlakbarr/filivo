import { Suspense } from "react";
import KnowledgeList from "@/components/admin/knowledge/KnowledgeList";

export default function KnowledgePage() {
  return <Suspense fallback={<div className="h-72 animate-pulse rounded-3xl bg-slate-100" />}><KnowledgeList /></Suspense>;
}
