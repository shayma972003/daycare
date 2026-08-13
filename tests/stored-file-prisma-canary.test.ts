import { describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const schema = process.env.STORED_FILE_POSTGRES_SCHEMA;
const canaryKey = process.env.STORED_FILE_CANARY_KEY;
const schoolId = process.env.STORED_FILE_CANARY_SCHOOL;
const enabled = Boolean(schema && canaryKey && schoolId);
const suite = enabled ? describe : describe.skip;

suite("StoredFile PrismaPg temporary-schema canary", () => {
  it("writes and reads through the explicit adapter schema", async () => {
    if (!schema || !/^codex_6b1_[a-z0-9_]+$/.test(schema) || schema === "public") {
      throw new Error("Unsafe or missing STORED_FILE_POSTGRES_SCHEMA");
    }
    if (!canaryKey || !canaryKey.startsWith("schools/codex6b1_")) {
      throw new Error("Unsafe or missing STORED_FILE_CANARY_KEY");
    }
    if (!schoolId || !schoolId.startsWith("codex6b1_")) {
      throw new Error("Unsafe or missing STORED_FILE_CANARY_SCHOOL");
    }
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is required for the canary");
    if (!new URL(connectionString).hostname.toLowerCase().includes("neon")) {
      throw new Error("StoredFile canary only accepts Neon");
    }

    const adapter = new PrismaPg({ connectionString }, { schema });
    const prisma = new PrismaClient({ adapter });
    try {
      await prisma.school.create({ data: { id: schoolId, name: "6B1 canary" } });
      await prisma.storedFile.create({
        data: {
          key: canaryKey,
          schoolId,
          category: "students",
          ownerType: "LEGACY",
          ownerId: "codex6b1_canary_owner",
          contentType: "application/pdf",
          sizeBytes: 1,
        },
      });
      await expect(prisma.storedFile.findUnique({ where: { key: canaryKey } }))
        .resolves.toMatchObject({ key: canaryKey, schoolId, ownerType: "LEGACY" });
    } finally {
      await prisma.$disconnect();
    }
  });
});
