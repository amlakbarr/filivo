import type PocketBase from "pocketbase";

import {
  isSafeTopicId,
  safeTopicErrorMetadata,
  type TopicRecord,
} from "@/lib/topics/admin";

import {
  TOPIC_GUIDANCE_VERSION_COLLECTION,
  serializeTopicGuidanceVersion,
  topicGuidanceSnapshot,
} from "@/lib/topics/guidance-history";

import {
  getAdminSession,
} from "@/lib/pocketbase/admin";

import {
  getPocketBaseServiceClient,
} from "@/lib/pocketbase/service";

const HISTORY_LIMIT =
  30;

type Context = {
  params:
    Promise<{
      id:
        string;
    }>;
};

export async function GET(
  _request:
    Request,

  {
    params,
  }:
    Context
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
    id:
      topicId,
  } =
    await params;

  if (
    !isSafeTopicId(
      topicId
    )
  ) {
    return apiError(
      requestId,
      400,
      "TOPIC_ID_INVALID",
      "شناسه موضوع معتبر نیست."
    );
  }

  let pb:
    PocketBase;

  try {
    pb =
      await getPocketBaseServiceClient();
  } catch (error) {
    return serviceError(
      requestId,
      error
    );
  }

  try {
    const [
      topic,
      versions,
    ] =
      await Promise.all([
        pb
          .collection(
            "topics"
          )
          .getOne<TopicRecord>(
            topicId
          ),

        pb
          .collection(
            TOPIC_GUIDANCE_VERSION_COLLECTION
          )
          .getList(
            1,
            HISTORY_LIMIT,
            {
              filter:
                pb.filter(
                  "topic = {:topicId}",
                  {
                    topicId,
                  }
                ),

              sort:
                "-created",

              expand:
                "created_by",
            }
          ),
      ]);

    return Response.json(
      {
        success:
          true,

        current: {
          snapshot:
            topicGuidanceSnapshot(
              topic
            ),

          updated:
            String(
              topic.updated ||
                ""
            ),
        },

        versions:
          versions.items.map(
            serializeTopicGuidanceVersion
          ),

        requestId,
      },
      {
        status:
          200,

        headers: {
          "Cache-Control":
            "no-store",

          "X-Request-Id":
            requestId,
        },
      }
    );
  } catch (error) {
    const status =
      getStatus(
        error
      );

    if (
      status ===
      404
    ) {
      return apiError(
        requestId,
        404,
        "TOPIC_GUIDANCE_HISTORY_NOT_FOUND",
        "موضوع یا تاریخچه Guidance پیدا نشد."
      );
    }

    console.error(
      "Topic guidance history failed",
      {
        requestId,

        adminId:
          admin.account.id,

        topicId,

        error:
          safeTopicErrorMetadata(
            error
          ),
      }
    );

    return apiError(
      requestId,
      503,
      "TOPIC_GUIDANCE_HISTORY_FAILED",
      "دریافت تاریخچه Guidance ناموفق بود."
    );
  }
}

function serviceError(
  requestId:
    string,

  error:
    unknown
) {
  console.error(
    "Topic guidance history service unavailable",
    {
      requestId,

      error:
        safeTopicErrorMetadata(
          error
        ),
    }
  );

  return apiError(
    requestId,
    503,
    "TOPIC_SERVICE_UNAVAILABLE",
    "سرویس مدیریت موضوعات موقتاً در دسترس نیست."
  );
}

function getStatus(
  error:
    unknown
) {
  if (
    typeof error !==
      "object" ||
    error ===
      null
  ) {
    return undefined;
  }

  const value =
    error as {
      status?:
        unknown;
    };

  return typeof value.status ===
    "number"
    ? value.status
    : undefined;
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
  return Response.json(
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
