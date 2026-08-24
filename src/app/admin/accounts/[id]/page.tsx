import AccountDetails from "@/components/admin/accounts/AccountDetails";

export default async function AccountDetailsPage({
  params,
}: {
  params: Promise<{
    id: string;
  }>;
}) {
  const {
    id,
  } = await params;

  return (
    <AccountDetails
      accountId={id}
    />
  );
}