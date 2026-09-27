export const LOGIN_EDGE_LIMIT = 10;
export const VERIFY_EDGE_LIMIT = 30;
export const EDGE_WINDOW_MS = 60_000;

type Clock = { now?: number; store?: Map<string, number[]> };

function prune(store: Map<string, number[]>, now: number) {
  if (store.size < 5_000) return;
  for (const [key, stamps] of store) {
    const recent = stamps.filter((stamp) => now - stamp < EDGE_WINDOW_MS);
    if (recent.length === 0) store.delete(key);
    else store.set(key, recent);
  }
}

export function resetEdgeRateLimits(store?: Map<string, number[]>) {
  (store ?? buckets).clear();
}

const buckets = new Map<string, number[]>();

export function edgeRateDecision(
  input: { method: string; pathname: string; ip: string },
  clock: Clock = {},
): "ok" | "limited" {
  const method = (input.method || "GET").toUpperCase();
  const path = input.pathname;
  let key: string | null = null;
  let limit = 0;
  if (
    method === "POST" &&
    (path === "/login" || path.startsWith("/api/auth/callback/") || path.startsWith("/api/auth/signin/"))
  ) {
    key = `login:${input.ip}`;
    limit = LOGIN_EDGE_LIMIT;
  } else if (path === "/verify" || path.startsWith("/verify/")) {
    key = `verify:${input.ip}`;
    limit = VERIFY_EDGE_LIMIT;
  }
  if (!key) return "ok";

  const store = clock.store ?? buckets;
  const now = clock.now ?? Date.now();
  prune(store, now);
  const recent = (store.get(key) ?? []).filter((stamp) => now - stamp < EDGE_WINDOW_MS);
  if (recent.length >= limit) {
    store.set(key, recent);
    return "limited";
  }
  recent.push(now);
  store.set(key, recent);
  return "ok";
}
