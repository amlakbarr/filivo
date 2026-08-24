"use client";

import {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  useRouter,
} from "next/navigation";

import {
  dispatchConversationUpdated,
} from "@/lib/chat/conversation-events";

import type {
  ChatFeedback,
  ChatMessage,
  FeedbackRating,
} from "@/types/chat";

type Props = {
  conversationId: string;
  title: string;
  messages: ChatMessage[];
};

type SendMessageResponse = {
  success?: boolean;
  message?: string;
  requestId?: string;
  warning?: string;

  userMessage?: ChatMessage;

  assistantMessage?: ChatMessage;

  conversation?: {
    id: string;
    title: string;
  };

  meta?: {
    requestId?: string;
  };
};

type FeedbackMutationResponse = {
  success?: boolean;

  message?: string;

  feedback?:
    | ChatFeedback
    | null;
};

type ConversationFeedbackResponse = {
  success?: boolean;

  message?: string;

  items?: Array<{
    messageId: string;
    feedback: ChatFeedback;
  }>;
};

export default function ChatWindow({
  conversationId,
  title,
  messages: initialMessages,
}: Props) {
  const router =
    useRouter();

  const [
    hydrated,
    setHydrated,
  ] =
    useState(
      false
    );

  const [
    message,
    setMessage,
  ] =
    useState("");

  const [
    currentTitle,
    setCurrentTitle,
  ] =
    useState(
      title
    );

  const [
    messages,
    setMessages,
  ] =
    useState<
      ChatMessage[]
    >(
      initialMessages
    );

  const [
    sending,
    setSending,
  ] =
    useState(false);

  const [
    error,
    setError,
  ] =
    useState("");

  const [
    warning,
    setWarning,
  ] =
    useState("");

  /*
   * ==========================================
   * Feedback state
   * ==========================================
   */

  const [
    feedbackLoading,
    setFeedbackLoading,
  ] =
    useState(true);

  const [
    feedbackBusyMessageId,
    setFeedbackBusyMessageId,
  ] =
    useState<
      string | null
    >(null);

  const [
    feedbackErrors,
    setFeedbackErrors,
  ] =
    useState<
      Record<
        string,
        string
      >
    >({});

  const [
    commentDrafts,
    setCommentDrafts,
  ] =
    useState<
      Record<
        string,
        string
      >
    >({});

  const pendingMessageRef =
    useRef<{
      content: string;
      id: string;
    } | null>(
      null
    );

  /*
   * ==========================================
   * Client Hydration
   *
   * During SSR and the first client render,
   * interactive disabled attributes are omitted.
   * After hydration React can safely apply the
   * real disabled state.
   * ==========================================
   */

  useEffect(() => {
    setHydrated(
      true
    );
  }, []);

  /*
   * ==========================================
   * Load Feedback after refresh
   * ==========================================
   */

  useEffect(() => {
    let active =
      true;

    async function loadFeedback() {
      setFeedbackLoading(
        true
      );

      try {
        const response =
          await fetch(
            `/api/conversations/${conversationId}/feedback`,
            {
              method:
                "GET",

              cache:
                "no-store",
            }
          );

        const data =
          (await response
            .json()
            .catch(
              () => ({})
            )) as ConversationFeedbackResponse;

        if (
          !active
        ) {
          return;
        }

        if (
          !response.ok ||
          !data.success
        ) {
          console.error(
            "Load chat feedback failed",
            data.message
          );

          return;
        }

        const feedbackByMessage =
          new Map<
            string,
            ChatFeedback
          >();

        for (
          const item of
          data.items || []
        ) {
          feedbackByMessage.set(
            item.messageId,
            item.feedback
          );
        }

        setMessages(
          (
            current
          ) =>
            current.map(
              (
                item
              ) => {
                if (
                  item.role !==
                  "assistant"
                ) {
                  return item;
                }

                const feedback =
                  feedbackByMessage.get(
                    item.id
                  ) ||
                  null;

                return {
                  ...item,
                  feedback,
                };
              }
            )
        );

        const drafts: Record<
          string,
          string
        > = {};

        for (
          const item of
          data.items || []
        ) {
          if (
            item.feedback
              .rating ===
              "down"
          ) {
            drafts[
              item.messageId
            ] =
              item.feedback
                .comment ||
              "";
          }
        }

        setCommentDrafts(
          (
            current
          ) => ({
            ...current,
            ...drafts,
          })
        );
      } catch (
        loadError
      ) {
        console.error(
          "Load feedback request failed",
          loadError
        );
      } finally {
        if (active) {
          setFeedbackLoading(
            false
          );
        }
      }
    }

    void loadFeedback();

    return () => {
      active =
        false;
    };
  }, [
    conversationId,
  ]);

  /*
   * ==========================================
   * Send Chat Message
   * ==========================================
   */

  async function sendMessage() {
    const content =
      message.trim();

    if (
      !content ||
      sending
    ) {
      return;
    }

    setSending(
      true
    );

    setError(
      ""
    );

    setWarning(
      ""
    );

    const pendingMessage =
      pendingMessageRef
        .current
        ?.content ===
      content
        ? pendingMessageRef.current
        : {
            content,

            id:
              createClientMessageId(),
          };

    pendingMessageRef.current =
      pendingMessage;

    try {
      const response =
        await fetch(
          `/api/conversations/${conversationId}/messages`,
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                content,

                clientMessageId:
                  pendingMessage.id,
              }),
          }
        );

      const data =
        (await response
          .json()
          .catch(
            () => ({})
          )) as SendMessageResponse;

      const requestId =
        data.requestId ||
        response.headers.get(
          "X-Request-Id"
        ) ||
        undefined;

      if (
        !response.ok ||
        !data.success
      ) {
        if (
          data.userMessage
        ) {
          setMessages(
            (
              current
            ) =>
              mergeMessages(
                current,
                [
                  data.userMessage as ChatMessage,
                ]
              )
          );
        }

        setError(
          withRequestId(
            data.message ||
              "ارسال پیام انجام نشد.",

            requestId
          )
        );

        return;
      }

      if (
        !data.userMessage ||
        !data.assistantMessage
      ) {
        setError(
          withRequestId(
            "پاسخ سرور ناقص است. دوباره تلاش کنید.",

            requestId
          )
        );

        return;
      }

      /*
       * پاسخ جدید هنوز Feedback ندارد.
       */
      const assistantMessage: ChatMessage =
        {
          ...data.assistantMessage,

          feedback:
            null,
        };

      setMessages(
        (
          current
        ) =>
          mergeMessages(
            current,
            [
              data.userMessage as ChatMessage,

              assistantMessage,
            ]
          )
      );

      if (
        data.conversation
          ?.id &&
        data.conversation
          .title
      ) {
        const updated =
          new Date()
            .toISOString();

        setCurrentTitle(
          data.conversation
            .title
        );

        dispatchConversationUpdated(
          {
            id:
              data.conversation
                .id,

            title:
              data.conversation
                .title,

            updated,
          }
        );
      }

      if (
        data.warning
      ) {
        setWarning(
          withRequestId(
            data.warning,

            data.meta
              ?.requestId ||
              requestId
          )
        );
      }

      setMessage(
        ""
      );

      pendingMessageRef.current =
        null;

      router.refresh();
    } catch {
      setError(
        "خطا در ارتباط با سرور. اتصال شبکه را بررسی کنید."
      );
    } finally {
      setSending(
        false
      );
    }
  }

  /*
   * ==========================================
   * Feedback
   * ==========================================
   */

  async function selectFeedback(
    chatMessage:
      ChatMessage,

    rating:
      FeedbackRating
  ) {
    if (
      chatMessage.role !==
        "assistant" ||
      feedbackBusyMessageId
    ) {
      return;
    }

    setFeedbackErrors(
      (
        current
      ) => ({
        ...current,

        [
          chatMessage.id
        ]:
          "",
      })
    );

    /*
     * اگر کاربر روی رأی فعلی
     * دوباره کلیک کرد → حذف.
     */

    if (
      chatMessage.feedback
        ?.rating ===
      rating
    ) {
      await removeFeedback(
        chatMessage.id
      );

      return;
    }

    setFeedbackBusyMessageId(
      chatMessage.id
    );

    try {
      const response =
        await fetch(
          `/api/messages/${chatMessage.id}/feedback`,
          {
            method:
              "PUT",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                rating,

                /*
                 * هنگام تغییر رأی به down
                 * Comment قبلی را حفظ می‌کنیم.
                 */
                comment:
                  rating ===
                  "down"
                    ? commentDrafts[
                        chatMessage
                          .id
                      ] ||
                      ""
                    : "",
              }),
          }
        );

      const data =
        (await response
          .json()
          .catch(
            () => ({})
          )) as FeedbackMutationResponse;

      if (
        !response.ok ||
        !data.success ||
        !data.feedback
      ) {
        setFeedbackErrors(
          (
            current
          ) => ({
            ...current,

            [
              chatMessage.id
            ]:
              data.message ||
              "ثبت بازخورد انجام نشد.",
          })
        );

        return;
      }

      updateMessageFeedback(
        chatMessage.id,
        data.feedback
      );

      if (
        data.feedback
          .rating ===
          "down"
      ) {
        setCommentDrafts(
          (
            current
          ) => ({
            ...current,

            [
              chatMessage.id
            ]:
              data.feedback
                ?.comment ||
              "",
          })
        );
      } else {
        setCommentDrafts(
          (
            current
          ) => ({
            ...current,

            [
              chatMessage.id
            ]:
              "",
          })
        );
      }
    } catch {
      setFeedbackErrors(
        (
          current
        ) => ({
          ...current,

          [
            chatMessage.id
          ]:
            "خطا در ارتباط با سرور.",
        })
      );
    } finally {
      setFeedbackBusyMessageId(
        null
      );
    }
  }

  async function removeFeedback(
    messageId: string
  ) {
    if (
      feedbackBusyMessageId
    ) {
      return;
    }

    setFeedbackBusyMessageId(
      messageId
    );

    setFeedbackErrors(
      (
        current
      ) => ({
        ...current,

        [
          messageId
        ]:
          "",
      })
    );

    try {
      const response =
        await fetch(
          `/api/messages/${messageId}/feedback`,
          {
            method:
              "DELETE",
          }
        );

      const data =
        (await response
          .json()
          .catch(
            () => ({})
          )) as FeedbackMutationResponse;

      if (
        !response.ok ||
        !data.success
      ) {
        setFeedbackErrors(
          (
            current
          ) => ({
            ...current,

            [
              messageId
            ]:
              data.message ||
              "حذف بازخورد انجام نشد.",
          })
        );

        return;
      }

      updateMessageFeedback(
        messageId,
        null
      );

      setCommentDrafts(
        (
          current
        ) => ({
          ...current,

          [
            messageId
          ]:
            "",
        })
      );
    } catch {
      setFeedbackErrors(
        (
          current
        ) => ({
          ...current,

          [
            messageId
          ]:
            "خطا در ارتباط با سرور.",
        })
      );
    } finally {
      setFeedbackBusyMessageId(
        null
      );
    }
  }

  async function saveFeedbackComment(
    messageId: string
  ) {
    if (
      feedbackBusyMessageId
    ) {
      return;
    }

    const chatMessage =
      messages.find(
        (
          item
        ) =>
          item.id ===
          messageId
      );

    if (
      !chatMessage ||
      chatMessage.role !==
        "assistant" ||
      chatMessage.feedback
        ?.rating !==
        "down"
    ) {
      return;
    }

    const comment =
      (
        commentDrafts[
          messageId
        ] ||
        ""
      )
        .trim()
        .slice(
          0,
          1000
        );

    setFeedbackBusyMessageId(
      messageId
    );

    setFeedbackErrors(
      (
        current
      ) => ({
        ...current,

        [
          messageId
        ]:
          "",
      })
    );

    try {
      const response =
        await fetch(
          `/api/messages/${messageId}/feedback`,
          {
            method:
              "PUT",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                rating:
                  "down",

                comment,
              }),
          }
        );

      const data =
        (await response
          .json()
          .catch(
            () => ({})
          )) as FeedbackMutationResponse;

      if (
        !response.ok ||
        !data.success ||
        !data.feedback
      ) {
        setFeedbackErrors(
          (
            current
          ) => ({
            ...current,

            [
              messageId
            ]:
              data.message ||
              "ذخیره توضیح انجام نشد.",
          })
        );

        return;
      }

      updateMessageFeedback(
        messageId,
        data.feedback
      );
    } catch {
      setFeedbackErrors(
        (
          current
        ) => ({
          ...current,

          [
            messageId
          ]:
            "خطا در ارتباط با سرور.",
        })
      );
    } finally {
      setFeedbackBusyMessageId(
        null
      );
    }
  }

  function updateMessageFeedback(
    messageId: string,
    feedback:
      | ChatFeedback
      | null
  ) {
    setMessages(
      (
        current
      ) =>
        current.map(
          (
            item
          ) =>
            item.id ===
            messageId
              ? {
                  ...item,
                  feedback,
                }
              : item
        )
    );
  }

  /*
   * ==========================================
   * Composer handlers
   * ==========================================
   */

  async function handleSubmit(
    event:
      FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    await sendMessage();
  }

  function handleKeyDown(
    event:
      KeyboardEvent<HTMLTextAreaElement>
  ) {
    if (
      event.key ===
        "Enter" &&
      !event.shiftKey
    ) {
      event.preventDefault();

      void sendMessage();
    }
  }

  /*
   * ==========================================
   * Render
   * ==========================================
   */

  return (
    <div className="flex h-full flex-col bg-white">

      {/* Header */}

      <header className="flex h-16 shrink-0 items-center border-b border-gray-200 px-6">

        <div>

          <h1 className="font-semibold text-gray-900">
            {
              currentTitle
            }
          </h1>

          <p className="mt-0.5 text-xs text-gray-400">
            دستیار هوشمند کارشناسان
          </p>

        </div>

      </header>

      {/* Messages */}

      <div className="flex-1 overflow-y-auto">

        <div className="mx-auto max-w-3xl px-5 py-8">

          {messages.length ===
          0 ? (

            <div className="flex min-h-[55vh] items-center justify-center">

              <div className="text-center">

                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100 font-bold text-gray-700">
                  AI
                </div>

                <h2 className="mt-5 text-xl font-bold text-gray-900">
                  گفتگو را شروع کنید
                </h2>

                <p className="mt-2 text-sm leading-7 text-gray-500">
                  سوال خود را در کادر پایین بنویسید.
                </p>

              </div>

            </div>

          ) : (

            <div className="space-y-6">

              {messages.map(
                (
                  item
                ) => (

                  <div
                    key={
                      item.id
                    }
                    className={
                      item.role ===
                      "user"
                        ? "flex justify-start"
                        : "flex justify-end"
                    }
                  >

                    <div
                      className={`max-w-[80%] ${
                        item.role ===
                        "assistant"
                          ? "w-full sm:w-auto"
                          : ""
                      }`}
                    >

                      {/* Bubble */}

                      <div
                        className={`whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-7 ${
                          item.role ===
                          "user"
                            ? "bg-black text-white"
                            : "bg-gray-100 text-gray-800"
                        }`}
                      >

                        <div>
                          {
                            item.content
                          }
                        </div>

                        {/* Sources */}

                        {item.role ===
                          "assistant" &&
                          item.sources &&
                          item.sources
                            .length >
                            0 && (

                            <div className="mt-3 border-t border-gray-200 pt-2 text-xs leading-6 text-gray-500">

                              <p className="font-medium text-gray-600">
                                منابع:
                              </p>

                              <ul className="mt-1 list-disc space-y-0.5 pr-4">

                                {item.sources.map(
                                  (
                                    source
                                  ) => (
                                    <li
                                      key={
                                        source.knowledgeId
                                      }
                                    >
                                      {
                                        source.title
                                      }
                                    </li>
                                  )
                                )}

                              </ul>

                            </div>

                          )}

                      </div>

                      {/* Feedback */}

                      {item.role ===
                        "assistant" && (

                        <div className="mt-2 px-1">

                          <div className="flex items-center gap-1">

                            <span className="ml-1 text-[11px] text-gray-400">
                              آیا این پاسخ مفید بود؟
                            </span>

                            <button
                              type="button"
                              aria-label="پاسخ مفید بود"
                              aria-pressed={
                                item.feedback
                                  ?.rating ===
                                "up"
                              }
                              disabled={
                                hydrated
                                  ? feedbackLoading ||
                                    feedbackBusyMessageId ===
                                      item.id
                                  : undefined
                              }
                              onClick={() =>
                                void selectFeedback(
                                  item,
                                  "up"
                                )
                              }
                              className={`flex h-8 w-8 items-center justify-center rounded-lg text-sm transition ${
                                item.feedback
                                  ?.rating ===
                                "up"
                                  ? "bg-emerald-100 text-emerald-700"
                                  : "text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                              } disabled:cursor-not-allowed disabled:opacity-50`}
                            >
                              👍
                            </button>

                            <button
                              type="button"
                              aria-label="پاسخ مفید نبود"
                              aria-pressed={
                                item.feedback
                                  ?.rating ===
                                "down"
                              }
                              disabled={
                                hydrated
                                  ? feedbackLoading ||
                                    feedbackBusyMessageId ===
                                      item.id
                                  : undefined
                              }
                              onClick={() =>
                                void selectFeedback(
                                  item,
                                  "down"
                                )
                              }
                              className={`flex h-8 w-8 items-center justify-center rounded-lg text-sm transition ${
                                item.feedback
                                  ?.rating ===
                                "down"
                                  ? "bg-rose-100 text-rose-700"
                                  : "text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                              } disabled:cursor-not-allowed disabled:opacity-50`}
                            >
                              👎
                            </button>

                          </div>

                          {/* Negative comment */}

                          {item.feedback
                            ?.rating ===
                            "down" && (

                            <div className="mt-2 rounded-xl border border-gray-200 bg-white p-3">

                              <label
                                htmlFor={`feedback-comment-${item.id}`}
                                className="text-xs font-medium text-gray-600"
                              >
                                چه مشکلی در پاسخ وجود داشت؟
                                <span className="mr-1 font-normal text-gray-400">
                                  (اختیاری)
                                </span>
                              </label>

                              <textarea
                                id={`feedback-comment-${item.id}`}
                                value={
                                  commentDrafts[
                                    item.id
                                  ] ??
                                  item.feedback
                                    ?.comment ??
                                  ""
                                }
                                onChange={(
                                  event
                                ) =>
                                  setCommentDrafts(
                                    (
                                      current
                                    ) => ({
                                      ...current,

                                      [
                                        item.id
                                      ]:
                                        event.target
                                          .value,
                                    })
                                  )
                                }
                                rows={
                                  2
                                }
                                maxLength={
                                  1000
                                }
                                disabled={
                                  feedbackBusyMessageId ===
                                  item.id
                                }
                                placeholder="مثلاً پاسخ ناقص بود یا منبع مناسب نبود..."
                                className="mt-2 w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-xs leading-6 outline-none transition focus:border-gray-400 disabled:opacity-50"
                              />

                              <div className="mt-2 flex items-center justify-between gap-3">

                                <span className="text-[10px] text-gray-400">
                                  {(
                                    commentDrafts[
                                      item.id
                                    ] ||
                                    ""
                                  ).length.toLocaleString(
                                    "fa-IR"
                                  )}
                                  {" "}
                                  / ۱۰۰۰
                                </span>

                                <button
                                  type="button"
                                  disabled={
                                    feedbackBusyMessageId ===
                                    item.id
                                  }
                                  onClick={() =>
                                    void saveFeedbackComment(
                                      item.id
                                    )
                                  }
                                  className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-black disabled:opacity-50"
                                >
                                  ثبت توضیح
                                </button>

                              </div>

                            </div>

                          )}

                          {/* Feedback error */}

                          {feedbackErrors[
                            item.id
                          ] && (

                            <p className="mt-2 text-xs text-red-600">
                              {
                                feedbackErrors[
                                  item.id
                                ]
                              }
                            </p>

                          )}

                        </div>

                      )}

                    </div>

                  </div>

                )
              )}

              {sending && (

                <div className="flex justify-end">

                  <div className="rounded-2xl bg-gray-100 px-4 py-3 text-sm text-gray-500">
                    در حال بررسی سوال...
                  </div>

                </div>

              )}

            </div>

          )}

        </div>

      </div>

      {/* Composer */}

      <div className="shrink-0 border-t border-gray-100 bg-white p-4">

        <form
          onSubmit={
            handleSubmit
          }
          className="mx-auto max-w-3xl"
        >

          {error && (

            <div className="mb-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
              {
                error
              }
            </div>

          )}

          {warning && (

            <div className="mb-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {
                warning
              }
            </div>

          )}

          <div className="rounded-2xl border border-gray-300 bg-white p-2 shadow-sm transition focus-within:border-gray-500">

            <textarea
              value={
                message
              }
              onChange={(
                event
              ) => {
                const nextMessage =
                  event.target
                    .value;

                setMessage(
                  nextMessage
                );

                if (
                  pendingMessageRef.current &&
                  pendingMessageRef.current
                    .content !==
                    nextMessage.trim()
                ) {
                  pendingMessageRef.current =
                    null;
                }
              }}
              onKeyDown={
                handleKeyDown
              }
              placeholder="سوال خود را بنویسید..."
              rows={
                2
              }
              maxLength={
                4000
              }
              disabled={
                hydrated
                  ? sending
                  : undefined
              }
              className="max-h-40 min-h-14 w-full resize-none bg-transparent px-3 py-2 text-sm leading-7 outline-none disabled:opacity-60"
            />

            <div className="flex items-center justify-between px-2 pb-1">

              <span className="text-xs text-gray-400">
                Enter برای ارسال
                {" • "}
                Shift + Enter برای خط جدید
              </span>

              <button
                type="submit"
                disabled={
                  hydrated
                    ? sending ||
                      !message.trim()
                    : undefined
                }
                className="rounded-xl bg-black px-5 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-30"
              >
                {sending
                  ? "در حال ارسال..."
                  : "ارسال"}
              </button>

            </div>

          </div>

        </form>

      </div>

    </div>
  );
}

/*
 * ============================================
 * Helpers
 * ============================================
 */

function withRequestId(
  message: string,
  requestId?: string
) {
  if (
    !requestId
  ) {
    return message;
  }

  return `${message} (کد پیگیری: ${requestId})`;
}

function createClientMessageId() {
  return `u${crypto
    .randomUUID()
    .replace(
      /-/g,
      ""
    )
    .slice(
      0,
      14
    )}`;
}

function mergeMessages(
  current:
    ChatMessage[],

  incoming:
    ChatMessage[]
) {
  const messagesById =
    new Map<
      string,
      ChatMessage
    >(
      current.map(
        (
          message
        ) => [
          message.id,
          message,
        ]
      )
    );

  for (
    const message of
    incoming
  ) {
    const existing =
      messagesById.get(
        message.id
      );

    messagesById.set(
      message.id,
      {
        ...existing,
        ...message,

        /*
         * اگر Response جدید Feedback
         * نداشت، Feedback قبلی UI را
         * از دست نده.
         */
        feedback:
          message.feedback !==
          undefined
            ? message.feedback
            : existing
                ?.feedback,
      }
    );
  }

  return [
    ...messagesById.values(),
  ];
}