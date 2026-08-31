import {
  NextResponse,
} from "next/server";

import {
  buildAIEvalCasePayload,
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

const RECORD_ID_PATTERN =
  /^[a-zA-Z0-9_-]{1,64}$/;

export async function PATCH(
  request:
    Request,

  {
    params,
  }: {
    params:
      Promise<{
        caseId:
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
    caseId,
  } =
    await params;

  if (
    !RECORD_ID_PATTERN.test(
      caseId
    )
  ) {
    return apiError(
      requestId,
      400,
      "INVALID_EVAL_CASE_ID",
      "شناسه Test Case معتبر نیست."
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

  const parsed =
    parseAIEvalCaseInput(
      body
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
        .update(
          caseId,
          buildAIEvalCasePayload(
            parsed.value,
            admin.account.id,
            "update"
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
      }
    );
  } catch (error) {
    return apiError(
      requestId,
      getStatus(
        error
      ) ===
        404
        ? 404
        : 503,
      getStatus(
        error
      ) ===
        404
        ? "AI_EVAL_CASE_NOT_FOUND"
        : "AI_EVAL_CASE_UPDATE_FAILED",
      getStatus(
        error
      ) ===
        404
        ? "Test Case پیدا نشد."
        : "ویرایش Test Case انجام نشد."
    );
  }
}

export async function DELETE(
  _request:
    Request,

  {
    params,
  }: {
    params:
      Promise<{
        caseId:
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
    caseId,
  } =
    await params;

  if (
    !RECORD_ID_PATTERN.test(
      caseId
    )
  ) {
    return apiError(
      requestId,
      400,
      "INVALID_EVAL_CASE_ID",
      "شناسه Test Case معتبر نیست."
    );
  }

  try {
    const pb =
      await getPocketBaseServiceClient();

    await pb
      .collection(
        "ai_eval_cases"
      )
      .delete(
        caseId
      );

    return apiSuccess(
      requestId,
      {
        deleted:
          true,
      }
    );
  } catch (error) {
    return apiError(
      requestId,
      getStatus(
        error
      ) ===
        404
        ? 404
        : 503,
      getStatus(
        error
      ) ===
        404
        ? "AI_EVAL_CASE_NOT_FOUND"
        : "AI_EVAL_CASE_DELETE_FAILED",
      getStatus(
        error
      ) ===
        404
        ? "Test Case پیدا نشد."
        : "حذف Test Case انجام نشد."
    );
  }
}

function getStatus(
  error:
    unknown
) {
  if (
    typeof error ===
      "object" &&
    error !==
      null &&
    "status" in
      error &&
    typeof (
      error as {
        status?:
          unknown;
      }
    ).status ===
      "number"
  ) {
    return (
      error as {
        status:
          number;
      }
    ).status;
  }

  return undefined;
}

function apiSuccess(
  requestId:
    string,

  data:
    Record<
      string,
      unknown
    >
) {
  return NextResponse.json(
    {
      success:
        true,

      ...data,

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
