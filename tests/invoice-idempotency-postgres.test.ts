import { PrismaPg } from "@prisma/adapter-pg";
import { describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

const schema = process.env.INVOICE_IDEMPOTENCY_SCHEMA;
const suite = schema ? describe : describe.skip;

suite("invoice idempotency on PostgreSQL", () => {
  it("allows exactly one concurrent claim and one recovery owner after lease expiry", async () => {
    if (!schema || !/^codex_6g2_[a-z0-9_]+$/.test(schema) || schema === "public") throw new Error("Unsafe schema");
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString || !new URL(connectionString).hostname.toLowerCase().includes("neon")) throw new Error("Neon only");
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }, { schema }) });
    const schoolId = `6g2_school_${Date.now()}`;
    const data = { schoolId, operationKind: "student-custom", idempotencyKey: "same-key-123", requestHash: "hash-a", type: "STUDENT" as const, amount: 0, vat_amount: 0, data: {}, generationStatus: "PENDING" as const, generationLeaseExpiresAt: new Date(Date.now() + 60_000) };
    try {
      await prisma.school.create({ data: { id: schoolId, name: "6G2" } });
      const claims = await Promise.allSettled([prisma.invoice.create({ data }), prisma.invoice.create({ data })]);
      expect(claims.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(await prisma.invoice.count({ where: { schoolId, idempotencyKey: "same-key-123" } })).toBe(1);
      const invoice = await prisma.invoice.findFirstOrThrow({ where: { schoolId } });
      expect(await prisma.invoice.count({ where: { schoolId, generationStatus: "COMPLETED" } })).toBe(0);

      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { generationLeaseExpiresAt: new Date(Date.now() - 1_000) },
      });
      const recovery = await Promise.all([
        prisma.invoice.updateMany({
          where: { id: invoice.id, generationStatus: "PENDING", generationLeaseExpiresAt: { lte: new Date() } },
          data: { generationLeaseExpiresAt: new Date(Date.now() + 60_000) },
        }),
        prisma.invoice.updateMany({
          where: { id: invoice.id, generationStatus: "PENDING", generationLeaseExpiresAt: { lte: new Date() } },
          data: { generationLeaseExpiresAt: new Date(Date.now() + 60_000) },
        }),
      ]);
      expect(recovery.reduce((total, item) => total + item.count, 0)).toBe(1);

      const staleLease = new Date(Date.now() - 60_000);
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { generationLeaseExpiresAt: staleLease },
      });
      const newLease = new Date(Date.now() + 60_000);
      expect((await prisma.invoice.updateMany({
        where: { id: invoice.id, generationStatus: "PENDING", generationLeaseExpiresAt: staleLease },
        data: { generationLeaseExpiresAt: newLease },
      })).count).toBe(1);
      expect((await prisma.invoice.updateMany({
        where: { id: invoice.id, generationStatus: "PENDING", generationLeaseExpiresAt: staleLease },
        data: { generationStatus: "COMPLETED", generationLeaseExpiresAt: null },
      })).count).toBe(0);

      await prisma.invoice.update({ where: { id: invoice.id }, data: { generationStatus: "FAILED", generationLeaseExpiresAt: null } });
      const reclaimed = await prisma.invoice.updateMany({
        where: { id: invoice.id, generationStatus: "FAILED" },
        data: { generationStatus: "PENDING", generationLeaseExpiresAt: new Date(Date.now() + 60_000) },
      });
      expect(reclaimed.count).toBe(1);
    } finally {
      await prisma.$disconnect();
    }
  }, 30_000);
});
