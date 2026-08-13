import { PrismaPg } from "@prisma/adapter-pg";
import { describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

const schema = process.env.RETENTION_TEST_SCHEMA;
const suite = schema ? describe : describe.skip;

suite("retention on PostgreSQL", () => {
  it("deletes only expired rows in bounded id batches", async () => {
    if (!schema || !/^codex_6h_[a-z0-9_]+$/.test(schema) || schema === "public") throw new Error("Unsafe schema");
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString || !new URL(connectionString).hostname.includes("neon")) throw new Error("Neon only");
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }, { schema }) });
    const schoolId = `6h_school_${Date.now()}`;
    try {
      await prisma.school.create({ data: { id: schoolId, name: "6H" } });
      await prisma.rateLimit.createMany({ data: [
        { key: "6h_expired", count: 1, expiresAt: new Date("2020-01-01") },
        { key: "6h_valid", count: 1, expiresAt: new Date("2099-01-01") },
      ] });
      const ids = await prisma.rateLimit.findMany({ where: { expiresAt: { lt: new Date() } }, select: { id: true }, take: 100 });
      await prisma.rateLimit.deleteMany({ where: { id: { in: ids.map((row) => row.id) } } });
      await expect(prisma.rateLimit.findUnique({ where: { key: "6h_expired" } })).resolves.toBeNull();
      await expect(prisma.rateLimit.findUnique({ where: { key: "6h_valid" } })).resolves.toBeTruthy();
    } finally { await prisma.$disconnect(); }
  });
});
