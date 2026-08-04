// Temporary: a fresh, pre-verified token on the same school, for a browser repro.
import { PrismaClient } from "./src/generated/prisma/client.ts";
import { PrismaPg } from "@prisma/adapter-pg";
import { readFileSync } from "node:fs";
import { randomBytes, createHash } from "node:crypto";

for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

// Remove the submission my earlier API repro created, so her token is untouched.
await prisma.enrollmentSubmission.deleteMany({ where: { full_name: "طفل تجربة الإرسال" } });
await prisma.enrollmentToken.update({
  where: { token: "cQqIyin-f5T_Rq_iyPgd7KpHFcV1Cgy4" },
  data: { submissions_count: 0, status: "active" },
});

const school = await prisma.school.findFirstOrThrow({
  where: { name: "الروضة" },
  select: { id: true },
});

const token = randomBytes(24).toString("base64url");
await prisma.enrollmentToken.create({
  data: {
    school_id: school.id,
    token,
    sent_to_phone: "+966500000009",
    sent_to_email: "qa-repro@daycare.test",
    otp_code_hash: createHash("sha256").update("424242").digest("hex"),
    otp_expires_at: new Date(Date.now() + 60 * 60_000),
    otp_last_sent_at: new Date(),
    expires_at: new Date(Date.now() + 24 * 60 * 60_000),
    otp_verified: true,
  },
});

console.log(JSON.stringify({ url: `https://daycare-green.vercel.app/enroll/${token}` }));
await prisma.$disconnect();
