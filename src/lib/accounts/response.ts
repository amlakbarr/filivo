import { NextResponse } from "next/server";

export function accountApiResponse(
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

export function accountApiError(
  requestId: string,
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>
) {
  return accountApiResponse(
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
