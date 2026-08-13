import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { backfillImportRowPayloads } from "../src/lib/import-row-payload";

const schema = process.env.IMPORT_ROW_BACKFILL_SCHEMA;
const confirmedSchema = process.env.CONFIRM_IMPORT_ROW_BACKFILL_SCHEMA;
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
if (
  !schema ||
  schema === "public" ||
  schema !== confirmedSchema ||
  !/^[a-z_][a-z0-9_]*$/.test(schema)
) {
  throw new Error("Set and exactly confirm a non-public IMPORT_ROW_BACKFILL_SCHEMA");
}

const limit = Number.parseInt(process.env.IMPORT_ROW_BACKFILL_BATCH_SIZE ?? "100", 10);
if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
  throw new Error("IMPORT_ROW_BACKFILL_BATCH_SIZE must be between 1 and 500");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }, { schema }) });
try {
  const result = await backfillImportRowPayloads(prisma, limit);
  // Counts only. Never print row ids, staged content, ciphertext, or keys.
  console.log(JSON.stringify(result));
} finally {
  await prisma.$disconnect();
}
