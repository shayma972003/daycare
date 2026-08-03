/**
 * Moves every base64 payload out of the database and into R2 (task 0.35).
 *
 * Run once after configuring R2, and safe to run again: it only touches values
 * that still start with `data:`, so a second run over migrated rows does
 * nothing. That matters more than it sounds — this reads and rewrites rows
 * holding children's photographs, and a script that must not be interrupted is a
 * script that will be.
 *
 *   npx tsx scripts/migrate-files-to-r2.mjs            # migrate
 *   npx tsx scripts/migrate-files-to-r2.mjs --dry-run  # report only
 *
 * Run under `tsx`, like prisma/seed.ts: Prisma 7 emits its client as TypeScript
 * into src/generated, so plain `node` cannot import it.
 *
 * Order of operations per value: upload, record, *then* update the column. A
 * crash between any two steps leaves an unreferenced object in the bucket — a
 * wasted byte — rather than a row pointing at a file that was never written.
 *
 * `Invoice.pdfUrl` is deliberately not migrated. A rendered PDF is reproducible
 * from the figures beside it, the settings screen already offers to clear them
 * in bulk, and moving them would spend the migration's slowest hours on the one
 * category nobody needs kept.
 */

import { PrismaClient } from "../src/generated/prisma/client.ts";
import { PrismaPg } from "@prisma/adapter-pg";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

// ─── Environment ────────────────────────────────────────────────────────────
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (match && !process.env[match[1]]) {
    process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
}

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, DATABASE_URL } =
  process.env;

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
  console.error("R2 is not configured — set all four R2_* variables first.");
  process.exit(1);
}

const dryRun = process.argv.includes("--dry-run");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) });

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

const EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "application/pdf": "pdf",
  "application/zip": "zip",
  "application/vnd.ms-excel": "xls",
};

/** Splits `data:<mime>;base64,<payload>` into bytes and a type. */
function decodeDataUri(value) {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(value);
  if (!match) return null;
  return { mime: match[1], buffer: Buffer.from(match[2], "base64") };
}

async function upload(schoolId, category, ownerId, value) {
  const decoded = decodeDataUri(value);
  if (!decoded) return null;

  const ext = EXTENSIONS[decoded.mime] ?? "bin";
  const key = `schools/${schoolId}/${category}/${ownerId}/${randomUUID()}.${ext}`;

  if (dryRun) {
    return { key, url: `/api/files/${key}`, sizeBytes: decoded.buffer.length };
  }

  await s3.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: decoded.buffer,
      ContentType: decoded.mime,
      CacheControl: "private, max-age=31536000, immutable",
    })
  );

  await prisma.storedFile.create({
    data: {
      key,
      schoolId,
      category,
      ownerId,
      contentType: decoded.mime,
      sizeBytes: decoded.buffer.length,
    },
  });

  return { key, url: `/api/files/${key}`, sizeBytes: decoded.buffer.length };
}

const totals = { files: 0, bytes: 0, skipped: 0 };

/**
 * Migrates one column of one table.
 *
 * `rows` must already be filtered to values starting with `data:`; `apply`
 * writes the new URL back. Both are passed in rather than derived, because the
 * six tables involved have six different shapes and a generic version would be
 * longer than the six calls.
 */
async function migrateColumn(label, rows, apply) {
  let migrated = 0;

  for (const row of rows) {
    const result = await upload(row.schoolId, row.category, row.ownerId, row.value);
    if (!result) {
      totals.skipped++;
      console.warn(`  ! ${label} ${row.id}: value is not a data URI, left alone`);
      continue;
    }

    if (!dryRun) await apply(row.id, result.url);

    migrated++;
    totals.files++;
    totals.bytes += result.sizeBytes;
  }

  console.log(`${label}: ${migrated} file(s)`);
}

const isDataUri = { startsWith: "data:" };

// ─── Students: avatar, evaluation file, additional file ─────────────────────
const students = await prisma.student.findMany({
  where: {
    OR: [
      { avatarUrl: isDataUri },
      { evaluationFileUrl: isDataUri },
      { additionalFile: isDataUri },
    ],
  },
  select: {
    id: true,
    schoolId: true,
    avatarUrl: true,
    evaluationFileUrl: true,
    additionalFile: true,
  },
});

for (const column of ["avatarUrl", "evaluationFileUrl", "additionalFile"]) {
  await migrateColumn(
    `Student.${column}`,
    students
      .filter((student) => student[column]?.startsWith("data:"))
      .map((student) => ({
        id: student.id,
        schoolId: student.schoolId,
        category: "students",
        ownerId: student.id,
        value: student[column],
      })),
    (id, url) => prisma.student.update({ where: { id }, data: { [column]: url } })
  );
}

// ─── School logo ────────────────────────────────────────────────────────────
const schools = await prisma.school.findMany({
  where: { logoUrl: isDataUri },
  select: { id: true, logoUrl: true },
});

await migrateColumn(
  "School.logoUrl",
  schools.map((school) => ({
    id: school.id,
    schoolId: school.id,
    category: "school",
    ownerId: school.id,
    value: school.logoUrl,
  })),
  (id, url) => prisma.school.update({ where: { id }, data: { logoUrl: url } })
);

// ─── Care report photos ─────────────────────────────────────────────────────
const reports = await prisma.careReport.findMany({
  where: { photoUrl: isDataUri },
  select: { id: true, schoolId: true, studentId: true, photoUrl: true },
});

await migrateColumn(
  "CareReport.photoUrl",
  reports.map((report) => ({
    id: report.id,
    schoolId: report.schoolId,
    category: "care",
    // Owned by the child, not the report: anonymising a child must take every
    // photograph of them with it, and it looks files up by owner.
    ownerId: report.studentId,
    value: report.photoUrl,
  })),
  (id, url) => prisma.careReport.update({ where: { id }, data: { photoUrl: url } })
);

// ─── Class images ───────────────────────────────────────────────────────────
const classes = await prisma.class.findMany({
  where: { imageUrl: isDataUri },
  select: { id: true, schoolId: true, imageUrl: true },
});

await migrateColumn(
  "Class.imageUrl",
  classes.map((klass) => ({
    id: klass.id,
    schoolId: klass.schoolId,
    category: "classes",
    ownerId: klass.id,
    value: klass.imageUrl,
  })),
  (id, url) => prisma.class.update({ where: { id }, data: { imageUrl: url } })
);

// ─── Activity images ────────────────────────────────────────────────────────
const activities = await prisma.activity.findMany({
  where: { imageUrl: isDataUri },
  select: { id: true, schoolId: true, imageUrl: true },
});

await migrateColumn(
  "Activity.imageUrl",
  activities.map((activity) => ({
    id: activity.id,
    schoolId: activity.schoolId,
    category: "activities",
    ownerId: activity.id,
    value: activity.imageUrl,
  })),
  (id, url) => prisma.activity.update({ where: { id }, data: { imageUrl: url } })
);

// ─── Unit files ─────────────────────────────────────────────────────────────
const unitFiles = await prisma.unitFile.findMany({
  where: { url: isDataUri },
  select: { id: true, url: true, unit: { select: { id: true, schoolId: true } } },
});

await migrateColumn(
  "UnitFile.url",
  unitFiles.map((file) => ({
    id: file.id,
    schoolId: file.unit.schoolId,
    category: "units",
    ownerId: file.unit.id,
    value: file.url,
  })),
  (id, url) => prisma.unitFile.update({ where: { id }, data: { url } })
);

// ─── Recompute the cached usage figures ─────────────────────────────────────
if (!dryRun && totals.files > 0) {
  await prisma.storageUsage.deleteMany({});
  console.log("\nCleared the storage-usage cache; it recomputes on next read.");
}

const mb = (totals.bytes / (1024 * 1024)).toFixed(2);
console.log(
  `\n${dryRun ? "[dry run] would move" : "Moved"} ${totals.files} file(s), ${mb} MB` +
    (totals.skipped ? ` · ${totals.skipped} left alone` : "")
);

await prisma.$disconnect();
