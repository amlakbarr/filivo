import KnowledgeForm from "@/components/admin/knowledge/KnowledgeForm";

type Params = Promise<{
  id:
    string;
}>;

type SearchParams = Promise<{
  gapId?:
    string |
    string[];

  feedbackId?:
    string |
    string[];

  question?:
    string |
    string[];
}>;

export default async function EditKnowledgePage({
  params,
  searchParams,
}: {
  params:
    Params;

  searchParams:
    SearchParams;
}) {
  const {
    id:
      rawKnowledgeId,
  } = await params;

  const query =
    await searchParams;

  const knowledgeId =
    cleanRecordId(
      rawKnowledgeId
    );

  const gapId =
    cleanRecordId(
      firstParam(
        query.gapId
      )
    );

  const feedbackId =
    cleanRecordId(
      firstParam(
        query.feedbackId
      )
    );

  const question =
    cleanText(
      firstParam(
        query.question
      ),
      2000
    );

  return (
    <KnowledgeForm
      knowledgeId={
        knowledgeId
      }

      gapId={
        gapId ||
        undefined
      }
      gapQuestion={
        gapId
          ? question ||
            undefined
          : undefined
      }

      feedbackId={
        feedbackId ||
        undefined
      }
      feedbackQuestion={
        feedbackId
          ? question ||
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
    String(
      value ||
        ""
    ).trim();

  return /^[a-zA-Z0-9_-]{1,64}$/.test(
    id
  )
    ? id
    : "";
}
