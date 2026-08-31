import type {
  AIEvalBatch,
  AIEvalBatchComparison,
} from "@/types/ai-evals";

export type AIEvalReleaseGateStatus =
  | "ready"
  | "blocked"
  | "not_ready";

export type AIEvalReleaseGateReason = {
  code:
    string;

  severity:
    | "blocking"
    | "warning"
    | "info";

  title:
    string;

  message:
    string;
};

export type AIEvalCoverageGateMode =
  | "strict"
  | "warn"
  | "off";

export type AIEvalReleaseCoverageGate = {
  available:
    boolean;

  mode:
    AIEvalCoverageGateMode;

  activeCases:
    number;

  activeTopics:
    number;

  coveredTopics:
    number;

  uncoveredTopics:
    number;

  topicCoveragePercent:
    number;

  minimumTopicCoveragePercent:
    number;

  publishedKnowledge:
    number;

  coveredKnowledge:
    number;

  uncoveredKnowledge:
    number;

  knowledgeCoveragePercent:
    number;

  minimumKnowledgeCoveragePercent:
    number;

  directKnowledge:
    number;

  topicOnlyKnowledge:
    number;

  directKnowledgeCoveragePercent:
    number;

  minimumDirectKnowledgeCoveragePercent:
    number;

  meetsTopicCoverage:
    boolean;

  meetsKnowledgeCoverage:
    boolean;

  meetsDirectKnowledgeCoverage:
    boolean;

  blockingIssues:
    number;

  warnings:
    number;
};

export type AIEvalReleaseGate = {
  status:
    AIEvalReleaseGateStatus;

  canRelease:
    boolean;

  baseline?:
    AIEvalBatch;

  candidate?:
    AIEvalBatch;

  comparison?:
    AIEvalBatchComparison;

  coverage:
    AIEvalReleaseCoverageGate;

  reasons:
    AIEvalReleaseGateReason[];

  summary: {
    regressions:
      number;

    errors:
      number;

    improvements:
      number;

    persistentFailures:
      number;

    configChanged:
      boolean;

    knowledgeChanged:
      boolean;

    coverageBlockingIssues:
      number;

    coverageWarnings:
      number;
  };
};
