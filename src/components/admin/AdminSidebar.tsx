"use client";

import Link from "next/link";

import {
  usePathname,
  useRouter,
} from "next/navigation";

import {
  useState,
} from "react";

const navigation = [
  {
    href:
      "/admin",

    label:
      "داشبورد",

    icon:
      "⌂",

    exact:
      true,
  },
  {
    href:
      "/admin/knowledge",

    label:
      "پایگاه دانش",

    icon:
      "◫",
  },
  {
    href:
      "/admin/topics",

    label:
      "موضوعات",

    icon:
      "⌘",
  },
  {
    href:
      "/admin/conversations",

    label:
      "مکالمات",

    icon:
      "◉",
  },
  {
    href:
      "/admin/accounts",

    label:
      "کارشناسان",

    icon:
      "♙",
  },
  {
    href:
      "/admin/analytics/topics",

    label:
      "تحلیل موضوعی",

    icon:
      "◈",
  },
  {
    href:
      "/admin/analytics/feedback",

    label:
      "کیفیت پاسخ‌ها",

    icon:
      "◎",
  },
  {
  href:
    "/admin/analytics/grounding",

  label:
    "کنترل صحت AI",

  icon:
    "⊙",
},
  {
    href:
      "/admin/reports",

    label:
      "گزارش‌ها",

    icon:
      "⌁",
  },
  {
    href:
      "/admin/audit",

    label:
      "گزارش امنیتی",

    icon:
      "◇",
  },
] as const;

export default function AdminSidebar({
  accountName,
}: {
  accountName:
    string;
}) {
  const pathname =
    usePathname();

  const router =
    useRouter();

  const [
    menuOpen,
    setMenuOpen,
  ] =
    useState(
      false
    );

  const [
    loggingOut,
    setLoggingOut,
  ] =
    useState(
      false
    );

  async function logout() {
    if (
      loggingOut
    ) {
      return;
    }

    setLoggingOut(
      true
    );

    try {
      await fetch(
        "/api/auth/logout",
        {
          method:
            "POST",
        }
      );

      router.replace(
        "/login"
      );

      router.refresh();
    } finally {
      setLoggingOut(
        false
      );
    }
  }

  return (
    <>
      {/* Mobile Header */}

      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur lg:hidden">

        <div>

          <p className="text-sm font-black text-slate-900">
            مرکز مدیریت
          </p>

          <p className="text-xs text-slate-500">
            {accountName ||
              "مدیر سیستم"}
          </p>

        </div>

        <button
          type="button"
          onClick={() =>
            setMenuOpen(
              (
                open
              ) =>
                !open
            )
          }
          className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700"
          aria-expanded={
            menuOpen
          }
          aria-label="نمایش منوی مدیریت"
        >
          منو
        </button>

      </header>

      {/* Mobile Overlay */}

      {menuOpen && (
        <button
          type="button"
          aria-label="بستن منو"
          className="fixed inset-0 z-30 bg-slate-950/30 lg:hidden"
          onClick={() =>
            setMenuOpen(
              false
            )
          }
        />
      )}

      {/* Sidebar */}

      <aside
        className={`fixed inset-y-0 right-0 z-40 flex w-72 flex-col border-l border-slate-200 bg-white px-4 py-5 transition-transform lg:translate-x-0 ${
          menuOpen
            ? "translate-x-0"
            : "translate-x-full"
        }`}
      >

        {/* Logo */}

        <div className="mb-8 flex items-center gap-3 px-2">

          <div className="grid size-11 place-items-center rounded-2xl bg-emerald-600 text-xl font-black text-white shadow-lg shadow-emerald-600/20">
            AI
          </div>

          <div>

            <p className="font-black text-slate-950">
              مرکز مدیریت
            </p>

            <p className="text-xs text-slate-500">
              دستیار هوشمند سازمانی
            </p>

          </div>

        </div>

        {/* Navigation */}

        <nav
          className="space-y-1.5 overflow-y-auto"
          aria-label="منوی مدیریت"
        >

          {navigation.map(
            (
              item
            ) => {
              const active =
                "exact" in
                  item &&
                item.exact
                  ? pathname ===
                    item.href
                  : (
                      pathname ===
                        item.href ||
                      pathname.startsWith(
                        `${item.href}/`
                      )
                    );

              return (
                <Link
                  key={
                    item.href
                  }
                  href={
                    item.href
                  }
                  onClick={() =>
                    setMenuOpen(
                      false
                    )
                  }
                  aria-current={
                    active
                      ? "page"
                      : undefined
                  }
                  className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-bold transition ${
                    active
                      ? "bg-emerald-50 text-emerald-700"
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
                  }`}
                >

                  <span
                    className="grid size-7 shrink-0 place-items-center text-lg"
                    aria-hidden
                  >
                    {
                      item.icon
                    }
                  </span>

                  <span className="min-w-0 truncate">
                    {
                      item.label
                    }
                  </span>

                </Link>
              );
            }
          )}

        </nav>

        {/* Footer */}

        <div className="mt-auto space-y-2 border-t border-slate-100 pt-4">

          <div className="mb-3 px-3">

            <p className="text-xs text-slate-400">
              واردشده با حساب
            </p>

            <p className="mt-1 truncate text-sm font-bold text-slate-700">
              {accountName ||
                "مدیر سیستم"}
            </p>

          </div>

          <Link
            href="/chat"
            onClick={() =>
              setMenuOpen(
                false
              )
            }
            className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-bold text-slate-600 transition hover:bg-slate-50"
          >

            <span
              className="grid size-7 place-items-center text-lg"
              aria-hidden
            >
              ↩
            </span>

            بازگشت به چت

          </Link>

          <button
            type="button"
            onClick={
              logout
            }
            disabled={
              loggingOut
            }
            className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-bold text-rose-600 transition hover:bg-rose-50 disabled:opacity-50"
          >

            <span
              className="grid size-7 place-items-center text-lg"
              aria-hidden
            >
              ⇥
            </span>

            {loggingOut
              ? "در حال خروج..."
              : "خروج"}

          </button>

        </div>

      </aside>

    </>
  );
}
