import { sweepExpiredAttempts } from "@/lib/retention";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");
  if (!secret || header !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const removed = await sweepExpiredAttempts();
  return Response.json(removed);
}
