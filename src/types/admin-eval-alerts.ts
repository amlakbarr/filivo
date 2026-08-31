export type AdminEvalAlertSeverity =
  | "critical"
  | "warning"
  | "info";

export type AdminEvalAlertKind =
  | "regression"
  | "failed"
  | "error"
  | "running";

export type AdminEvalAlertScope =
  | "knowledge"
  | "topic";

export type AdminEvalAlert = {
  id: string;

  scope:
    AdminEvalAlertScope;

  kind:
    AdminEvalAlertKind;

  severity:
    AdminEvalAlertSeverity;

  entityId:
    string;

  entityTitle:
    string;

  topicName?:
    string;

  trigger?:
    string;

  batchId:
    string;

  batchLabel:
    string;

  regressions:
    number;

  failed:
    number;

  errors:
    number;

  total:
    number;

  message:
    string;

  detailHref:
    string;

  created:
    string;
};

export type AdminEvalAlertsResponse =
  | {
      success:
        true;

      alerts:
        AdminEvalAlert[];

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
