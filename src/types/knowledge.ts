export type KnowledgeStatus = "draft" | "published" | "archived";
export type KnowledgeSyncStatus = "pending" | "synced" | "error";
export type KnowledgeSourceType = "text" | "file";

export type KnowledgeItem = {
  id: string;
  title: string;
  content: string;
  topic: string;
  topic_name: string;
  departments: string[];
  department_names: string[];
  tags: string[];
  source_type: KnowledgeSourceType;
  attachment: string;
  attachment_url: string;
  status: KnowledgeStatus;
  version: number;
  sync_status: KnowledgeSyncStatus;
  sync_error: string;
  openai_file_id: string;
  created_by: string;
  updated_by: string;
  created: string;
  updated: string;
};

export type TopicOption = { id: string; name: string; parent_id: string; parent_name: string; label: string };
export type DepartmentOption = { id: string; name: string };
export type KnowledgeApiError = { success: false; code: string; message: string; requestId?: string; fieldErrors?: Record<string, string> };
