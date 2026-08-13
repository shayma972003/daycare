import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { generatePaymentCycles } from "@/lib/payment-cycles";
import { formatAst } from "@/lib/datetime";
import { z } from "zod";
import { bulkSummary, type BulkItemResult } from "@/lib/bulk-result";

const schema = z.object({
  // Capped like bulk-status: each id triggers a payment-cycle regeneration, so
  // an unbounded list is a request that runs until the function times out.
  ids: z.array(z.string()).min(1).max(500),
  enrollmentEndDate: z.string().min(1),
});

export async function POST(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    // 403 when the caller is known but lacks the permission; 401 otherwise.
    return (
      sessionErrorResponse(error) ??
      Response.json({ error: "Unauthorized" }, { status: 401 })
    );
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "بيانات غير صحيحة" }, { status: 400 });
  }

  const { ids, enrollmentEndDate } = parsed.data;
  const newDate = new Date(enrollmentEndDate);
  if (isNaN(newDate.getTime())) {
    return Response.json({ error: "تاريخ غير صحيح" }, { status: 400 });
  }

  const students = await prisma.student.findMany({
    where: { id: { in: ids }, schoolId, deletedAt: null },
    select: { id: true, name: true },
  });

  if (students.length === 0) {
    return Response.json({ error: "لا يوجد طلاب صالحين" }, { status: 400 });
  }

  const results: BulkItemResult[] = ids
    .filter((id) => !students.some((student) => student.id === id))
    .map((id) => ({ id, status: "failed", code: "NOT_FOUND" }));
  for (const student of students) {
    try {
      await prisma.$transaction(async (tx) => {
        const updated = await tx.student.updateMany({ where: { id: student.id, schoolId, deletedAt: null }, data: { enrollmentEndDate: newDate } });
        if (updated.count !== 1) throw new Error("student_not_available");
        await generatePaymentCycles(student.id, tx);
      });
      results.push({ id: student.id, status: "succeeded" });
    } catch {
      results.push({ id: student.id, status: "failed", code: "UPDATE_FAILED" });
    }
  }
  const summary = bulkSummary(results);

  await logAction({
    school_id: schoolId,
    // `toLocaleDateString("ar-SA")` defaults to the Islamic calendar, so this
    // line recorded a Hijri date while every other date in the product is
    // Gregorian — the same defect fixed in task 0.68.
    action: `تمديد تاريخ الاشتراك لـ ${students.length} طالب حتى ${formatAst(newDate, {
      year: "numeric",
      month: "long",
      day: "numeric",
    })}`,
    entity_type: "student",
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json({ success: summary.failed === 0, updated: summary.succeeded, ...summary }, { status: summary.failed ? 207 : 200 });
}
