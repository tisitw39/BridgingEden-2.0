const PLACEHOLDER_SECRETS = new Set([
  "",
  "replace-with-a-long-random-string",
  "changeme",
  "secret",
  "password",
  "development-secret",
]);

export type ProductionEnv = {
  NODE_ENV?: string;
  AUTH_SECRET?: string;
  AUTH_URL?: string;
  AUDIT_EMAIL_HMAC_KEY?: string;
};

function secretError(name: string, value: string | undefined): string | null {
  const secret = value ?? "";
  const bytes = new TextEncoder().encode(secret).length;
  if (PLACEHOLDER_SECRETS.has(secret) || bytes < 32) {
    return `${name} must be a unique value of at least 32 bytes in production.`;
  }
  return null;
}

export function productionEnvError(env: ProductionEnv = process.env): string | null {
  if (env.NODE_ENV !== "production") return null;
  const secret = secretError("AUTH_SECRET", env.AUTH_SECRET);
  if (secret) return secret;
  const hmac = secretError("AUDIT_EMAIL_HMAC_KEY", env.AUDIT_EMAIL_HMAC_KEY);
  if (hmac) return hmac;
  const url = env.AUTH_URL ?? "";
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      return "AUTH_URL must be an absolute https URL in production.";
    }
  } catch {
    return "AUTH_URL must be set to the public origin in production.";
  }
  return null;
}

export function assertProductionEnv(): void {
  const message = productionEnvError();
  if (message) throw new Error(message);
}
