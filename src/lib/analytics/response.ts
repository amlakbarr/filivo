import { NextResponse } from "next/server";

export function analyticsResponse(
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

export function analyticsError(
  requestId: string,
  status: number,
  code: string,
  message: string
) {
  return analyticsResponse(
    { success: false, code, message },
    status,
    requestId
  );
}
