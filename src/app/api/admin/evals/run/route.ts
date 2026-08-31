import {
  Buffer,
} from "node:buffer";

import {
  NextResponse,
} from "next/server";

import {
  completeAIEvalBatch,
  createAIEvalBatch,
  failAIEvalBatch,
  serializeAIEvalBatch,
} from "@/lib/ai/eval-batches";

import {
  isManualEvalEnabled,
  releaseEvalExecutionLock,
  tryAcquireEvalExecutionLock,
  type EvalExecutionLease,
} from "@/lib/ai/eval-execution-lock";

import {
  runAIEvalCase,
} from "@/lib/ai/evals";

import {
  getAdminSession,
} from "@/lib/pocketbase/admin";

import {
  getPocketBaseServiceClient,
} from "@/lib/pocketbase/service";

const RECORD_ID_PATTERN =
  /^[a-zA-Z0-9_-]{1,64}$/;

const DEFAULT_MAX_BATCH_CASES =
  50;

const ABSOLUTE_MAX_BATCH_CASES =
  100;

const MAX_REQUEST_BODY_BYTES =
  16 *
  1024;

export async function POST(
  request:
    Request
) {
  const requestId =
    crypto.randomUUID();

  /*
   * ==========================================
   * Admin
   * ==========================================
   */

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

  /*
   * ==========================================
   * Emergency Kill Switch
   * ==========================================
   */

  if (
    !isManualEvalEnabled()
  ) {
    return apiError(
      requestId,
      503,
      "AI_MANUAL_EVAL_DISABLED",
      "اجرای دستی Golden Testها موقتاً غیرفعال شده است."
    );
  }

  /*
   * ==========================================
   * Bounded Body
   * ==========================================
   */

  const parsedBody =
    await readJsonBody(
      request
    );

  if (
    !parsedBody.ok
  ) {
    return apiError(
      requestId,
      parsedBody.status,
      parsedBody.code,
      parsedBody.message
    );
  }

  const object =
    typeof parsedBody.value ===
      "object" &&
    parsedBody.value !==
      null &&
    !Array.isArray(
      parsedBody.value
    )
      ? parsedBody.value as
          Record<
            string,
            unknown
          >
      : {};

  const caseId =
    typeof object.caseId ===
      "string"
      ? object.caseId
          .trim()
      : "";

  const runAll =
    object.all ===
    true;

  const label =
    cleanText(
      object.label,
      200
    );

  const notes =
    cleanText(
      object.notes,
      4_000
    );

  if (
    !runAll &&
    !RECORD_ID_PATTERN.test(
      caseId
    )
  ) {
    return apiError(
      requestId,
      400,
      "INVALID_EVAL_RUN_REQUEST",
      "یک Test Case معتبر برای اجرا انتخاب کنید."
    );
  }

  let batchId =
    "";

  let lease:
    EvalExecutionLease |
    null =
      null;

  let pb:
    Awaited<
      ReturnType<
        typeof getPocketBaseServiceClient
      >
    > |
    null =
      null;

  try {
    pb =
      await getPocketBaseServiceClient();

    /*
     * ========================================
     * Distributed Execution Lock
     *
     * Full suite globally serialized.
     * Single Case only locks the same Case.
     * ========================================
     */

    lease =
      await tryAcquireEvalExecutionLock({
        pb,

        key:
          runAll
            ? "manual:full-suite"
            : `manual:case:${caseId}`,

        ttlSeconds:
          runAll
            ? environmentInteger(
                process.env
                  .AI_EVAL_FULL_SUITE_LOCK_TTL_SECONDS,
                5 *
                  60,
                2 *
                  60 *
                  60,
                60 *
                  60
              )
            : environmentInteger(
                process.env
                  .AI_EVAL_SINGLE_LOCK_TTL_SECONDS,
                60,
                60 *
                  60,
                15 *
                  60
              ),
      });

    if (
      !lease
    ) {
      return apiError(
        requestId,
        409,
        "AI_EVAL_ALREADY_RUNNING",
        runAll
          ? "یک اجرای کامل Golden Testها هم‌اکنون در حال انجام است."
          : "این Golden Test هم‌اکنون در حال اجرا است."
      );
    }

    /*
     * ========================================
     * Cases
     * ========================================
     */

    const maxBatchCases =
      environmentInteger(
        process.env
          .AI_EVAL_MAX_BATCH_CASES,
        1,
        ABSOLUTE_MAX_BATCH_CASES,
        DEFAULT_MAX_BATCH_CASES
      );

    const cases =
      runAll
        ? (
            await pb
              .collection(
                "ai_eval_cases"
              )
              .getList(
                1,
                maxBatchCases,
                {
                  filter:
                    "active = true",

                  sort:
                    "created",

                  expand: [
                    "expected_topic",
                    "expected_knowledge_items",
                  ].join(
                    ","
                  ),
                }
              )
          ).items
        : [
            await pb
              .collection(
                "ai_eval_cases"
              )
              .getOne(
                caseId,
                {
                  expand: [
                    "expected_topic",
                    "expected_knowledge_items",
                  ].join(
                    ","
                  ),
                }
              ),
          ];

    if (
      cases.length ===
      0
    ) {
      return apiError(
        requestId,
        404,
        "NO_ACTIVE_EVAL_CASES",
        "Test Case فعالی برای اجرا وجود ندارد."
      );
    }

    /*
     * ========================================
     * Batch
     * ========================================
     */

    const batch =
      await createAIEvalBatch({
        pb,

        adminId:
          admin.account.id,

        runMode:
          runAll
            ? "all"
            : "single",

        totalCases:
          cases.length,

        label:
          label ||
          undefined,

        notes:
          notes ||
          undefined,
      });

    batchId =
      batch.id;

    const runs = [];

    /*
     * Sequential execution:
     * - predictable OpenAI load
     * - bounded concurrency
     * - deterministic snapshots
     */
    for (
      const item of
      cases
    ) {
      runs.push(
        await runAIEvalCase({
          pb,

          caseRecord:
            item,

          adminId:
            admin.account.id,

          batchId:
            batch.id,
        })
      );
    }

    const completedBatch =
      await completeAIEvalBatch({
        pb,

        batchId:
          batch.id,

        runs,
      });

    return apiSuccess(
      requestId,
      {
        batch:
          serializeAIEvalBatch(
            completedBatch
          ),

        runs,

        summary: {
          total:
            runs.length,

          passed:
            countRuns(
              runs,
              "passed"
            ),

          failed:
            countRuns(
              runs,
              "failed"
            ),

          error:
            countRuns(
              runs,
              "error"
            ),
        },
      }
    );
  } catch (
    error
  ) {
    console.error(
      "AI eval batch run failed",
      {
        requestId,

        adminId:
          admin.account.id,

        batchId:
          batchId ||
          undefined,

        error:
          safeErrorMetadata(
            error
          ),
      }
    );

    if (
      batchId
    ) {
      try {
        const failurePb =
          pb ??
          await getPocketBaseServiceClient();

        await failAIEvalBatch(
          failurePb,
          batchId
        );
      } catch (
        failError
      ) {
        console.error(
          "AI eval failed batch could not be marked error",
          {
            requestId,

            batchId,

            error:
              safeErrorMetadata(
                failError
              ),
          }
        );
      }
    }

    return apiError(
      requestId,
      503,
      "AI_EVAL_RUN_FAILED",
      "اجرای Golden Testها انجام نشد."
    );
  } finally {
    if (
      lease
    ) {
      try {
        const releasePb =
          pb ??
          await getPocketBaseServiceClient();

        await releaseEvalExecutionLock({
          pb:
            releasePb,

          lease,
        });
      } catch (
        releaseError
      ) {
        console.error(
          "AI eval execution lock cleanup failed",
          {
            requestId,

            error:
              safeErrorMetadata(
                releaseError
              ),
          }
        );
      }
    }
  }
}

/*
 * ============================================
 * Body Parser
 * ============================================
 */

async function readJsonBody(
  request:
    Request
): Promise<
  | {
      ok:
        true;

      value:
        unknown;
    }
  | {
      ok:
        false;

      status:
        number;

      code:
        string;

      message:
        string;
    }
> {
  const contentLength =
    Number(
      request.headers.get(
        "content-length"
      ) ||
        0
    );

  if (
    Number.isFinite(
      contentLength
    ) &&
    contentLength >
      MAX_REQUEST_BODY_BYTES
  ) {
    return {
      ok:
        false,

      status:
        413,

      code:
        "REQUEST_TOO_LARGE",

      message:
        "حجم درخواست بیش از حد مجاز است.",
    };
  }

  let raw:
    string;

  try {
    raw =
      await request.text();
  } catch {
    return {
      ok:
        false,

      status:
        400,

      code:
        "INVALID_REQUEST_BODY",

      message:
        "خواندن بدنه درخواست ناموفق بود.",
    };
  }

  if (
    Buffer.byteLength(
      raw,
      "utf8"
    ) >
    MAX_REQUEST_BODY_BYTES
  ) {
    return {
      ok:
        false,

      status:
        413,

      code:
        "REQUEST_TOO_LARGE",

      message:
        "حجم درخواست بیش از حد مجاز است.",
    };
  }

  try {
    return {
      ok:
        true,

      value:
        raw.trim()
          ? JSON.parse(
              raw
            )
          : {},
    };
  } catch {
    return {
      ok:
        false,

      status:
        400,

      code:
        "INVALID_JSON",

      message:
        "بدنه درخواست معتبر نیست.",
    };
  }
}

/*
 * ============================================
 * Helpers
 * ============================================
 */

function countRuns(
  runs:
    Array<{
      status:
        string;
    }>,

  status:
    string
) {
  return runs.filter(
    (
      run
    ) =>
      run.status ===
      status
  ).length;
}

function cleanText(
  value:
    unknown,

  maximum:
    number
) {
  return typeof value ===
    "string"
    ? value
        .replace(
          /[\u0000-\u001f\u007f]/g,
          " "
        )
        .replace(
          /\s+/g,
          " "
        )
        .trim()
        .slice(
          0,
          maximum
        )
    : "";
}

function environmentInteger(
  value:
    string |
    undefined,

  minimum:
    number,

  maximum:
    number,

  fallback:
    number
) {
  const number =
    Number(
      value
    );

  if (
    !Number.isInteger(
      number
    )
  ) {
    return fallback;
  }

  return Math.min(
    maximum,
    Math.max(
      minimum,
      number
    )
  );
}

function safeErrorMetadata(
  error:
    unknown
) {
  if (
    typeof error !==
      "object" ||
    error ===
      null
  ) {
    return {
      message:
        String(
          error
        ),
    };
  }

  const value =
    error as {
      name?:
        unknown;

      message?:
        unknown;

      status?:
        unknown;

      code?:
        unknown;

      request_id?:
        unknown;
    };

  return {
    name:
      typeof value.name ===
      "string"
        ? value.name
        : undefined,

    message:
      typeof value.message ===
      "string"
        ? value.message
        : undefined,

    status:
      typeof value.status ===
      "number"
        ? value.status
        : undefined,

    code:
      typeof value.code ===
        "string" ||
      typeof value.code ===
        "number"
        ? value.code
        : undefined,

    requestId:
      typeof value.request_id ===
      "string"
        ? value.request_id
        : undefined,
  };
}

function apiSuccess(
  requestId:
    string,

  data:
    Record<
      string,
      unknown
    >
) {
  return NextResponse.json(
    {
      success:
        true,

      ...data,

      requestId,
    },
    {
      headers: {
        "Cache-Control":
          "no-store",

        "X-Request-Id":
          requestId,
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
    string
) {
  return NextResponse.json(
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
