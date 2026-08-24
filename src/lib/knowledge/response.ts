import { NextResponse } from "next/server";

export function knowledgeApiResponse(
  body: Record<string, unknown>,
  status: number,
  requestId: string
) {
  return NextResponse.json(
    { ...body, requestId },
    {
      status,
      headers: {
        "X-Request-Id": requestId,
        "Cache-Control": "no-store",
      },
    }
  );
}

export function knowledgeApiError(
  requestId: string,
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>
) {
  return knowledgeApiResponse(
    {
      success: false,
      code,
      message,
      ...(details || {}),
    },
    status,
    requestId
  );
}
