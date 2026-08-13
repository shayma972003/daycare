import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { backfillEnrollmentSubmissionIdNumbers } from "../src/lib/enrollment-submission-pii";

const schema = process.env.ENROLLMENT_PII_BACKFILL_SCHEMA;
const confirmedSchema = process.env.CONFIRM_ENROLLMENT_PII_BACKFILL_SCHEMA;
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
if (!schema || schema !== confirmedSchema || !/^[a-z_][a-z0-9_]*$/.test(schema)) {
  throw new Error("Set and exactly confirm ENROLLMENT_PII_BACKFILL_SCHEMA before running");
}

const limit = Number.parseInt(process.env.ENROLLMENT_PII_BACKFILL_BATCH_SIZE ?? "100", 10);
if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
  throw new Error("ENROLLMENT_PII_BACKFILL_BATCH_SIZE must be between 1 and 500");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }, { schema }) });
try {
  const result = await backfillEnrollmentSubmissionIdNumbers(prisma, limit);
  // Counts only. Never print plaintext, ciphertext, blind indexes, row ids, or keys.
  console.log(JSON.stringify(result));
  if (result.failed > 0) process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
