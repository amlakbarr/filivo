"use client";

import Link from "next/link";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type {
  AdminEvalAlert,
  AdminEvalAlertsResponse,
} from "@/types/admin-eval-alerts";

const POLL_INTERVAL_MS =
  15_000;

export default function AdminEvalAlerts() {
  const [
    alerts,
    setAlerts,
  ] =
    useState<
      AdminEvalAlert[]
    >(
      []
    );

  const loadingRef =
    useRef(
      false
    );

  const load =
    useCallback(
      async () => {
        if (
          loadingRef.current
        ) {
          return;
        }

        loadingRef.current =
          true;

        try {
          const response =
            await fetch(
              "/api/admin/evals/alerts",
              {
                cache:
                  "no-store",
              }
            );

          const body =
            (
              await response.json()
            ) as
              AdminEvalAlertsResponse;

          if (
            response.ok &&
            body.success
          ) {
            setAlerts(
              body.alerts
            );
          }
        } catch {
          // Last valid state remains visible.
        } finally {
          loadingRef.current =
            false;
        }
      },
      []
    );

  useEffect(
    () => {
      void load();

      const interval =
        window.setInterval(
          () => {
            void load();
          },
          POLL_INTERVAL_MS
        );

      function handleVisibility() {
        if (
          document.visibilityState ===
          "visible"
        ) {
          void load();
        }
      }

      document.addEventListener(
        "visibilitychange",
        handleVisibility
      );

      return () => {
        window.clearInterval(
          interval
        );

        document.removeEventListener(
          "visibilitychange",
          handleVisibility
        );
      };
    },
    [
      load,
    ]
  );

  if (
    alerts.length ===
    0
  ) {
    return null;
  }

  return (
    <section
      aria-label="هشدارهای تست هوش مصنوعی"
      className="space-y-3"
    >

      {alerts.map(
        (
          alert
        ) => (
          <AlertCard
            key={
              alert.id
            }
            alert={
              alert
            }
          />
        )
      )}

    </section>
  );
}

function AlertCard({
  alert,
}: {
  alert:
    AdminEvalAlert;
}) {
  const presentation =
    getPresentation(
      alert
    );

  return (
    <article
      role={
        alert.severity ===
        "critical"
          ? "alert"
          : "status"
      }
      className={`rounded-2xl border px-4 py-3 shadow-sm ${presentation.card}`}
    >

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">

        <div className="min-w-0">

          <div className="flex flex-wrap items-center gap-2">

            <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${presentation.badge}`}>
              {
                presentation.label
              }
            </span>

            <span className="rounded-full bg-white/70 px-2.5 py-1 text-[10px] font-black text-slate-600">
              {
                alert.scope ===
                "topic"
                  ? "TOPIC / GUIDANCE"
                  : "KNOWLEDGE"
              }
            </span>

            {alert.trigger && (
              <span className="rounded-full bg-white/70 px-2.5 py-1 text-[10px] font-bold text-slate-500">
                {
                  triggerLabel(
                    alert.trigger
                  )
                }
              </span>
            )}

          </div>

          <h2 className="mt-2 text-sm font-black text-slate-950">
            {
              alert.entityTitle
            }
          </h2>

          <p className="mt-1 text-xs leading-6 text-slate-700">
            {
              alert.message
            }
          </p>

          {alert.total >
            0 && (
            <p className="mt-1 text-[10px] font-bold text-slate-500">
              PASS:
              {" "}
              {
                (
                  alert.total -
                  alert.failed -
                  alert.errors
                ).toLocaleString(
                  "fa-IR"
                )
              }
              {" · "}
              FAIL:
              {" "}
              {
                alert.failed.toLocaleString(
                  "fa-IR"
                )
              }
              {" · "}
              ERROR:
              {" "}
              {
                alert.errors.toLocaleString(
                  "fa-IR"
                )
              }
            </p>
          )}

        </div>

        <Link
          href={
            alert.detailHref
          }
          className={`shrink-0 rounded-xl px-4 py-2.5 text-xs font-black ${presentation.action}`}
        >
          {
            alert.kind ===
            "running"
              ? "مشاهده وضعیت"
              : "بررسی جزئیات"
          }
        </Link>

      </div>

    </article>
  );
}

function getPresentation(
  alert:
    AdminEvalAlert
) {
  if (
    alert.kind ===
    "regression"
  ) {
    return {
      label:
        "REGRESSION",

      card:
        "border-rose-300 bg-rose-50",

      badge:
        "bg-rose-200 text-rose-800",

      action:
        "bg-rose-700 text-white hover:bg-rose-800",
    };
  }

  if (
    alert.kind ===
    "error"
  ) {
    return {
      label:
        "TEST ERROR",

      card:
        "border-orange-300 bg-orange-50",

      badge:
        "bg-orange-200 text-orange-800",

      action:
        "bg-orange-700 text-white hover:bg-orange-800",
    };
  }

  if (
    alert.kind ===
    "failed"
  ) {
    return {
      label:
        "GOLDEN TEST FAIL",

      card:
        "border-amber-300 bg-amber-50",

      badge:
        "bg-amber-200 text-amber-800",

      action:
        "bg-amber-700 text-white hover:bg-amber-800",
    };
  }

  return {
    label:
      "AUTO TEST",

    card:
      "border-blue-200 bg-blue-50",

    badge:
      "bg-blue-100 text-blue-700",

    action:
      "bg-blue-700 text-white hover:bg-blue-800",
  };
}

function triggerLabel(
  trigger:
    string
) {
  switch (
    trigger
  ) {
    case "guidance_update":
      return "ویرایش Guidance";

    case "guidance_restore":
      return "Restore Guidance";

    case "status_change":
      return "تغییر وضعیت Topic";

    case "update":
      return "ویرایش Topic";

    case "publish":
      return "انتشار Knowledge";

    default:
      return trigger;
  }
}
