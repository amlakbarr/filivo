export const CONVERSATION_UPDATED_EVENT =
  "callcenter:conversation-updated";

export type ConversationUpdatedDetail = {
  id: string;
  title: string;
  updated: string;
};

export function dispatchConversationUpdated(
  detail: ConversationUpdatedDetail
) {
  window.dispatchEvent(
    new CustomEvent<ConversationUpdatedDetail>(
      CONVERSATION_UPDATED_EVENT,
      {
        detail,
      }
    )
  );
}
