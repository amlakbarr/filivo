export type AIEvalCoverageLevel =
  | "strong"
  | "topic_only"
  | "uncovered";

export type AIEvalTopicCoverageItem = {
  id:
    string;

  name:
    string;

  active:
    boolean;

  directCaseCount:
    number;

  knowledgeCaseCount:
    number;

  covered:
    boolean;
};

export type AIEvalKnowledgeCoverageItem = {
  id:
    string;

  title:
    string;

  topicId?:
    string;

  topicName?:
    string;

  version:
    number;

  syncStatus:
    string;

  directCaseCount:
    number;

  topicCaseCount:
    number;

  level:
    AIEvalCoverageLevel;

  covered:
    boolean;
};

export type AIEvalCoverageDashboard = {
  generatedAt:
    string;

  summary: {
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

    publishedKnowledge:
      number;

    coveredKnowledge:
      number;

    directKnowledge:
      number;

    topicOnlyKnowledge:
      number;

    uncoveredKnowledge:
      number;

    knowledgeCoveragePercent:
      number;

    directKnowledgeCoveragePercent:
      number;
  };

  topics:
    AIEvalTopicCoverageItem[];

  knowledge:
    AIEvalKnowledgeCoverageItem[];
};

export type AIEvalCoverageResponse =
  | {
      success:
        true;

      coverage:
        AIEvalCoverageDashboard;

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
