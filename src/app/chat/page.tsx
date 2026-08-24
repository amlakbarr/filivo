export default function ChatPage() {
  return (
    <div className="flex h-full flex-col bg-white">

      <div className="flex flex-1 items-center justify-center px-6">

        <div className="max-w-lg text-center">

          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-black text-xl font-bold text-white">
            AI
          </div>

          <h1 className="mt-6 text-2xl font-bold text-gray-900">
            چه سوالی دارید؟
          </h1>

          <p className="mt-3 leading-7 text-gray-500">
            برای شروع گفتگو روی
            «چت جدید» کلیک کنید.
          </p>

        </div>

      </div>

    </div>
  );
}