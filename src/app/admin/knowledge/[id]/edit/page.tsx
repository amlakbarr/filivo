import KnowledgeForm from "@/components/admin/knowledge/KnowledgeForm";

type PageProps = {
  params: Promise<{
    id: string;
  }>;

  searchParams: Promise<{
    gapId?: string;
    question?: string;
  }>;
};

export default async function EditKnowledgePage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const query = await searchParams;

  return (
    <KnowledgeForm
      knowledgeId={id}
      gapId={sanitizeId(query.gapId)}
      gapQuestion={sanitizeText(
        query.question,
        4000
      )}
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