import { NextResponse } from "next/server";

import {
  getAIEvalReleaseGate,
} from "@/lib/ai/eval-release-gate";
import {
  getAdminSession,
} from "@/lib/pocketbase/admin";
import {
  getPocketBaseServiceClient,
} from "@/lib/pocketbase/service";

export async function GET() {
  const requestId = crypto.randomUUID();
  const admin = await getAdminSession();

  if (!admin.ok) {
    return apiError(
      requestId,
      admin.status,
      admin.code,
      admin.message
    );
  }

  try {
    const pb = await getPocketBaseServiceClient();
    const gate = await getAIEvalReleaseGate(pb);

    return NextResponse.json(
      {
        success: true,
        gate,
        requestId,
      },
      {
        headers: {
          "Cache-Control": "no-store",
          "X-Request-Id": requestId,
        },
      }
    );
  } catch (error) {
    console.error("AI eval release gate failed", {
      requestId,
      adminId: admin.account.id,
      error,
    });

    return apiError(
      requestId,
      503,
      "AI_EVAL_RELEASE_GATE_UNAVAILABLE",
      "وضعیت Release Gate در دسترس نیست."
    );
  }
}

function apiError(
  requestId: string,
  status: number,
  code: string,
  message: string
) {
  return NextResponse.json(
    {
      success: false,
      code,
      message,
      requestId,
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Request-Id": requestId,
      },
    }
  );
}
