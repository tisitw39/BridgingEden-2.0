const DEFAULT_POOL_MAX_WAIT_MS = 5_000;
const MIN_POOL_MAX_WAIT_MS = 2_000;
const MAX_POOL_MAX_WAIT_MS = 5_000;

export function poolMaxWaitMs(
  env: { NODE_ENV?: string; LOGIN_POOL_MAX_WAIT_MS?: string } = process.env,
): number {
  const raw = env.LOGIN_POOL_MAX_WAIT_MS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_POOL_MAX_WAIT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_POOL_MAX_WAIT_MS;
  return Math.min(MAX_POOL_MAX_WAIT_MS, Math.max(MIN_POOL_MAX_WAIT_MS, Math.trunc(parsed)));
}

export function isPoolWaitTimeout(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  const code = String((error as { code?: unknown }).code);
  const message =
    error instanceof Error
      ? error.message
      : String((error as { message?: unknown }).message ?? "");
  if (code === "P2024") return true;
  return code === "P2028" && message.includes("Unable to start a transaction");
}
