import type { RecordModel } from "pocketbase";

import { getAdminPocketBase } from "@/lib/pocketbase/admin";

export type KnowledgeGapStatus =
  | "open"
  | "in_progress"
  | "resolved"
  | "ignored";

export type KnowledgeGapType =
  | "no_answer"
  | "unclassified"
  | "both";

export type KnowledgeGapListItem = {
  id: string;

  title: string;
  sampleQuestion: string;

  status: KnowledgeGapStatus;
  gapType: KnowledgeGapType;

  priorityScore: number;

  occurrenceCount: number;
  uniqueUsersCount: number;
  uniqueDepartmentsCount: number;

  topicId?: string;
  topicName?: string;

  lastSeenAt?: string;

  created: string;
  updated: string;
};

export type KnowledgeGapListResult = {
  items: KnowledgeGapListItem[];

  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
};

export type KnowledgeGapStats = {
  open: number;
  inProgress: number;
  resolved: number;
  ignored: number;

  totalOccurrences: number;
  affectedUsers: number;

  highestPriority?: {
    id: string;
    title: string;
    priorityScore: number;
    occurrenceCount: number;
  };
};

export type GetKnowledgeGapsInput = {
  page?: number;
  perPage?: number;

  search?: string;

  status?: string;
  gapType?: string;

  sort?: string;
};

/*
 * ============================================
 * List
 * ============================================
 */

export async function getKnowledgeGaps({
  page = 1,
  perPage = 20,
  search = "",
  status = "",
  gapType = "",
  sort = "-priority_score",
}: GetKnowledgeGapsInput): Promise<KnowledgeGapListResult> {
  const pb =
    await getAdminPocketBase();

  const safePage =
    Math.max(
      1,
      Number.isFinite(page)
        ? page
        : 1
    );

  const safePerPage =
    Math.min(
      50,
      Math.max(
        5,
        Number.isFinite(perPage)
          ? perPage
          : 20
      )
    );

  const filters: string[] = [];

  const filterValues: Record<
    string,
    string
  > = {};

  /*
   * Search
   */
  const normalizedSearch =
    search.trim();

  if (normalizedSearch) {
    filters.push(
      "(title ~ {:search} || sample_question ~ {:search})"
    );

    filterValues.search =
      normalizedSearch;
  }

  /*
   * Status
   */
  if (
    isGapStatus(status)
  ) {
    filters.push(
      "status = {:status}"
    );

    filterValues.status =
      status;
  }

  /*
   * Gap Type
   */
  if (
    isGapType(gapType)
  ) {
    filters.push(
      "gap_type = {:gapType}"
    );

    filterValues.gapType =
      gapType;
  }

  const filter =
    filters.length > 0
      ? pb.filter(
          filters.join(" && "),
          filterValues
        )
      : "";

  const safeSort =
    getSafeSort(sort);

  const result =
    await pb
      .collection(
        "knowledge_gaps"
      )
      .getList(
        safePage,
        safePerPage,
        {
          filter,

          sort:
            safeSort,

          expand:
            "topic",

          fields:
            [
              "id",
              "title",
              "sample_question",
              "status",
              "gap_type",
              "priority_score",
              "occurrence_count",
              "unique_users_count",
              "unique_departments_count",
              "topic",
              "last_seen_at",
              "created",
              "updated",
              "expand.topic.id",
              "expand.topic.name",
              "expand.topic.active",
            ].join(","),
        }
      );

  return {
    items:
      result.items.map(
        mapGapRecord
      ),

    page:
      result.page,

    perPage:
      result.perPage,

    totalItems:
      result.totalItems,

    totalPages:
      result.totalPages,
  };
}

/*
 * ============================================
 * Dashboard statistics
 * ============================================
 */

export async function getKnowledgeGapStats(): Promise<KnowledgeGapStats> {
  const pb =
    await getAdminPocketBase();

  /*
   * این Queryها مستقل هستند
   * و همزمان اجرا می‌شوند.
   */
  const [
    openResult,
    inProgressResult,
    resolvedResult,
    ignoredResult,
    occurrenceResult,
    highestPriorityResult,
  ] = await Promise.all([
    pb
      .collection(
        "knowledge_gaps"
      )
      .getList(
        1,
        1,
        {
          filter:
            'status = "open"',
          fields:
            "id",
        }
      ),

    pb
      .collection(
        "knowledge_gaps"
      )
      .getList(
        1,
        1,
        {
          filter:
            'status = "in_progress"',
          fields:
            "id",
        }
      ),

    pb
      .collection(
        "knowledge_gaps"
      )
      .getList(
        1,
        1,
        {
          filter:
            'status = "resolved"',
          fields:
            "id",
        }
      ),

    pb
      .collection(
        "knowledge_gaps"
      )
      .getList(
        1,
        1,
        {
          filter:
            'status = "ignored"',
          fields:
            "id",
        }
      ),

    /*
     * برای آمار کاربران و occurrenceها
     * Occurrenceها را می‌خوانیم.
     *
     * فعلاً چون PocketBase Aggregate API
     * مستقیمی مثل SQL COUNT DISTINCT
     * روی Base Collection ندارد،
     * این بخش را کنترل‌شده می‌خوانیم.
     *
     * در صورت بزرگ شدن دیتابیس بعداً
     * View Collection می‌سازیم.
     */
    pb
      .collection(
        "knowledge_gap_occurrences"
      )
      .getFullList({
        fields:
          "id,user",
      }),

    pb
      .collection(
        "knowledge_gaps"
      )
      .getList(
        1,
        1,
        {
          filter:
            'status = "open"',

          sort:
            "-priority_score",

          fields:
            "id,title,priority_score,occurrence_count",
        }
      ),
  ]);

  const uniqueUsers =
    new Set<string>();

  for (
    const occurrence of
    occurrenceResult
  ) {
    const userId =
      String(
        occurrence.user ||
          ""
      );

    if (userId) {
      uniqueUsers.add(
        userId
      );
    }
  }

  const highest =
    highestPriorityResult
      .items[0];

  return {
    open:
      openResult.totalItems,

    inProgress:
      inProgressResult.totalItems,

    resolved:
      resolvedResult.totalItems,

    ignored:
      ignoredResult.totalItems,

    totalOccurrences:
      occurrenceResult.length,

    affectedUsers:
      uniqueUsers.size,

    highestPriority:
      highest
        ? {
            id:
              highest.id,

            title:
              String(
                highest.title ||
                  ""
              ),

            priorityScore:
              Number(
                highest.priority_score ||
                  0
              ),

            occurrenceCount:
              Number(
                highest.occurrence_count ||
                  0
              ),
          }
        : undefined,
  };
}

/*
 * ============================================
 * Mapping
 * ============================================
 */

function mapGapRecord(
  record: RecordModel
): KnowledgeGapListItem {
  const topicRecord =
    record.expand?.topic as
      | RecordModel
      | undefined;

  return {
    id:
      record.id,

    title:
      String(
        record.title ||
          ""
      ),

    sampleQuestion:
      String(
        record.sample_question ||
          ""
      ),

    status:
      normalizeStatus(
        record.status
      ),

    gapType:
      normalizeGapType(
        record.gap_type
      ),

    priorityScore:
      Number(
        record.priority_score ||
          0
      ),

    occurrenceCount:
      Number(
        record.occurrence_count ||
          0
      ),

    uniqueUsersCount:
      Number(
        record.unique_users_count ||
          0
      ),

    uniqueDepartmentsCount:
      Number(
        record.unique_departments_count ||
          0
      ),

    topicId:
      record.topic
        ? String(
            record.topic
          )
        : undefined,

    topicName:
      topicRecord
        ? String(
            topicRecord.name ||
              ""
          )
        : undefined,

    lastSeenAt:
      record.last_seen_at
        ? String(
            record.last_seen_at
          )
        : undefined,

    created:
      String(
        record.created ||
          ""
      ),

    updated:
      String(
        record.updated ||
          ""
      ),
  };
}

/*
 * ============================================
 * Validation
 * ============================================
 */

function isGapStatus(
  value: string
): value is KnowledgeGapStatus {
  return [
    "open",
    "in_progress",
    "resolved",
    "ignored",
  ].includes(value);
}

function isGapType(
  value: string
): value is KnowledgeGapType {
  return [
    "no_answer",
    "unclassified",
    "both",
  ].includes(value);
}

function normalizeStatus(
  value: unknown
): KnowledgeGapStatus {
  const normalized =
    String(
      value || ""
    );

  return isGapStatus(
    normalized
  )
    ? normalized
    : "open";
}

function normalizeGapType(
  value: unknown
): KnowledgeGapType {
  const normalized =
    String(
      value || ""
    );

  return isGapType(
    normalized
  )
    ? normalized
    : "no_answer";
}

/*
 * ============================================
 * Sort whitelist
 * ============================================
 */

function getSafeSort(
  value: string
) {
  const allowed =
    new Set([
      "-priority_score",
      "priority_score",

      "-occurrence_count",
      "occurrence_count",

      "-last_seen_at",
      "last_seen_at",

      "-created",
      "created",

      "-updated",
      "updated",
    ]);

  return allowed.has(
    value
  )
    ? value
    : "-priority_score";
}