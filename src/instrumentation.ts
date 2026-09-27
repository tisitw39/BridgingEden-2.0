export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertProductionEnv } = await import("@/lib/env");
  const { prisma } = await import("@/lib/db");
  assertProductionEnv();
  if (process.env.NODE_ENV !== "production") return;
  const rows = await prisma.$queryRaw<{ rolsuper: boolean }[]>`
    SELECT rolsuper FROM pg_roles WHERE rolname = current_user
  `;
  if (!rows[0] || rows[0].rolsuper) {
    throw new Error("The application database role must not be a superuser.");
  }
}
