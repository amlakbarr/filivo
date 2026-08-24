import { NextResponse } from "next/server";

import { getAdminSession } from "@/lib/pocketbase/admin";
import { getPocketBaseServiceClient } from "@/lib/pocketbase/service";

const RECENT_USAGE_LIMIT = 20;

export async function GET() {
  const requestId = crypto.randomUUID();
  const admin = await getAdminSession();

  if (!admin.ok) {
    return jsonResponse(
      {
        success: false,
        code: admin.code,
        message: admin.message,
        requestId,
      },
      admin.status,
      requestId
    );
  }

  try {
    const pb = await getPocketBaseServiceClient();
    const result = await pb
      .collection("ai_usage")
      .getList(1, RECENT_USAGE_LIMIT, {
        sort: "-created",
        fields: [
          "id",
          "user",
          "conversation",
          "model",
          "input_tokens",
          "cached_input_tokens",
          "output_tokens",
          "reasoning_tokens",
          "total_tokens",
          "file_search_calls",
          "estimated_cost_usd",
          "cost_available",
          "latency_ms",
          "success",
          "created",
        ].join(","),
      });

    return jsonResponse(
      {
        success: true,
        count: result.items.length,
        items: result.items.map((record) => ({
          user: String(record.user || ""),
          conversation: String(
            record.conversation || ""
          ),
          model: String(record.model || ""),
          input_tokens: toNumber(record.input_tokens),
          cached_input_tokens: toNumber(
            record.cached_input_tokens
          ),
          output_tokens: toNumber(record.output_tokens),
          reasoning_tokens: toNumber(
            record.reasoning_tokens
          ),
          total_tokens: toNumber(record.total_tokens),
          file_search_calls: toNumber(
            record.file_search_calls
          ),
          estimated_cost_usd:
            record.cost_available === false
              ? null
              : toNumber(record.estimated_cost_usd),
          latency_ms: toNumber(record.latency_ms),
          success: Boolean(record.success),
          created: String(record.created || ""),
        })),
      },
      200,
      requestId
    );
  } catch (error) {
    console.error("Recent AI usage query failed", {
      requestId,
      adminId: admin.account.id,
      error,
    });

    return jsonResponse(
      {
        success: false,
        code: "USAGE_UNAVAILABLE",
        message: "اطلاعات مصرف در دسترس نیست.",
        requestId,
      },
      503,
      requestId
    );
  }
}

function toNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  requestId: string
) {
  return NextResponse.json(body, {
    status,
    headers: {
      "X-Request-Id": requestId,
      "Cache-Control": "no-store",
    },
  });
}
