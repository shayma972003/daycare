import { describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const schema = process.env.RATE_LIMIT_POSTGRES_SCHEMA;
const canaryKey = process.env.RATE_LIMIT_CANARY_KEY;
const enabled = Boolean(schema && canaryKey);
const suite = enabled ? describe : describe.skip;

suite("PrismaPg temporary-schema canary", () => {
  it("writes and reads the RateLimit model through the explicit schema option", async () => {
    if (!schema || !/^codex_5b_[a-z0-9_]+$/.test(schema) || schema === "public") {
      throw new Error("Unsafe or missing RATE_LIMIT_POSTGRES_SCHEMA");
    }
    if (!canaryKey || !/^codex5b_[a-z0-9_]+:canary$/.test(canaryKey)) {
      throw new Error("Unsafe or missing RATE_LIMIT_CANARY_KEY");
    }
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is required for the canary");
    const parsed = new URL(connectionString);
    if (!parsed.hostname.toLowerCase().includes("neon")) {
      throw new Error("Prisma canary only accepts Neon");
    }

    const adapter = new PrismaPg({ connectionString }, { schema });
    const prisma = new PrismaClient({ adapter });
    try {
      await prisma.rateLimit.create({
        data: { key: canaryKey, count: 1, expiresAt: new Date(Date.now() + 60_000) },
      });
      await expect(prisma.rateLimit.findUnique({ where: { key: canaryKey } })).resolves.toMatchObject({
        key: canaryKey,
        count: 1,
      });
    } finally {
      await prisma.$disconnect();
    }
  });
});
