import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession, sessionErrorResponse } from "@/lib/session";
import { clearSupportViewCookie } from "@/lib/support-view-token";

const viewSchema = z.object({
  pathname: z.string().trim().min(1).max(200).regex(/^\/(?!api(?:\/|$))/),
});

export async function GET() {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    return sessionErrorResponse(error) ?? Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const active = await prisma.supportAccessSession.findFirst({
    where: { schoolId: session.user.schoolId, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, expiresAt: true },
    orderBy: { createdAt: "desc" },
  });
  return Response.json({
    active: Boolean(active),
    expiresAt: active?.expiresAt ?? null,
    isSupportViewer: session.isSupportAccess,
  }, {
    headers: {
      "Cache-Control": "no-store",
      // If a support session was revoked from the admin workspace, the signed
      // token can outlive the database row for a few minutes. Once the request
      // resolves as a normal school session, clear that stale browser overlay
      // so the school cannot remain trapped in read-only mode.
      ...(!session.isSupportAccess ? { "Set-Cookie": clearSupportViewCookie() } : {}),
    },
  });
}

export async function POST(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    return sessionErrorResponse(error) ?? Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.isSupportAccess || !session.supportAccessId) {
    return Response.json({ error: "هذا السجل مخصص لجلسة الدعم" }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = viewSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 422 });
  const now = new Date();
  const access = await prisma.supportAccessSession.findFirst({
    where: {
      id: session.supportAccessId,
      schoolId: session.user.schoolId,
      revokedAt: null,
      expiresAt: { gt: now },
    },
    select: { id: true, ticketId: true, createdByAdminId: true },
  });
  if (!access) return Response.json({ error: "انتهت جلسة الدعم", expired: true }, { status: 410 });
  await prisma.$transaction([
    prisma.supportAccessSession.update({ where: { id: access.id }, data: { lastViewedAt: now } }),
    prisma.adminActivityLog.create({
      data: {
        school_id: session.user.schoolId,
        action: "support_tenant_page_viewed",
        performed_by: access.createdByAdminId,
        metadata: { accessSessionId: access.id, ticketId: access.ticketId, pathname: parsed.data.pathname },
      },
    }),
  ]);
  return Response.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE() {
  let session;
  try {
    session = await requireSession();
  } catch {
    // Clearing a local support overlay is always safe. This is also the escape
    // hatch for a token whose database session was revoked in another tab.
    return Response.json(
      { success: true, cleared: true },
      { headers: { "Cache-Control": "no-store", "Set-Cookie": clearSupportViewCookie() } },
    );
  }
  if (!session.isSupportAccess || !session.supportAccessId) {
    return Response.json(
      { success: true, cleared: true },
      { headers: { "Cache-Control": "no-store", "Set-Cookie": clearSupportViewCookie() } },
    );
  }
  const now = new Date();
  const access = await prisma.supportAccessSession.findFirst({
    where: { id: session.supportAccessId, schoolId: session.user.schoolId, revokedAt: null },
    select: { id: true, ticketId: true, createdByAdminId: true },
  });
  if (access) {
    await prisma.$transaction([
      prisma.supportAccessSession.update({ where: { id: access.id }, data: { revokedAt: now } }),
      prisma.adminActivityLog.create({
        data: {
          school_id: session.user.schoolId,
          action: "support_access_ended",
          performed_by: access.createdByAdminId,
          metadata: { accessSessionId: access.id, ticketId: access.ticketId, endedFromTenantView: true },
        },
      }),
    ]);
  }
  return Response.json(
    { success: true },
    { headers: { "Cache-Control": "no-store", "Set-Cookie": clearSupportViewCookie() } },
  );
}
