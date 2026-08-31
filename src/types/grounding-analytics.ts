export type GroundingAnalyticsRange =
  | "24h"
  | "7d"
  | "30d"
  | "90d";

export type GroundingAlertSeverity =
  | "warning"
  | "critical";

export type GroundingAnalyticsAlert = {
  id: string;

  severity:
    GroundingAlertSeverity;

  title: string;
  message: string;

  currentValue?: number;
  thresholdValue?: number;
  unit?:
    | "percent"
    | "count";

  topicId?: string;
  topicName?: string;
};

export type GroundingAnalyticsTopicRow = {
  topicId?: string;
  topicName: string;

  required: number;
  verified: number;
  blocked: number;

  blockRate: number;

  blockedWithoutEvidence: number;
  blockedAfterVerifier: number;
  unsupportedClaimCount: number;
};

export type GroundingAnalyticsThresholds = {
  globalMinimumRequired: number;
  globalBlockRateWarningPercent: number;
  globalBlockRateCriticalPercent: number;

  topicMinimumRequired: number;
  topicBlockRateWarningPercent: number;

  unsupportedClaimsWarningCount: number;
};

export type GroundingAnalyticsReasonRow = {
  key: string;
  label: string;
  count: number;
  percent: number;
};

export type GroundingAnalyticsBlockedItem = {
  id: string;
  conversationId: string;
  created: string;

  question: string;
  answer: string;

  topicId?: string;
  topicName?: string;

  userId?: string;
  userName?: string;
  employeeCode?: string;
  departmentName?: string;

  gateReason: string;
  verifierStatus: string;
  verifierReason?: string;

  unsupportedClaims: string[];

  verifierModel?: string;
  verifierRequestId?: string;

  retrievalCount: number;
  relevantCount: number;
  sourceCount: number;
};

export type GroundingAnalyticsDashboard = {
  range: {
    preset: GroundingAnalyticsRange;
    label: string;
    from: string;
    to: string;
  };

  totals: {
    checked: number;
    verified: number;
    blocked: number;
    notRequired: number;
    required: number;
    verificationRate: number;
    blockRate: number;
  };

  evidence: {
    averageRetrievalCount: number;
    averageRelevantCount: number;
    averageSourceCount: number;
    blockedWithoutRelevantEvidence: number;
    blockedAfterVerifier: number;
  };

  thresholds:
    GroundingAnalyticsThresholds;

  alerts:
    GroundingAnalyticsAlert[];

  topics:
    GroundingAnalyticsTopicRow[];

  gateReasons: GroundingAnalyticsReasonRow[];
  verifierReasons: GroundingAnalyticsReasonRow[];

  recentBlocked: GroundingAnalyticsBlockedItem[];
};
