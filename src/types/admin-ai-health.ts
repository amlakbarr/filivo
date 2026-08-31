export type AdminAIHealthLevel =
  | "healthy"
  | "warning"
  | "critical";

export type AdminAIHealthRelease = {
  status:
    | "ready"
    | "blocked"
    | "not_ready"
    | "unavailable";

  canRelease:
    boolean;

  baselineLabel?:
    string;

  candidateLabel?:
    string;

  regressions:
    number;

  errors:
    number;

  improvements:
    number;

  persistentFailures:
    number;

  message:
    string;
};

export type AdminAIHealthGrounding = {
  rangeLabel:
    string;

  required:
    number;

  verified:
    number;

  blocked:
    number;

  unsupportedClaims:
    number;

  operationalErrors:
    number;

  blockRate:
    number;

  level:
    AdminAIHealthLevel;
};

export type AdminAIHealthGap = {
  id:
    string;

  title:
    string;

  status:
    string;

  priorityScore:
    number;

  occurrenceCount:
    number;

  topicName?:
    string;
};

export type AdminAIHealthDashboard = {
  generatedAt:
    string;

  overall: {
    level:
      AdminAIHealthLevel;

    title:
      string;

    message:
      string;
  };

  release:
    AdminAIHealthRelease;

  regressions: {
    active:
      number;

    critical:
      number;

    warnings:
      number;

    running:
      number;

    knowledge:
      number;

    topics:
      number;

    items:
      Array<{
        id:
          string;

        scope:
          "knowledge"
          | "topic";

        kind:
          string;

        severity:
          string;

        entityId:
          string;

        entityTitle:
          string;

        trigger?:
          string;

        message:
          string;

        detailHref:
          string;
      }>;
  };

  coverage: {
    activeTopics:
      number;

    uncoveredTopics:
      number;

    topicCoveragePercent:
      number;

    publishedKnowledge:
      number;

    uncoveredKnowledge:
      number;

    topicOnlyKnowledge:
      number;

    directKnowledgeCoveragePercent:
      number;
  };

  grounding:
    AdminAIHealthGrounding;

  gaps: {
    open:
      number;

    inProgress:
      number;

    highPriority:
      number;

    top:
      AdminAIHealthGap[];
  };

  feedback: {
    negativeOpen:
      number;

    new:
      number;

    inProgress:
      number;
  };

  knowledgeSync: {
    published:
      number;

    synced:
      number;

    pending:
      number;

    errors:
      number;
  };

  availability: {
    release:
      boolean;

    regressions:
      boolean;

    coverage:
      boolean;

    grounding:
      boolean;

    gaps:
      boolean;

    feedback:
      boolean;

    knowledgeSync:
      boolean;
  };
};

export type AdminAIHealthResponse =
  | {
      success:
        true;

      dashboard:
        AdminAIHealthDashboard;

      requestId:
        string;
    }
  | {
      success:
        false;

      code:
        string;

      message:
        string;

      requestId:
        string;
    };
