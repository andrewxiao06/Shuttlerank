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
let authResolved = false;
const waiters: Array<() => void> = [];

export function setTokenGetter(g: TokenGetter | null): void {
  getToken = g;
}

/**
 * Mark the auth state as finalized — either signed-in (with a userId) or
 * confirmed signed-out (null). Any `waitForAuthReady()` calls pending
 * before this point resolve immediately afterward.
 */
export function setUserId(id: string | null): void {
  userId = id;
  authResolved = true;
  while (waiters.length) waiters.shift()!();
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

/**
 * Resolve when the Clerk bridge has finished initializing (either with a
 * userId or with a confirmed signed-out state). Used by `request()` to
 * avoid firing API calls in the auth race window — a fresh tab would
 * otherwise emit a 401 before Clerk's `useAuth()` hook hydrates.
 *
 * Capped at `timeoutMs` so a stuck Clerk can't deadlock the app.
 */
export function waitForAuthReady(timeoutMs = 1500): Promise<void> {
  if (authResolved) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      const idx = waiters.indexOf(done);
      if (idx >= 0) waiters.splice(idx, 1);
      resolve();
    }, timeoutMs);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    waiters.push(done);
  });
}
