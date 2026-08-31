import type {
  ReactNode,
} from "react";

import {
  redirect,
} from "next/navigation";

import AdminEvalAlerts from "@/components/admin/AdminEvalAlerts";

import AdminSidebar from "@/components/admin/AdminSidebar";

import {
  getCurrentAccount,
} from "@/lib/pocketbase/auth";

export default async function AdminLayout({
  children,
}: {
  children:
    ReactNode;
}) {
  const account =
    await getCurrentAccount();

  if (
    !account
  ) {
    redirect(
      "/login"
    );
  }

  if (
    account.role !==
    "admin"
  ) {
    redirect(
      "/chat"
    );
  }

  return (
    <div
      className="min-h-screen bg-slate-50 text-slate-950"
      dir="rtl"
    >

      <AdminSidebar
        accountName={
          account.name ||
          account.email
        }
      />

      <main className="min-h-screen lg:mr-72">

        <div className="mx-auto w-full max-w-[1500px] space-y-4 p-4 sm:p-6 lg:p-8">

          <AdminEvalAlerts />

          {
            children
          }

        </div>

      </main>

    </div>
  );
}
