import KnowledgeForm from "@/components/admin/knowledge/KnowledgeForm";

type SearchParams = Promise<{
  gapId?:
    string |
    string[];

  feedbackId?:
    string |
    string[];

  title?:
    string |
    string[];

  question?:
    string |
    string[];

  topicId?:
    string |
    string[];
}>;

export default async function NewKnowledgePage({
  searchParams,
}: {
  searchParams:
    SearchParams;
}) {
  const params =
    await searchParams;

  const gapId =
    firstParam(
      params.gapId
    );

  const feedbackId =
    firstParam(
      params.feedbackId
    );

  const title =
    cleanText(
      firstParam(
        params.title
      ),
      200
    );

  const question =
    cleanText(
      firstParam(
        params.question
      ),
      2000
    );

  const topicId =
    cleanRecordId(
      firstParam(
        params.topicId
      )
    );

  return (
    <KnowledgeForm
      gapId={
        gapId ||
        undefined
      }
      gapTitle={
        gapId
          ? title ||
            undefined
          : undefined
      }
      gapQuestion={
        gapId
          ? question ||
            undefined
          : undefined
      }
      gapTopicId={
        gapId
          ? topicId ||
            undefined
          : undefined
      }

      feedbackId={
        feedbackId ||
        undefined
      }
      feedbackTitle={
        feedbackId
          ? title ||
            undefined
          : undefined
      }
      feedbackQuestion={
        feedbackId
          ? question ||
            undefined
          : undefined
      }
      feedbackTopicId={
        feedbackId
          ? topicId ||
            undefined
          : undefined
      }
    />
  );
}

function firstParam(
  value:
    | string
    | string[]
    | undefined
) {
  if (
    Array.isArray(
      value
    )
  ) {
    return value[0] ||
      "";
  }

  return value ||
    "";
}

function cleanText(
  value:
    string,

  maximumLength:
    number
) {
  return value
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
      maximumLength
    );
}

function cleanRecordId(
  value:
    string
) {
  const id =
    value.trim();

  return /^[a-zA-Z0-9_-]{1,64}$/.test(
    id
  )
    ? id
    : "";
}
