import { NextResponse } from "next/server";
import type { RecordModel } from "pocketbase";

import { getAdminSession } from "@/lib/pocketbase/admin";
import { getPocketBaseServiceClient } from "@/lib/pocketbase/service";

const RECENT_CLASSIFICATION_LIMIT = 20;
const MAX_QUESTION_LENGTH = 180;

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
      .collection("messages")
      .getList(1, RECENT_CLASSIFICATION_LIMIT, {
        filter: "role = 'user'",
        sort: "-created",
        expand: "topic,topic.parent",
      });

    return jsonResponse(
      {
        success: true,
        count: result.items.length,
        items: result.items.map((record) => {
          const topic = getExpandedTopic(record);

          return {
            message_id: record.id,
            user: String(record.user || ""),
            question: truncateQuestion(record.content),
            topic_id:
              String(record.topic || "") || null,
            topic_name: topic?.name || null,
            parent_topic: topic?.parent || null,
            topic_confidence: toConfidence(
              record.topic_confidence
            ),
            classification_status: String(
              record.classification_status || "pending"
            ),
            created: String(record.created || ""),
          };
        }),
      },
      200,
      requestId
    );
  } catch (error) {
    console.error("Recent classification query failed", {
      requestId,
      adminId: admin.account.id,
      error,
    });

    return jsonResponse(
      {
        success: false,
        code: "CLASSIFICATION_UNAVAILABLE",
        message: "اطلاعات طبقه‌بندی در دسترس نیست.",
        requestId,
      },
      503,
      requestId
    );
  }
}

function getExpandedTopic(record: RecordModel) {
  const expand = record.expand as
    | Record<string, unknown>
    | undefined;
  const rawTopic = expand?.topic;
  const topic = Array.isArray(rawTopic)
    ? rawTopic[0]
    : rawTopic;

  if (typeof topic !== "object" || topic === null) {
    return null;
  }

  const topicRecord = topic as Record<string, unknown>;
  const topicExpand = topicRecord.expand as
    | Record<string, unknown>
    | undefined;
  const rawParent = topicExpand?.parent;
  const parent = Array.isArray(rawParent)
    ? rawParent[0]
    : rawParent;
  const parentName =
    typeof parent === "object" && parent !== null
      ? String(
          (parent as Record<string, unknown>).name || ""
        ).trim()
      : "";

  return {
    name: String(topicRecord.name || "").trim(),
    parent: parentName || null,
  };
}

function truncateQuestion(value: unknown) {
  const question = String(value || "")
    .replace(/\s+/g, " ")
    .trim();

  if (question.length <= MAX_QUESTION_LENGTH) {
    return question;
  }

  return `${question.slice(0, MAX_QUESTION_LENGTH).trim()}…`;
}

function toConfidence(value: unknown) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.min(1, Math.max(0, number));
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
