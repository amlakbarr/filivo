export type GroundingRemediationRange =
  | "24h"
  | "7d"
  | "30d"
  | "90d";

import type {
  KnowledgeGapPriorityBreakdown,
} from "@/lib/knowledge-gaps/priority";

export type GroundingRemediationGap = {
  id: string;

  title: string;
  sampleQuestion: string;

  status:
    | "open"
    | "in_progress"
    | "resolved"
    | "ignored";

  gapType:
    | "no_answer"
    | "unclassified"
    | "both";

  priorityScore: number;

  occurrenceCount: number;
  uniqueUsersCount: number;
  uniqueDepartmentsCount: number;

  lastSeenAt?: string;

  priorityBreakdown:
    KnowledgeGapPriorityBreakdown;
};

export type GroundingRemediationBlockedItem = {
  assistantMessageId: string;
  userMessageId: string;

  conversationId: string;

  question: string;

  created: string;

  userName?: string;
  employeeCode?: string;
  departmentName?: string;

  gateReason: string;
  verifierStatus: string;
  verifierReason?: string;

  unsupportedClaims: string[];

  retrievalCount: number;
  relevantCount: number;
  sourceCount: number;

  gapId?: string;
  gapStatus?: string;
};

export type GroundingTopicRemediationDashboard = {
  range: {
    preset:
      GroundingRemediationRange;

    label:
      string;

    from:
      string;

    to:
      string;
  };

  topic: {
    id:
      string;

    name:
      string;

    parentName?:
      string;

    label:
      string;
  };

  totals: {
    openGaps:
      number;

    blockedQuestions:
      number;

    verifierBlocked:
      number;

    withoutEvidence:
      number;

    linkedToGap:
      number;

    unlinkedToGap:
      number;
  };

  gaps:
    GroundingRemediationGap[];

  blocked:
    GroundingRemediationBlockedItem[];
};
