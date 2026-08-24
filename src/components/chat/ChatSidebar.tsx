"use client";

import Link from "next/link";
import {
  usePathname,
  useRouter,
} from "next/navigation";
import {
  useEffect,
  useState,
} from "react";

import LogoutButton from "@/components/auth/LogoutButton";
import {
  CONVERSATION_UPDATED_EVENT,
  type ConversationUpdatedDetail,
} from "@/lib/chat/conversation-events";
import type { ConversationItem } from "@/types/chat";

type Props = {
  conversations: ConversationItem[];

  account: {
    name: string;
    role: "employee" | "admin";
  };
};

export default function ChatSidebar({
  conversations,
  account,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [conversationItems, setConversationItems] =
    useState(conversations);

  useEffect(() => {
    function handleConversationUpdated(event: Event) {
      const { id, title, updated } = (
        event as CustomEvent<ConversationUpdatedDetail>
      ).detail;

      setConversationItems((current) => {
        const conversation = current.find(
          (item) => item.id === id
        );

        if (!conversation) {
          return current;
        }

        return [
          {
            ...conversation,
            title,
            updated,
            last_message_at: updated,
          },
          ...current.filter((item) => item.id !== id),
        ];
      });
    }

    window.addEventListener(
      CONVERSATION_UPDATED_EVENT,
      handleConversationUpdated
    );

    return () => {
      window.removeEventListener(
        CONVERSATION_UPDATED_EVENT,
        handleConversationUpdated
      );
    };
  }, []);

  async function createNewChat() {
    if (creating) {
      return;
    }

    setCreating(true);
    setError("");

    try {
      const response = await fetch("/api/conversations", {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok) {
        setError(
          data.message || "ایجاد گفتگو انجام نشد."
        );

        return;
      }

      const conversation = data.conversation as
        | ConversationItem
        | undefined;

      if (!conversation?.id) {
        setError("پاسخ سرور برای گفتگوی جدید ناقص است.");
        return;
      }

      setConversationItems((current) => [
        conversation,
        ...current.filter(
          (item) => item.id !== conversation.id
        ),
      ]);

      router.push(`/chat/${conversation.id}`);
      router.refresh();
    } catch {
      setError("خطا در ارتباط با سرور.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <aside className="flex h-screen w-72 shrink-0 flex-col border-l border-gray-200 bg-white">

      {/* عنوان */}
      <div className="border-b border-gray-200 p-4">
        <h2 className="text-lg font-bold text-gray-900">
          دستیار هوشمند
        </h2>

        <p className="mt-1 text-xs text-gray-500">
          {account.name}
        </p>

        {/* چت جدید */}
        <button
          type="button"
          onClick={createNewChat}
          disabled={creating}
          className="mt-4 w-full rounded-xl bg-black px-4 py-3 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {creating
            ? "در حال ایجاد..."
            : "+ چت جدید"}
        </button>

        {error && (
          <p className="mt-2 text-xs text-red-600">
            {error}
          </p>
        )}
      </div>

      {/* تاریخچه گفتگوها */}
      <div className="flex-1 overflow-y-auto p-3">
        <p className="mb-3 px-2 text-xs font-medium text-gray-400">
          گفتگوهای اخیر
        </p>

        {conversationItems.length === 0 ? (
          <div className="px-3 py-8 text-center text-sm text-gray-400">
            هنوز گفتگویی ندارید.
          </div>
        ) : (
          <div className="space-y-1">
            {conversationItems.map((conversation) => {
              const href = `/chat/${conversation.id}`;
              const isActive = pathname === href;

              return (
                <Link
                  key={conversation.id}
                  href={href}
                  className={`block truncate rounded-xl px-3 py-3 text-sm transition ${
                    isActive
                      ? "bg-gray-100 font-medium text-gray-900"
                      : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                  }`}
                >
                  {conversation.title || "گفتگوی جدید"}
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* پایین سایدبار */}
      <div className="border-t border-gray-200 p-4">

        {account.role === "admin" && (
          <Link
            href="/admin"
            className="mb-3 block rounded-xl border border-gray-200 px-4 py-2.5 text-center text-sm transition hover:bg-gray-50"
          >
            پنل مدیریت
          </Link>
        )}

        <LogoutButton />
      </div>

    </aside>
  );
}
