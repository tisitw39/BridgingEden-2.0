export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { assertProductionEnv } = await import("@/lib/env");
    assertProductionEnv();
    if (process.env.NODE_ENV !== "production") return;

    const { prisma } = await import("@/lib/db");
    const { disabledGuardTriggerProblem, runtimeRoleProblem } = await import("@/lib/db-role");
    const problem = await runtimeRoleProblem(prisma);
    if (problem) throw new Error(problem);
    const triggers = await disabledGuardTriggerProblem(prisma);
    if (triggers) throw new Error(triggers);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}