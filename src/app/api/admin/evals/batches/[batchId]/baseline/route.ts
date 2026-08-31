import {
  NextResponse,
} from "next/server";

import {
  markAIEvalBatchAsBaseline,
} from "@/lib/ai/eval-batches";

import {
  getAdminSession,
} from "@/lib/pocketbase/admin";

import {
  getPocketBaseServiceClient,
} from "@/lib/pocketbase/service";

const RECORD_ID_PATTERN =
  /^[a-zA-Z0-9_-]{1,64}$/;

export async function POST(
  _request:
    Request,

  {
    params,
  }: {
    params:
      Promise<{
        batchId:
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
    batchId,
  } =
    await params;

  if (
    !RECORD_ID_PATTERN.test(
      batchId
    )
  ) {
    return apiError(
      requestId,
      400,
      "INVALID_EVAL_BATCH_ID",
      "شناسه Batch معتبر نیست."
    );
  }

  try {
    const pb =
      await getPocketBaseServiceClient();

    const batch =
      await markAIEvalBatchAsBaseline(
        pb,
        batchId
      );

    return NextResponse.json(
      {
        success:
          true,

        batch,

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
        : "ثبت Baseline انجام نشد.";

    return apiError(
      requestId,
      409,
      "AI_EVAL_BASELINE_FAILED",
      message
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
