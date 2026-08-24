import type { RecordModel } from "pocketbase";

import { getAdminPocketBase } from "@/lib/pocketbase/admin";

export type GapDetailStatus =
  | "open"
  | "in_progress"
  | "resolved"
  | "ignored";

export type GapDetailType =
  | "no_answer"
  | "unclassified"
  | "both";

export type GapOccurrenceItem = {
  id: string;

  questionText: string;
  reason: GapDetailType;

  userMessageId: string;
  assistantMessageId?: string;
  conversationId: string;

  userId: string;
  userName?: string;
  employeeCode?: string;

  departmentId?: string;
  departmentName?: string;

  topicId?: string;
  topicName?: string;

  assistantAnswer?: string;

  created: string;
};

export type KnowledgeGapDetail = {
  id: string;

  title: string;
  sampleQuestion: string;
  normalizedKey: string;

  status: GapDetailStatus;
  gapType: GapDetailType;

  priorityScore: number;

  occurrenceCount: number;
  uniqueUsersCount: number;
  uniqueDepartmentsCount: number;

  topicId?: string;
  topicName?: string;

  lastSeenAt?: string;

  resolvedKnowledgeItemId?: string;
  resolvedKnowledgeItemTitle?: string;

  resolvedById?: string;
  resolvedByName?: string;

  resolvedAt?: string;

  resolutionNote?: string;
  ignoreNote?: string;

  created: string;
  updated: string;

  occurrences: GapOccurrenceItem[];
};

export async function getKnowledgeGapDetail(
  gapId: string
): Promise<KnowledgeGapDetail | null> {
  const pb =
    await getAdminPocketBase();

  /*
   * Gap اصلی
   */
  let gap: RecordModel;

  try {
    gap = await pb
      .collection("knowledge_gaps")
      .getOne(gapId, {
        expand: [
          "topic",
          "resolved_knowledge_item",
          "resolved_by",
        ].join(","),
      });
  } catch (error) {
    if (
      isPocketBaseNotFound(
        error
      )
    ) {
      return null;
    }

    throw error;
  }

  /*
   * Occurrenceهای این Gap
   */
  const occurrenceRecords =
    await pb
      .collection(
        "knowledge_gap_occurrences"
      )
      .getFullList({
        filter: pb.filter(
          "gap = {:gap}",
          {
            gap:
              gap.id,
          }
        ),

        sort:
          "-created",

        expand: [
          "user",
          "department",
          "topic",
          "assistant_message",
        ].join(","),
      });

  const topic =
    getExpandedRecord(
      gap,
      "topic"
    );

  const resolvedKnowledge =
    getExpandedRecord(
      gap,
      "resolved_knowledge_item"
    );

  const resolvedBy =
    getExpandedRecord(
      gap,
      "resolved_by"
    );

  return {
    id:
      gap.id,

    title:
      String(
        gap.title ||
          ""
      ),

    sampleQuestion:
      String(
        gap.sample_question ||
          ""
      ),

    normalizedKey:
      String(
        gap.normalized_key ||
          ""
      ),

    status:
      normalizeStatus(
        gap.status
      ),

    gapType:
      normalizeGapType(
        gap.gap_type
      ),

    priorityScore:
      Number(
        gap.priority_score ||
          0
      ),

    occurrenceCount:
      Number(
        gap.occurrence_count ||
          0
      ),

    uniqueUsersCount:
      Number(
        gap.unique_users_count ||
          0
      ),

    uniqueDepartmentsCount:
      Number(
        gap.unique_departments_count ||
          0
      ),

    topicId:
      gap.topic
        ? String(
            gap.topic
          )
        : undefined,

    topicName:
      topic
        ? String(
            topic.name ||
              ""
          )
        : undefined,

    lastSeenAt:
      gap.last_seen_at
        ? String(
            gap.last_seen_at
          )
        : undefined,

    resolvedKnowledgeItemId:
      gap.resolved_knowledge_item
        ? String(
            gap.resolved_knowledge_item
          )
        : undefined,

    resolvedKnowledgeItemTitle:
      resolvedKnowledge
        ? String(
            resolvedKnowledge.title ||
              ""
          )
        : undefined,

    resolvedById:
      gap.resolved_by
        ? String(
            gap.resolved_by
          )
        : undefined,

    resolvedByName:
      resolvedBy
        ? String(
            resolvedBy.name ||
              resolvedBy.email ||
              ""
          )
        : undefined,

    resolvedAt:
      gap.resolved_at
        ? String(
            gap.resolved_at
          )
        : undefined,

    resolutionNote:
      gap.resolution_note
        ? String(
            gap.resolution_note
          )
        : undefined,

    ignoreNote:
      gap.ignore_note
        ? String(
            gap.ignore_note
          )
        : undefined,

    created:
      String(
        gap.created ||
          ""
      ),

    updated:
      String(
        gap.updated ||
          ""
      ),

    occurrences:
      occurrenceRecords.map(
        mapOccurrence
      ),
  };
}

function mapOccurrence(
  record: RecordModel
): GapOccurrenceItem {
  const user =
    getExpandedRecord(
      record,
      "user"
    );

  const department =
    getExpandedRecord(
      record,
      "department"
    );

  const topic =
    getExpandedRecord(
      record,
      "topic"
    );

  const assistant =
    getExpandedRecord(
      record,
      "assistant_message"
    );

  return {
    id:
      record.id,

    questionText:
      String(
        record.question_text ||
          ""
      ),

    reason:
      normalizeGapType(
        record.reason
      ),

    userMessageId:
      String(
        record.user_message ||
          ""
      ),

    assistantMessageId:
      record.assistant_message
        ? String(
            record.assistant_message
          )
        : undefined,

    conversationId:
      String(
        record.conversation ||
          ""
      ),

    userId:
      String(
        record.user ||
          ""
      ),

    userName:
      user
        ? String(
            user.name ||
              user.email ||
              ""
          )
        : undefined,

    employeeCode:
      user
        ? String(
            user.employee_code ||
              ""
          )
        : undefined,

    departmentId:
      record.department
        ? String(
            record.department
          )
        : undefined,

    departmentName:
      department
        ? String(
            department.name ||
              ""
          )
        : undefined,

    topicId:
      record.topic
        ? String(
            record.topic
          )
        : undefined,

    topicName:
      topic
        ? String(
            topic.name ||
              ""
          )
        : undefined,

    assistantAnswer:
      assistant
        ? String(
            assistant.content ||
              ""
          )
        : undefined,

    created:
      String(
        record.created ||
          ""
      ),
  };
}

function getExpandedRecord(
  record: RecordModel,
  key: string
): RecordModel | undefined {
  const value =
    record.expand?.[key];

  if (
    !value ||
    Array.isArray(value)
  ) {
    return undefined;
  }

  return value as RecordModel;
}

function normalizeStatus(
  value: unknown
): GapDetailStatus {
  const status =
    String(
      value ||
        ""
    );

  if (
    status === "open" ||
    status === "in_progress" ||
    status === "resolved" ||
    status === "ignored"
  ) {
    return status;
  }

  return "open";
}

function normalizeGapType(
  value: unknown
): GapDetailType {
  const type =
    String(
      value ||
        ""
    );

  if (
    type === "no_answer" ||
    type === "unclassified" ||
    type === "both"
  ) {
    return type;
  }

  return "no_answer";
}

function isPocketBaseNotFound(
  error: unknown
) {
  if (
    typeof error !== "object" ||
    error === null
  ) {
    return false;
  }

  const value =
    error as {
      status?: unknown;
    };

  return (
    value.status === 404
  );
}