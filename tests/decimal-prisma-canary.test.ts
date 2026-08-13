import { PrismaPg } from "@prisma/adapter-pg";
import { describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

const schema = process.env.DECIMAL_TEST_SCHEMA;
const canaryId = process.env.DECIMAL_TEST_CANARY;
const suite = schema && canaryId ? describe : describe.skip;

suite("6G1 PrismaPg temporary-schema canary", () => {
  it("writes and reads through the explicitly selected schema", async () => {
    if (!schema || !/^codex_6g1_[a-z0-9_]+$/.test(schema) || schema === "public") throw new Error("Unsafe schema");
    if (!canaryId?.startsWith("codex6g1_")) throw new Error("Unsafe canary");
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString || !new URL(connectionString).hostname.toLowerCase().includes("neon")) throw new Error("Neon only");
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }, { schema }) });
    try {
      await prisma.school.create({ data: { id: canaryId, name: "6G1 canary" } });
      await expect(prisma.school.findUnique({ where: { id: canaryId } })).resolves.toBeTruthy();
    } finally {
      await prisma.$disconnect();
    }
  });
});
