export type KnowledgeEvalStatusValue =
  | "passed"
  | "failed"
  | "error"
  | "running"
  | "stale"
  | "no_cases"
  | "never_run"
  | "not_applicable";

export type KnowledgeEvalStatusItem = {
  knowledgeId:
    string;

  status:
    KnowledgeEvalStatusValue;

  relatedCaseCount:
    number;

  batchId?:
    string;

  batchLabel?:
    string;

  passed:
    number;

  failed:
    number;

  errors:
    number;

  total:
    number;

  knowledgeUpdated?:
    string;

  testedKnowledgeUpdated?:
    string;

  startedAt?:
    string;

  completedAt?:
    string;

  message:
    string;
};

export type KnowledgeEvalStatusResponse =
  | {
      success:
        true;

      items:
        Record<
          string,
          KnowledgeEvalStatusItem
        >;

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
