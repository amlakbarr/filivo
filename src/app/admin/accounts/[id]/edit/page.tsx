import AccountForm from "@/components/admin/accounts/AccountForm";

export default async function EditAccountPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <AccountForm accountId={id} />; }
