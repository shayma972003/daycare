import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { assertGuardianOwned, crossTenantResponse } from "@/lib/tenant-guard";
import { normalizePhone } from "@/lib/phone-normalizer";
import { z } from "zod";

/**
 * A child's guardians (task 2.34).
 *
 * `Student.guardianId` remains the primary contact — the invoice generator, the
 * reminder flow and a dozen screens read it — and this route manages everyone
 * else, plus the relationship and pick-up permission that the old flat
 * `name_2`/`phone_3` columns could never express.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    return (
      sessionErrorResponse(error) ??
      Response.json({ error: "Unauthorized" }, { status: 401 })
    );
  }
  const schoolId = session.user.schoolId;
  const { id } = await params;

  const student = await prisma.student.findFirst({
    where: { id, schoolId, deletedAt: null },
    select: {
      id: true,
      guardianId: true,
      guardianLinks: {
        include: {
          guardian: {
            select: {
              id: true,
              name: true,
              phone1: true,
              phone2: true,
              email: true,
              anonymizedAt: true,
              account: { select: { id: true, acceptedAt: true, disabledAt: true } },
            },
          },
        },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      },
    },
  });

  if (!student) return Response.json({ error: "Not found" }, { status: 404 });

  return Response.json(
    student.guardianLinks.map((link) => ({
      guardianId: link.guardianId,
      name: link.guardian.name,
      phone1: link.guardian.phone1,
      phone2: link.guardian.phone2,
      email: link.guardian.email,
      relation: link.relation,
      // Trusts the column on Student over the denormalised mirror: if the two
      // ever disagree, the one the rest of the product reads is right.
      isPrimary: link.guardianId === student.guardianId,
      canPickup: link.canPickup,
      anonymized: Boolean(link.guardian.anonymizedAt),
      portalStatus: link.guardian.account
        ? link.guardian.account.disabledAt
          ? "disabled"
          : link.guardian.account.acceptedAt
            ? "active"
            : "invited"
        : null,
    }))
  );
}

const attachSchema = z.object({
  /** Either link an existing guardian… */
  guardianId: z.string().min(1).optional(),
  /** …or create one from these. */
  name: z.string().min(1).max(120).optional(),
  phone1: z.string().max(20).nullish(),
  phone2: z.string().max(20).nullish(),
  email: z.string().email().nullish(),

  relation: z.string().max(60).nullish(),
  canPickup: z.boolean().optional(),
  /** Promotes this guardian to the child's primary contact. */
  makePrimary: z.boolean().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    return (
      sessionErrorResponse(error) ??
      Response.json({ error: "Unauthorized" }, { status: 401 })
    );
  }
  const schoolId = session.user.schoolId;
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = attachSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 422 });
  }
  if (!parsed.data.guardianId && !parsed.data.name) {
    return Response.json(
      { error: "اختاري ولي أمر موجوداً أو أدخلي اسماً جديداً" },
      { status: 422 }
    );
  }

  const student = await prisma.student.findFirst({
    where: { id, schoolId, deletedAt: null },
    select: { id: true, name: true, guardianId: true, anonymizedAt: true },
  });
  if (!student) return Response.json({ error: "Not found" }, { status: 404 });
  if (student.anonymizedAt) {
    return Response.json(
      { error: "هذا السجل مجهَّل نهائياً ولا يمكن تعديله" },
      { status: 409 }
    );
  }

  let guardianId: string;

  if (parsed.data.guardianId) {
    try {
      const owned = await assertGuardianOwned(parsed.data.guardianId, schoolId);
      if (!owned) return Response.json({ error: "ولي الأمر غير موجود" }, { status: 404 });
      guardianId = owned;
    } catch (error) {
      const denied = crossTenantResponse(error);
      if (denied) return denied;
      throw error;
    }
  } else {
    /**
     * Linking an existing record beats creating a duplicate.
     *
     * A grandmother attached to two grandchildren must be one row, not two —
     * otherwise updating her number fixes one child's emergency sheet and not
     * the other's. Matched on phone or email because those are the identifiers a
     * nursery actually has.
     *
     * Deliberately **links without overwriting**: the same rule as task 0.96.
     * Finding a match is not permission to rewrite that family's details.
     */
    const phone1 = parsed.data.phone1 ? normalizePhone(parsed.data.phone1) : null;
    const email = parsed.data.email?.toLowerCase().trim() || null;

    const existing =
      phone1 || email
        ? await prisma.guardian.findFirst({
            where: {
              schoolId,
              deletedAt: null,
              OR: [
                ...(phone1 ? [{ phone1 }] : []),
                ...(email ? [{ email }] : []),
              ],
            },
            select: { id: true },
          })
        : null;

    if (existing) {
      guardianId = existing.id;
    } else {
      const created = await prisma.guardian.create({
        data: {
          schoolId,
          name: parsed.data.name!,
          phone1,
          phone2: parsed.data.phone2 ? normalizePhone(parsed.data.phone2) : null,
          email,
        },
        select: { id: true },
      });
      guardianId = created.id;
    }
  }

  const makePrimary = parsed.data.makePrimary === true || student.guardianId === null;

  await prisma.$transaction(async (tx) => {
    if (makePrimary) {
      // Exactly one primary. The old one keeps its link and loses the flag —
      // demoted, not removed.
      await tx.studentGuardian.updateMany({
        where: { studentId: id },
        data: { isPrimary: false },
      });
      await tx.student.update({ where: { id }, data: { guardianId } });
    }

    await tx.studentGuardian.upsert({
      where: { studentId_guardianId: { studentId: id, guardianId } },
      create: {
        studentId: id,
        guardianId,
        relation: parsed.data.relation ?? null,
        canPickup: parsed.data.canPickup ?? true,
        isPrimary: makePrimary,
      },
      update: {
        ...(parsed.data.relation !== undefined ? { relation: parsed.data.relation } : {}),
        ...(parsed.data.canPickup !== undefined ? { canPickup: parsed.data.canPickup } : {}),
        ...(makePrimary ? { isPrimary: true } : {}),
      },
    });
  });

  await logAction({
    school_id: schoolId,
    action: `ربط ولي أمر بالطفل: ${student.name}`,
    entity_type: "student",
    entity_id: student.id,
    entity_name: student.name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json({ guardianId, isPrimary: makePrimary }, { status: 201 });
}

const detachSchema = z.object({ guardianId: z.string().min(1) });

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    return (
      sessionErrorResponse(error) ??
      Response.json({ error: "Unauthorized" }, { status: 401 })
    );
  }
  const schoolId = session.user.schoolId;
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = detachSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const student = await prisma.student.findFirst({
    where: { id, schoolId, deletedAt: null },
    select: { id: true, name: true, guardianId: true },
  });
  if (!student) return Response.json({ error: "Not found" }, { status: 404 });

  /**
   * The primary contact cannot simply be detached.
   *
   * Every reminder, invoice and notification path reads `Student.guardianId`; a
   * child left with none goes silent. Promote someone else first — an explicit
   * two-step, because the alternative is a child whose family stops hearing from
   * the nursery and nobody notices for a month.
   */
  if (student.guardianId === parsed.data.guardianId) {
    return Response.json(
      { error: "عيّني ولي أمر رئيسياً آخر قبل إزالة الحالي" },
      { status: 409 }
    );
  }

  const { count } = await prisma.studentGuardian.deleteMany({
    where: { studentId: id, guardianId: parsed.data.guardianId },
  });

  await logAction({
    school_id: schoolId,
    action: `إزالة ولي أمر من الطفل: ${student.name}`,
    entity_type: "student",
    entity_id: student.id,
    entity_name: student.name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json({ removed: count });
}
