import { prisma } from "../src/lib/db";
import { sweepExpiredAttempts } from "../src/lib/retention";

sweepExpiredAttempts()
  .then((result) => {
    console.log(`Removed ${result.logins} login attempts and ${result.lookups} verification lookups.`);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
