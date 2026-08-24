import {
  Suspense,
} from "react";

import AIBudgetAlerts from "@/components/admin/analytics/AIBudgetAlerts";

import AdminDashboard from "@/components/admin/analytics/AdminDashboard";

export default function AdminPage() {
  return (
    <div className="space-y-6">

      <AIBudgetAlerts />

      <Suspense
        fallback={
          <div className="h-96 animate-pulse rounded-3xl bg-slate-100" />
        }
      >
        <AdminDashboard />
      </Suspense>

    </div>
  );
}