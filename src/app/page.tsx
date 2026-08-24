import { redirect } from "next/navigation";
import { getCurrentAccount } from "@/lib/pocketbase/auth";

export default async function Home() {
  const account = await getCurrentAccount();

  if (!account) {
    redirect("/login");
  }

  if (account.role === "admin") {
    redirect("/admin");
  }

  redirect("/chat");
}