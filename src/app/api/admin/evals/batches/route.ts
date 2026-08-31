import {
  NextResponse,
} from "next/server";

import {
  getAIEvalBatches,
} from "@/lib/ai/eval-batches";

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

    const batches =
      await getAIEvalBatches(
        pb
      );

    return NextResponse.json(
      {
        success:
          true,

        batches,

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
    console.error(
      "AI eval batches load failed",
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
      "AI_EVAL_BATCHES_UNAVAILABLE",
      "تاریخچه اجرای تست‌ها در دسترس نیست."
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
