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

import MarkdownContent from "@/components/common/MarkdownContent";

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

type FeedbackReason =
  | "incorrect"
  | "incomplete"
  | "outdated"
  | "irrelevant"
  | "unclear"
  | "source_issue"
  | "other";

type FeedbackWithReasons =
  ChatFeedback & {
    reasons?:
      FeedbackReason[];
  };

type FeedbackMutationResponse = {
  success?: boolean;

  message?: string;

  feedback?:
    | FeedbackWithReasons
    | null;
};

type ConversationFeedbackResponse = {
  success?: boolean;

  message?: string;

  items?: Array<{
    messageId: string;
    feedback: FeedbackWithReasons;
  }>;
};

const MAX_FEEDBACK_REASONS =
  3;

const FEEDBACK_REASON_OPTIONS:
  ReadonlyArray<{
    value:
      FeedbackReason;

    label:
      string;
  }> = [
    {
      value:
        "incorrect",

      label:
        "پاسخ اشتباه است",
    },
    {
      value:
        "incomplete",

      label:
        "پاسخ ناقص است",
    },
    {
      value:
        "outdated",

      label:
        "اطلاعات قدیمی است",
    },
    {
      value:
        "irrelevant",

      label:
        "پاسخ نامرتبط است",
    },
    {
      value:
        "unclear",

      label:
        "پاسخ مبهم است",
    },
    {
      value:
        "source_issue",

      label:
        "مشکل در منبع یا اطلاعات",
    },
    {
      value:
        "other",

      label:
        "مورد دیگر",
    },
  ];

export default function ChatWindow({
  conversationId,
  title,
  messages: initialMessages,
}: Props) {
  const router =
    useRouter();

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
   * Perceived Latency / Progress UX
   * ==========================================
   */

  const [
    pendingDisplayMessage,
    setPendingDisplayMessage,
  ] =
    useState("");

  const [
    waitingStatus,
    setWaitingStatus,
  ] =
    useState(
      "در حال بررسی سؤال..."
    );

  const messagesEndRef =
    useRef<HTMLDivElement | null>(
      null
    );

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
    feedbackNotices,
    setFeedbackNotices,
  ] =
    useState<
      Record<
        string,
        {
          type:
            | "success"
            | "error";

          text:
            string;
        }
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

  const [
    reasonDrafts,
    setReasonDrafts,
  ] =
    useState<
      Record<
        string,
        FeedbackReason[]
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
   * Waiting Status
   *
   * این متن‌ها وضعیت دقیق Backend را ادعا
   * نمی‌کنند؛ فقط به کاربر نشان می‌دهند که
   * درخواست همچنان در حال پردازش است.
   * ==========================================
   */

  useEffect(() => {
    if (
      !sending
    ) {
      setWaitingStatus(
        "در حال بررسی سؤال..."
      );

      return;
    }

    setWaitingStatus(
      "در حال بررسی سؤال..."
    );

    const preparingTimer =
      window.setTimeout(
        () => {
          setWaitingStatus(
            "در حال آماده‌سازی پاسخ..."
          );
        },
        2500
      );

    const verificationTimer =
      window.setTimeout(
        () => {
          setWaitingStatus(
            "در حال بررسی نهایی پاسخ..."
          );
        },
        6500
      );

    return () => {
      window.clearTimeout(
        preparingTimer
      );

      window.clearTimeout(
        verificationTimer
      );
    };
  }, [
    sending,
  ]);

  /*
   * ==========================================
   * Auto Scroll
   * ==========================================
   */

  useEffect(() => {
    messagesEndRef.current
      ?.scrollIntoView({
        behavior:
          "smooth",

        block:
          "end",
      });
  }, [
    messages.length,
    sending,
    waitingStatus,
  ]);

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
            FeedbackWithReasons
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

        const reasons: Record<
          string,
          FeedbackReason[]
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

            reasons[
              item.messageId
            ] =
              getFeedbackReasons(
                item.feedback
              );
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

        setReasonDrafts(
          (
            current
          ) => ({
            ...current,
            ...reasons,
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

    setPendingDisplayMessage(
      content
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
      setPendingDisplayMessage(
        ""
      );

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

    clearFeedbackNotice(
      chatMessage.id
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

    const currentReasons =
      reasonDrafts[
        chatMessage.id
      ] ||
      getFeedbackReasons(
        chatMessage.feedback
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

                reasons:
                  rating ===
                  "down"
                    ? currentReasons
                    : [],

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
        const message =
          data.message ||
          "ثبت بازخورد انجام نشد.";

        setFeedbackErrors(
          (
            current
          ) => ({
            ...current,

            [
              chatMessage.id
            ]:
              message,
          })
        );

        setFeedbackNotice(
          chatMessage.id,
          "error",
          message
        );

        return;
      }

      updateMessageFeedback(
        chatMessage.id,
        data.feedback
      );

      setFeedbackNotice(
        chatMessage.id,
        "success",
        data.feedback.rating ===
          "down"
          ? "بازخورد منفی ثبت شد. در صورت نیاز جزئیات آن را تکمیل کنید."
          : "بازخورد مثبت با موفقیت ثبت شد."
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

        setReasonDrafts(
          (
            current
          ) => ({
            ...current,

            [
              chatMessage.id
            ]:
              getFeedbackReasons(
                data.feedback
              ),
          })
        );
      } else {
        clearFeedbackDrafts(
          chatMessage.id
        );
      }
    } catch {
      const message =
        "خطا در ارتباط با سرور.";

      setFeedbackErrors(
        (
          current
        ) => ({
          ...current,

          [
            chatMessage.id
          ]:
            message,
        })
      );

      setFeedbackNotice(
        chatMessage.id,
        "error",
        message
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

    clearFeedbackNotice(
      messageId
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
        const message =
          data.message ||
          "حذف بازخورد انجام نشد.";

        setFeedbackErrors(
          (
            current
          ) => ({
            ...current,

            [
              messageId
            ]:
              message,
          })
        );

        setFeedbackNotice(
          messageId,
          "error",
          message
        );

        return;
      }

      updateMessageFeedback(
        messageId,
        null
      );

      clearFeedbackDrafts(
        messageId
      );

      setFeedbackNotice(
        messageId,
        "success",
        "بازخورد این پاسخ حذف شد."
      );
    } catch {
      const message =
        "خطا در ارتباط با سرور.";

      setFeedbackErrors(
        (
          current
        ) => ({
          ...current,

          [
            messageId
          ]:
            message,
        })
      );

      setFeedbackNotice(
        messageId,
        "error",
        message
      );
    } finally {
      setFeedbackBusyMessageId(
        null
      );
    }
  }

  function toggleFeedbackReason(
    messageId:
      string,

    reason:
      FeedbackReason
  ) {
    if (
      feedbackBusyMessageId ===
      messageId
    ) {
      return;
    }

    setReasonDrafts(
      (
        current
      ) => {
        const existing =
          current[
            messageId
          ] ||
          getFeedbackReasons(
            messages.find(
              (
                item
              ) =>
                item.id ===
                messageId
            )?.feedback
          );

        if (
          existing.includes(
            reason
          )
        ) {
          return {
            ...current,

            [
              messageId
            ]:
              existing.filter(
                (
                  item
                ) =>
                  item !==
                  reason
              ),
          };
        }

        if (
          existing.length >=
          MAX_FEEDBACK_REASONS
        ) {
          return current;
        }

        return {
          ...current,

          [
            messageId
          ]: [
            ...existing,
            reason,
          ],
        };
      }
    );
  }

  async function saveFeedbackDetails(
    messageId:
      string
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

    const reasons =
      (
        reasonDrafts[
          messageId
        ] ||
        getFeedbackReasons(
          chatMessage.feedback
        )
      ).slice(
        0,
        MAX_FEEDBACK_REASONS
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

    clearFeedbackNotice(
      messageId
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

                reasons,

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
        const message =
          data.message ||
          "ذخیره جزئیات بازخورد انجام نشد.";

        setFeedbackErrors(
          (
            current
          ) => ({
            ...current,

            [
              messageId
            ]:
              message,
          })
        );

        setFeedbackNotice(
          messageId,
          "error",
          message
        );

        return;
      }

      updateMessageFeedback(
        messageId,
        data.feedback
      );

      setCommentDrafts(
        (
          current
        ) => ({
          ...current,

          [
            messageId
          ]:
            data.feedback
              ?.comment ||
            "",
        })
      );

      setReasonDrafts(
        (
          current
        ) => ({
          ...current,

          [
            messageId
          ]:
            getFeedbackReasons(
              data.feedback
            ),
        })
      );

      setFeedbackNotice(
        messageId,
        "success",
        "جزئیات بازخورد با موفقیت ثبت شد."
      );
    } catch {
      const message =
        "خطا در ارتباط با سرور.";

      setFeedbackErrors(
        (
          current
        ) => ({
          ...current,

          [
            messageId
          ]:
            message,
        })
      );

      setFeedbackNotice(
        messageId,
        "error",
        message
      );
    } finally {
      setFeedbackBusyMessageId(
        null
      );
    }
  }

  function setFeedbackNotice(
    messageId:
      string,

    type:
      | "success"
      | "error",

    text:
      string
  ) {
    setFeedbackNotices(
      (
        current
      ) => ({
        ...current,

        [
          messageId
        ]: {
          type,
          text,
        },
      })
    );
  }

  function clearFeedbackNotice(
    messageId:
      string
  ) {
    setFeedbackNotices(
      (
        current
      ) => {
        const next = {
          ...current,
        };

        delete next[
          messageId
        ];

        return next;
      }
    );
  }

  function clearFeedbackDrafts(
    messageId:
      string
  ) {
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

    setReasonDrafts(
      (
        current
      ) => ({
        ...current,

        [
          messageId
        ]:
          [],
      })
    );
  }

  function updateMessageFeedback(
    messageId: string,
    feedback:
      | FeedbackWithReasons
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
            0 &&
          !sending ? (

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
                ) => {

                  const selectedReasons =
                    reasonDrafts[
                      item.id
                    ] ||
                    getFeedbackReasons(
                      item.feedback
                    );

                  return (

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
                        className={`rounded-2xl px-4 py-3 text-sm leading-7 ${
                          item.role ===
                          "user"
                            ? "bg-black text-white"
                            : "bg-gray-100 text-gray-800"
                        }`}
                      >

                        {item.role ===
                        "assistant" ? (
                          <MarkdownContent
                            content={
                              item.content
                            }
                          />
                        ) : (
                          <div className="whitespace-pre-wrap">
                            {
                              item.content
                            }
                          </div>
                        )}

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

                          <div className="flex flex-wrap items-center gap-1">

                            <span className="ml-1 text-[11px] text-gray-400">
                              آیا این پاسخ مفید بود؟
                            </span>

                            {item.feedback && (
                              <span
                                className={`mr-1 rounded-full border px-2.5 py-1 text-[10px] font-bold ${
                                  item.feedback.rating ===
                                  "down"
                                    ? "border-rose-200 bg-rose-50 text-rose-700"
                                    : "border-emerald-200 bg-emerald-50 text-emerald-700"
                                }`}
                              >
                                {item.feedback.rating ===
                                "down"
                                  ? "بازخورد منفی ثبت شده"
                                  : "بازخورد مثبت ثبت شده"}
                              </span>
                            )}

                            <button
                              type="button"
                              aria-label="پاسخ مفید بود"
                              aria-pressed={
                                item.feedback
                                  ?.rating ===
                                "up"
                              }
                              disabled={
                                feedbackLoading ||
                                feedbackBusyMessageId ===
                                  item.id
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
                                feedbackLoading ||
                                feedbackBusyMessageId ===
                                  item.id
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

                          {/* Negative feedback details */}

                          {item.feedback
                            ?.rating ===
                            "down" && (

                            <div className="mt-2 rounded-xl border border-gray-200 bg-white p-3">

                              <div>

                                <p className="text-xs font-medium text-gray-700">
                                  چه مشکلی در پاسخ وجود داشت؟
                                </p>

                                <p className="mt-1 text-[11px] text-gray-400">
                                  حداکثر ۳ مورد را انتخاب کنید.
                                </p>

                                <div className="mt-2 flex flex-wrap gap-2">

                                  {FEEDBACK_REASON_OPTIONS.map(
                                    (
                                      option
                                    ) => {
                                      const selected =
                                        selectedReasons.includes(
                                          option.value
                                        );

                                      const limitReached =
                                        selectedReasons.length >=
                                          MAX_FEEDBACK_REASONS;

                                      return (
                                        <button
                                          key={
                                            option.value
                                          }
                                          type="button"
                                          aria-pressed={
                                            selected
                                          }
                                          disabled={
                                            feedbackBusyMessageId ===
                                              item.id ||
                                            (
                                              !selected &&
                                              limitReached
                                            )
                                          }
                                          onClick={() =>
                                            toggleFeedbackReason(
                                              item.id,
                                              option.value
                                            )
                                          }
                                          className={`rounded-full border px-3 py-1.5 text-[11px] transition ${
                                            selected
                                              ? "border-rose-300 bg-rose-50 text-rose-700"
                                              : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50"
                                          } disabled:cursor-not-allowed disabled:opacity-40`}
                                        >
                                          {
                                            option.label
                                          }
                                        </button>
                                      );
                                    }
                                  )}

                                </div>

                                <p className="mt-2 text-[10px] text-gray-400">
                                  {selectedReasons.length.toLocaleString(
                                    "fa-IR"
                                  )}
                                  {" "}
                                  / ۳ انتخاب شده
                                </p>

                              </div>

                              <label
                                htmlFor={`feedback-comment-${item.id}`}
                                className="mt-4 block text-xs font-medium text-gray-600"
                              >
                                توضیح بیشتر
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
                                placeholder="اگر لازم است جزئیات بیشتری بنویسید..."
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
                                    void saveFeedbackDetails(
                                      item.id
                                    )
                                  }
                                  className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-black disabled:opacity-50"
                                >
                                  ثبت جزئیات بازخورد
                                </button>

                              </div>

                            </div>

                          )}

                          {/* Feedback notification */}

                          {feedbackNotices[
                            item.id
                          ] && (

                            <div
                              role={
                                feedbackNotices[
                                  item.id
                                ].type ===
                                "error"
                                  ? "alert"
                                  : "status"
                              }
                              className={`mt-2 rounded-xl border px-3 py-2.5 text-xs font-medium leading-6 ${
                                feedbackNotices[
                                  item.id
                                ].type ===
                                "success"
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : "border-rose-200 bg-rose-50 text-rose-700"
                              }`}
                            >
                              {
                                feedbackNotices[
                                  item.id
                                ].text
                              }
                            </div>

                          )}

                          {!feedbackNotices[
                            item.id
                          ] &&
                            feedbackErrors[
                              item.id
                            ] && (

                            <div
                              role="alert"
                              className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-medium leading-6 text-rose-700"
                            >
                              {
                                feedbackErrors[
                                  item.id
                                ]
                              }
                            </div>

                          )}

                        </div>

                      )}

                    </div>

                  </div>

                  );
                }
              )}

              {sending &&
                pendingDisplayMessage && (

                <div className="flex justify-start">

                  <div className="max-w-[80%] rounded-2xl bg-black px-4 py-3 text-sm leading-7 text-white">

                    <div className="whitespace-pre-wrap">
                      {
                        pendingDisplayMessage
                      }
                    </div>

                  </div>

                </div>

              )}

              {sending && (

                <div className="flex justify-end">

                  <div
                    role="status"
                    aria-live="polite"
                    className="flex items-center gap-2 rounded-2xl bg-gray-100 px-4 py-3 text-sm text-gray-500"
                  >
                    <span
                      className="inline-flex gap-1"
                      aria-hidden="true"
                    >
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gray-400" />

                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gray-400 [animation-delay:150ms]" />

                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gray-400 [animation-delay:300ms]" />
                    </span>

                    <span>
                      {
                        waitingStatus
                      }
                    </span>
                  </div>

                </div>

              )}

              <div
                ref={
                  messagesEndRef
                }
                aria-hidden="true"
              />

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
                sending
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
                  sending ||
                  !message.trim()
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

function getFeedbackReasons(
  feedback:
    | ChatFeedback
    | FeedbackWithReasons
    | null
    | undefined
): FeedbackReason[] {
  if (
    !feedback ||
    typeof feedback !==
      "object"
  ) {
    return [];
  }

  const value =
    (
      feedback as {
        reasons?:
          unknown;
      }
    ).reasons;

  if (
    !Array.isArray(
      value
    )
  ) {
    return [];
  }

  const result:
    FeedbackReason[] =
    [];

  for (
    const item of
    value
  ) {
    if (
      !isFeedbackReason(
        item
      ) ||
      result.includes(
        item
      )
    ) {
      continue;
    }

    result.push(
      item
    );

    if (
      result.length >=
      MAX_FEEDBACK_REASONS
    ) {
      break;
    }
  }

  return result;
}

function isFeedbackReason(
  value:
    unknown
): value is FeedbackReason {
  return (
    value ===
      "incorrect" ||
    value ===
      "incomplete" ||
    value ===
      "outdated" ||
    value ===
      "irrelevant" ||
    value ===
      "unclear" ||
    value ===
      "source_issue" ||
    value ===
      "other"
  );
}

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
