import { NextResponse } from "next/server";

import { getAdminPocketBase } from "@/lib/pocketbase/admin";
import { getCurrentAccount } from "@/lib/pocketbase/auth";

export async function POST(
  request: Request,
  {
    params,
  }: {
    params: Promise<{
      id: string;
    }>;
  }
) {
  /*
   * =========================================
   * Authentication
   * =========================================
   */

  const account =
    await getCurrentAccount();

  if (!account) {
    return NextResponse.json(
      {
        success: false,
        message:
          "ابتدا وارد حساب کاربری شوید.",
      },
      {
        status: 401,
      }
    );
  }

  if (
    account.role !== "admin"
  ) {
    return NextResponse.json(
      {
        success: false,
        message:
          "دسترسی غیرمجاز است.",
      },
      {
        status: 403,
      }
    );
  }

  const { id: gapId } =
    await params;

  /*
   * =========================================
   * Request Body
   * =========================================
   */

  let body: unknown;

  try {
    body =
      await request.json();
  } catch {
    return NextResponse.json(
      {
        success: false,
        message:
          "ساختار درخواست معتبر نیست.",
      },
      {
        status: 400,
      }
    );
  }

  const knowledgeItemId =
    getKnowledgeItemId(body);

  if (!knowledgeItemId) {
    return NextResponse.json(
      {
        success: false,
        message:
          "شناسه مطلب پایگاه دانش معتبر نیست.",
      },
      {
        status: 400,
      }
    );
  }

  /*
   * =========================================
   * Superuser PocketBase
   * =========================================
   */

  const pb =
    await getAdminPocketBase();

  /*
   * =========================================
   * Gap
   * =========================================
   */

  let gap;

  try {
    gap = await pb
      .collection(
        "knowledge_gaps"
      )
      .getOne(gapId);
  } catch (error) {
    if (
      getErrorStatus(error) ===
      404
    ) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Knowledge Gap پیدا نشد.",
        },
        {
          status: 404,
        }
      );
    }

    console.error(
      "Resolve gap lookup failed",
      error
    );

    return NextResponse.json(
      {
        success: false,
        message:
          "در بررسی Knowledge Gap خطایی رخ داد.",
      },
      {
        status: 500,
      }
    );
  }

  /*
   * =========================================
   * Knowledge Item
   * =========================================
   */

  let knowledgeItem;

  try {
    knowledgeItem =
      await pb
        .collection(
          "knowledge_items"
        )
        .getOne(
          knowledgeItemId
        );
  } catch (error) {
    if (
      getErrorStatus(error) ===
      404
    ) {
      return NextResponse.json(
        {
          success: false,
          message:
            "مطلب پایگاه دانش پیدا نشد.",
        },
        {
          status: 404,
        }
      );
    }

    console.error(
      "Resolve gap knowledge lookup failed",
      error
    );

    return NextResponse.json(
      {
        success: false,
        message:
          "در بررسی مطلب پایگاه دانش خطایی رخ داد.",
      },
      {
        status: 500,
      }
    );
  }

  /*
   * =========================================
   * Published check
   * =========================================
   */

  if (
    knowledgeItem.status !==
    "published"
  ) {
    return NextResponse.json(
      {
        success: false,
        message:
          "برای حل Knowledge Gap، مطلب باید ابتدا منتشر شود.",
      },
      {
        status: 409,
      }
    );
  }

  /*
   * =========================================
   * Vector Store Sync check
   * =========================================
   */

  if (
    knowledgeItem.sync_status !==
    "synced"
  ) {
    return NextResponse.json(
      {
        success: false,
        message:
          "مطلب هنوز با پایگاه دانش هوش مصنوعی همگام نشده است.",
      },
      {
        status: 409,
      }
    );
  }

  /*
   * openai_file_id نیز باید وجود داشته باشد.
   * یعنی سند واقعاً وارد Vector Store شده.
   */

  if (
    !String(
      knowledgeItem.openai_file_id ||
        ""
    ).trim()
  ) {
    return NextResponse.json(
      {
        success: false,
        message:
          "فایل همگام‌شده OpenAI برای این مطلب ثبت نشده است.",
      },
      {
        status: 409,
      }
    );
  }

  /*
   * =========================================
   * Idempotency
   * =========================================
   */

  if (
    gap.status === "resolved"
  ) {
    const existingKnowledgeId =
      String(
        gap.resolved_knowledge_item ||
          ""
      );

    /*
     * همان Knowledge قبلاً Gap را حل کرده.
     * Success برگردان.
     */
    if (
      existingKnowledgeId ===
      knowledgeItem.id
    ) {
      return NextResponse.json({
        success: true,
        alreadyResolved: true,

        gap: {
          id:
            gap.id,

          status:
            gap.status,

          resolvedKnowledgeItem:
            existingKnowledgeId,

          resolvedAt:
            gap.resolved_at ||
            "",
        },
      });
    }

    /*
     * Gap با Knowledge دیگری قبلاً حل شده.
     */
    return NextResponse.json(
      {
        success: false,
        message:
          "این Knowledge Gap قبلاً با مطلب دیگری حل شده است.",
      },
      {
        status: 409,
      }
    );
  }

  /*
   * =========================================
   * Resolve
   * =========================================
   */

  const now =
    new Date().toISOString();

  const updateData: Record<
    string,
    unknown
  > = {
    status:
      "resolved",

    resolved_knowledge_item:
      knowledgeItem.id,

    resolved_by:
      account.id,

    resolved_at:
      now,

    resolution_note:
      `با انتشار مطلب «${String(
        knowledgeItem.title ||
          ""
      ).slice(
        0,
        200
      )}» در پایگاه دانش حل شد.`,

    ignore_note:
      "",
  };

  /*
   * اگر Gap موضوع نداشت ولی Knowledge
   * موضوع دارد، Topic را هم تکمیل کن.
   */

  if (
    !gap.topic &&
    knowledgeItem.topic
  ) {
    updateData.topic =
      knowledgeItem.topic;
  }

  try {
    const updatedGap =
      await pb
        .collection(
          "knowledge_gaps"
        )
        .update(
          gap.id,
          updateData
        );

    return NextResponse.json({
      success: true,

      gap: {
        id:
          updatedGap.id,

        status:
          updatedGap.status,

        resolvedKnowledgeItem:
          updatedGap.resolved_knowledge_item,

        resolvedBy:
          updatedGap.resolved_by,

        resolvedAt:
          updatedGap.resolved_at,
      },

      knowledgeItem: {
        id:
          knowledgeItem.id,

        title:
          knowledgeItem.title,
      },
    });
  } catch (error) {
    console.error(
      "Resolve knowledge gap failed",
      error
    );

    return NextResponse.json(
      {
        success: false,
        message:
          "حل Knowledge Gap انجام نشد.",
      },
      {
        status: 500,
      }
    );
  }
}

/*
 * =========================================
 * Helpers
 * =========================================
 */

function getKnowledgeItemId(
  body: unknown
) {
  if (
    typeof body !==
      "object" ||
    body === null ||
    !(
      "knowledgeItemId" in
      body
    )
  ) {
    return null;
  }

  const value =
    String(
      body.knowledgeItemId ||
        ""
    ).trim();

  if (!value) {
    return null;
  }

  return value.slice(
    0,
    100
  );
}

function getErrorStatus(
  error: unknown
) {
  if (
    typeof error !==
      "object" ||
    error === null
  ) {
    return undefined;
  }

  const value =
    error as {
      status?: unknown;
    };

  return typeof value.status ===
    "number"
    ? value.status
    : undefined;
}