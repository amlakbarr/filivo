import {
  NextResponse,
} from "next/server";

import {
  buildAIEvalCasePayload,
  getAIEvalDashboard,
  parseAIEvalCaseInput,
  serializeEvalCase,
  validateAIEvalRelations,
} from "@/lib/ai/evals";

import {
  getAdminSession,
} from "@/lib/pocketbase/admin";

import {
  getPocketBaseServiceClient,
} from "@/lib/pocketbase/service";

export async function GET() {
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

  try {
    const pb =
      await getPocketBaseServiceClient();

    const dashboard =
      await getAIEvalDashboard(
        pb
      );

    return apiSuccess(
      requestId,
      {
        dashboard,
      }
    );
  } catch (error) {
    console.error(
      "AI eval dashboard load failed",
      {
        requestId,

        adminId:
          admin.account.id,

        error,
      }
    );

    return apiError(
      requestId,
      503,
      "AI_EVAL_DASHBOARD_UNAVAILABLE",
      "مرکز تست AI در دسترس نیست."
    );
  }
}

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

  const body =
    await readJson(
      request
    );

  if (
    !body.ok
  ) {
    return apiError(
      requestId,
      400,
      "INVALID_JSON",
      "بدنه درخواست معتبر نیست."
    );
  }

  const parsed =
    parseAIEvalCaseInput(
      body.value
    );

  if (
    !parsed.ok
  ) {
    return apiError(
      requestId,
      400,
      "INVALID_EVAL_CASE",
      parsed.message
    );
  }

  try {
    const pb =
      await getPocketBaseServiceClient();

    const relationError =
      await validateAIEvalRelations(
        pb,
        parsed.value
      );

    if (
      relationError
    ) {
      return apiError(
        requestId,
        400,
        "INVALID_EVAL_RELATION",
        relationError
      );
    }

    const record =
      await pb
        .collection(
          "ai_eval_cases"
        )
        .create(
          buildAIEvalCasePayload(
            parsed.value,
            admin.account.id,
            "create"
          ),
          {
            expand: [
              "expected_topic",
              "expected_knowledge_items",
            ].join(
              ","
            ),
          }
        );

    return apiSuccess(
      requestId,
      {
        item:
          serializeEvalCase(
            record
          ),
      },
      201
    );
  } catch (error) {
    console.error(
      "AI eval case create failed",
      {
        requestId,
        adminId:
          admin.account.id,
        error,
      }
    );

    return apiError(
      requestId,
      503,
      "AI_EVAL_CASE_CREATE_FAILED",
      "ساخت Test Case انجام نشد."
    );
  }
}

async function readJson(
  request:
    Request
) {
  try {
    return {
      ok:
        true as const,

      value:
        await request.json(),
    };
  } catch {
    return {
      ok:
        false as const,
    };
  }
}

function apiSuccess(
  requestId:
    string,

  data:
    Record<
      string,
      unknown
    >,

  status =
    200
) {
  return NextResponse.json(
    {
      success:
        true,

      ...data,

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
