import type {
  AIEvalComparisonOutcome,
  AIEvalRun,
} from "@/types/ai-evals";

export type KnowledgeEvalDetailBatch = {
  id: string;

  label: string;

  status:
    | "running"
    | "completed"
    | "completed_with_failures"
    | "error";

  trigger?:
    | "publish"
    | "update";

  knowledgeUpdated?:
    string;

  impactedCases?: number;
  executedCases?: number;
  capped: boolean;

  passed: number;
  failed: number;
  errors: number;
  total: number;

  startedAt?: string;
  completedAt?: string;

  created: string;
};

export type KnowledgeEvalDetailRow = {
  key: string;

  caseId?: string;

  title: string;
  question: string;

  outcome:
    AIEvalComparisonOutcome;

  previousRun?: AIEvalRun;
  currentRun?: AIEvalRun;
};

export type KnowledgeEvalDetail = {
  knowledge: {
    id: string;

    title: string;

    topicId?: string;
    topicName?: string;

    status: string;
    syncStatus: string;

    version: number;

    updated: string;
  };

  currentBatch?:
    KnowledgeEvalDetailBatch;

  previousBatch?:
    KnowledgeEvalDetailBatch;

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

  rows:
    KnowledgeEvalDetailRow[];
};
