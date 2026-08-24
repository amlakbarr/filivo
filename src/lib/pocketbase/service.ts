import PocketBase from "pocketbase";

let serviceClientPromise: Promise<PocketBase> | null = null;

/*
 * ============================================
 * Public Service Client
 *
 * تنها Superuser Client مشترک Backend.
 * ============================================
 */

export async function getPocketBaseServiceClient(): Promise<PocketBase> {
  if (!serviceClientPromise) {
    serviceClientPromise =
      createServiceClient();
  }

  try {
    const pb =
      await serviceClientPromise;

    /*
     * اگر Token دیگر معتبر نیست،
     * Client جدید ساخته شود.
     */
    if (!pb.authStore.isValid) {
      serviceClientPromise =
        createServiceClient();

      return await serviceClientPromise;
    }

    return pb;
  } catch (error) {
    /*
     * Promise خراب را Cache نکن.
     */
    serviceClientPromise =
      null;

    throw error;
  }
}

/*
 * ============================================
 * Create Service Client
 * ============================================
 */

async function createServiceClient(): Promise<PocketBase> {
  const url =
    process.env.POCKETBASE_URL?.trim();

  const token =
    process.env.POCKETBASE_SUPERUSER_TOKEN?.trim();

  const email =
    process.env.POCKETBASE_SUPERUSER_EMAIL?.trim();

  const password =
    process.env.POCKETBASE_SUPERUSER_PASSWORD;

  if (!url) {
    throw new Error(
      "POCKETBASE_URL is not defined"
    );
  }

  const pb =
    new PocketBase(url);

  /*
   * این Client بین Requestهای مختلف Backend
   * استفاده می‌شود.
   */
  pb.autoCancellation(false);

  /*
   * ==========================================
   * Option 1: Superuser Token
   * ==========================================
   */

  if (token) {
    pb.authStore.save(
      token,
      null
    );

    if (!pb.authStore.isValid) {
      pb.authStore.clear();

      throw new Error(
        "POCKETBASE_SUPERUSER_TOKEN is invalid or expired"
      );
    }

    await verifySuperuserAccess(
      pb
    );

    return pb;
  }

  /*
   * ==========================================
   * Option 2: Email / Password
   * ==========================================
   */

  if (
    !email ||
    !password
  ) {
    throw new Error(
      "PocketBase service credentials are not configured"
    );
  }

  await pb
    .collection("_superusers")
    .authWithPassword(
      email,
      password,
      {
        /*
         * PocketBase در صورت نزدیک بودن
         * Token به Expiration آن را Refresh
         * یا Re-authenticate می‌کند.
         */
        autoRefreshThreshold:
          30 * 60,
      }
    );

  await verifySuperuserAccess(
    pb
  );

  return pb;
}

/*
 * ============================================
 * Verify Superuser
 *
 * یک Endpoint مربوط به Collection Schema
 * فقط برای Superuser قابل دسترسی است.
 * ============================================
 */

async function verifySuperuserAccess(
  pb: PocketBase
) {
  try {
    await pb.collections.getOne(
      "accounts"
    );
  } catch (error) {
    pb.authStore.clear();

    throw new Error(
      "PocketBase service authentication failed",
      {
        cause:
          error,
      }
    );
  }
}