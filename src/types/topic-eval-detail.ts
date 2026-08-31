import type {
  AIEvalComparisonOutcome,
  AIEvalRun,
} from "@/types/ai-evals";

export type TopicEvalDetailBatch = {
  id: string;

  label: string;

  status:
    | "running"
    | "completed"
    | "completed_with_failures"
    | "error";

  trigger?:
    | "update"
    | "guidance_update"
    | "guidance_restore"
    | "status_change";

  topicUpdated?:
    string;

  topicActive?:
    boolean;

  impactedCases?:
    number;

  executedCases?:
    number;

  capped:
    boolean;

  passed:
    number;

  failed:
    number;

  errors:
    number;

  total:
    number;

  startedAt?:
    string;

  completedAt?:
    string;

  created:
    string;
};

export type TopicEvalDetailRow = {
  key: string;

  caseId?:
    string;

  title:
    string;

  question:
    string;

  outcome:
    AIEvalComparisonOutcome;

  previousRun?:
    AIEvalRun;

  currentRun?:
    AIEvalRun;
};

export type TopicEvalDetail = {
  topic: {
    id: string;

    name: string;

    active: boolean;

    updated: string;
  };

  currentBatch?:
    TopicEvalDetailBatch;

  previousBatch?:
    TopicEvalDetailBatch;

  summary: {
    totalRows:
      number;

    stablePass:
      number;

    regressions:
      number;

    improvements:
      number;

    persistentFailures:
      number;

    errors:
      number;

    newCases:
      number;

    removedCases:
      number;
  };

  rows:
    TopicEvalDetailRow[];
};
