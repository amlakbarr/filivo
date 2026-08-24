export type TopicAnalyticsMetric = {
  value: number;
  previous: number;
  changePercent: number | null;
};

export type TopicAnalyticsTopic = {
  id: string;
  name: string;
  path: string;
  parentId: string;
  parentName: string;
  description: string;
  active: boolean;
};

export type TopicCount = TopicAnalyticsTopic & {
  count: number;
  previousCount: number;
  percentage: number;
  averageConfidence: number;
  uniqueUsers: number;
  uniqueDepartments: number;
};

export type TopicTrendPoint = {
  key: string;
  label: string;
  values: Record<string, number>;
};

export type TopicQuestion = {
  id: string;
  content: string;
  userId: string;
  userName: string;
  employeeCode: string;
  departmentId: string;
  departmentName: string;
  conversationId: string;
  topicId: string;
  topicPath: string;
  confidence: number;
  status: string;
  created: string;
};

export type TopicAnalyticsDashboard = {
  range: {
    preset: string;
    label: string;
    timezone: string;
    from: string;
    to: string;
    granularity: "hour" | "day";
  };
  filters: {
    department: string;
    account: string;
    parentTopic: string;
    topic: string;
    status: string;
    trendTopics: string[];
    unclassifiedPage: number;
  };
  lookups: {
    departments: Array<{ id: string; name: string; active: boolean }>;
    accounts: Array<{ id: string; name: string; employeeCode: string; departmentId: string; active: boolean }>;
    topics: TopicAnalyticsTopic[];
    parentTopics: TopicAnalyticsTopic[];
  };
  kpis: {
    total: TopicAnalyticsMetric;
    classified: TopicAnalyticsMetric;
    unclassified: TopicAnalyticsMetric;
    error: number;
    pending: number;
    usedTopics: number;
    classificationRate: number;
    topTopic: TopicCount | null;
  };
  topics: TopicCount[];
  parents: TopicCount[];
  trend: {
    topics: TopicAnalyticsTopic[];
    points: TopicTrendPoint[];
  };
  employees: {
    items: Array<{
      id: string;
      name: string;
      employeeCode: string;
      department: string;
      total: number;
      classified: number;
      unclassified: number;
      topTopics: Array<{ id: string; path: string; count: number }>;
    }>;
    page: number;
    totalPages: number;
    totalItems: number;
  };
  departments: Array<{
    id: string;
    name: string;
    activeUsers: number;
    total: number;
    classified: number;
    unclassified: number;
    topTopics: Array<{ id: string; path: string; count: number }>;
  }>;
  heatmap: {
    topics: Array<{ id: string; path: string }>;
    rows: Array<{ id: string; name: string; values: Record<string, number> }>;
    maxValue: number;
  };
  confidence: {
    average: number;
    median: number;
    belowThreshold: number;
    threshold: number;
    lowestTopics: Array<{ id: string; path: string; average: number; count: number }>;
  };
  unclassified: TopicQuestion[];
  unclassifiedTotalPages: number;
  errors: string[];
};

export type TopicDetailsAnalytics = {
  topic: TopicAnalyticsTopic;
  range: TopicAnalyticsDashboard["range"];
  total: number;
  uniqueUsers: number;
  uniqueDepartments: number;
  averageConfidence: number;
  trend: TopicAnalyticsDashboard["trend"];
  topEmployees: TopicAnalyticsDashboard["employees"]["items"];
  childBreakdown: TopicCount[];
  recentQuestions: TopicQuestion[];
};

export type AccountTopicAnalytics = {
  account: {
    id: string;
    name: string;
    employeeCode: string;
    department: string;
  };
  dashboard: TopicAnalyticsDashboard;
  recentClassified: TopicQuestion[];
};
