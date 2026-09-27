import { cronBearerMatches } from "@/lib/cron-auth";
import { prisma } from "@/lib/db";
import { disabledGuardTriggerProblem } from "@/lib/db-role";
import { sweepExpiredAttempts } from "@/lib/retention";

export async function GET(request: Request) {
  if (!cronBearerMatches(process.env.CRON_SECRET ?? "", request.headers.get("authorization"))) {
    return new Response("Unauthorized", { status: 401 });
  }
  const triggers = await disabledGuardTriggerProblem(prisma);
  if (triggers) return new Response(triggers, { status: 500 });
  const removed = await sweepExpiredAttempts();
  return Response.json(removed);
}
