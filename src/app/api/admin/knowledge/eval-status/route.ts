import {
  NextResponse,
} from "next/server";

import {
  getKnowledgeEvalStatuses,
  parseKnowledgeEvalStatusIds,
} from "@/lib/ai/knowledge-eval-status";

import {
  getAdminSession,
} from "@/lib/pocketbase/admin";

import {
  getPocketBaseServiceClient,
} from "@/lib/pocketbase/service";

export async function POST(
  request:
    Request
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

  let body:
    unknown;

  try {
    body =
      await request.json();
  } catch {
    return apiError(
      requestId,
      400,
      "INVALID_JSON",
      "بدنه درخواست معتبر نیست."
    );
  }

  const ids =
    parseKnowledgeEvalStatusIds(
      typeof body ===
        "object" &&
      body !==
        null &&
      !Array.isArray(
        body
      )
        ? (
            body as {
              ids?:
                unknown;
            }
          ).ids
        : undefined
    );

  if (
    ids.length ===
    0
  ) {
    return apiSuccess(
      requestId,
      {}
    );
  }

  try {
    const pb =
      await getPocketBaseServiceClient();

    const items =
      await getKnowledgeEvalStatuses({
        pb,

        knowledgeIds:
          ids,
      });

    return apiSuccess(
      requestId,
      items
    );
  } catch (error) {
    console.error(
      "Knowledge eval status load failed",
      {
        requestId,

        adminId:
          admin.account.id,

        ids,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    return apiError(
      requestId,
      503,
      "KNOWLEDGE_EVAL_STATUS_UNAVAILABLE",
      "وضعیت تست هوش مصنوعی مطالب موقتاً در دسترس نیست."
    );
  }
}

function apiSuccess(
  requestId:
    string,

  items:
    Record<
      string,
      unknown
    >
) {
  return NextResponse.json(
    {
      success:
        true,

      items,

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
