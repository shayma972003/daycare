// Temporary: how big a payload does the enrolment submit survive in production?
import { readFileSync } from "node:fs";
import { PrismaClient } from "./src/generated/prisma/client.ts";
import { PrismaPg } from "@prisma/adapter-pg";
import { randomBytes, createHash } from "node:crypto";

for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const school = await prisma.school.findFirstOrThrow({ where: { name: "الروضة" }, select: { id: true } });

async function freshToken() {
  const token = randomBytes(24).toString("base64url");
  await prisma.enrollmentToken.create({
    data: {
      school_id: school.id,
      token,
      sent_to_phone: "+966500000009",
      sent_to_email: "qa-size@daycare.test",
      otp_code_hash: createHash("sha256").update("424242").digest("hex"),
      otp_expires_at: new Date(Date.now() + 3600_000),
      otp_last_sent_at: new Date(),
      expires_at: new Date(Date.now() + 86400_000),
      otp_verified: true,
    },
  });
  return token;
}

const BASE = "https://daycare-green.vercel.app";

// A PDF of N megabytes, encoded the way the form encodes it.
function fakePdfDataUri(megabytes) {
  const raw = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(megabytes * 1024 * 1024, 0x41)]);
  return `data:application/pdf;base64,${raw.toString("base64")}`;
}

for (const mb of [0.5, 2, 3, 4, 6, 10]) {
  const token = await freshToken();
  const dataUri = fakePdfDataUri(mb);
  const body = JSON.stringify({
    token,
    full_name: `اختبار حجم ${mb}MB`,
    enrollment_date: "2026-08-04",
    evaluation_file_url: dataUri,
    evaluation_file_name: `تقييم-${mb}mb.pdf`,
  });

  const started = Date.now();
  let status = "?";
  let snippet = "";
  try {
    const res = await fetch(`${BASE}/api/enrollment/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    status = res.status;
    snippet = (await res.text()).slice(0, 120).replace(/\s+/g, " ");
  } catch (error) {
    status = "NETWORK FAIL";
    snippet = String(error.message);
  }

  console.log(
    `file ${String(mb).padStart(4)} MB → request body ${(body.length / 1024 / 1024).toFixed(2)} MB → ${status}  ${snippet}  (${Date.now() - started}ms)`
  );
}

await prisma.enrollmentSubmission.deleteMany({ where: { full_name: { startsWith: "اختبار حجم" } } });
await prisma.enrollmentToken.deleteMany({ where: { sent_to_email: "qa-size@daycare.test" } });
await prisma.$disconnect();
