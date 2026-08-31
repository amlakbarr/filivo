import {
  NextResponse,
} from "next/server";

import {
  getTopicEvalDetail,
  isTopicEvalRecordId,
} from "@/lib/ai/topic-eval-detail";

import {
  getAdminSession,
} from "@/lib/pocketbase/admin";

import {
  getPocketBaseServiceClient,
} from "@/lib/pocketbase/service";

export async function GET(
  _request:
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
    return apiError(
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
    !isTopicEvalRecordId(
      topicId
    )
  ) {
    return apiError(
      requestId,
      400,
      "INVALID_TOPIC_ID",
      "شناسه Topic معتبر نیست."
    );
  }

  try {
    const pb =
      await getPocketBaseServiceClient();

    const detail =
      await getTopicEvalDetail({
        pb,

        topicId,
      });

    return NextResponse.json(
      {
        success:
          true,

        detail,

        requestId,
      },
      {
        headers: {
          "Cache-Control":
            "no-store",

          "X-Request-Id":
            requestId,
        },
      }
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
      return apiError(
        requestId,
        404,
        "TOPIC_NOT_FOUND",
        "Topic موردنظر پیدا نشد."
      );
    }

    console.error(
      "Topic eval detail load failed",
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

    return apiError(
      requestId,
      503,
      "TOPIC_EVAL_DETAIL_UNAVAILABLE",
      "جزئیات تست این Topic موقتاً در دسترس نیست."
    );
  }
}

function apiError(
  requestId:
    string,

  status:
    number,

  code:
    string,

  message:
    string
) {
  return NextResponse.json(
    {
      success:
        false,

      code,

      message,

      requestId,
    },
    {
      status,

      headers: {
        "Cache-Control":
          "no-store",

        "X-Request-Id":
          requestId,
      },
    }
  );
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
