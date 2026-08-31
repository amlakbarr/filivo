import {
  analyticsError,
  analyticsResponse,
} from "@/lib/analytics/response";

import {
  getGroundingTopicRemediationDashboard,
  isGroundingRecordId,
  parseGroundingRemediationRange,
} from "@/lib/analytics/grounding-remediation";

import {
  getAdminSession,
} from "@/lib/pocketbase/admin";

import {
  getPocketBaseServiceClient,
} from "@/lib/pocketbase/service";

export async function GET(
  request:
    Request,

  {
    params,
  }: {
    params:
      Promise<{
        topicId:
          string;
      }>;
  }
) {
  const requestId =
    crypto.randomUUID();

  const admin =
    await getAdminSession();

  if (
    !admin.ok
  ) {
    return analyticsError(
      requestId,
      admin.status,
      admin.code,
      admin.message
    );
  }

  const {
    topicId:
      rawTopicId,
  } =
    await params;

  const topicId =
    String(
      rawTopicId ||
        ""
    ).trim();

  if (
    !isGroundingRecordId(
      topicId
    )
  ) {
    return analyticsError(
      requestId,
      400,
      "INVALID_TOPIC_ID",
      "شناسه موضوع معتبر نیست."
    );
  }

  const url =
    new URL(
      request.url
    );

  const range =
    parseGroundingRemediationRange(
      url.searchParams.get(
        "range"
      )
    );

  try {
    const pb =
      await getPocketBaseServiceClient();

    const dashboard =
      await getGroundingTopicRemediationDashboard(
        pb,
        topicId,
        range
      );

    return analyticsResponse(
      {
        success:
          true,

        dashboard,
      },
      200,
      requestId
    );
  } catch (error) {
    const status =
      getErrorStatus(
        error
      );

    if (
      status ===
      404
    ) {
      return analyticsError(
        requestId,
        404,
        "TOPIC_NOT_FOUND",
        "موضوع موردنظر پیدا نشد."
      );
    }

    console.error(
      "Grounding topic remediation failed",
      {
        requestId,

        adminId:
          admin.account.id,

        topicId,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return analyticsError(
      requestId,
      503,
      "GROUNDING_REMEDIATION_UNAVAILABLE",
      "اطلاعات اقدام اصلاحی این موضوع در دسترس نیست."
    );
  }
}

function getErrorStatus(
  error:
    unknown
) {
  if (
    typeof error !==
      "object" ||
    error ===
      null
  ) {
    return undefined;
  }

  const value =
    error as {
      status?:
        unknown;
    };

  return typeof value.status ===
    "number"
      ? value.status
      : undefined;
}

function safeErrorMetadata(
  error:
    unknown
) {
  if (
    typeof error !==
      "object" ||
    error ===
      null
  ) {
    return {
      message:
        String(
          error
        ),
    };
  }

  const value =
    error as {
      name?:
        unknown;

      message?:
        unknown;

      status?:
        unknown;

      code?:
        unknown;
    };

  return {
    name:
      typeof value.name ===
      "string"
        ? value.name
        : undefined,

    message:
      typeof value.message ===
      "string"
        ? value.message
        : undefined,

    status:
      typeof value.status ===
      "number"
        ? value.status
        : undefined,

    code:
      typeof value.code ===
        "string" ||
      typeof value.code ===
        "number"
        ? value.code
        : undefined,
  };
}
