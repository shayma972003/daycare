// Temporary: reproduce the enrolment submit failure against production.
import { PrismaClient } from "./src/generated/prisma/client.ts";
import { PrismaPg } from "@prisma/adapter-pg";
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const TOKEN = "cQqIyin-f5T_Rq_iyPgd7KpHFcV1Cgy4";
const BASE = "https://daycare-green.vercel.app";

const row = await prisma.enrollmentToken.findUnique({
  where: { token: TOKEN },
  select: {
    status: true,
    otp_verified: true,
    submissions_count: true,
    max_submissions: true,
    expires_at: true,
    school_id: true,
  },
});
console.log("token state:", JSON.stringify(row));

const submissions = await prisma.enrollmentSubmission.count({
  where: { school_id: row?.school_id ?? "" },
});
console.log("submissions for this school:", submissions);

// The exact shape the form sends.
const payload = {
  token: TOKEN,
  full_name: "طفل تجربة الإرسال",
  id_number: "",
  nationality: "",
  academic_stage: "",
  gender: "",
  period: "",
  date_of_birth: "",
  health_condition: "",
  allergies: "",
  attendance_type: "",
  payment_method: "",
  enrollment_date: "2026-08-04",
  guardian_name: "",
  guardian_phone_1: "",
  guardian_phone_2: "",
  guardian_email: "",
  guardian_name_2: "",
  guardian_phone_3: "",
  guardian_phone_4: "",
  guardian_email_2: "",
};

const res = await fetch(`${BASE}/api/enrollment/submit`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});
console.log("submit status:", res.status);
console.log("submit body:", (await res.text()).slice(0, 600));

await prisma.$disconnect();
