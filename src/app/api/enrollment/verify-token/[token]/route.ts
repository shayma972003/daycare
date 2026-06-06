import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const rec = await prisma.enrollmentToken.findUnique({
    where: { token },
    include: { school: { select: { name: true, logoUrl: true } } },
  });

  if (!rec) {
    return Response.json({ error: "invalid" }, { status: 404 });
  }

  if (rec.expires_at < new Date() || rec.status === "expired") {
    return Response.json({ error: "expired" }, { status: 410 });
  }

  if (rec.submissions_count >= rec.max_submissions) {
    return Response.json({ error: "limit_reached", max: rec.max_submissions }, { status: 429 });
  }

  const maskedPhone = rec.sent_to_phone.slice(0, -4).replace(/\d/g, "X") + rec.sent_to_phone.slice(-4);

  return Response.json({
    valid: true,
    otpVerified: rec.otp_verified,
    maskedPhone,
    submissionsCount: rec.submissions_count,
    maxSubmissions: rec.max_submissions,
    school: {
      name: rec.school.name,
      logoUrl: rec.school.logoUrl,
    },
  });
}
