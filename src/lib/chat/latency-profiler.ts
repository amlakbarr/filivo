import "server-only";

import {
  performance,
} from "node:perf_hooks";

/*
 * ============================================
 * Chat Latency Profiler
 *
 * هدف این Utility:
 *
 * - بدون تغییر Schema دیتابیس
 * - بدون ذخیره متن سؤال یا پاسخ
 * - بدون ثبت User ID
 * - اندازه‌گیری Stageهای موجود Chat Route
 *
 * Stageهای تکراری مانند:
 *
 * request_lock
 * budget_guard
 * conversation_update
 *
 * با هم جمع می‌شوند.
 * ============================================
 */

export type ChatLatencySnapshot = {
  totalMs:
    number;

  slow:
    boolean;

  currentStage:
    string;

  longestStage:
    string |
    null;

  longestStageMs:
    number;

  stages:
    Record<
      string,
      number
    >;
};

type ChatLatencyProfilerOptions = {
  requestId:
    string;

  initialStage:
    string;
};

const DEFAULT_SLOW_THRESHOLD_MS =
  2_500;

const MIN_SLOW_THRESHOLD_MS =
  250;

const MAX_SLOW_THRESHOLD_MS =
  120_000;

export function createChatLatencyProfiler({
  requestId,
  initialStage,
}: ChatLatencyProfilerOptions) {
  const startedAt =
    performance.now();

  let currentStage =
    cleanStageName(
      initialStage
    ) ||
    "request";

  let currentStageStartedAt =
    startedAt;

  let finished =
    false;

  const durations =
    new Map<
      string,
      number
    >();

  const profilingEnabled =
    environmentBoolean(
      process.env
        .CHAT_LATENCY_PROFILING_ENABLED,
      false
    );

  const slowThresholdMs =
    environmentInteger(
      process.env
        .CHAT_LATENCY_SLOW_THRESHOLD_MS,
      MIN_SLOW_THRESHOLD_MS,
      MAX_SLOW_THRESHOLD_MS,
      DEFAULT_SLOW_THRESHOLD_MS
    );

  function commitCurrentStage(
    now:
      number
  ) {
    if (
      finished
    ) {
      return;
    }

    const duration =
      Math.max(
        0,
        now -
          currentStageStartedAt
      );

    durations.set(
      currentStage,
      (
        durations.get(
          currentStage
        ) ||
        0
      ) +
        duration
    );
  }

  function setStage(
    nextStage:
      string
  ) {
    if (
      finished
    ) {
      return;
    }

    const normalized =
      cleanStageName(
        nextStage
      );

    if (
      !normalized
    ) {
      return;
    }

    const now =
      performance.now();

    commitCurrentStage(
      now
    );

    currentStage =
      normalized;

    currentStageStartedAt =
      now;
  }

  function snapshot():
    ChatLatencySnapshot {
    const now =
      performance.now();

    const snapshotDurations =
      new Map(
        durations
      );

    if (
      !finished
    ) {
      snapshotDurations.set(
        currentStage,
        (
          snapshotDurations.get(
            currentStage
          ) ||
          0
        ) +
          Math.max(
            0,
            now -
              currentStageStartedAt
          )
      );
    }

    const totalMs =
      roundMs(
        now -
          startedAt
      );

    const sorted =
      [
        ...snapshotDurations
          .entries(),
      ]
        .map(
          (
            [
              stage,
              duration,
            ]
          ) => ({
            stage,

            duration:
              roundMs(
                duration
              ),
          })
        )
        .sort(
          (
            left,
            right
          ) =>
            right.duration -
            left.duration
        );

    const stages:
      Record<
        string,
        number
      > = {};

    for (
      const item of
      sorted
    ) {
      stages[
        item.stage
      ] =
        item.duration;
    }

    return {
      totalMs,

      slow:
        totalMs >=
        slowThresholdMs,

      currentStage,

      longestStage:
        sorted[0]
          ?.stage ||
        null,

      longestStageMs:
        sorted[0]
          ?.duration ||
        0,

      stages,
    };
  }

  function finish(
    context?:
      Record<
        string,
        unknown
      >
  ) {
    if (
      finished
    ) {
      return;
    }

    const now =
      performance.now();

    commitCurrentStage(
      now
    );

    finished =
      true;

    const totalMs =
      roundMs(
        now -
          startedAt
      );

    const sorted =
      [
        ...durations
          .entries(),
      ]
        .map(
          (
            [
              stage,
              duration,
            ]
          ) => ({
            stage,

            duration:
              roundMs(
                duration
              ),
          })
        )
        .sort(
          (
            left,
            right
          ) =>
            right.duration -
            left.duration
        );

    const stageDurations:
      Record<
        string,
        number
      > = {};

    for (
      const item of
      sorted
    ) {
      stageDurations[
        item.stage
      ] =
        item.duration;
    }

    const slow =
      totalMs >=
      slowThresholdMs;

    /*
     * در حالت عادی فقط Requestهای کند Log
     * می‌شوند. برای profiling موقت Production:
     *
     * CHAT_LATENCY_PROFILING_ENABLED=true
     *
     * تمام Requestها را Log می‌کند.
     */
    if (
      profilingEnabled ||
      slow
    ) {
      console.info(
        "Chat latency profile",
        {
          requestId,

          totalMs,

          slow,

          slowThresholdMs,

          finalStage:
            currentStage,

          longestStage:
            sorted[0]
              ?.stage ||
            null,

          longestStageMs:
            sorted[0]
              ?.duration ||
            0,

          stages:
            stageDurations,

          ...(context
            ? {
                context:
                  sanitizeContext(
                    context
                  ),
              }
            : {}),
        }
      );
    }
  }

  return {
    setStage,
    snapshot,
    finish,
  };
}

/*
 * ============================================
 * Helpers
 * ============================================
 */

function cleanStageName(
  value:
    unknown
) {
  return String(
    value ||
      ""
  )
    .trim()
    .toLowerCase()
    .replace(
      /[^a-z0-9_:-]/g,
      "_"
    )
    .slice(
      0,
      80
    );
}

function roundMs(
  value:
    number
) {
  if (
    !Number.isFinite(
      value
    )
  ) {
    return 0;
  }

  return Math.round(
    value *
      10
  ) /
    10;
}

function environmentBoolean(
  value:
    string |
    undefined,

  fallback:
    boolean
) {
  if (
    value ===
      undefined ||
    value.trim() ===
      ""
  ) {
    return fallback;
  }

  const normalized =
    value
      .trim()
      .toLowerCase();

  if (
    [
      "1",
      "true",
      "yes",
      "on",
    ].includes(
      normalized
    )
  ) {
    return true;
  }

  if (
    [
      "0",
      "false",
      "no",
      "off",
    ].includes(
      normalized
    )
  ) {
    return false;
  }

  return fallback;
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

function sanitizeContext(
  context:
    Record<
      string,
      unknown
    >
) {
  const result:
    Record<
      string,
      unknown
    > = {};

  /*
   * فقط metadata عملیاتی کم‌ریسک.
   * عمداً content / question / answer /
   * email / userId ثبت نمی‌کنیم.
   */
  const allowedKeys =
    new Set([
      "finalStage",
      "lockAcquired",
      "hasPersistedUserMessage",
    ]);

  for (
    const [
      key,
      value,
    ] of
    Object.entries(
      context
    )
  ) {
    if (
      !allowedKeys.has(
        key
      )
    ) {
      continue;
    }

    if (
      typeof value ===
        "string" ||
      typeof value ===
        "number" ||
      typeof value ===
        "boolean" ||
      value ===
        null
    ) {
      result[
        key
      ] =
        value;
    }
  }

  return result;
}
