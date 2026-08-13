import { PrismaPg } from "@prisma/adapter-pg";
import { describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

const schema = process.env.PUSH_LEASE_SCHEMA;
const schoolId = process.env.PUSH_LEASE_CANARY;
const suite = schema && schoolId ? describe : describe.skip;

suite("6F PrismaPg temporary-schema canary", () => {
  it("routes through the explicit schema", async () => {
    if (!schema || !/^codex_6f_[a-z0-9_]+$/.test(schema) || schema === "public") {
      throw new Error("Unsafe PUSH_LEASE_SCHEMA");
    }
    if (!schoolId?.startsWith("codex6f_")) throw new Error("Unsafe canary id");
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString || !new URL(connectionString).hostname.includes("neon")) {
      throw new Error("6F canary only accepts Neon");
    }
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }, { schema }) });
    try {
      await prisma.school.create({ data: { id: schoolId, name: "6F canary" } });
      await expect(prisma.school.findUnique({ where: { id: schoolId } })).resolves.toBeTruthy();
    } finally {
      await prisma.$disconnect();
    }
  });
});
