import { randomBytes } from "node:crypto";
import { z } from "zod";
import { verifyAdminSessionFromRequest } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

const createSchema = z.object({
  schoolId: z.string().min(1),
  requesterUserId: z.string().min(1).optional(),
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(3).max(3000),
  category: z.string().trim().max(60).optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
});

function ticketReference() {
  const time = Date.now().toString(36).toUpperCase();
  const random = randomBytes(2).toString("hex").toUpperCase();
  return `SUP-${time}-${random}`;
}

function clampLimit(raw: string | null) {
  const value = Number(raw ?? 50);
  if (!Number.isFinite(value)) return 50;
  return Math.max(1, Math.min(100, Math.trunc(value)));
}

export async function GET(request: Request) {
  const session = await verifyAdminSessionFromRequest(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const priority = url.searchParams.get("priority");
  const schoolId = url.searchParams.get("schoolId");
  const search = url.searchParams.get("search")?.trim();
  const limit = clampLimit(url.searchParams.get("limit"));
  const statuses = ["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER", "RESOLVED", "CLOSED"] as const;
  const priorities = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
  const parsedStatus = statuses.find((value) => value === status);
  const parsedPriority = priorities.find((value) => value === priority);

  const where = {
    ...(parsedStatus ? { status: parsedStatus } : {}),
    ...(parsedPriority ? { priority: parsedPriority } : {}),
    ...(schoolId ? { schoolId } : {}),
    ...(search
      ? {
          OR: [
            { reference: { contains: search, mode: "insensitive" as const } },
            { title: { contains: search, mode: "insensitive" as const } },
            { school: { name: { contains: search, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  const [tickets, schools, admins, statusCounts, urgentOpen] = await Promise.all([
    prisma.supportTicket.findMany({
      where,
      select: {
        id: true,
        reference: true,
        title: true,
        category: true,
        status: true,
        priority: true,
        firstRespondedAt: true,
        resolvedAt: true,
        createdAt: true,
        updatedAt: true,
        school: { select: { id: true, name: true } },
        requesterUser: { select: { id: true, name: true, email: true } },
        assignedAdmin: { select: { id: true, email: true } },
        _count: { select: { notes: true, attachments: true, accessSessions: true } },
      },
      orderBy: [{ status: "asc" }, { priority: "desc" }, { updatedAt: "desc" }],
      take: limit,
    }),
    prisma.school.findMany({
      select: { id: true, name: true, subscription_status: true },
      orderBy: { name: "asc" },
    }),
    prisma.superAdmin.findMany({ select: { id: true, email: true }, orderBy: { email: "asc" } }),
    prisma.supportTicket.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.supportTicket.count({
      where: { priority: "URGENT", status: { in: ["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER"] } },
    }),
  ]);

  const counts = new Map(statusCounts.map((row) => [row.status, row._count._all]));
  return Response.json({
    tickets,
    schools,
    admins,
    summary: {
      open: counts.get("OPEN") ?? 0,
      inProgress: counts.get("IN_PROGRESS") ?? 0,
      waiting: counts.get("WAITING_CUSTOMER") ?? 0,
      resolved: (counts.get("RESOLVED") ?? 0) + (counts.get("CLOSED") ?? 0),
      urgentOpen,
    },
  });
}

export async function POST(request: Request) {
  const session = await verifyAdminSessionFromRequest(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 422 });
  }

  const [school, requester] = await Promise.all([
    prisma.school.findUnique({ where: { id: parsed.data.schoolId }, select: { id: true, name: true } }),
    parsed.data.requesterUserId
      ? prisma.user.findFirst({
          where: { id: parsed.data.requesterUserId, schoolId: parsed.data.schoolId },
          select: { id: true },
        })
      : Promise.resolve(null),
  ]);
  if (!school) return Response.json({ error: "المنشأة غير موجودة" }, { status: 404 });
  if (parsed.data.requesterUserId && !requester) {
    return Response.json({ error: "الحساب لا يتبع المنشأة المحددة" }, { status: 422 });
  }

  const ticket = await prisma.$transaction(async (tx) => {
    const created = await tx.supportTicket.create({
      data: {
        reference: ticketReference(),
        schoolId: school.id,
        requesterUserId: requester?.id ?? null,
        createdByAdminId: session.adminId,
        assignedAdminId: session.adminId,
        title: parsed.data.title,
        description: parsed.data.description,
        category: parsed.data.category || null,
        priority: parsed.data.priority,
      },
      select: { id: true, reference: true },
    });
    await tx.adminActivityLog.create({
      data: {
        school_id: school.id,
        action: "support_ticket_created",
        performed_by: session.adminId,
        metadata: {
          ticketId: created.id,
          reference: created.reference,
          priority: parsed.data.priority,
          category: parsed.data.category || null,
        },
      },
    });
    return created;
  });

  return Response.json(ticket, { status: 201, headers: { "Cache-Control": "no-store" } });
}
