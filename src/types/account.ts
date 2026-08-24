export type AccountRole = "employee" | "admin";

export type AccountActivity = {
  conversationCount: number;
  questionCount: number;
  lastActivity: string;
};

export type ManagedAccount = {
  id: string;
  name: string;
  email: string;
  employee_code: string;
  department: string;
  department_name: string;
  job_title: string;
  role: AccountRole;
  active: boolean;
  created: string;
  updated: string;
  activity: AccountActivity;
};

export type AccountApiError = {
  success: false;
  code: string;
  message: string;
  requestId?: string;
  fieldErrors?: Record<string, string>;
};
