import { NextResponse } from "next/server";
import { getCurrentAccount } from "@/lib/pocketbase/auth";

export async function GET() {
  const account = await getCurrentAccount();

  if (!account) {
    return NextResponse.json(
      {
        authenticated: false,
      },
      { status: 401 }
    );
  }

  return NextResponse.json({
    authenticated: true,
    account,
  });
}