import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export function sessionIsCurrent(claimed: unknown, actual: number): boolean {
  return typeof claimed === "number" && Number.isInteger(claimed) && claimed >= 0 && claimed === actual;
}

async function actorFromSession() {
  const session = await auth();
  if (!session?.user?.id) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, name: true, role: true, tokenVersion: true },
  });
  if (!user || !sessionIsCurrent(session.user.tokenVersion, user.tokenVersion)) return null;
  return user;
}

export async function requireUser() {
  const user = await actorFromSession();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "ADMIN") redirect("/portfolio");
  return user;
}

export async function currentUser() {
  return actorFromSession();
}
