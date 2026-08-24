import PocketBase from "pocketbase";

const url = process.env.NEXT_PUBLIC_POCKETBASE_URL;

if (!url) {
  throw new Error("NEXT_PUBLIC_POCKETBASE_URL is not defined");
}

export const pb = new PocketBase(url);