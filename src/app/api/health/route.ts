import { NextResponse } from "next/server";
import { createServerPocketBase } from "@/lib/pocketbase/server";

export async function GET() {
  try {
    const pb = createServerPocketBase();

    const health = await pb.health.check();

    return NextResponse.json({
      success: true,
      pocketbase: health,
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        success: false,
        message: "PocketBase connection failed",
      },
      {
        status: 500,
      }
    );
  }
}