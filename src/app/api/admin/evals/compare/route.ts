import {
  NextResponse,
} from "next/server";

import {
  compareAIEvalBatches,
} from "@/lib/ai/eval-batches";

import {
  getAdminSession,
} from "@/lib/pocketbase/admin";

import {
  getPocketBaseServiceClient,
} from "@/lib/pocketbase/service";

const RECORD_ID_PATTERN =
  /^[a-zA-Z0-9_-]{1,64}$/;

export async function GET(
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

  const url =
    new URL(
      request.url
    );

  const baseline =
    cleanOptionalId(
      url.searchParams.get(
        "baseline"
      )
    );

  const current =
    cleanOptionalId(
      url.searchParams.get(
        "current"
      )
    );

  try {
    const pb =
      await getPocketBaseServiceClient();

    const comparison =
      await compareAIEvalBatches({
        pb,

        baselineId:
          baseline,

        currentId:
          current,
      });

    return NextResponse.json(
      {
        success:
          true,

        comparison,

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
    const message =
      error instanceof
        Error
        ? error.message
        : "مقایسه Batchها انجام نشد.";

    return apiError(
      requestId,
      409,
      "AI_EVAL_COMPARE_FAILED",
      message
    );
  }
}

function cleanOptionalId(
  value:
    string |
    null
) {
  if (
    !value
  ) {
    return undefined;
  }

  const id =
    value.trim();

  return RECORD_ID_PATTERN.test(
    id
  )
    ? id
    : undefined;
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
