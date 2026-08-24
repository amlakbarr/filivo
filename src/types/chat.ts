export type ConversationItem = {
  id: string;
  title: string;
  status: string;
  created: string;
  updated: string;
  last_message_at?: string;
};

export type ChatSource = {
  knowledgeId: string;
  title: string;
  filename?: string;
};

export type FeedbackRating =
  | "up"
  | "down";

export type ChatFeedback = {
  id: string;

  rating: FeedbackRating;

  comment?: string;

  created?: string;

  updated?: string;
};

export type ChatMessage = {
  id: string;

  role:
    | "user"
    | "assistant";

  content: string;

  created: string;

  model?: string;

  hasAnswer?: boolean;

  sources?: ChatSource[];

  /*
   * undefined:
   * هنوز Feedback بارگذاری نشده.
   *
   * null:
   * بارگذاری شده ولی رأیی وجود ندارد.
   *
   * object:
   * Feedback ثبت شده است.
   */
  feedback?:
    | ChatFeedback
    | null;
};