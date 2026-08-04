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

const tokens = await prisma.enrollmentToken.findMany({
  select: {
    token: true,
    status: true,
    sent_to_email: true,
    otp_verified: true,
    submissions_count: true,
    expires_at: true,
    school: { select: { name: true } },
  },
  orderBy: { created_at: "desc" },
  take: 10,
});

console.log(`enrollment tokens in THIS database: ${tokens.length}`);
for (const t of tokens) {
  console.log(
    `  ${t.token.slice(0, 14)}…  ${t.status}  verified=${t.otp_verified}  subs=${t.submissions_count}  ${t.sent_to_email}  [${t.school.name}]`
  );
}

const schools = await prisma.school.findMany({ select: { name: true } });
console.log(`schools: ${schools.map((s) => s.name).join(" | ")}`);
console.log(`local DB host: ${new URL(process.env.DATABASE_URL).host}`);

await prisma.$disconnect();
