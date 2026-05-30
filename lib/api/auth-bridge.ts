/*
 * Auth token bridge — Clerk's `getToken()` is a React-only hook and
 * `lib/api/client.ts` is a plain module. This holder lets a small
 * provider (mounted in `app/providers.tsx`) push the latest token
 * fetcher into a module-level slot the client can read.
 *
 * The slot is intentionally a getter rather than a token string so each
 * request can refresh through Clerk's caching (Clerk returns fast cached
 * tokens within a few minutes of last call).
 */

type TokenGetter = () => Promise<string | null>;

let getToken: TokenGetter | null = null;
let userId: string | null = null;

export function setTokenGetter(g: TokenGetter | null): void {
  getToken = g;
}

export function setUserId(id: string | null): void {
  userId = id;
}

export async function getAuthToken(): Promise<string | null> {
  if (!getToken) return null;
  try {
    return await getToken();
  } catch {
    return null;
  }
}

export function getUserId(): string | null {
  return userId;
}
