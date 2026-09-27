export const DEMO_USER_EMAILS = [
  "admin@bridgingeden.ie",
  "ciara.nolan@bridgingeden.ie",
  "aoife.brennan@example.com",
  "liam.oconnell@example.com",
] as const;

export function demoSeedEnvError(env: { NODE_ENV?: string; ALLOW_DEMO_SEED?: string }): string | null {
  if (env.NODE_ENV === "production") return "Refusing to seed while NODE_ENV=production.";
  if (env.ALLOW_DEMO_SEED !== "1") return "Refusing to seed without ALLOW_DEMO_SEED=1.";
  return null;
}

export function nonDemoUserError(count: number): string | null {
  if (count > 0) return "Refusing to seed because non-demo users exist.";
  return null;
}
