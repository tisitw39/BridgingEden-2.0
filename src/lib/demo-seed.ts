export const DEMO_USER_EMAILS = [
  "admin@example.com",
  "ciara.nolan@example.com",
  "aoife.brennan@example.com",
  "liam.oconnell@example.com",
] as const;

export const DEMO_ADMIN_PASSWORD = "EdenAdmin!2026";
export const DEMO_HOLDER_PASSWORD = "HolderDemo!2026";

export function demoSeedEnvError(env: { NODE_ENV?: string; ALLOW_DEMO_SEED?: string }): string | null {
  if (env.NODE_ENV === "production") return "Refusing to seed while NODE_ENV=production.";
  if (env.ALLOW_DEMO_SEED !== "1") return "Refusing to seed without ALLOW_DEMO_SEED=1.";
  return null;
}

export function emptyUsersError(count: number): string | null {
  if (count > 0) return "Refusing to seed because the users table is not empty.";
  return null;
}
