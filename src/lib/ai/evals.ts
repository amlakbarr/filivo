import "server-only";

import { zodTextFormat } from "openai/helpers/zod";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { z } from "zod";

import {
  buildChatFileSearchFilter,
  extractCitedFileIds,
  extractFileSearchResults,
  getChatRetrievalSettings,
  INSUFFICIENT_KNOWLEDGE_MESSAGE,
  isInsufficientKnowledgeAnswer,
  selectRelevantRetrievalResults,
  type ChatRetrievalResult,
} from "@/lib/ai/chat-retrieval";

import {
  enforceGroundedAnswer,
} from "@/lib/ai/chat-grounding";

import {
  previewTopicClassification,
} from "@/lib/ai/classification";

import {
  getOpenAIClient,
  getOpenAIModel,
  getOpenAIVectorStoreId,
} from "@/lib/ai/openai";

import type {
  AIEvalCase,
  AIEvalCaseInput,
  AIEvalCaseSnapshot,
  AIEvalDashboard,
  AIEvalKnowledgeOption,
  AIEvalRun,
  AIEvalTopicOption,
} from "@/types/ai-evals";

import type {
  ChatSource,
} from "@/types/chat";

/*
 * ============================================
 * Constants
 * ============================================
 */

const EVAL_MAX_OUTPUT_TOKENS =
  700;

const EVAL_CASE_LIMIT =
  100;

const EVAL_RUN_HISTORY_LIMIT =
  500;

const MAX_REQUIRED_PHRASES =
  30;

const MAX_PHRASE_LENGTH =
  300;

const RECORD_ID_PATTERN =
  /^[a-zA-Z0-9_-]{1,64}$/;

/*
 * Golden tests are explicitly admin-triggered.
 *
 * They do NOT:
 * - create conversations
 * - create messages
 * - create knowledge gaps
 *
 * Classification uses previewTopicClassification,
 * which is already designed for diagnostics without
 * persistence.
 * ============================================
 */

const EvalVerifierSchema =
  z
    .object({
      supported:
        z.boolean(),

      unsupported_claims:
        z
          .array(
            z.string()
          )
          .max(8),

      reason:
        z.string(),
    })
    .strict();

/*
 * ============================================
 * Dashboard
 * ============================================
 */

export async function getAIEvalDashboard(
  pb:
    PocketBase
): Promise<AIEvalDashboard> {
  const [
    cases,
    runs,
    topics,
    knowledgeItems,
  ] =
    await Promise.all([
      pb
        .collection(
          "ai_eval_cases"
        )
        .getList(
          1,
          EVAL_CASE_LIMIT,
          {
            sort:
              "-active,-updated",

            expand: [
              "expected_topic",
              "expected_knowledge_items",
            ].join(
              ","
            ),
          }
        ),

      pb
        .collection(
          "ai_eval_runs"
        )
        .getList(
          1,
          EVAL_RUN_HISTORY_LIMIT,
          {
            sort:
              "-created",

            expand:
              "actual_topic",
          }
        ),

      pb
        .collection(
          "topics"
        )
        .getFullList({
          filter:
            "active = true",

          sort:
            "sort_order,name",

          fields:
            "id,name",
        }),

      pb
        .collection(
          "knowledge_items"
        )
        .getFullList({
          filter:
            "status = 'published'",

          sort:
            "title",

          fields:
            "id,title,topic,status",
        }),
    ]);

  const latestRunByCase =
    new Map<
      string,
      RecordModel
    >();

  for (
    const run of
    runs.items
  ) {
    const caseId =
      String(
        run.case ||
          ""
      ).trim();

    if (
      caseId &&
      !latestRunByCase.has(
        caseId
      )
    ) {
      latestRunByCase.set(
        caseId,
        run
      );
    }
  }

  const serializedCases =
    cases.items.map(
      (
        record
      ) =>
        serializeEvalCase(
          record,
          latestRunByCase.get(
            record.id
          )
        )
    );

  const latestRuns =
    serializedCases
      .map(
        (
          item
        ) =>
          item.latestRun
      )
      .filter(
        (
          run
        ): run is AIEvalRun =>
          Boolean(
            run
          )
      );

  return {
    summary: {
      total:
        serializedCases.length,

      active:
        serializedCases.filter(
          (
            item
          ) =>
            item.active
        ).length,

      passed:
        latestRuns.filter(
          (
            run
          ) =>
            run.status ===
            "passed"
        ).length,

      failed:
        latestRuns.filter(
          (
            run
          ) =>
            run.status ===
            "failed"
        ).length,

      error:
        latestRuns.filter(
          (
            run
          ) =>
            run.status ===
            "error"
        ).length,

      neverRun:
        serializedCases.filter(
          (
            item
          ) =>
            !item.latestRun
        ).length,
    },

    cases:
      serializedCases,

    lookups: {
      topics:
        topics.map(
          serializeTopicOption
        ),

      knowledgeItems:
        knowledgeItems.map(
          serializeKnowledgeOption
        ),
    },
  };
}

/*
 * ============================================
 * Case Input
 * ============================================
 */

export function parseAIEvalCaseInput(
  body:
    unknown
):
  | {
      ok:
        true;

      value:
        AIEvalCaseInput;
    }
  | {
      ok:
        false;

      message:
        string;
    } {
  if (
    typeof body !==
      "object" ||
    body ===
      null ||
    Array.isArray(
      body
    )
  ) {
    return {
      ok:
        false,

      message:
        "ساختار Case معتبر نیست.",
    };
  }

  const value =
    body as
      Record<
        string,
        unknown
      >;

  const title =
    cleanText(
      value.title,
      200
    );

  const question =
    cleanText(
      value.question,
      4000
    );

  if (
    !title
  ) {
    return {
      ok:
        false,

      message:
        "عنوان Test Case الزامی است.",
    };
  }

  if (
    !question
  ) {
    return {
      ok:
        false,

      message:
        "متن سؤال الزامی است.",
    };
  }

  const expectedTopicId =
    cleanRecordId(
      value.expectedTopicId
    );

  const expectedKnowledgeItemIds =
    cleanIdArray(
      value.expectedKnowledgeItemIds,
      20
    );

  const expectedHasAnswer =
    value.expectedHasAnswer ===
    true;

  const expectedAnswer =
    cleanText(
      value.expectedAnswer,
      10_000
    );

  return {
    ok:
      true,

    value: {
      title,

      question,

      expectedTopicId:
        expectedTopicId ||
        undefined,

      expectedKnowledgeItemIds,

      expectedHasAnswer,

      expectedAnswer:
        expectedAnswer ||
        undefined,

      requiredPhrases:
        cleanPhraseArray(
          value.requiredPhrases
        ),

      forbiddenPhrases:
        cleanPhraseArray(
          value.forbiddenPhrases
        ),

      active:
        value.active !==
        false,
    },
  };
}

export async function validateAIEvalRelations(
  pb:
    PocketBase,

  input:
    AIEvalCaseInput
) {
  if (
    input.expectedTopicId
  ) {
    try {
      await pb
        .collection(
          "topics"
        )
        .getOne(
          input.expectedTopicId,
          {
            fields:
              "id",
          }
        );
    } catch {
      return "Topic مورد انتظار معتبر نیست.";
    }
  }

  if (
    input
      .expectedKnowledgeItemIds
      .length >
    0
  ) {
    const records =
      await loadKnowledgeItemsByIds(
        pb,
        input.expectedKnowledgeItemIds
      );

    if (
      records.length !==
      input
        .expectedKnowledgeItemIds
        .length
    ) {
      return "یکی از Knowledgeهای مورد انتظار معتبر نیست.";
    }
  }

  return null;
}

export function buildAIEvalCasePayload(
  input:
    AIEvalCaseInput,

  adminId:
    string,

  mode:
    | "create"
    | "update"
) {
  return {
    title:
      input.title,

    question:
      input.question,

    expected_topic:
      input.expectedTopicId ||
      "",

    expected_knowledge_items:
      input
        .expectedKnowledgeItemIds,

    expected_has_answer:
      input.expectedHasAnswer,

    expected_answer:
      input.expectedAnswer ||
      "",

    required_phrases:
      JSON.stringify(
        input.requiredPhrases
      ),

    forbidden_phrases:
      JSON.stringify(
        input.forbiddenPhrases
      ),

    active:
      input.active,

    ...(mode ===
      "create"
      ? {
          created_by:
            adminId,
        }
      : {}),

    updated_by:
      adminId,
  };
}

/*
 * ============================================
 * Run One Case
 * ============================================
 */

export async function runAIEvalCase({
  pb,
  caseRecord,
  adminId,
  batchId,
}: {
  pb:
    PocketBase;

  caseRecord:
    RecordModel;

  adminId:
    string;

  batchId?:
    string;
}): Promise<AIEvalRun> {
  const startedAt =
    new Date();

  const expected =
    serializeEvalCase(
      caseRecord
    );

  const caseSnapshot =
    createAIEvalCaseSnapshot(
      expected
    );

  const run =
    await pb
      .collection(
        "ai_eval_runs"
      )
      .create({
        case:
          caseRecord.id,

        batch:
          batchId ||
          "",

        case_snapshot:
          JSON.stringify(
            caseSnapshot
          ),

        status:
          "pending",

        run_by:
          adminId,

        started_at:
          startedAt
            .toISOString(),
      });

  try {

    /*
     * ========================================
     * Classification Preview
     * ========================================
     */

    const classification =
      await previewTopicClassification({
        question:
          expected.question,

        context:
          [],
      });

    const actualTopicId =
      classification.topicId;

    /*
     * ========================================
     * Chat / Retrieval
     * ========================================
     */

    const model =
      getOpenAIModel();

    const retrievalSettings =
      getChatRetrievalSettings();

    const fileSearchFilter =
      buildChatFileSearchFilter(
        actualTopicId
      );

    const chatStartedAt =
      Date.now();

    const response =
      await getOpenAIClient()
        .responses
        .create({
          model,

          instructions:
            buildEvalAssistantInstructions(),

          input: [
            {
              role:
                "user",

              content:
                expected.question,
            },
          ],

          tools: [
            {
              type:
                "file_search",

              vector_store_ids: [
                getOpenAIVectorStoreId(),
              ],

              max_num_results:
                retrievalSettings
                  .maxResults,

              filters:
                fileSearchFilter,

              ranking_options: {
                score_threshold:
                  retrievalSettings
                    .minScore,
              },
            },
          ],

          include: [
            "file_search_call.results",
          ],

          reasoning: {
            effort:
              "none",
          },

          text: {
            verbosity:
              "low",
          },

          max_output_tokens:
            EVAL_MAX_OUTPUT_TOKENS,

          store:
            false,
        });

    const latencyMs =
      Date.now() -
      chatStartedAt;

    let answer =
      String(
        response.output_text ||
          ""
      ).trim();

    if (
      response.status !==
        "completed" ||
      !answer
    ) {
      throw new Error(
        "Chat evaluation response was incomplete."
      );
    }

    const retrievalResults =
      extractFileSearchResults(
        response.output
      );

    const citedFileIds =
      extractCitedFileIds(
        response.output
      );

    const relevantResults =
      isInsufficientKnowledgeAnswer(
        answer
      )
        ? []
        : selectRelevantRetrievalResults({
            results:
              retrievalResults,

            citedFileIds,

            minScore:
              retrievalSettings
                .minScore,

            maxResults:
              retrievalSettings
                .maxResults,
          });

    let sources =
      await resolveKnowledgeSources(
        pb,
        relevantResults
      );

    const grounding =
      enforceGroundedAnswer({
        question:
          expected.question,

        answer,

        relevantResults,

        sources,
      });

    answer =
      grounding.answer;

    sources =
      grounding.sources;

    let actualHasAnswer =
      grounding.hasAnswer;

    let groundingStatus =
      grounding.requiresKnowledge
        ? grounding.hasAnswer
          ? "verified"
          : "blocked"
        : "not_required";

    let verifierStatus =
      grounding.requiresKnowledge
        ? grounding.hasAnswer
          ? "pending"
          : "not_run"
        : "not_required";

    /*
     * ========================================
     * Semantic Verifier Preview
     * ========================================
     */

    if (
      actualHasAnswer &&
      grounding.requiresKnowledge
    ) {
      const verifier =
        await verifyEvalGrounding({
          question:
            expected.question,

          answer,

          retrievalResults,

          citedFileIds,

          sources,

          minScore:
            retrievalSettings.minScore,
        });

      verifierStatus =
        verifier.status;

      if (
        !verifier.supported
      ) {
        answer =
          INSUFFICIENT_KNOWLEDGE_MESSAGE;

        sources =
          [];

        actualHasAnswer =
          false;

        groundingStatus =
          "blocked";
      }
    }

    /*
     * ========================================
     * Assertions
     * ========================================
     */

    const failureReasons =
      evaluateAssertions({
        expected,

        actualTopicId,

        actualHasAnswer,

        actualAnswer:
          answer,

        actualSources:
          sources,
      });

    const status =
      failureReasons.length ===
      0
        ? "passed"
        : "failed";

    const completedAt =
      new Date();

    const updated =
      await pb
        .collection(
          "ai_eval_runs"
        )
        .update(
          run.id,
          {
            status,

            actual_answer:
              answer,

            actual_topic:
              actualTopicId ||
              "",

            actual_has_answer:
              actualHasAnswer,

            actual_sources:
              JSON.stringify(
                sources.map(
                  (
                    source
                  ) => ({
                    id:
                      source.knowledgeId,

                    title:
                      source.title,
                  })
                )
              ),

            grounding_status:
              groundingStatus,

            verifier_status:
              verifierStatus,

            failure_reasons:
              JSON.stringify(
                failureReasons
              ),

            model,

            latency_ms:
              latencyMs,

            completed_at:
              completedAt
                .toISOString(),
          },
          {
            expand:
              "actual_topic",
          }
        );

    return serializeEvalRun(
      updated
    );
  } catch (error) {
    const message =
      safeErrorMessage(
        error
      );

    const updated =
      await pb
        .collection(
          "ai_eval_runs"
        )
        .update(
          run.id,
          {
            status:
              "error",

            failure_reasons:
              JSON.stringify([
                message,
              ]),

            completed_at:
              new Date()
                .toISOString(),
          }
        );

    return serializeEvalRun(
      updated
    );
  }
}

/*
 * ============================================
 * Assertions
 * ============================================
 */

function evaluateAssertions({
  expected,
  actualTopicId,
  actualHasAnswer,
  actualAnswer,
  actualSources,
}: {
  expected:
    AIEvalCase;

  actualTopicId:
    string |
    null;

  actualHasAnswer:
    boolean;

  actualAnswer:
    string;

  actualSources:
    ChatSource[];
}) {
  const failures:
    string[] = [];

  if (
    actualHasAnswer !==
    expected.expectedHasAnswer
  ) {
    failures.push(
      expected.expectedHasAnswer
        ? "انتظار می‌رفت پاسخ معتبر وجود داشته باشد، اما پاسخ Block شد."
        : "انتظار می‌رفت پاسخ Block شود، اما سیستم پاسخ معتبر اعلام کرد."
    );
  }

  if (
    expected.expectedTopic &&
    actualTopicId !==
      expected
        .expectedTopic
        .id
  ) {
    failures.push(
      `Topic مورد انتظار «${expected.expectedTopic.name}» تشخیص داده نشد.`
    );
  }

  const actualSourceIds =
    new Set(
      actualSources.map(
        (
          source
        ) =>
          source.knowledgeId
      )
    );

  for (
    const knowledge of
    expected
      .expectedKnowledgeItems
  ) {
    if (
      !actualSourceIds.has(
        knowledge.id
      )
    ) {
      failures.push(
        `Knowledge مورد انتظار «${knowledge.title}» در Sourceهای پاسخ وجود ندارد.`
      );
    }
  }

  if (
    expected.expectedAnswer &&
    normalizeComparableText(
      actualAnswer
    ) !==
      normalizeComparableText(
        expected.expectedAnswer
      )
  ) {
    failures.push(
      "متن پاسخ با Expected Answer یکسان نیست."
    );
  }

  for (
    const phrase of
    expected.requiredPhrases
  ) {
    if (
      !containsNormalized(
        actualAnswer,
        phrase
      )
    ) {
      failures.push(
        `عبارت الزامی «${phrase}» در پاسخ وجود ندارد.`
      );
    }
  }

  for (
    const phrase of
    expected.forbiddenPhrases
  ) {
    if (
      containsNormalized(
        actualAnswer,
        phrase
      )
    ) {
      failures.push(
        `عبارت ممنوع «${phrase}» در پاسخ دیده شد.`
      );
    }
  }

  return failures;
}

/*
 * ============================================
 * Semantic Verifier Preview
 *
 * این نسخه هیچ Budget Reservation / ai_usage
 * ایجاد نمی‌کند تا Golden Testها داده عملیاتی
 * کاربران را آلوده نکنند.
 * ============================================
 */

async function verifyEvalGrounding({
  question,
  answer,
  retrievalResults,
  citedFileIds,
  sources,
  minScore,
}: {
  question:
    string;

  answer:
    string;

  retrievalResults:
    ChatRetrievalResult[];

  citedFileIds:
    ReadonlySet<string>;

  sources:
    ChatSource[];

  minScore:
    number;
}) {
  const evidence =
    buildEvalEvidence({
      retrievalResults,

      citedFileIds,

      sources,

      minScore,
    });

  if (
    !evidence
  ) {
    return {
      supported:
        false,

      status:
        "no_evidence",
    };
  }

  const model =
    process.env
      .OPENAI_GROUNDING_VERIFIER_MODEL
      ?.trim() ||
    getOpenAIModel();

  try {
    const response =
      await getOpenAIClient()
        .responses
        .parse({
          model,

          instructions:
            EVAL_VERIFIER_INSTRUCTIONS,

          input: [
            "QUESTION:",
            question,
            "",
            "ANSWER TO VERIFY:",
            answer,
            "",
            "EVIDENCE:",
            evidence,
          ].join(
            "\n"
          ),

          text: {
            format:
              zodTextFormat(
                EvalVerifierSchema,
                "grounding_eval_verdict"
              ),

            verbosity:
              "low",
          },

          reasoning: {
            effort:
              "none",
          },

          max_output_tokens:
            220,

          store:
            false,
        });

    const parsed =
      response.output_parsed;

    if (
      response.status !==
        "completed" ||
      !parsed
    ) {
      return {
        supported:
          false,

        status:
          "invalid_verifier_response",
      };
    }

    return {
      supported:
        parsed.supported,

      status:
        parsed.supported
          ? "supported"
          : "unsupported_claims",
    };
  } catch {
    return {
      supported:
        false,

      status:
        "verifier_unavailable",
    };
  }
}

const EVAL_VERIFIER_INSTRUCTIONS = `
تو یک ممیز سخت‌گیر Grounding هستی.

فقط بر اساس EVIDENCE ارائه‌شده بررسی کن که تمام ادعاهای مهم پاسخ پشتیبانی می‌شوند.
از دانش عمومی خودت استفاده نکن.
هر عدد، مبلغ، درصد، تاریخ، مدت، شرط، استثنا، الزام، ممنوعیت و نتیجه عملیاتی باید Evidence مستقیم داشته باشد.
اگر حتی یک ادعای مهم بدون پشتیبانی است supported=false برگردان.
`;

/*
 * ============================================
 * Evidence
 * ============================================
 */

function buildEvalEvidence({
  retrievalResults,
  citedFileIds,
  sources,
  minScore,
}: {
  retrievalResults:
    ChatRetrievalResult[];

  citedFileIds:
    ReadonlySet<string>;

  sources:
    ChatSource[];

  minScore:
    number;
}) {
  const allowedKnowledgeIds =
    new Set(
      sources.map(
        (
          source
        ) =>
          source.knowledgeId
      )
    );

  return retrievalResults
    .filter(
      (
        result
      ) =>
        result.attributes.status ===
          "published" &&
        result.score >=
          minScore &&
        Boolean(
          result.text
        ) &&
        Boolean(
          result.knowledgeId
        ) &&
        allowedKnowledgeIds.has(
          result.knowledgeId ||
            ""
        ) &&
        citedFileIds.has(
          result.fileId
        )
    )
    .sort(
      (
        left,
        right
      ) =>
        right.score -
        left.score
    )
    .slice(
      0,
      12
    )
    .map(
      (
        result,
        index
      ) =>
        [
          `EVIDENCE ${index + 1}`,
          `knowledge_id: ${result.knowledgeId || ""}`,
          `score: ${result.score}`,
          "text:",
          result.text.slice(
            0,
            4000
          ),
        ].join(
          "\n"
        )
    )
    .join(
      "\n\n---\n\n"
    )
    .slice(
      0,
      18_000
    );
}

/*
 * ============================================
 * Source Resolution
 * ============================================
 */

async function resolveKnowledgeSources(
  pb:
    PocketBase,

  results:
    ChatRetrievalResult[]
) {
  const ids =
    [
      ...new Set(
        results
          .map(
            (
              result
            ) =>
              cleanRecordId(
                result.knowledgeId
              )
          )
          .filter(
            Boolean
          )
      ),
    ];

  if (
    ids.length ===
    0
  ) {
    return [];
  }

  const records =
    await loadKnowledgeItemsByIds(
      pb,
      ids
    );

  const byId =
    new Map(
      records.map(
        (
          record
        ) => [
          record.id,
          record,
        ]
      )
    );

  const sources:
    ChatSource[] =
    [];

  for (
    const result of
    results
  ) {
    const id =
      cleanRecordId(
        result.knowledgeId
      );

    const record =
      byId.get(
        id
      );

    const title =
      String(
        record?.title ||
          ""
      ).trim();

    if (
      !id ||
      !record ||
      record.status !==
        "published" ||
      !title
    ) {
      continue;
    }

    sources.push({
      knowledgeId:
        id,

      title,

      ...(result.filename
        ? {
            filename:
              result.filename,
          }
        : {}),
    });
  }

  return sources;
}

async function loadKnowledgeItemsByIds(
  pb:
    PocketBase,

  ids:
    string[]
) {
  const uniqueIds =
    [
      ...new Set(
        ids
          .map(
            cleanRecordId
          )
          .filter(
            Boolean
          )
      ),
    ];

  if (
    uniqueIds.length ===
    0
  ) {
    return [];
  }

  const values:
    Record<
      string,
      string
    > = {};

  const clauses =
    uniqueIds.map(
      (
        id,
        index
      ) => {
        const key =
          `id${index}`;

        values[
          key
        ] =
          id;

        return `id = {:${key}}`;
      }
    );

  return pb
    .collection(
      "knowledge_items"
    )
    .getFullList({
      filter:
        pb.filter(
          `status = 'published' && (${clauses.join(
            " || "
          )})`,
          values
        ),

      fields:
        "id,title,topic,status",
    });
}

/*
 * ============================================
 * Case Snapshot
 * ============================================
 */

export function createAIEvalCaseSnapshot(
  item:
    AIEvalCase
): AIEvalCaseSnapshot {
  /*
   * Field case_snapshot حداکثر 20000 نویسه دارد.
   * Snapshot عمداً فقط Expectationهای لازم برای
   * تفسیر تاریخی Run را نگه می‌دارد.
   */
  return {
    caseId:
      item.id,

    title:
      item.title
        .slice(
          0,
          200
        ),

    question:
      item.question
        .slice(
          0,
          4000
        ),

    expectedTopicId:
      item.expectedTopic
        ?.id,

    expectedTopicName:
      item.expectedTopic
        ?.name
        .slice(
          0,
          200
        ),

    expectedKnowledgeItems:
      item
        .expectedKnowledgeItems
        .slice(
          0,
          20
        )
        .map(
          (
            knowledge
          ) => ({
            id:
              knowledge.id,

            title:
              knowledge.title
                .slice(
                  0,
                  250
                ),
          })
        ),

    expectedHasAnswer:
      item.expectedHasAnswer,

    expectedAnswer:
      item.expectedAnswer
        ?.slice(
          0,
          5000
        ),

    requiredPhrases:
      item
        .requiredPhrases
        .slice(
          0,
          30
        )
        .map(
          (
            phrase
          ) =>
            phrase.slice(
              0,
              200
            )
        ),

    forbiddenPhrases:
      item
        .forbiddenPhrases
        .slice(
          0,
          30
        )
        .map(
          (
            phrase
          ) =>
            phrase.slice(
              0,
              200
            )
        ),

    active:
      item.active,
  };
}

export function parseAIEvalCaseSnapshot(
  value:
    unknown
):
  | AIEvalCaseSnapshot
  | undefined {
  if (
    typeof value !==
    "string" ||
    !value.trim()
  ) {
    return undefined;
  }

  try {
    const parsed:
      unknown =
        JSON.parse(
          value
        );

    if (
      typeof parsed !==
        "object" ||
      parsed ===
        null ||
      Array.isArray(
        parsed
      )
    ) {
      return undefined;
    }

    const object =
      parsed as
        Partial<
          AIEvalCaseSnapshot
        >;

    const caseId =
      cleanRecordId(
        object.caseId
      );

    const title =
      cleanText(
        object.title,
        200
      );

    const question =
      cleanText(
        object.question,
        4000
      );

    if (
      !title ||
      !question
    ) {
      return undefined;
    }

    return {
      caseId:
        caseId ||
        "",

      title,

      question,

      expectedTopicId:
        cleanRecordId(
          object.expectedTopicId
        ) ||
        undefined,

      expectedTopicName:
        cleanText(
          object.expectedTopicName,
          200
        ) ||
        undefined,

      expectedKnowledgeItems:
        Array.isArray(
          object.expectedKnowledgeItems
        )
          ? object
              .expectedKnowledgeItems
              .slice(
                0,
                20
              )
              .map(
                (
                  knowledge
                ) => {
                  if (
                    typeof knowledge !==
                      "object" ||
                    knowledge ===
                      null
                  ) {
                    return null;
                  }

                  const item =
                    knowledge as {
                      id?:
                        unknown;

                      title?:
                        unknown;
                    };

                  const id =
                    cleanRecordId(
                      item.id
                    );

                  if (
                    !id
                  ) {
                    return null;
                  }

                  return {
                    id,

                    title:
                      cleanText(
                        item.title,
                        250
                      ) ||
                      "Knowledge",
                  };
                }
              )
              .filter(
                (
                  item
                ): item is {
                  id:
                    string;

                  title:
                    string;
                } =>
                  item !==
                  null
              )
          : [],

      expectedHasAnswer:
        object.expectedHasAnswer ===
        true,

      expectedAnswer:
        cleanText(
          object.expectedAnswer,
          5000
        ) ||
        undefined,

      requiredPhrases:
        Array.isArray(
          object.requiredPhrases
        )
          ? object
              .requiredPhrases
              .map(
                (
                  phrase
                ) =>
                  cleanText(
                    phrase,
                    200
                  )
              )
              .filter(
                Boolean
              )
              .slice(
                0,
                30
              )
          : [],

      forbiddenPhrases:
        Array.isArray(
          object.forbiddenPhrases
        )
          ? object
              .forbiddenPhrases
              .map(
                (
                  phrase
                ) =>
                  cleanText(
                    phrase,
                    200
                  )
              )
              .filter(
                Boolean
              )
              .slice(
                0,
                30
              )
          : [],

      active:
        object.active !==
        false,
    };
  } catch {
    return undefined;
  }
}

/*
 * ============================================
 * Serialization
 * ============================================
 */

export function serializeEvalCase(
  record:
    RecordModel,

  latestRun?:
    RecordModel
): AIEvalCase {
  const expectedTopic =
    getExpandedOne(
      record,
      "expected_topic"
    );

  const expectedKnowledge =
    getExpandedMany(
      record,
      "expected_knowledge_items"
    );

  const expectedKnowledgeIds =
    relationIds(
      record.expected_knowledge_items
    );

  const expandedKnowledgeById =
    new Map(
      expectedKnowledge.map(
        (
          item
        ) => [
          item.id,
          item,
        ]
      )
    );

  return {
    id:
      record.id,

    title:
      String(
        record.title ||
          ""
      ),

    question:
      String(
        record.question ||
          ""
      ),

    expectedTopic:
      record.expected_topic
        ? {
            id:
              String(
                record.expected_topic
              ),

            name:
              String(
                expectedTopic?.name ||
                  ""
              ) ||
              "موضوع",
          }
        : undefined,

    expectedKnowledgeItems:
      expectedKnowledgeIds.map(
        (
          id
        ) => ({
          id,

          title:
            String(
              expandedKnowledgeById
                .get(
                  id
                )
                ?.title ||
                ""
            ) ||
            "Knowledge",
        })
      ),

    expectedHasAnswer:
      record.expected_has_answer ===
      true,

    expectedAnswer:
      String(
        record.expected_answer ||
          ""
      ).trim() ||
      undefined,

    requiredPhrases:
      parseStringArray(
        record.required_phrases
      ),

    forbiddenPhrases:
      parseStringArray(
        record.forbidden_phrases
      ),

    active:
      record.active !==
      false,

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

    latestRun:
      latestRun
        ? serializeEvalRun(
            latestRun
          )
        : undefined,
  };
}

export function serializeEvalRun(
  record:
    RecordModel
): AIEvalRun {
  const topic =
    getExpandedOne(
      record,
      "actual_topic"
    );

  return {
    id:
      record.id,

    caseId:
      String(
        record.case ||
          ""
      ),

    batchId:
      String(
        record.batch ||
          ""
      ).trim() ||
      undefined,

    caseSnapshot:
      parseAIEvalCaseSnapshot(
        record.case_snapshot
      ),

    status:
      normalizeRunStatus(
        record.status
      ),

    actualAnswer:
      String(
        record.actual_answer ||
          ""
      ).trim() ||
      undefined,

    actualTopic:
      record.actual_topic
        ? {
            id:
              String(
                record.actual_topic
              ),

            name:
              String(
                topic?.name ||
                  ""
              ) ||
              "موضوع",
          }
        : undefined,

    actualHasAnswer:
      typeof record.actual_has_answer ===
      "boolean"
        ? record.actual_has_answer
        : undefined,

    actualSources:
      parseSourceArray(
        record.actual_sources
      ),

    groundingStatus:
      String(
        record.grounding_status ||
          ""
      ).trim() ||
      undefined,

    verifierStatus:
      String(
        record.verifier_status ||
          ""
      ).trim() ||
      undefined,

    failureReasons:
      parseStringArray(
        record.failure_reasons
      ),

    model:
      String(
        record.model ||
          ""
      ).trim() ||
      undefined,

    latencyMs:
      Number.isFinite(
        Number(
          record.latency_ms
        )
      )
        ? Number(
            record.latency_ms
          )
        : undefined,

    startedAt:
      String(
        record.started_at ||
          ""
      ).trim() ||
      undefined,

    completedAt:
      String(
        record.completed_at ||
          ""
      ).trim() ||
      undefined,

    created:
      String(
        record.created ||
          ""
      ),
  };
}

/*
 * ============================================
 * Lookups
 * ============================================
 */

function serializeTopicOption(
  record:
    RecordModel
): AIEvalTopicOption {
  return {
    id:
      record.id,

    name:
      String(
        record.name ||
          ""
      ),
  };
}

function serializeKnowledgeOption(
  record:
    RecordModel
): AIEvalKnowledgeOption {
  return {
    id:
      record.id,

    title:
      String(
        record.title ||
          ""
      ),

    topicId:
      String(
        record.topic ||
          ""
      ) ||
      undefined,
  };
}

/*
 * ============================================
 * Assistant Instructions
 *
 * فعلاً با Chat production همسان نگه داشته شده.
 * در مرحله بعد بهتر است به فایل مشترک منتقل شود.
 * ============================================
 */

const EVAL_ASSISTANT_POLICY = `
تو دستیار فارسی‌زبان کارشناسان یک شرکت هستی و به پایگاه دانش داخلی شرکت دسترسی داری.

قوانین پاسخ‌گویی:
- همیشه به زبان فارسی، مستقیم، واضح و کاربردی پاسخ بده.
- اگر پاسخ مرحله‌ای است، مراحل را شماره‌گذاری کن و بی‌دلیل پاسخ را طولانی نکن.
- برای هر سؤال مرتبط با قوانین، فرایندها، محصولات، قیمت‌ها، شرایط، سیاست‌ها یا هر اطلاعات داخلی شرکت، فقط بر پایه اطلاعات بازیابی‌شده از پایگاه دانش پاسخ بده.
- هیچ قانون، فرایند، قیمت، درصد، شرط یا سیاست داخلی را حدس نزن و از دانش عمومی مدل برای تکمیل اطلاعات داخلی استفاده نکن.
- اگر اطلاعات بازیابی‌شده برای پاسخ دقیق به سؤال داخلی کافی نیست، فقط پیام استاندارد کمبود دانش را برگردان و توضیح دیگری اضافه نکن.
- سؤال‌های عمومی و غیرسازمانی مانند سلام، توضیح یک مفهوم عمومی یا ادامه طبیعی مکالمه را می‌توانی معمولی پاسخ بدهی.
- برای سؤال‌های مربوط به امروز، فردا، دیروز، تاریخ، روز هفته یا ساعت، فقط از زمان جاری سیستم که در ادامه Instructions دریافت می‌کنی استفاده کن و هرگز تاریخ یا روز هفته را حدس نزن.
- در پاسخ به کارشناس از عبارت‌های RAG، Vector Store، File Search یا جزئیات فنی بازیابی اطلاعات نام نبر.
`.trim();

export function getAIEvalPromptMaterial() {
  return {
    assistant:
      EVAL_ASSISTANT_POLICY,

    verifier:
      EVAL_VERIFIER_INSTRUCTIONS,
  };
}

function buildEvalAssistantInstructions() {
  const currentDateTime =
    getCurrentDateTimeContext();

  return `
${EVAL_ASSISTANT_POLICY}

اگر اطلاعات بازیابی‌شده برای پاسخ دقیق به سؤال داخلی کافی نیست، فقط همین جمله را برگردان:
${INSUFFICIENT_KNOWLEDGE_MESSAGE}

زمان جاری سیستم:
- منطقه زمانی: ${currentDateTime.timezone}
- تاریخ شمسی: ${currentDateTime.persian}
- تاریخ میلادی: ${currentDateTime.gregorian}

این اطلاعات زمان جاری قطعی این درخواست هستند.
`;
}

function getCurrentDateTimeContext() {
  const now =
    new Date();

  const timezone =
    getAppTimezone();

  const options:
    Intl.DateTimeFormatOptions = {
    timeZone:
      timezone,

    weekday:
      "long",

    year:
      "numeric",

    month:
      "long",

    day:
      "numeric",

    hour:
      "2-digit",

    minute:
      "2-digit",

    second:
      "2-digit",

    hourCycle:
      "h23",
  };

  return {
    timezone,

    persian:
      new Intl.DateTimeFormat(
        "fa-IR-u-ca-persian",
        options
      ).format(
        now
      ),

    gregorian:
      new Intl.DateTimeFormat(
        "fa-IR-u-ca-gregory",
        options
      ).format(
        now
      ),
  };
}

function getAppTimezone() {
  const requested =
    process.env
      .APP_TIMEZONE
      ?.trim() ||
    "Asia/Tehran";

  try {
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone:
          requested,
      }
    ).format(
      new Date()
    );

    return requested;
  } catch {
    return "Asia/Tehran";
  }
}

/*
 * ============================================
 * Generic Helpers
 * ============================================
 */

function getExpandedOne(
  record:
    RecordModel,

  key:
    string
) {
  const value =
    record.expand?.[
      key
    ];

  if (
    !value
  ) {
    return undefined;
  }

  return Array.isArray(
    value
  )
    ? value[0]
    : value;
}

function getExpandedMany(
  record:
    RecordModel,

  key:
    string
) {
  const value =
    record.expand?.[
      key
    ];

  if (
    !value
  ) {
    return [];
  }

  return Array.isArray(
    value
  )
    ? value
    : [
        value,
      ];
}

function relationIds(
  value:
    unknown
) {
  if (
    Array.isArray(
      value
    )
  ) {
    return value
      .map(
        cleanRecordId
      )
      .filter(
        Boolean
      );
  }

  const id =
    cleanRecordId(
      value
    );

  return id
    ? [
        id,
      ]
    : [];
}

function parseStringArray(
  value:
    unknown
) {
  if (
    Array.isArray(
      value
    )
  ) {
    return value
      .filter(
        (
          item
        ): item is string =>
          typeof item ===
          "string"
      )
      .map(
        (
          item
        ) =>
          item.trim()
      )
      .filter(
        Boolean
      );
  }

  if (
    typeof value !==
      "string"
  ) {
    return [];
  }

  const text =
    value.trim();

  if (
    !text
  ) {
    return [];
  }

  try {
    const parsed:
      unknown =
        JSON.parse(
          text
        );

    if (
      Array.isArray(
        parsed
      )
    ) {
      return parsed
        .filter(
          (
            item
          ): item is string =>
            typeof item ===
            "string"
        )
        .map(
          (
            item
          ) =>
            item.trim()
        )
        .filter(
          Boolean
        );
    }
  } catch {
    // Fallback below.
  }

  return text
    .split(
      /\r?\n/
    )
    .map(
      (
        item
      ) =>
        item.trim()
    )
    .filter(
      Boolean
    );
}

function parseSourceArray(
  value:
    unknown
) {
  if (
    typeof value !==
      "string"
  ) {
    return [];
  }

  try {
    const parsed:
      unknown =
        JSON.parse(
          value
        );

    if (
      !Array.isArray(
        parsed
      )
    ) {
      return [];
    }

    return parsed
      .map(
        (
          item
        ) => {
          if (
            typeof item !==
              "object" ||
            item ===
              null
          ) {
            return null;
          }

          const object =
            item as {
              id?:
                unknown;

              title?:
                unknown;
            };

          const id =
            cleanRecordId(
              object.id
            );

          if (
            !id
          ) {
            return null;
          }

          return {
            id,

            title:
              cleanText(
                object.title,
                300
              ) ||
              "Knowledge",
          };
        }
      )
      .filter(
        (
          item
        ): item is {
          id:
            string;

          title:
            string;
        } =>
          item !==
          null
      );
  } catch {
    return [];
  }
}

function cleanIdArray(
  value:
    unknown,

  maximum:
    number
) {
  if (
    !Array.isArray(
      value
    )
  ) {
    return [];
  }

  return [
    ...new Set(
      value
        .map(
          cleanRecordId
        )
        .filter(
          Boolean
        )
    ),
  ].slice(
    0,
    maximum
  );
}

function cleanPhraseArray(
  value:
    unknown
) {
  if (
    !Array.isArray(
      value
    )
  ) {
    return [];
  }

  return [
    ...new Set(
      value
        .map(
          (
            item
          ) =>
            cleanText(
              item,
              MAX_PHRASE_LENGTH
            )
        )
        .filter(
          Boolean
        )
    ),
  ].slice(
    0,
    MAX_REQUIRED_PHRASES
  );
}

function cleanRecordId(
  value:
    unknown
) {
  const id =
    String(
      value ||
        ""
    ).trim();

  return RECORD_ID_PATTERN.test(
    id
  )
    ? id
    : "";
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

function normalizeComparableText(
  value:
    string
) {
  return String(
    value ||
      ""
  )
    .replace(
      /ي/g,
      "ی"
    )
    .replace(
      /ك/g,
      "ک"
    )
    .replace(
      /\u200c/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim()
    .toLocaleLowerCase(
      "fa-IR"
    );
}

function containsNormalized(
  text:
    string,

  phrase:
    string
) {
  return normalizeComparableText(
    text
  ).includes(
    normalizeComparableText(
      phrase
    )
  );
}

function normalizeRunStatus(
  value:
    unknown
):
  AIEvalRun["status"] {
  if (
    value ===
      "passed" ||
    value ===
      "failed" ||
    value ===
      "error"
  ) {
    return value;
  }

  return "pending";
}

function safeErrorMessage(
  error:
    unknown
) {
  if (
    error instanceof
    Error
  ) {
    return error.message
      .replace(
        /\s+/g,
        " "
      )
      .trim()
      .slice(
        0,
        1000
      );
  }

  return String(
    error
  )
    .replace(
      /\s+/g,
      " "
    )
    .trim()
    .slice(
      0,
      1000
    ) ||
    "خطای نامشخص در اجرای Test Case.";
}
