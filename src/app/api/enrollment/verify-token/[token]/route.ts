import { prisma } from "@/lib/prisma";
import { stampFileUrl } from "@/lib/file-token";
import { rateLimit, clientIp, rateLimitResponse } from "@/lib/rate-limit";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const limited = await rateLimit({
    key: `enroll:verify-token:${clientIp(request)}`,
    limit: 60,
    windowMs: 15 * 60 * 1000,
  });
  const limitedResponse = rateLimitResponse(limited);
  if (limitedResponse) return limitedResponse;

  const { token } = await params;

  const rec = await prisma.enrollmentToken.findUnique({
    where: { token },
    select: {
      expires_at: true,
      status: true,
      submissions_count: true,
      max_submissions: true,
      school: { select: { name: true, logoUrl: true } },
    },
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

  return Response.json({
    valid: true,
    submissionsCount: rec.submissions_count,
    maxSubmissions: rec.max_submissions,
    school: {
      name: rec.school.name,
      logoUrl: stampFileUrl(rec.school.logoUrl),
    },
  });
}
