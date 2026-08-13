import { PrismaPg } from "@prisma/adapter-pg";
import { describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

const schema = process.env.TENANT_INTEGRITY_SCHEMA;
const schoolId = process.env.TENANT_INTEGRITY_CANARY;
const suite = schema && schoolId ? describe : describe.skip;

suite("6E PrismaPg temporary-schema canary", () => {
  it("routes model reads and writes through the explicit adapter schema", async () => {
    if (!schema || !/^codex_6e_[a-z0-9_]+$/.test(schema) || schema === "public") {
      throw new Error("Unsafe TENANT_INTEGRITY_SCHEMA");
    }
    if (!schoolId?.startsWith("codex6e_")) throw new Error("Unsafe canary id");
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString || !new URL(connectionString).hostname.toLowerCase().includes("neon")) {
      throw new Error("6E canary only accepts Neon");
    }

    const prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString }, { schema }),
    });
    try {
      await prisma.school.create({ data: { id: schoolId, name: "6E canary" } });
      await expect(prisma.school.findUnique({ where: { id: schoolId } })).resolves.toMatchObject({
        id: schoolId,
      });
    } finally {
      await prisma.$disconnect();
    }
  });
});
