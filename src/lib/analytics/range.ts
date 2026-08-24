export type AnalyticsRange = {
  preset: string;
  label: string;
  timezone: string;
  from: Date;
  to: Date;
  previousFrom: Date;
  previousTo: Date;
  granularity: "hour" | "day";
  bucketKeys: Array<{ key: string; label: string }>;
};

type DateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const ALLOWED_PRESETS = new Set([
  "today",
  "7d",
  "30d",
  "this_month",
  "previous_month",
  "custom",
]);

export function getAppTimezone() {
  const configured =
    process.env.APP_TIMEZONE?.trim() || "Asia/Tehran";

  try {
    new Intl.DateTimeFormat("en", {
      timeZone: configured,
    }).format(new Date());
    return configured;
  } catch {
    return "Asia/Tehran";
  }
}

export function resolveAnalyticsRange(
  searchParams: URLSearchParams,
  now = new Date()
): AnalyticsRange {
  const timezone = getAppTimezone();
  const requested = searchParams.get("range") || "7d";
  const preset = ALLOWED_PRESETS.has(requested)
    ? requested
    : "7d";
  const nowParts = getZonedParts(now, timezone);
  let from: Date;
  let to: Date = now;
  let label: string;
  let granularity: "hour" | "day" = "day";

  if (preset === "today") {
    from = zonedDateToUtc(
      { ...nowParts, hour: 0, minute: 0, second: 0 },
      timezone
    );
    label = "امروز";
    granularity = "hour";
  } else if (preset === "30d") {
    const start = addLocalDays(nowParts, -29);
    from = zonedDateToUtc(
      { ...start, hour: 0, minute: 0, second: 0 },
      timezone
    );
    label = "۳۰ روز اخیر";
  } else if (preset === "this_month") {
    from = zonedDateToUtc(
      {
        year: nowParts.year,
        month: nowParts.month,
        day: 1,
        hour: 0,
        minute: 0,
        second: 0,
      },
      timezone
    );
    label = "این ماه";
  } else if (preset === "previous_month") {
    const thisMonth = zonedDateToUtc(
      {
        year: nowParts.year,
        month: nowParts.month,
        day: 1,
        hour: 0,
        minute: 0,
        second: 0,
      },
      timezone
    );
    const previousMonthParts = addLocalMonths(
      nowParts,
      -1
    );
    from = zonedDateToUtc(
      {
        year: previousMonthParts.year,
        month: previousMonthParts.month,
        day: 1,
        hour: 0,
        minute: 0,
        second: 0,
      },
      timezone
    );
    to = thisMonth;
    label = "ماه قبل";
  } else if (preset === "custom") {
    const custom = parseCustomRange(
      searchParams.get("from"),
      searchParams.get("to"),
      timezone
    );
    from = custom.from;
    to = custom.to;
    label = `${formatRangeDate(from, timezone)} تا ${formatRangeDate(new Date(to.getTime() - 1), timezone)}`;
    granularity = custom.isSingleDay ? "hour" : "day";
  } else {
    const start = addLocalDays(nowParts, -6);
    from = zonedDateToUtc(
      { ...start, hour: 0, minute: 0, second: 0 },
      timezone
    );
    label = "۷ روز اخیر";
  }

  const { previousFrom, previousTo } =
    resolvePreviousRange(
      preset,
      from,
      to,
      timezone
    );

  return {
    preset,
    label,
    timezone,
    from,
    to,
    previousFrom,
    previousTo,
    granularity,
    bucketKeys: createBucketKeys(
      from,
      to,
      timezone,
      granularity
    ),
  };
}

function resolvePreviousRange(
  preset: string,
  from: Date,
  to: Date,
  timezone: string
) {
  if (preset === "today") {
    return {
      previousFrom: shiftLocalDays(from, -1, timezone),
      previousTo: shiftLocalDays(to, -1, timezone),
    };
  }
  if (preset === "7d") {
    return {
      previousFrom: shiftLocalDays(from, -7, timezone),
      previousTo: shiftLocalDays(to, -7, timezone),
    };
  }
  if (preset === "30d") {
    return {
      previousFrom: shiftLocalDays(from, -30, timezone),
      previousTo: shiftLocalDays(to, -30, timezone),
    };
  }
  if (preset === "this_month") {
    return {
      previousFrom: shiftLocalMonths(from, -1, timezone),
      previousTo: shiftLocalMonths(to, -1, timezone),
    };
  }
  if (preset === "previous_month") {
    return {
      previousFrom: shiftLocalMonths(from, -1, timezone),
      previousTo: new Date(from),
    };
  }

  const dayCount = Math.max(
    1,
    Math.round((to.getTime() - from.getTime()) / 86_400_000)
  );
  return {
    previousFrom: shiftLocalDays(from, -dayCount, timezone),
    previousTo: shiftLocalDays(to, -dayCount, timezone),
  };
}

function shiftLocalDays(
  date: Date,
  amount: number,
  timezone: string
) {
  return zonedDateToUtc(
    addLocalDays(getZonedParts(date, timezone), amount),
    timezone
  );
}

function shiftLocalMonths(
  date: Date,
  amount: number,
  timezone: string
) {
  const parts = getZonedParts(date, timezone);
  const monthStart = new Date(
    Date.UTC(parts.year, parts.month - 1 + amount, 1)
  );
  const year = monthStart.getUTCFullYear();
  const month = monthStart.getUTCMonth() + 1;
  const lastDay = new Date(
    Date.UTC(year, month, 0)
  ).getUTCDate();

  return zonedDateToUtc(
    {
      ...parts,
      year,
      month,
      day: Math.min(parts.day, lastDay),
    },
    timezone
  );
}

export function getBucketKey(
  date: Date,
  timezone: string,
  granularity: "hour" | "day"
) {
  const parts = getZonedParts(date, timezone);
  const dateKey = `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
  return granularity === "hour"
    ? `${dateKey}T${pad(parts.hour)}`
    : dateKey;
}

function parseCustomRange(
  rawFrom: string | null,
  rawTo: string | null,
  timezone: string
) {
  const fromParts = parseDateInput(rawFrom);
  const toParts = parseDateInput(rawTo);

  if (!fromParts || !toParts) {
    throw new AnalyticsRangeError(
      "برای بازه سفارشی، تاریخ شروع و پایان معتبر وارد کنید."
    );
  }

  const from = zonedDateToUtc(
    { ...fromParts, hour: 0, minute: 0, second: 0 },
    timezone
  );
  const endDay = addLocalDays(
    { ...toParts, hour: 0, minute: 0, second: 0 },
    1
  );
  const to = zonedDateToUtc(
    { ...endDay, hour: 0, minute: 0, second: 0 },
    timezone
  );
  const days = (to.getTime() - from.getTime()) / 86_400_000;

  if (to <= from) {
    throw new AnalyticsRangeError(
      "تاریخ پایان باید بعد از تاریخ شروع باشد."
    );
  }
  if (days > 366) {
    throw new AnalyticsRangeError(
      "حداکثر بازه قابل انتخاب ۳۶۶ روز است."
    );
  }

  return {
    from,
    to,
    isSingleDay:
      fromParts.year === toParts.year &&
      fromParts.month === toParts.month &&
      fromParts.day === toParts.day,
  };
}

function createBucketKeys(
  from: Date,
  to: Date,
  timezone: string,
  granularity: "hour" | "day"
) {
  const buckets: Array<{ key: string; label: string }> = [];
  const seen = new Set<string>();
  const step = granularity === "hour" ? 3_600_000 : 86_400_000;

  for (
    let timestamp = from.getTime();
    timestamp < to.getTime();
    timestamp += step
  ) {
    const date = new Date(timestamp);
    const key = getBucketKey(date, timezone, granularity);

    if (seen.has(key)) continue;
    seen.add(key);
    buckets.push({
      key,
      label:
        granularity === "hour"
          ? new Intl.DateTimeFormat("fa-IR", {
              timeZone: timezone,
              hour: "2-digit",
              minute: "2-digit",
            }).format(date)
          : new Intl.DateTimeFormat("fa-IR", {
              timeZone: timezone,
              month: "short",
              day: "numeric",
            }).format(date),
    });
  }

  return buckets;
}

function getZonedParts(
  date: Date,
  timezone: string
): DateParts {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const values = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function zonedDateToUtc(
  desired: DateParts,
  timezone: string
) {
  const target = Date.UTC(
    desired.year,
    desired.month - 1,
    desired.day,
    desired.hour,
    desired.minute,
    desired.second
  );
  let timestamp = target;

  for (let iteration = 0; iteration < 3; iteration += 1) {
    const actual = getZonedParts(
      new Date(timestamp),
      timezone
    );
    const represented = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second
    );
    timestamp -= represented - target;
  }

  return new Date(timestamp);
}

function addLocalDays(parts: DateParts, amount: number) {
  const date = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day + amount)
  );
  return {
    ...parts,
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function addLocalMonths(parts: DateParts, amount: number) {
  const date = new Date(
    Date.UTC(parts.year, parts.month - 1 + amount, 1)
  );
  return {
    ...parts,
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: 1,
  };
}

function parseDateInput(value: string | null) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(
    value || ""
  );
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function formatRangeDate(date: Date, timezone: string) {
  return new Intl.DateTimeFormat("fa-IR", {
    timeZone: timezone,
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export class AnalyticsRangeError extends Error {}
