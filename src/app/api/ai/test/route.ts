import { NextResponse } from "next/server";

import {
  getOpenAIClient,
  getOpenAIModel,
} from "@/lib/ai/openai";

import { getCurrentAccount } from "@/lib/pocketbase/auth";

export async function GET() {
  const requestId = crypto.randomUUID();

  try {
    /*
     * اجازه تست فقط به کاربر Login شده
     */
    const account =
      await getCurrentAccount();

    if (!account) {
      return NextResponse.json(
        {
          success: false,
          code: "UNAUTHORIZED",
          message: "Unauthorized",
          requestId,
        },
        {
          status: 401,
          headers: {
            "X-Request-Id": requestId,
          },
        }
      );
    }

    const openai =
      getOpenAIClient();

    const model =
      getOpenAIModel();

    const response =
      await openai.responses.create({
        model,

        input:
          "فقط عبارت «اتصال با موفقیت برقرار شد» را بنویس.",

        max_output_tokens: 50,
      });

    const output = response.output_text.trim();

    if (
      response.status !== "completed" ||
      !output
    ) {
      console.error("OpenAI test incomplete", {
        requestId,
        responseId: response.id,
        status: response.status,
        error: response.error,
        incompleteDetails:
          response.incomplete_details,
      });

      return NextResponse.json(
        {
          success: false,
          code: "OPENAI_INCOMPLETE_RESPONSE",
          message: "پاسخ OpenAI کامل نشد.",
          requestId,
          responseId: response.id,
        },
        {
          status: 502,
          headers: {
            "X-Request-Id": requestId,
          },
        }
      );
    }

    return NextResponse.json(
      {
        success: true,

        model,

        responseId: response.id,

        output,
        requestId,
      },
      {
        headers: {
          "X-Request-Id": requestId,
        },
      }
    );
  } catch (error: unknown) {
    const details = getErrorDetails(error);
    const status =
      details.status === 429
        ? 429
        : 503;

    console.error("OpenAI test error", {
      requestId,
      error: details,
    });

    return NextResponse.json(
      {
        success: false,
        code:
          details.status === 429
            ? "OPENAI_RATE_LIMITED"
            : "OPENAI_UNAVAILABLE",
        message:
          "ارتباط با OpenAI برقرار نشد.",
        requestId,
        upstreamRequestId:
          details.requestId,
      },
      {
        status,
        headers: {
          "X-Request-Id": requestId,
        },
      }
    );
  }
}

function getErrorDetails(error: unknown) {
  if (typeof error !== "object" || error === null) {
    return {
      message: String(error),
    };
  }

  const value = error as {
    name?: unknown;
    message?: unknown;
    status?: unknown;
    code?: unknown;
    type?: unknown;
    request_id?: unknown;
  };

  return {
    name:
      typeof value.name === "string"
        ? value.name
        : undefined,
    message:
      typeof value.message === "string"
        ? value.message
        : undefined,
    status:
      typeof value.status === "number"
        ? value.status
        : undefined,
    code:
      typeof value.code === "string"
        ? value.code
        : undefined,
    type:
      typeof value.type === "string"
        ? value.type
        : undefined,
    requestId:
      typeof value.request_id === "string"
        ? value.request_id
        : undefined,
  };
}
