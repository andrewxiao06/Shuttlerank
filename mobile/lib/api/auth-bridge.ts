/*
 * Auth token bridge — Clerk's `getToken()` is a hook, but the API client is
 * a plain module. The Clerk provider (Phase 2) pushes a token getter into
 * this module-level slot; the client reads it on each request. Mirrors the
 * web app's auth-bridge.
 */

type TokenGetter = () => Promise<string | null>;

let getToken: TokenGetter | null = null;

export function setTokenGetter(g: TokenGetter | null): void {
  getToken = g;
}

export async function getAuthToken(): Promise<string | null> {
  if (!getToken) return null;
  try {
    return await getToken();
  } catch {
    return null;
  }
}
