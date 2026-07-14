import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

/**
 * Resolves the store a partner-facing request is acting on.
 *
 * Web store-dashboard: no storeId passed — falls back to the next-auth
 * session (phone+password Credentials), matching how it's always worked.
 *
 * Mobile app (Expo store-app): passes storeId explicitly. There is no
 * next-auth session there — the storeId is obtained once via
 * POST /api/stores/login and stored in SecureStore, the same way the
 * device JWT anchors identity for the Android player. This is intentionally
 * lighter than a signed token; see CLAUDE.md's store-partner auth convention.
 *
 * Returns null if neither resolves to a real store.
 */
export async function resolveStoreId(explicitStoreId?: string | null): Promise<string | null> {
  if (explicitStoreId) {
    const store = await db.store.findUnique({ where: { id: explicitStoreId }, select: { id: true } });
    return store?.id ?? null;
  }
  const session = await auth();
  if (!session?.user?.id) return null;
  const store = await db.store.findUnique({ where: { userId: session.user.id }, select: { id: true } });
  return store?.id ?? null;
}
