import "dotenv/config";
import { hash } from "bcryptjs";
import { PrismaClient, type Role } from "@prisma/client";
import { BCRYPT_COST } from "../src/lib/passwords";
import { prisma } from "../src/lib/db";
import {
  approveBatch,
  draftBatch,
  ensureHolderAccount,
  ensureSystemAccounts,
  retireCredits,
  transferCredits,
} from "../src/lib/ledger/service";

const owner = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL } },
});

async function upsertUser(input: { email: string; name: string; password: string; role: Role }) {
  const passwordHash = await hash(input.password, BCRYPT_COST);
  const user = await owner.user.upsert({
    where: { email: input.email },
    update: { name: input.name, role: input.role, passwordHash },
    create: {
      email: input.email,
      name: input.name,
      role: input.role,
      passwordHash,
    },
  });
  if (input.role === "HOLDER") {
    await ensureHolderAccount(prisma, user);
  }
  return user;
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed while NODE_ENV=production.");
  }
  if (!process.env.DIRECT_URL) {
    throw new Error("DIRECT_URL is required so the seed can create admin users as the owner role.");
  }
  await ensureSystemAccounts();
  const admin = await upsertUser({
    email: "admin@bridgingeden.ie",
    name: "Bridging Eden Registry",
    password: "EdenAdmin!2026",
    role: "ADMIN",
  });
  const approver = await upsertUser({
    email: "ciara.nolan@bridgingeden.ie",
    name: "Ciara Nolan",
    password: "EdenAdmin!2026",
    role: "ADMIN",
  });
  const aoife = await upsertUser({
    email: "aoife.brennan@example.com",
    name: "Aoife Brennan",
    password: "HolderDemo!2026",
    role: "HOLDER",
  });
  const liam = await upsertUser({
    email: "liam.oconnell@example.com",
    name: "Liam O'Connell",
    password: "HolderDemo!2026",
    role: "HOLDER",
  });

  const existing = await prisma.project.findUnique({ where: { code: "GLEN" } });
  if (existing) {
    console.log("Seed projects already exist. Demo passwords were refreshed.");
    return;
  }

  const glen = await prisma.project.create({
    data: {
      code: "GLEN",
      name: "Glenmalure Native Woodland",
      location: "Glenmalure, Co. Wicklow, Ireland",
      methodology: "Native Woodland Establishment (BE-NW-1)",
      standardReference: "Bridging Eden Protocol BE-NW-1 · registry ref BE-REG-GLEN-001",
      description:
        "Restoring sessile oak, birch, hazel, holly, and rowan on former upland pasture in Glenmalure. The planting plan keeps open glades for red squirrel and leaves a walking route along the existing track. Credits from this project are tonnes of CO₂e. They are not yield-bearing.",
      createdById: admin.id,
      documents: {
        create: {
          fileName: "glenmalure-project-note.txt",
          mimeType: "text/plain",
          sizeBytes: Buffer.byteLength(glenNote()),
          content: Buffer.from(glenNote()),
          uploadedById: admin.id,
        },
      },
    },
  });

  const beara = await prisma.project.create({
    data: {
      code: "BEARA",
      name: "Beara Atlantic Oakwoods",
      location: "Beara Peninsula, Co. Cork, Ireland",
      methodology: "Atlantic Oakwood Restoration (BE-AOR-1)",
      standardReference: "Bridging Eden Protocol BE-AOR-1 · registry ref BE-REG-BEARA-001",
      description:
        "Atlantic oakwood restoration on the Beara peninsula, closing gaps in an existing woodland and keeping public access along the coast path. Issued credits sit in the Bridging Eden inventory until they are transferred to a holder.",
      createdById: admin.id,
    },
  });

  const glenBatch = await draftBatch({
    projectId: glen.id,
    vintageYear: 2024,
    quantity: 500,
    methodology: glen.methodology,
    actorId: admin.id,
  });
  await approveBatch(glenBatch.id, approver.id);

  const bearaBatch = await draftBatch({
    projectId: beara.id,
    vintageYear: 2025,
    quantity: 320,
    methodology: beara.methodology,
    actorId: admin.id,
  });
  await approveBatch(bearaBatch.id, approver.id);

  await draftBatch({
    projectId: glen.id,
    vintageYear: 2026,
    quantity: 180,
    methodology: glen.methodology,
    actorId: admin.id,
  });

  const inventory = await prisma.account.findUniqueOrThrow({ where: { code: "INVENTORY" } });
  const aoifeAccount = await prisma.account.findUniqueOrThrow({ where: { userId: aoife.id } });
  const liamAccount = await prisma.account.findUniqueOrThrow({ where: { userId: liam.id } });

  await transferCredits({
    fromAccountId: inventory.id,
    toAccountId: aoifeAccount.id,
    projectId: glen.id,
    vintageYear: 2024,
    quantity: 120,
    actorId: admin.id,
    memo: "Allocation to Aoife Brennan",
  });
  await transferCredits({
    fromAccountId: inventory.id,
    toAccountId: liamAccount.id,
    projectId: beara.id,
    vintageYear: 2025,
    quantity: 40,
    actorId: admin.id,
    memo: "Allocation to Liam O'Connell",
  });
  await retireCredits({
    fromAccountId: aoifeAccount.id,
    projectId: glen.id,
    vintageYear: 2024,
    quantity: 25,
    beneficiary: "Northwind Office Ltd",
    reason: "Corporate greenhouse gas inventory for the 2025 reporting year.",
    actorId: aoife.id,
  });

  console.log("Seeded Bridging Eden demo data.");
  console.log("Admin    admin@bridgingeden.ie / EdenAdmin!2026");
  console.log("Approver ciara.nolan@bridgingeden.ie / EdenAdmin!2026");
  console.log("Holder   aoife.brennan@example.com / HolderDemo!2026");
  console.log("Holder   liam.oconnell@example.com / HolderDemo!2026");
}

function glenNote() {
  return [
    "Glenmalure Native Woodland",
    "Location: Glenmalure, Co. Wicklow, Ireland",
    "Methodology: Native Woodland Establishment (BE-NW-1)",
    "Registry reference: BE-REG-GLEN-001",
    "",
    "Species mix: sessile oak, birch, hazel, holly, rowan.",
    "This note is a supporting document stored with the project. It is not a registry API record.",
  ].join("\n");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await owner.$disconnect();
  });
