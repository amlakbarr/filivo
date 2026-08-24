import type {
  ReactNode,
} from "react";

import {
  redirect,
} from "next/navigation";

import ChatSidebar from "@/components/chat/ChatSidebar";

import {
  getAuthenticatedPocketBase,
} from "@/lib/pocketbase/auth";

import {
  getPocketBaseServiceClient,
} from "@/lib/pocketbase/service";

import type {
  ConversationItem,
} from "@/types/chat";

export default async function ChatLayout({
  children,
}: {
  children:
    ReactNode;
}) {
  /*
   * ==========================================
   * Authentication
   *
   * فقط برای تشخیص هویت کاربر.
   * ==========================================
   */

  const session =
    await getAuthenticatedPocketBase();

  if (!session) {
    redirect(
      "/login"
    );
  }

  const {
    account,
  } = session;

  /*
   * ==========================================
   * Service Client
   *
   * از اینجا دسترسی به داده‌های Conversation
   * با Backend Service Client انجام می‌شود.
   * ==========================================
   */

  let pb;

  try {
    pb =
      await getPocketBaseServiceClient();
  } catch (error) {
    console.error(
      "Chat layout PocketBase service unavailable",
      {
        userId:
          account.id,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    throw new Error(
      "Chat data service is unavailable"
    );
  }

  /*
   * ==========================================
   * Conversations
   *
   * چون Service Client Ruleهای PocketBase را
   * bypass می‌کند، Ownership را خودمان
   * صریحاً enforce می‌کنیم.
   * ==========================================
   */

  let records;

  try {
    records =
      await pb
        .collection(
          "conversations"
        )
        .getFullList({
          filter:
            pb.filter(
              "user = {:userId} && status = {:status}",
              {
                userId:
                  account.id,

                status:
                  "active",
              }
            ),

          sort:
            "-updated",

          fields:
            "id,title,status,created,updated,last_message_at,user",
        });
  } catch (error) {
    console.error(
      "Chat conversations load failed",
      {
        userId:
          account.id,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    throw new Error(
      "Unable to load conversations"
    );
  }

  /*
   * ==========================================
   * Serialize
   * ==========================================
   */

  const conversations:
    ConversationItem[] =
    records.map(
      (
        record
      ) => ({
        id:
          record.id,

        title:
          String(
            record.title ||
              "گفتگوی جدید"
          ),

        status:
          record.status ===
          "archived"
            ? "archived"
            : "active",

        created:
          String(
            record.created ||
              ""
          ),

        updated:
          String(
            record.updated ||
              ""
          ),

        last_message_at:
          record.last_message_at
            ? String(
                record.last_message_at
              )
            : undefined,
      })
    );

  /*
   * ==========================================
   * Render
   * ==========================================
   */

  return (
    <div
      className="flex h-screen overflow-hidden bg-gray-50"
      dir="rtl"
    >
      <ChatSidebar
        key={
          conversations
            .map(
              (
                conversation
              ) =>
                `${conversation.id}:${conversation.updated}`
            )
            .join(
              "|"
            )
        }
        conversations={
          conversations
        }
        account={{
          name:
            account.name ||
            account.email,

          role:
            account.role,
        }}
      />

      <main className="min-w-0 flex-1 overflow-hidden">
        {children}
      </main>
    </div>
  );
}

/*
 * ============================================
 * Safe Error Metadata
 * ============================================
 */

function safeErrorMetadata(
  error:
    unknown
) {
  if (
    typeof error !==
      "object" ||
    error ===
      null
  ) {
    return {
      name:
        "UnknownError",
    };
  }

  const value =
    error as {
      name?: unknown;
      status?: unknown;
      code?: unknown;
    };

  return {
    name:
      typeof value.name ===
      "string"
        ? value.name
        : undefined,

    status:
      typeof value.status ===
      "number"
        ? value.status
        : undefined,

    code:
      typeof value.code ===
        "string" ||
      typeof value.code ===
        "number"
        ? value.code
        : undefined,
  };
}