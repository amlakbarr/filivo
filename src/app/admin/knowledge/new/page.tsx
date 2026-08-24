import KnowledgeForm from "@/components/admin/knowledge/KnowledgeForm";

type PageProps = {
  searchParams: Promise<{
    gapId?: string;
    title?: string;
    question?: string;
    topicId?: string;
  }>;
};

export default async function NewKnowledgePage({
  searchParams,
}: PageProps) {
  const params = await searchParams;

  return (
    <KnowledgeForm
      gapId={sanitizeId(params.gapId)}
      gapTitle={sanitizeText(params.title, 200)}
      gapQuestion={sanitizeText(params.question, 4000)}
      gapTopicId={sanitizeId(params.topicId)}
    />
  );
}

function sanitizeText(
  value: string | undefined,
  maxLength: number
) {
  if (!value) {
    return undefined;
  }

  const result = value
    .trim()
    .slice(0, maxLength);

  return result || undefined;
}

function sanitizeId(
  value: string | undefined
) {
  if (!value) {
    return undefined;
  }

  const result = value
    .trim()
    .slice(0, 100);

  return result || undefined;
}