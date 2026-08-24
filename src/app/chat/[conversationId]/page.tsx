import {
  redirect,
} from "next/navigation";

import ChatWindow from "@/components/chat/ChatWindow";

import {
  toChatMessage,
} from "@/lib/chat/messages";

import {
  getAuthenticatedPocketBase,
} from "@/lib/pocketbase/auth";

import {
  getPocketBaseServiceClient,
} from "@/lib/pocketbase/service";

/*
 * ============================================
 * Conversation Page
 * ============================================
 */

export default async function ConversationPage({
  params,
}: {
  params: Promise<{
    conversationId: string;
  }>;
}) {
  const {
    conversationId,
  } = await params;

  /*
   * ==========================================
   * Authentication
   *
   * فقط برای مشخص‌کردن هویت کاربر.
   * هیچ Read/Write مربوط به Chat با
   * PocketBase Client کاربر انجام نمی‌شود.
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
   * ==========================================
   */

  let pb;

  try {
    pb =
      await getPocketBaseServiceClient();
  } catch (error) {
    console.error(
      "Conversation page service unavailable",
      {
        userId:
          account.id,

        conversationId,

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
   * Conversation Ownership
   *
   * Service Client تمام PocketBase Ruleها را
   * bypass می‌کند، بنابراین Ownership باید
   * حتماً در Backend بررسی شود.
   * ==========================================
   */

  let conversation;

  try {
    conversation =
      await pb
        .collection(
          "conversations"
        )
        .getFirstListItem(
          pb.filter(
            "id = {:conversationId} && user = {:userId}",
            {
              conversationId,

              userId:
                account.id,
            }
          ),
          {
            fields:
              "id,user,title,status,created,updated,last_message_at",
          }
        );
  } catch (error) {
    const metadata =
      safeErrorMetadata(
        error
      );

    /*
     * برای کاربر تفاوتی بین:
     *
     * - Conversation وجود ندارد
     * - متعلق به کاربر دیگری است
     *
     * نشان نمی‌دهیم.
     */
    if (
      metadata.status ===
      404
    ) {
      redirect(
        "/chat"
      );
    }

    console.error(
      "Conversation ownership check failed",
      {
        userId:
          account.id,

        conversationId,

        error:
          metadata,
      }
    );

    throw new Error(
      "Unable to load conversation"
    );
  }

  /*
   * ==========================================
   * Extra Ownership Defense
   *
   * Filter بالا کافی است، اما چون Service
   * Client سطح دسترسی بالایی دارد، یک بررسی
   * دفاعی دیگر هم انجام می‌دهیم.
   * ==========================================
   */

  if (
    String(
      conversation.user ||
        ""
    ) !==
    account.id
  ) {
    console.error(
      "Conversation ownership mismatch",
      {
        userId:
          account.id,

        conversationId:
          conversation.id,
      }
    );

    redirect(
      "/chat"
    );
  }

  /*
   * ==========================================
   * Messages
   *
   * هم Conversation و هم User در Filter
   * بررسی می‌شوند.
   * ==========================================
   */

  let records;

  try {
    records =
      await pb
        .collection(
          "messages"
        )
        .getFullList({
          filter:
            pb.filter(
              "conversation = {:conversationId} && user = {:userId}",
              {
                conversationId:
                  conversation.id,

                userId:
                  account.id,
              }
            ),

          sort:
            "created",

          expand:
            "sources",
        });
  } catch (error) {
    console.error(
      "Conversation messages load failed",
      {
        userId:
          account.id,

        conversationId:
          conversation.id,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    throw new Error(
      "Unable to load conversation messages"
    );
  }

  /*
   * ==========================================
   * Serialize
   * ==========================================
   */

  const messages =
    records.map(
      (
        record
      ) =>
        toChatMessage(
          record
        )
    );

  /*
   * ==========================================
   * Render
   * ==========================================
   */

  return (
    <ChatWindow
      key={
        conversation.id
      }
      conversationId={
        conversation.id
      }
      title={
        String(
          conversation.title ||
            "گفتگوی جدید"
        )
      }
      messages={
        messages
      }
    />
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