export type AIEvalRunStatus =
  | "pending"
  | "passed"
  | "failed"
  | "error";

export type AIEvalBatchStatus =
  | "running"
  | "completed"
  | "completed_with_failures"
  | "error";

export type AIEvalBatchRunMode =
  | "all"
  | "single";

export type AIEvalComparisonOutcome =
  | "stable_pass"
  | "regression"
  | "improvement"
  | "persistent_failure"
  | "error"
  | "new_case"
  | "removed_case";

export type AIEvalTopicOption = {
  id: string;
  name: string;
};

export type AIEvalKnowledgeOption = {
  id: string;
  title: string;
  topicId?: string;
};

export type AIEvalCaseSnapshot = {
  caseId: string;
  title: string;
  question: string;

  expectedTopicId?: string;
  expectedTopicName?: string;

  expectedKnowledgeItems: Array<{
    id: string;
    title: string;
  }>;

  expectedHasAnswer: boolean;
  expectedAnswer?: string;

  requiredPhrases: string[];
  forbiddenPhrases: string[];

  active: boolean;
};

export type AIEvalSystemSnapshot = {
  capturedAt?: string;

  chatModel?: string;
  verifierModel?: string;

  fileSearchMinScore?: number;
  fileSearchMaxResults?: number;

  appTimezone?: string;

  assistantPromptHash?: string;
  verifierPromptHash?: string;

  vectorStoreHash?: string;

  knowledgeFingerprint?: string;
  publishedKnowledgeCount?: number;
};

export type AIEvalRun = {
  id: string;
  caseId: string;
  batchId?: string;

  status: AIEvalRunStatus;

  caseSnapshot?: AIEvalCaseSnapshot;

  actualAnswer?: string;

  actualTopic?: {
    id: string;
    name: string;
  };

  actualHasAnswer?: boolean;

  actualSources: Array<{
    id: string;
    title: string;
  }>;

  groundingStatus?: string;
  verifierStatus?: string;

  failureReasons: string[];

  model?: string;
  latencyMs?: number;

  startedAt?: string;
  completedAt?: string;

  created: string;
};

export type AIEvalCase = {
  id: string;

  title: string;
  question: string;

  expectedTopic?: {
    id: string;
    name: string;
  };

  expectedKnowledgeItems: Array<{
    id: string;
    title: string;
  }>;

  expectedHasAnswer: boolean;
  expectedAnswer?: string;

  requiredPhrases: string[];
  forbiddenPhrases: string[];

  active: boolean;

  created: string;
  updated: string;

  latestRun?: AIEvalRun;
};

export type AIEvalBatch = {
  id: string;

  label: string;
  notes?: string;

  runMode: AIEvalBatchRunMode;
  status: AIEvalBatchStatus;

  totalCases: number;
  passedCount: number;
  failedCount: number;
  errorCount: number;

  model?: string;
  verifierModel?: string;

  configHash?: string;

  systemSnapshot:
    AIEvalSystemSnapshot;

  isBaseline: boolean;

  createdBy?: {
    id: string;
    name: string;
  };

  startedAt?: string;
  completedAt?: string;

  created: string;
  updated: string;
};

export type AIEvalComparisonRow = {
  key: string;

  caseId?: string;

  title: string;
  question: string;

  outcome:
    AIEvalComparisonOutcome;

  baselineRun?: AIEvalRun;
  currentRun?: AIEvalRun;
};

export type AIEvalBatchComparison = {
  baseline: AIEvalBatch;
  current: AIEvalBatch;

  environment: {
    configChanged: boolean;
    knowledgeChanged: boolean;

    baselineConfigHash?: string;
    currentConfigHash?: string;

    baselineKnowledgeFingerprint?: string;
    currentKnowledgeFingerprint?: string;
  };

  summary: {
    totalRows: number;

    stablePass: number;
    regressions: number;
    improvements: number;
    persistentFailures: number;
    errors: number;
    newCases: number;
    removedCases: number;
  };

  rows: AIEvalComparisonRow[];
};

export type AIEvalDashboard = {
  summary: {
    total: number;
    active: number;
    passed: number;
    failed: number;
    error: number;
    neverRun: number;
  };

  cases: AIEvalCase[];

  lookups: {
    topics: AIEvalTopicOption[];
    knowledgeItems: AIEvalKnowledgeOption[];
  };
};

export type AIEvalCaseInput = {
  title: string;
  question: string;

  expectedTopicId?: string;

  expectedKnowledgeItemIds: string[];

  expectedHasAnswer: boolean;
  expectedAnswer?: string;

  requiredPhrases: string[];
  forbiddenPhrases: string[];

  active: boolean;
};
