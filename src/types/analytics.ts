export type AnalyticsMetric = {
  value: number;
  previous: number;
  changePercent: number | null;
};

export type AnalyticsPoint = {
  key: string;
  label: string;

  questions: number;

  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;

  cost: number;
};

export type UsageBreakdown = {
  key: string;
  label: string;

  requests: number;

  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;

  cost: number;

  avgLatency: number;
};

export type EmployeeUsageRow = {
  id: string;

  name: string;
  email: string;
  employeeCode: string;
  department: string;

  questions: number;
  conversations: number;

  chatRequests: number;
  classificationRequests: number;

  totalTokens: number;
  cost: number;

  avgChatLatency: number;

  lastActivity: string;
};

/*
 * ============================================
 * Feedback / Quality
 * ============================================
 */

export type ProblematicKnowledgeSource = {
  id: string;
  title: string;

  totalFeedback: number;

  positive: number;
  negative: number;

  satisfactionRate: number;
  negativeRate: number;
};

export type DashboardFeedbackAnalytics = {
  assistantMessages: number;

  total: number;

  positive: number;
  negative: number;

  satisfactionRate: number;

  /*
   * درصد پاسخ‌های AI که حداقل یک Feedback
   * از صاحب همان Conversation گرفته‌اند.
   */
  coverageRate: number;

  /*
   * تنظیمات هشدار که Server استفاده کرده.
   */
  alertThresholds: {
    minTotal: number;
    negativeRate: number;
  };

  problematicSources: ProblematicKnowledgeSource[];
};

/*
 * ============================================
 * Main Dashboard
 * ============================================
 */

export type AnalyticsDashboard = {
  range: {
    preset: string;

    label: string;

    timezone: string;

    from: string;
    to: string;

    previousFrom: string;
    previousTo: string;

    granularity:
      | "hour"
      | "day";
  };

  kpis: {
    questions: AnalyticsMetric;

    activeUsers: AnalyticsMetric;

    requests: number;

    chatRequests: number;

    classificationRequests: number;

    totalTokens: AnalyticsMetric;

    cost: AnalyticsMetric;

    pricedRequests: number;

    unpricedRequests: number;

    avgChatLatency: number;

    successRate: number;
  };

  series: AnalyticsPoint[];

  requestBreakdown: UsageBreakdown[];

  modelBreakdown: UsageBreakdown[];

  fileSearch: {
    calls: number;

    avgCallsPerChat: number;

    chatsWithSearchPercent:
      | number
      | null;
  };

  /*
   * کیفیت پاسخ‌های AI
   */
  feedback: DashboardFeedbackAnalytics;

  failures: Array<{
    id: string;

    created: string;

    userId: string;

    userName: string;

    requestType: string;

    model: string;

    errorMessage: string;

    latencyMs: number;
  }>;

  employees: {
    items: EmployeeUsageRow[];

    page: number;

    perPage: number;

    totalItems: number;

    totalPages: number;

    sort: string;

    search: string;
  };

  errors: string[];
};