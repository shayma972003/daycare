import { requireSession, sessionErrorResponse } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { parseAcademicStage, parsePaymentStatus } from '@/lib/enum-labels';
import { normalizePhone } from '@/lib/phone-normalizer';
import { logAction } from '@/lib/activity-logger';
import { protectIdNumber } from '@/lib/pii-crypto';
import {
  clearedImportRowPayload,
  lockImportRow,
  protectedImportRowPayload,
  revealImportRowPayload,
  updateImportRowPayload,
} from '@/lib/import-row-payload';

function parseDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    const parsed = new Date((value - 25569) * 86400 * 1000);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(String(value).trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const PERIOD_MAP: Record<string, string> = { صباحي: 'MORNING', مسائي: 'EVENING', morning: 'MORNING', evening: 'EVENING', MORNING: 'MORNING', EVENING: 'EVENING' };
const GENDER_MAP: Record<string, string> = { ذكر: 'MALE', أنثى: 'FEMALE', male: 'MALE', female: 'FEMALE', MALE: 'MALE', FEMALE: 'FEMALE' };
const PAY_MAP: Record<string, string> = { نقدي: 'CASH', تحويل: 'TRANSFER', بطاقة: 'CARD', cash: 'CASH', transfer: 'TRANSFER', card: 'CARD', CASH: 'CASH', TRANSFER: 'TRANSFER', CARD: 'CARD' };

export async function POST(req: Request, { params }: { params: Promise<{ session_id: string }> }) {
  let session;
  try { session = await requireSession(); } catch (error) {
    return sessionErrorResponse(error) ?? Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!session.can('students.manage')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  const schoolId = session.user.schoolId;
  const { session_id: sessionId } = await params;

  const claimed = await prisma.importSession.updateMany({
    where: {
      id: sessionId,
      school_id: schoolId,
      status: 'validated',
      expires_at: { gt: new Date() },
    },
    data: { status: 'confirming' },
  });
  if (claimed.count !== 1) {
    const existing = await prisma.importSession.findFirst({
      where: { id: sessionId, school_id: schoolId },
      select: { status: true, expires_at: true },
    });
    if (!existing) return Response.json({ error: 'Not found' }, { status: 404 });
    if (existing.expires_at <= new Date()) return Response.json({ error: 'Import session expired' }, { status: 410 });
    return Response.json({ error: 'Import session cannot be confirmed' }, { status: 409 });
  }

  try {
  const importSession = await prisma.importSession.findFirst({
    where: { id: sessionId, school_id: schoolId },
    include: { rows: { orderBy: { row_number: 'asc' }, select: { id: true, status: true } } },
  });
  if (!importSession) return Response.json({ error: 'Not found' }, { status: 404 });

  let importedCount = 0;
  let failedCount = 0;
  let duplicateGuardiansReused = 0;

  for (const listedRow of importSession.rows.filter((row) => row.status === 'valid')) {
    try {
      const rowResult = await prisma.$transaction(async (tx) => {
        if (!(await lockImportRow(tx, listedRow.id))) {
          return { imported: false, reusedGuardian: false };
        }
        const row = await tx.importRow.findFirst({
          where: {
            id: listedRow.id,
            session_id: sessionId,
            status: 'valid',
            session: { school_id: schoolId, status: 'confirming', expires_at: { gt: new Date() } },
          },
        });
        if (!row) return { imported: false, reusedGuardian: false };
        const payload = revealImportRowPayload(row);
        if (!payload.mappedData) throw new Error('Mapped import data is unavailable');
        const data = payload.mappedData;
        let reusedGuardian = false;

        if (importSession.type === 'students') {
          let guardianId: string | null = null;
          const guardianName = String(data.guardian_name ?? '').trim();
          const phone1 = data.guardian_phone_1 ? normalizePhone(data.guardian_phone_1 as string) : null;
          const phone2 = data.guardian_phone_2 ? normalizePhone(data.guardian_phone_2 as string) : null;
          const guardianEmail = data.guardian_email ? String(data.guardian_email).trim() : null;
          if (guardianName || phone1) {
            const conditions: object[] = [];
            if (phone1) conditions.push({ phone1 });
            if (guardianEmail) conditions.push({ email: guardianEmail });
            const existing = conditions.length > 0
              ? await tx.guardian.findFirst({ where: { schoolId, OR: conditions } })
              : null;
            if (existing) {
              guardianId = existing.id;
              reusedGuardian = true;
            } else {
              guardianId = (await tx.guardian.create({
                data: { schoolId, name: guardianName || 'غير محدد', phone1, phone2, email: guardianEmail },
              })).id;
            }
          }

          await tx.student.create({
            data: {
              schoolId,
              name: String(data.full_name).trim(),
              guardianId,
              ...protectIdNumber(data.id_number ? String(data.id_number) : null),
              dateOfBirth: parseDate(data.date_of_birth),
              gender: (GENDER_MAP[String(data.gender ?? '').trim()] ?? 'MALE') as 'MALE' | 'FEMALE',
              nationality: data.nationality ? String(data.nationality).trim() : null,
              healthCondition: data.health_condition ? String(data.health_condition).trim() : null,
              allergies: data.allergies ? String(data.allergies).trim() : null,
              academicStage: parseAcademicStage(data.academic_stage ? String(data.academic_stage) : null),
              period: (PERIOD_MAP[String(data.period ?? '').trim()] ?? 'MORNING') as 'MORNING' | 'EVENING',
              registrationDate: parseDate(data.registration_date) ?? new Date(),
              enrollment_date: parseDate(data.enrollment_date),
              enrollmentEndDate: parseDate(data.enrollment_end_date),
              paymentMethod: (PAY_MAP[String(data.payment_method ?? '').trim()] ?? 'CASH') as 'CASH' | 'TRANSFER' | 'CARD',
              paymentStatus: parsePaymentStatus(data.payment_status ? String(data.payment_status) : null) ?? 'PENDING',
              registration_fee: 0,
            },
          });
        } else {
          const salary = data.monthly_salary ? Number(data.monthly_salary) : 0;
          const deductionRate = data.late_deduction_rate ? Number(data.late_deduction_rate) : 0;
          await tx.teacher.create({
            data: {
              schoolId,
              name: String(data.full_name).trim(),
              ...protectIdNumber(data.id_number ? String(data.id_number) : null),
              dateOfBirth: parseDate(data.date_of_birth),
              nationality: data.nationality ? String(data.nationality).trim() : null,
              email: data.email ? String(data.email).trim() : null,
              phone1: data.phone_1 ? String(data.phone_1).trim() : null,
              phone2: data.phone_2 ? String(data.phone_2).trim() : null,
              period: (PERIOD_MAP[String(data.period ?? '').trim()] ?? 'MORNING') as 'MORNING' | 'EVENING',
              monthlySalary: Number.isNaN(salary) ? 0 : salary,
              lateDeductionRate: Number.isNaN(deductionRate) ? 0 : deductionRate,
              qualification1: data.qualification_1 ? String(data.qualification_1).trim() : null,
              joinDate: parseDate(data.join_date) ?? new Date(),
            },
          });
        }

        await tx.importRow.update({
          where: { id: row.id },
          data: { status: 'imported', ...clearedImportRowPayload() },
        });
        return { imported: true, reusedGuardian };
      }, { timeout: 15_000 });

      if (rowResult.imported) {
        importedCount += 1;
        if (rowResult.reusedGuardian) duplicateGuardiansReused += 1;
      }
    } catch {
      failedCount += 1;
      // Keep the encrypted staged data available until expiry; only a generic,
      // non-PII error is added. The row can be validated and retried later.
      await prisma.$transaction(async (tx) => {
        if (!(await lockImportRow(tx, listedRow.id))) return;
        const current = await tx.importRow.findFirst({
          where: { id: listedRow.id, session_id: sessionId, status: 'valid' },
        });
        if (!current) return;
        const payload = revealImportRowPayload(current);
        await tx.importRow.update({
          where: { id: current.id },
          data: {
            status: 'skipped',
            ...protectedImportRowPayload(updateImportRowPayload(payload, {
              errors: [{ message: 'تعذر استيراد هذا الصف', type: 'error' }],
            })),
          },
        });
      }, { timeout: 10_000 }).catch(() => undefined);
    }
  }

  await prisma.importRow.updateMany({
    where: { session_id: sessionId, status: 'error' },
    data: { status: 'skipped' },
  });
  await prisma.importSession.updateMany({
    where: { id: sessionId, school_id: schoolId, status: 'confirming' },
    data: {
      status: 'completed',
      completed_at: new Date(),
      duplicate_guardians_reused: duplicateGuardiansReused,
      valid_rows: importedCount,
      error_rows: importSession.rows.filter((row) => row.status === 'error').length + failedCount,
    },
  });

  await logAction({
    school_id: schoolId,
    action: importSession.type === 'students'
      ? `تأكيد استيراد الطلاب: ${importedCount} طالب مستورد`
      : `تأكيد استيراد المعلمين: ${importedCount} معلم مستورد`,
    entity_type: 'import',
    entity_id: sessionId,
    performed_by: session.user.name ?? 'المدير',
    request: req,
  });

  return Response.json({
    imported: importedCount,
    skipped: importSession.rows.filter((row) => row.status === 'error').length + failedCount,
    duplicate_guardians_reused: duplicateGuardiansReused,
  }, { status: 200 });
  } catch {
    await prisma.importSession.updateMany({
      where: { id: sessionId, school_id: schoolId, status: 'confirming' },
      data: { status: 'validated' },
    }).catch(() => undefined);
    return Response.json({ error: 'Import confirmation failed' }, { status: 500 });
  }
}
