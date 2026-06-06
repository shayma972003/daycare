import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { createHash } from "crypto";

const schema = z.object({
  token: z.string().min(1),
  otp_code: z.string().length(6),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "بيانات غير صحيحة" }, { status: 422 });
  }

  const { token, otp_code } = parsed.data;

  const rec = await prisma.enrollmentToken.findUnique({
    where: { token },
    include: { school: { select: { name: true, logoUrl: true } } },
  });

  if (!rec) return Response.json({ error: "invalid" }, { status: 404 });
  if (rec.expires_at < new Date()) return Response.json({ error: "expired" }, { status: 410 });
  if (rec.otp_verified) {
    return Response.json({ success: true, school: { name: rec.school.name, logoUrl: rec.school.logoUrl } });
  }

  if (!rec.otp_expires_at || rec.otp_expires_at < new Date()) {
    return Response.json({ error: "انتهت صلاحية الرمز. اطلب رمزاً جديداً." }, { status: 410 });
  }

  if (rec.otp_code !== otp_code) {
    return Response.json({ error: "رمز التحقق غير صحيح" }, { status: 401 });
  }

  const ua = request.headers.get("user-agent") ?? "";
  const ip = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? "";
  const fingerprint = createHash("sha256").update(`${ua}|${ip}`).digest("hex").slice(0, 16);

  await prisma.enrollmentToken.update({
    where: { token },
    data: {
      otp_verified: true,
      status: "active",
      device_fingerprint: fingerprint,
    },
  });

  return Response.json({
    success: true,
    school: { name: rec.school.name, logoUrl: rec.school.logoUrl },
  });
}
