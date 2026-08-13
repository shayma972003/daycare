import { PrismaPg } from "@prisma/adapter-pg";
import { describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

const schema = process.env.INVOICE_IDEMPOTENCY_SCHEMA;
const suite = schema ? describe : describe.skip;

suite("invoice idempotency on PostgreSQL", () => {
  it("allows exactly one concurrent claim and a retry after failure", async () => {
    if (!schema || !/^codex_6g2_[a-z0-9_]+$/.test(schema) || schema === "public") throw new Error("Unsafe schema");
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString || !new URL(connectionString).hostname.toLowerCase().includes("neon")) throw new Error("Neon only");
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }, { schema }) });
    const schoolId = `6g2_school_${Date.now()}`;
    const data = { schoolId, operationKind: "student-custom", idempotencyKey: "same-key-123", requestHash: "hash-a", type: "STUDENT" as const, amount: 0, vat_amount: 0, data: {}, generationStatus: "PENDING" as const };
    try {
      await prisma.school.create({ data: { id: schoolId, name: "6G2" } });
      const claims = await Promise.allSettled([prisma.invoice.create({ data }), prisma.invoice.create({ data })]);
      expect(claims.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(await prisma.invoice.count({ where: { schoolId, idempotencyKey: "same-key-123" } })).toBe(1);
      const invoice = await prisma.invoice.findFirstOrThrow({ where: { schoolId } });
      await prisma.invoice.update({ where: { id: invoice.id }, data: { generationStatus: "FAILED" } });
      const reclaimed = await prisma.invoice.updateMany({ where: { id: invoice.id, generationStatus: "FAILED" }, data: { generationStatus: "PENDING" } });
      expect(reclaimed.count).toBe(1);
    } finally {
      await prisma.$disconnect();
    }
  });
});
