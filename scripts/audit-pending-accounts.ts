import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

try {
  const [staffWithPassword, staffWithoutPassword, guardiansPending] = await Promise.all([
    prisma.user.count({ where: { acceptedAt: null, password: { not: null } } }),
    prisma.user.count({ where: { acceptedAt: null, password: null } }),
    prisma.guardianAccount.count({ where: { acceptedAt: null } }),
  ]);

  // Counts only: never print email, phone, names, identifiers, tokens or hashes.
  console.log(JSON.stringify({ staffWithPassword, staffWithoutPassword, guardiansPending }));
} finally {
  await prisma.$disconnect();
}
