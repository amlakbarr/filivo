import type PocketBase from "pocketbase";

import {
  recordAuditLog,
} from "@/lib/audit/log";

import {
  consumeAdminRateLimit,
} from "@/lib/admin/rate-limit";

import {
  TopicValidationError,
  buildTopicListFilter,
  clampInteger,
  cleanTopicSearch,
  getTopicMessageCount,
  parseTopicCreateInput,
  parseTopicStatus,
  safeTopicErrorMetadata,
  serializeTopic,
  topicCodeExists,
  type TopicRecord,
} from "@/lib/topics/admin";

import {
  getAdminSession,
} from "@/lib/pocketbase/admin";

import {
  getPocketBaseServiceClient,
} from "@/lib/pocketbase/service";

const MAX_PAGE_SIZE =
  50;

/*
 * ============================================
 * GET
 *
 * List Topics
 * ============================================
 */

export async function GET(
  request:
    Request
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

  let pb:
    PocketBase;

  try {
    pb =
      await getPocketBaseServiceClient();
  } catch (error) {
    console.error(
      "Topic service unavailable",
      {
        requestId,

        adminId:
          admin.account.id,

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

  const url =
    new URL(
      request.url
    );

  const page =
    clampInteger(
      url.searchParams.get(
        "page"
      ),
      1,
      100_000,
      1
    );

  const perPage =
    clampInteger(
      url.searchParams.get(
        "perPage"
      ),
      1,
      MAX_PAGE_SIZE,
      10
    );

  const search =
    cleanTopicSearch(
      url.searchParams.get(
        "search"
      )
    );

  const status =
    parseTopicStatus(
      url.searchParams.get(
        "status"
      )
    );

  const filter =
    buildTopicListFilter({
      pb,

      search,

      status,
    });

  try {
    const result =
      await pb
        .collection(
          "topics"
        )
        .getList<TopicRecord>(
          page,
          perPage,
          {
            ...(filter
              ? {
                  filter,
                }
              : {}),

            sort:
              "sort_order,name",

            fields:
              [
                "id",
                "name",
                "code",
                "description",
                "keywords",
                "examples",
                "negative_examples",
                "classification_note",
                "active",
                "sort_order",
                "created",
                "updated",
              ].join(
                ","
              ),
          }
        );

    const counts =
      await mapWithConcurrency(
        result.items,
        6,
        async (
          topic
        ) =>
          getTopicMessageCount({
            pb,

            topicId:
              topic.id,
          })
      );

    const items =
      result.items.map(
        (
          topic,
          index
        ) =>
          serializeTopic(
            topic,
            counts[
              index
            ] ||
              0
          )
      );

    return apiSuccess(
      {
        success:
          true,

        items,

        pagination: {
          page:
            result.page,

          perPage:
            result.perPage,

          totalItems:
            result.totalItems,

          totalPages:
            result.totalPages,
        },

        requestId,
      }
    );
  } catch (error) {
    console.error(
      "Topic list failed",
      {
        requestId,

        adminId:
          admin.account.id,

        error:
          safeTopicErrorMetadata(
            error
          ),
      }
    );

    return apiError(
      requestId,
      500,
      "TOPIC_LIST_FAILED",
      "دریافت فهرست موضوعات ناموفق بود."
    );
  }
}

/*
 * ============================================
 * POST
 *
 * Create Topic
 * ============================================
 */

export async function POST(
  request:
    Request
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

  const rateLimit =
    await consumeMutationRateLimit({
      adminId:
        admin.account.id,

      action:
        "topic.create",

      requestId,
    });

  if (
    rateLimit instanceof
      Response
  ) {
    return rateLimit;
  }

  let body:
    unknown;

  try {
    body =
      await request.json();
  } catch {
    return apiError(
      requestId,
      400,
      "TOPIC_INVALID_JSON",
      "بدنه JSON درخواست معتبر نیست."
    );
  }

  let payload;

  try {
    payload =
      parseTopicCreateInput(
        body
      );
  } catch (error) {
    if (
      error instanceof
      TopicValidationError
    ) {
      return validationError(
        requestId,
        error
      );
    }

    throw error;
  }

  let pb:
    PocketBase;

  try {
    pb =
      await getPocketBaseServiceClient();
  } catch (error) {
    console.error(
      "Topic service unavailable during create",
      {
        requestId,

        adminId:
          admin.account.id,

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

  try {
    if (
      await topicCodeExists({
        pb,

        code:
          payload.code,
      })
    ) {
      return apiError(
        requestId,
        409,
        "TOPIC_CODE_EXISTS",
        "موضوع دیگری با این کد وجود دارد.",
        {
          field:
            "code",
        }
      );
    }

    const created =
      await pb
        .collection(
          "topics"
        )
        .create<TopicRecord>(
          payload
        );

    await recordAuditLog({
      action:
        "topic.create",

      result:
        "success",

      actorId:
        admin.account.id,

      actorRole:
        "admin",

      entityType:
        "topic",

      entityId:
        created.id,

      requestId,

      request,

      metadata: {
        name:
          payload.name,

        code:
          payload.code,

        active:
          payload.active,

        sort_order:
          payload.sort_order,

        guidance: {
          keywords:
            Boolean(
              payload.keywords
            ),

          examples:
            Boolean(
              payload.examples
            ),

          negative_examples:
            Boolean(
              payload.negative_examples
            ),

          classification_note:
            Boolean(
              payload.classification_note
            ),
        },
      },
    });

    return apiSuccess(
      {
        success:
          true,

        item:
          serializeTopic(
            created,
            0
          ),

        requestId,
      },
      201
    );
  } catch (error) {
    console.error(
      "Topic create failed",
      {
        requestId,

        adminId:
          admin.account.id,

        error:
          safeTopicErrorMetadata(
            error
          ),
      }
    );

    await recordAuditLog({
      action:
        "topic.create",

      result:
        "failure",

      actorId:
        admin.account.id,

      actorRole:
        "admin",

      entityType:
        "topic",

      requestId,

      request,

      errorCode:
        "TOPIC_CREATE_FAILED",
    });

    return apiError(
      requestId,
      500,
      "TOPIC_CREATE_FAILED",
      "ساخت موضوع ناموفق بود."
    );
  }
}

/*
 * ============================================
 * Mutation Rate Limit
 * ============================================
 */

async function consumeMutationRateLimit({
  adminId,
  action,
  requestId,
}: {
  adminId:
    string;

  action:
    "topic.create" |
    "topic.update";

  requestId:
    string;
}): Promise<
  true |
  Response
> {
  try {
    const result =
      await consumeAdminRateLimit({
        adminId,

        action,

        requestId,
      });

    if (
      !result.allowed
    ) {
      return apiError(
        requestId,
        429,
        result.code,
        "تعداد درخواست‌های مدیریتی بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.",
        {
          retryAfterSeconds:
            result.retryAfterSeconds,
        },
        {
          "Retry-After":
            String(
              result.retryAfterSeconds
            ),
        }
      );
    }

    return true;
  } catch (error) {
    console.error(
      "Topic admin rate limit unavailable",
      {
        requestId,

        adminId,

        action,

        error:
          safeTopicErrorMetadata(
            error
          ),
      }
    );

    return apiError(
      requestId,
      503,
      "ADMIN_RATE_LIMIT_UNAVAILABLE",
      "کنترل محدودیت درخواست‌های مدیریتی موقتاً در دسترس نیست."
    );
  }
}

/*
 * ============================================
 * Responses
 * ============================================
 */

function validationError(
  requestId:
    string,

  error:
    TopicValidationError
) {
  return apiError(
    requestId,
    400,
    error.code,
    error.message,
    error.field
      ? {
          field:
            error.field,
        }
      : undefined
  );
}

function apiSuccess(
  body:
    unknown,

  status =
    200
) {
  return Response.json(
    body,
    {
      status,

      headers: {
        "Cache-Control":
          "no-store",
      },
    }
  );
}

function apiError(
  requestId:
    string,

  status:
    number,

  code:
    string,

  message:
    string,

  extra?:
    Record<
      string,
      unknown
    >,

  headers?:
    Record<
      string,
      string
    >
) {
  return Response.json(
    {
      success:
        false,

      code,

      message,

      requestId,

      ...(extra ||
        {}),
    },
    {
      status,

      headers: {
        "Cache-Control":
          "no-store",

        ...(headers ||
          {}),
      },
    }
  );
}

/*
 * ============================================
 * Concurrency Helper
 * ============================================
 */

async function mapWithConcurrency<
  T,
  R
>(
  items:
    T[],

  concurrency:
    number,

  worker:
    (
      item:
        T,

      index:
        number
    ) => Promise<R>
) {
  const results =
    new Array<R>(
      items.length
    );

  let nextIndex =
    0;

  const runners =
    Array.from(
      {
        length:
          Math.min(
            concurrency,
            items.length
          ),
      },
      async () => {
        while (
          true
        ) {
          const index =
            nextIndex;

          nextIndex +=
            1;

          if (
            index >=
            items.length
          ) {
            return;
          }

          results[
            index
          ] =
            await worker(
              items[
                index
              ],
              index
            );
        }
      }
    );

  await Promise.all(
    runners
  );

  return results;
}
