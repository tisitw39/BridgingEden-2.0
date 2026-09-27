export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { assertProductionEnv } = await import("@/lib/env");
    assertProductionEnv();
    if (process.env.NODE_ENV !== "production") return;

    const { prisma } = await import("@/lib/db");
    const { runtimeRoleProblem } = await import("@/lib/db-role");
    const problem = await runtimeRoleProblem(prisma);
    if (problem) throw new Error(problem);

    const { sweepExpiredAttempts } = await import("@/lib/retention");
    const sweep = () => {
      sweepExpiredAttempts().catch(() => undefined);
    };
    sweep();
    setInterval(sweep, 60 * 60 * 1000).unref();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
