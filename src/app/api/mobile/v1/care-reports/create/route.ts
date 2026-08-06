import { requireMobileAuth, mobileAuthResponse } from "@/lib/mobile-guard";
import { prisma } from "@/lib/prisma";
import { buildReportFields, careReportInputSchema, type CareReportInput } from "@/lib/care-reports";
import { keyFromUrl, schoolIdFromKey } from "@/lib/r2";
import { z } from "zod";

/**
 * Filing a care report from the app.
 *
 * `/api/mobile/v1/care-reports` is the guardian's read of her own children's
 * feed. This is the other direction — staff writing — and it is a separate path
 * because the two have nothing in common but a table: different account kind,
 * different permission, different shape.
 *
 * Every rule the dashboard's create path documents applies here and is enforced
 * the same way, because they are properties of the data rather than of the
 * screen: ids proven against the school before anything is written, anonymised
 * records refused new personal data, and a photo URL checked to be inside this
 * school's prefix rather than trusted.
 *
 * Batched by design. A teacher reports on the six children who ate, not one at
 * a time — that is the shape the care screen was built around on the web, and
 * the app should not make her do it six times.
 */
const bodySchema = z.object({
  studentIds: z.array(z.string().min(1)).min(1).max(60),
  report: careReportInputSchema.omit({ studentId: true }),
});

export async function POST(request: Request) {
  let context;
  try {
    context = await requireMobileAuth(request, {
      kind: "staff",
      permission: "attendance.students",
    });
  } catch (error) {
    const response = mobileAuthResponse(error);
    if (response) return response;
    throw error;
  }

  const schoolId = context.claims.schoolId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "بيانات غير صحيحة" }, { status: 422 });
  }

  const template: CareReportInput = { ...parsed.data.report, studentId: "" };

  /**
   * Who filed it.
   *
   * `MobileContext` carries the claims, not the account row — `claims.sub` is
   * the user id. The staff record matters because a report is attributed to the
   * teacher, and the name is stored alongside so the feed still reads correctly
   * after that member of staff leaves.
   */
  const author = await prisma.user.findFirst({
    where: { id: context.claims.sub, schoolId },
    select: { name: true, teacherId: true },
  });

  // The list comes from a client. A report filed against another tenant's child
  // would be visible to that family.
  const students = await prisma.student.findMany({
    where: { id: { in: parsed.data.studentIds }, schoolId, deletedAt: null },
    select: { id: true, classId: true, anonymizedAt: true },
  });
  if (students.length === 0) {
    return Response.json({ error: "لا يوجد أطفال صالحون" }, { status: 404 });
  }

  // A record whose personal data has already been destroyed must not gain new
  // personal data. See docs/DATA_LIFECYCLE.md.
  const writable = students.filter((student) => !student.anonymizedAt);
  if (writable.length === 0) {
    return Response.json(
      { error: "السجلات مجهَّلة ولا يمكن إضافة تقارير لها" },
      { status: 409 }
    );
  }

  // Checked, not trusted: the upload route returns a key inside this school's
  // prefix, but nothing stops a caller posting a different one.
  if (template.photoUrl) {
    const key = keyFromUrl(template.photoUrl);
    if (!key || schoolIdFromKey(key) !== schoolId) {
      return Response.json({ error: "رابط الصورة غير صالح" }, { status: 422 });
    }
  }

  const occurredAt = template.occurredAt ? new Date(template.occurredAt) : new Date();
  if (Number.isNaN(occurredAt.getTime())) {
    return Response.json({ error: "التاريخ غير صحيح" }, { status: 422 });
  }

  const created: { id: string; studentId: string }[] = [];

  for (const student of writable) {
    const fields = buildReportFields({ ...template, studentId: student.id });
    // Nothing was filled in. Skipped rather than saved: a parent seeing an
    // empty "meal" entry assumes something was meant by it.
    if (!fields) continue;

    const report = await prisma.careReport.create({
      data: {
        schoolId,
        studentId: student.id,
        classId: student.classId,
        teacherId: author?.teacherId ?? null,
        reportedByName: author?.name ?? "الطاقم",
        occurredAt,
        // `buildReportFields` returns only the columns this type owns; the type
        // itself is written separately, exactly as the dashboard does.
        type: template.type,
        ...fields,
      },
      select: { id: true, studentId: true },
    });
    created.push(report);
  }

  if (created.length === 0) {
    return Response.json({ error: "لم تُدخلي أي تفاصيل" }, { status: 422 });
  }

  return Response.json({ created: created.length, reports: created }, { status: 201 });
}
