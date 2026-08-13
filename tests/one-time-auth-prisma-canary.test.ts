import { describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const schema = process.env.ONE_TIME_AUTH_SCHEMA;
const canaryKey = process.env.ONE_TIME_AUTH_CANARY;
const suite = schema && canaryKey ? describe : describe.skip;

suite("6C PrismaPg temporary-schema canary", () => {
  it("routes a model write through the explicit adapter schema", async () => {
    if (!schema || !/^codex_6c_[a-z0-9_]+$/.test(schema) || schema === "public") {
      throw new Error("Unsafe ONE_TIME_AUTH_SCHEMA");
    }
    if (!canaryKey?.startsWith("codex6c_")) throw new Error("Unsafe canary key");
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString || !new URL(connectionString).hostname.toLowerCase().includes("neon")) {
      throw new Error("6C canary only accepts Neon");
    }
    const prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString }, { schema }),
    });
    try {
      await prisma.rateLimit.create({
        data: { key: canaryKey, count: 1, expiresAt: new Date(Date.now() + 60_000) },
      });
      await expect(prisma.rateLimit.findUnique({ where: { key: canaryKey } })).resolves.toMatchObject({
        key: canaryKey,
      });
    } finally {
      await prisma.$disconnect();
    }
  });
});
