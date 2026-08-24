import { redirect } from "next/navigation";
import LoginForm from "@/components/auth/LoginForm";
import { getCurrentAccount } from "@/lib/pocketbase/auth";

export default async function LoginPage() {
  const account = await getCurrentAccount();

  if (account) {
    if (account.role === "admin") {
      redirect("/admin");
    }

    redirect("/chat");
  }

  return (
    <main
      className="flex min-h-screen items-center justify-center bg-gray-100 px-4"
      dir="rtl"
    >
      <div className="w-full max-w-md rounded-3xl bg-white p-8 shadow-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-gray-900">
            دستیار هوشمند کارشناسان
          </h1>

          <p className="mt-2 text-sm text-gray-500">
            برای ادامه وارد حساب کاربری خود شوید
          </p>
        </div>

        <LoginForm />
      </div>
    </main>
  );
}