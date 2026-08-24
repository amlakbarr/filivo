import {
  ClientResponseError,
  RecordModel,
} from "pocketbase";

import { getAdminPocketBase } from "@/lib/pocketbase/admin";

type GapType =
  | "no_answer"
  | "unclassified"
  | "both";

type TrackKnowledgeGapInput = {
  userMessageId: string;
  assistantMessageId: string;
};

type TrackKnowledgeGapResult =
  | {
      tracked: true;
      gapId: string;
      occurrenceId: string;
    }
  | {
      tracked: false;
      reason: string;
    };

type CreateGapInput = {
  normalizedKey: string;
  questionText: string;
  topicId: string;
  gapType: GapType;
};

type PriorityInput = {
  occurrenceCount: number;
  uniqueUsers: number;
  uniqueDepartments: number;
};

/*
 * =========================================
 * Public function
 * =========================================
 */

export async function trackKnowledgeGap(
  input: TrackKnowledgeGapInput
): Promise<TrackKnowledgeGapResult> {
  const pb =
    await getAdminPocketBase();

  /*
   * جلوگیری از ثبت دوباره همان سؤال
   */
  const existingOccurrence =
    await findOccurrenceByUserMessage(
      input.userMessageId
    );

  if (existingOccurrence) {
    return {
      tracked: false,
      reason: "already_tracked",
    };
  }

  /*
   * گرفتن پیام کاربر
   */
  const userMessage = await pb
    .collection("messages")
    .getOne(input.userMessageId);

  /*
   * گرفتن پاسخ Assistant
   */
  const assistantMessage = await pb
    .collection("messages")
    .getOne(input.assistantMessageId);

  /*
   * Validation نقش‌ها
   */
  if (userMessage.role !== "user") {
    return {
      tracked: false,
      reason: "invalid_user_message",
    };
  }

  if (
    assistantMessage.role !==
    "assistant"
  ) {
    return {
      tracked: false,
      reason:
        "invalid_assistant_message",
    };
  }

  /*
   * پاسخ باید دقیقاً متعلق به
   * همین سؤال باشد.
   */
  if (
    assistantMessage.reply_to !==
    userMessage.id
  ) {
    return {
      tracked: false,
      reason: "reply_mismatch",
    };
  }

  /*
   * فعلاً Gap فقط زمانی ایجاد می‌شود
   * که پاسخ کافی نداشته باشیم.
   *
   * unclassified به تنهایی Gap نیست.
   */
  if (
    assistantMessage.has_answer !==
    false
  ) {
    return {
      tracked: false,
      reason: "answer_available",
    };
  }

  const questionText =
    String(
      userMessage.content || ""
    ).trim();

  if (!questionText) {
    return {
      tracked: false,
      reason: "empty_question",
    };
  }

  /*
   * Greeting و مکالمه‌های trivial
   * Knowledge Gap نیستند.
   */
  if (
    isTrivialConversation(
      questionText
    )
  ) {
    return {
      tracked: false,
      reason:
        "trivial_conversation",
    };
  }

  const normalizedKey =
    normalizeGapKey(
      questionText
    );

  if (!normalizedKey) {
    return {
      tracked: false,
      reason:
        "invalid_normalized_key",
    };
  }

  /*
   * وضعیت Classification سؤال
   */
  const classificationStatus =
    String(
      userMessage.classification_status ||
        ""
    );

  /*
   * اگر هم جواب نداریم و هم Topic
   * تشخیص داده نشده، Gap از نوع both است.
   */
  const gapType: GapType =
    classificationStatus ===
    "unclassified"
      ? "both"
      : "no_answer";

  const topicId =
    String(
      userMessage.topic || ""
    );

  const userId =
    String(
      userMessage.user || ""
    );

  const conversationId =
    String(
      userMessage.conversation ||
        ""
    );

  if (
    !userId ||
    !conversationId
  ) {
    return {
      tracked: false,
      reason:
        "missing_relations",
    };
  }

  /*
   * Department را از Account می‌گیریم.
   */
  const account = await pb
    .collection("accounts")
    .getOne(userId);

  const departmentId =
    String(
      account.department || ""
    );

  /*
   * Gap موجود را پیدا کن
   * یا Gap جدید بساز.
   */
  const gap =
    await findOrCreateGap({
      normalizedKey,
      questionText,
      topicId,
      gapType,
    });

  /*
   * قبل از ایجاد Occurrence جدید بررسی
   * می‌کنیم این User قبلاً در Gap بوده یا نه.
   */
  const userAlreadySeen =
    await hasOccurrenceForUser(
      gap.id,
      userId
    );

  /*
   * همین بررسی برای Department
   */
  const departmentAlreadySeen =
    departmentId
      ? await hasOccurrenceForDepartment(
          gap.id,
          departmentId
        )
      : false;

  /*
   * ایجاد Occurrence
   */
  let occurrence: RecordModel;

  try {
    occurrence = await pb
      .collection(
        "knowledge_gap_occurrences"
      )
      .create({
        gap:
          gap.id,

        user_message:
          userMessage.id,

        assistant_message:
          assistantMessage.id,

        user:
          userId,

        conversation:
          conversationId,

        department:
          departmentId || "",

        topic:
          topicId || "",

        reason:
          gapType,

        question_text:
          questionText,
      });
  } catch (error) {
    /*
     * Unique index روی user_message
     * ممکن است Request همزمان را Reject کند.
     */
    if (
      error instanceof
      ClientResponseError
    ) {
      const duplicate =
        await findOccurrenceByUserMessage(
          userMessage.id
        );

      if (duplicate) {
        return {
          tracked: false,
          reason:
            "already_tracked",
        };
      }
    }

    throw error;
  }

  /*
   * Counterها
   */
  const updateData: Record<
    string,
    unknown
  > = {
    "occurrence_count+": 1,

    last_seen_at:
      new Date().toISOString(),
  };

  if (!userAlreadySeen) {
    updateData[
      "unique_users_count+"
    ] = 1;
  }

  if (
    departmentId &&
    !departmentAlreadySeen
  ) {
    updateData[
      "unique_departments_count+"
    ] = 1;
  }

  /*
   * اگر Gap قبلاً resolved شده ولی
   * دوباره پاسخ ناموفق آمده،
   * آن را مجدداً باز می‌کنیم.
   */
  if (
    gap.status === "resolved"
  ) {
    updateData.status = "open";
  }

  /*
   * ادغام نوع Gap
   */
  updateData.gap_type =
    mergeGapTypes(
      normalizeGapType(
        gap.gap_type
      ),
      gapType
    );

  /*
   * اگر Gap Topic نداشته ولی
   * سؤال جدید Topic دارد، Topic را ذخیره کن.
   */
  if (
    !gap.topic &&
    topicId
  ) {
    updateData.topic =
      topicId;
  }

  /*
   * افزایش Counterها
   */
  const updatedGap =
    await pb
      .collection(
        "knowledge_gaps"
      )
      .update(
        gap.id,
        updateData
      );

  /*
   * محاسبه Priority
   */
  const priorityScore =
    calculatePriorityScore({
      occurrenceCount:
        Number(
          updatedGap.occurrence_count ||
            0
        ),

      uniqueUsers:
        Number(
          updatedGap.unique_users_count ||
            0
        ),

      uniqueDepartments:
        Number(
          updatedGap.unique_departments_count ||
            0
        ),
    });

  /*
   * ذخیره Priority
   */
  await pb
    .collection("knowledge_gaps")
    .update(gap.id, {
      priority_score:
        priorityScore,
    });

  return {
    tracked: true,

    gapId:
      gap.id,

    occurrenceId:
      occurrence.id,
  };
}

/*
 * =========================================
 * Find/Create Gap
 * =========================================
 */

async function findOrCreateGap({
  normalizedKey,
  questionText,
  topicId,
  gapType,
}: CreateGapInput): Promise<RecordModel> {
  const pb =
    await getAdminPocketBase();

  /*
   * ابتدا دنبال Gap موجود بگرد.
   */
  try {
    return await pb
      .collection(
        "knowledge_gaps"
      )
      .getFirstListItem(
        pb.filter(
          "normalized_key = {:key}",
          {
            key:
              normalizedKey,
          }
        )
      );
  } catch {
    /*
     * اگر پیدا نشد ادامه می‌دهیم.
     */
  }

  /*
   * Gap جدید
   */
  try {
    return await pb
      .collection(
        "knowledge_gaps"
      )
      .create({
        title:
          createGapTitle(
            questionText
          ),

        sample_question:
          questionText,

        normalized_key:
          normalizedKey,

        topic:
          topicId || "",

        status:
          "open",

        gap_type:
          gapType,

        priority_score:
          0,

        occurrence_count:
          0,

        unique_users_count:
          0,

        unique_departments_count:
          0,

        last_seen_at:
          new Date().toISOString(),
      });
  } catch (error) {
    /*
     * اگر دو Request همزمان سعی کردند
     * همان Gap را ایجاد کنند، Unique Index
     * یکی را Reject خواهد کرد.
     */
    if (
      error instanceof
      ClientResponseError
    ) {
      return await pb
        .collection(
          "knowledge_gaps"
        )
        .getFirstListItem(
          pb.filter(
            "normalized_key = {:key}",
            {
              key:
                normalizedKey,
            }
          )
        );
    }

    throw error;
  }
}

/*
 * =========================================
 * Occurrence lookup
 * =========================================
 */

async function findOccurrenceByUserMessage(
  userMessageId: string
): Promise<RecordModel | null> {
  const pb =
    await getAdminPocketBase();

  try {
    return await pb
      .collection(
        "knowledge_gap_occurrences"
      )
      .getFirstListItem(
        pb.filter(
          "user_message = {:message}",
          {
            message:
              userMessageId,
          }
        )
      );
  } catch {
    return null;
  }
}

/*
 * =========================================
 * Unique User count
 * =========================================
 */

async function hasOccurrenceForUser(
  gapId: string,
  userId: string
): Promise<boolean> {
  const pb =
    await getAdminPocketBase();

  try {
    await pb
      .collection(
        "knowledge_gap_occurrences"
      )
      .getFirstListItem(
        pb.filter(
          "gap = {:gap} && user = {:user}",
          {
            gap:
              gapId,

            user:
              userId,
          }
        )
      );

    return true;
  } catch {
    return false;
  }
}

/*
 * =========================================
 * Unique Department count
 * =========================================
 */

async function hasOccurrenceForDepartment(
  gapId: string,
  departmentId: string
): Promise<boolean> {
  const pb =
    await getAdminPocketBase();

  try {
    await pb
      .collection(
        "knowledge_gap_occurrences"
      )
      .getFirstListItem(
        pb.filter(
          "gap = {:gap} && department = {:department}",
          {
            gap:
              gapId,

            department:
              departmentId,
          }
        )
      );

    return true;
  } catch {
    return false;
  }
}

/*
 * =========================================
 * Normalization
 * =========================================
 */

export function normalizeGapKey(
  value: string
): string {
  return value
    .normalize("NFKC")

    /*
     * حروف عربی به فارسی
     */
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")

    /*
     * نیم فاصله به Space
     */
    .replace(/\u200c/g, " ")

    /*
     * حذف حرکات عربی
     */
    .replace(
      /[\u064B-\u065F\u0670\u06D6-\u06ED]/g,
      ""
    )

    .toLowerCase()

    /*
     * حذف علامت‌ها
     */
    .replace(
      /[^\p{L}\p{N}\s]/gu,
      " "
    )

    /*
     * حذف Space اضافه
     */
    .replace(/\s+/g, " ")

    .trim()

    /*
     * جلوگیری از Key بسیار بزرگ
     */
    .slice(0, 500);
}

/*
 * =========================================
 * Greeting / trivial detection
 * =========================================
 */

function isTrivialConversation(
  value: string
): boolean {
  const normalized =
    normalizeGapKey(value);

  const trivialMessages =
    new Set<string>([
      "سلام",
      "درود",
      "سلام خوبی",
      "خوبی",
      "ممنون",
      "مرسی",
      "خیلی ممنون",
      "تشکر",
      "متشکرم",
      "سپاس",
      "خداحافظ",
      "فعلا",
      "فعلاً",
    ]);

  return trivialMessages.has(
    normalized
  );
}

/*
 * =========================================
 * Gap title
 * =========================================
 */

function createGapTitle(
  question: string
): string {
  const cleaned =
    question
      .replace(/\s+/g, " ")
      .trim();

  const maxLength = 80;

  if (
    cleaned.length <=
    maxLength
  ) {
    return cleaned;
  }

  return (
    cleaned
      .slice(0, maxLength)
      .trim() + "..."
  );
}

/*
 * =========================================
 * Gap Type
 * =========================================
 */

function normalizeGapType(
  value: unknown
): GapType {
  if (
    value === "unclassified" ||
    value === "both" ||
    value === "no_answer"
  ) {
    return value;
  }

  return "no_answer";
}

function mergeGapTypes(
  current: GapType,
  incoming: GapType
): GapType {
  if (
    current === incoming
  ) {
    return current;
  }

  if (
    current === "both" ||
    incoming === "both"
  ) {
    return "both";
  }

  return "both";
}

/*
 * =========================================
 * Priority Score
 * =========================================
 */

function calculatePriorityScore({
  occurrenceCount,
  uniqueUsers,
  uniqueDepartments,
}: PriorityInput): number {
  /*
   * فرمول ساده و قابل توضیح:
   *
   * هر بار تکرار = 2 امتیاز
   * هر کاربر جدید = 3 امتیاز
   * هر Department جدید = 5 امتیاز
   */

  return (
    occurrenceCount * 2 +
    uniqueUsers * 3 +
    uniqueDepartments * 5
  );
}