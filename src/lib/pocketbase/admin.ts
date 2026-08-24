import type PocketBase from "pocketbase";

import {
  getCurrentAccount,
  type CurrentAccount,
} from "@/lib/pocketbase/auth";

import {
  getPocketBaseServiceClient,
} from "@/lib/pocketbase/service";

/*
 * ============================================
 * Admin Session
 * ============================================
 */

export type AdminSessionResult =
  | {
      ok: true;

      account:
        CurrentAccount;
    }
  | {
      ok: false;

      status:
        401 | 403;

      code:
        | "UNAUTHORIZED"
        | "FORBIDDEN";

      message:
        string;
    };

/*
 * ============================================
 * Check logged-in Admin
 *
 * این تابع برای Authorization
 * Routeهای مدیریتی است.
 * ============================================
 */

export async function getAdminSession(): Promise<AdminSessionResult> {
  const account =
    await getCurrentAccount();

  /*
   * Login نشده
   */
  if (!account) {
    return {
      ok:
        false,

      status:
        401,

      code:
        "UNAUTHORIZED",

      message:
        "ابتدا وارد حساب کاربری شوید.",
    };
  }

  /*
   * Employee است، نه Admin
   */
  if (
    account.role !==
    "admin"
  ) {
    return {
      ok:
        false,

      status:
        403,

      code:
        "FORBIDDEN",

      message:
        "دسترسی به این بخش فقط برای مدیر مجاز است.",
    };
  }

  return {
    ok:
      true,

    account,
  };
}

/*
 * ============================================
 * Superuser PocketBase
 *
 * برای حفظ Compatibility با فایل‌هایی که
 * قبلاً getAdminPocketBase را Import کرده‌اند.
 *
 * Superuser Client واقعی فقط در service.ts
 * ساخته می‌شود.
 * ============================================
 */

export async function getAdminPocketBase(): Promise<PocketBase> {
  return getPocketBaseServiceClient();
}