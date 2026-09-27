import { PrismaClient } from "@prisma/client";

const url = process.env.DIRECT_URL;
if (!url) throw new Error("DIRECT_URL is required for the owner test connection.");

export const ownerPrisma = new PrismaClient({
  datasources: { db: { url } },
});
