import PocketBase from "pocketbase";

export function createServerPocketBase() {
  const url = process.env.POCKETBASE_URL;

  if (!url) {
    throw new Error("POCKETBASE_URL is not defined");
  }

  return new PocketBase(url);
}