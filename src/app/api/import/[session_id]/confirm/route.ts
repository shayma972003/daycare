import { requireSession } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { normalizePhone } from '@/lib/phone-normalizer';
import { logAction } from '@/lib/activity-logger';

function parseDate(val: unknown): Date | null {
  if (val === null || val === undefined || val === '') return null;
  // Excel serial date (number)
  if (typeof val === 'number') {
    const d = new Date((val - 25569) * 86400 * 1000);
    return isNaN(d.getTime()) ? null : d;
  }
  const s = String(val).trim();
  if (!s) return null;
  // Already an ISO string from validate step
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

const PERIOD_MAP: Record<string, string> = { صباحي: 'MORNING', مسائي: 'EVENING', morning: 'MORNING', evening: 'EVENING', MORNING: 'MORNING', EVENING: 'EVENING' };
const GENDER_MAP: Record<string, string> = { ذكر: 'MALE', أنثى: 'FEMALE', male: 'MALE', female: 'FEMALE', MALE: 'MALE', FEMALE: 'FEMALE' };
const PAY_MAP: Record<string, string> = { نقدي: 'CASH', تحويل: 'TRANSFER', بطاقة: 'CARD', cash: 'CASH', transfer: 'TRANSFER', card: 'CARD', CASH: 'CASH', TRANSFER: 'TRANSFER', CARD: 'CARD' };

export async function POST(req: Request, { params }: { params: Promise<{ session_id: string }> }) {
  let session;
  try { session = await requireSession(); } catch {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;
  const { session_id } = await params;

  const importSession = await prisma.importSession.findFirst({
    where: { id: session_id, school_id: schoolId },
    include: { rows: { orderBy: { row_number: 'asc' } } },
  });
  if (!importSession) return Response.json({ error: 'Not found' }, { status: 404 });

  const validRows = importSession.rows.filter((r) => r.status === 'valid');
  const errorRows = importSession.rows.filter((r) => r.status === 'error');

  let importedCount = 0;
  let failedCount = 0;
  let duplicateGuardiansReused = 0;
  // In-memory guardian cache for this import session (phone/email/name -> id) — avoids
  // re-querying the DB for guardians shared across siblings within the same file.
  const guardianCache = new Map<string, string>();

  // Process rows sequentially, without a single all-or-nothing transaction: a large file
  // can take much longer than Prisma's default interactive-transaction timeout (5s), which
  // previously caused the whole import to fail with a P2028 timeout in production. Each row
  // now commits independently, so one bad row only fails that row.
  for (const row of validRows) {
    try {
      const data = row.mapped_data as Record<string, unknown>;

      if (importSession.type === 'students') {
        let guardianId: string | null = null;
        const guardianName = String(data.guardian_name ?? '').trim();
        const phone1 = data.guardian_phone_1 ? normalizePhone(data.guardian_phone_1 as string) : null;
        const phone2 = data.guardian_phone_2 ? normalizePhone(data.guardian_phone_2 as string) : null;
        const guardianEmail = data.guardian_email ? String(data.guardian_email).trim() : null;

        if (guardianName || phone1) {
          const cacheKey = phone1 ?? guardianEmail ?? guardianName;
          if (cacheKey && guardianCache.has(cacheKey)) {
            guardianId = guardianCache.get(cacheKey)!;
            duplicateGuardiansReused++;
          } else {
            const conditions: object[] = [];
            if (phone1) conditions.push({ phone1 });
            if (guardianEmail) conditions.push({ email: guardianEmail });

            const existing = conditions.length > 0
              ? await prisma.guardian.findFirst({ where: { schoolId, OR: conditions } })
              : null;

            if (existing) {
              guardianId = existing.id;
              duplicateGuardiansReused++;
            } else {
              const created = await prisma.guardian.create({
                data: {
                  schoolId,
                  name: guardianName || 'غير محدد',
                  phone1,
                  phone2,
                  email: guardianEmail,
                },
              });
              guardianId = created.id;
            }

            if (cacheKey) guardianCache.set(cacheKey, guardianId);
          }
        }

        const period = PERIOD_MAP[String(data.period ?? '').trim()] ?? 'MORNING';
        const gender = GENDER_MAP[String(data.gender ?? '').trim()] ?? 'MALE';
        const paymentMethod = PAY_MAP[String(data.payment_method ?? '').trim()] ?? 'CASH';

        await prisma.student.create({
          data: {
            schoolId,
            name: String(data.full_name).trim(),
            guardianId,
            idNumber: data.id_number ? String(data.id_number).trim() : null,
            dateOfBirth: parseDate(data.date_of_birth),
            gender: gender as 'MALE' | 'FEMALE',
            nationality: data.nationality ? String(data.nationality).trim() : null,
            healthCondition: data.health_condition ? String(data.health_condition).trim() : null,
            allergies: data.allergies ? String(data.allergies).trim() : null,
            academicStage: data.academic_stage ? String(data.academic_stage).trim() : null,
            period: period as 'MORNING' | 'EVENING',
            registrationDate: parseDate(data.registration_date) ?? new Date(),
            enrollment_date: parseDate(data.enrollment_date),
            enrollmentEndDate: parseDate(data.enrollment_end_date),
            paymentMethod: paymentMethod as 'CASH' | 'TRANSFER' | 'CARD',
            attendanceType: data.attendance_type ? String(data.attendance_type).trim() : 'دوام منتظم',
            paymentStatus: data.payment_status ? String(data.payment_status).trim() : 'بانتظار الدفع',
            registration_fee: 0,
          },
        });
      } else {
        // Teacher import
        const period = PERIOD_MAP[String(data.period ?? '').trim()] ?? 'MORNING';
        const salary = data.monthly_salary ? Number(data.monthly_salary) : 0;
        const deductionRate = data.late_deduction_rate ? Number(data.late_deduction_rate) : 0;

        await prisma.teacher.create({
          data: {
            schoolId,
            name: String(data.full_name).trim(),
            idNumber: data.id_number ? String(data.id_number).trim() : null,
            dateOfBirth: data.date_of_birth ? new Date(data.date_of_birth as string) : null,
            nationality: data.nationality ? String(data.nationality).trim() : null,
            email: data.email ? String(data.email).trim() : null,
            phone1: data.phone_1 ? String(data.phone_1).trim() : null,
            phone2: data.phone_2 ? String(data.phone_2).trim() : null,
            period: period as 'MORNING' | 'EVENING',
            monthlySalary: isNaN(salary) ? 0 : salary,
            lateDeductionRate: isNaN(deductionRate) ? 0 : deductionRate,
            qualification1: data.qualification_1 ? String(data.qualification_1).trim() : null,
            joinDate: data.join_date ? new Date(data.join_date as string) : new Date(),
          },
        });
      }

      await prisma.importRow.update({ where: { id: row.id }, data: { status: 'imported' } });
      importedCount++;
    } catch (rowError) {
      console.error(`Import row ${row.row_number} failed:`, rowError);
      failedCount++;
      try {
        await prisma.importRow.update({
          where: { id: row.id },
          data: { status: 'skipped', errors: [{ message: String(rowError) }] },
        });
      } catch { /* best-effort row status update */ }
    }
  }

  // Mark rows that failed validation as skipped
  for (const row of errorRows) {
    await prisma.importRow.update({ where: { id: row.id }, data: { status: 'skipped' } }).catch(() => {});
  }

  await prisma.importSession.update({
    where: { id: session_id },
    data: {
      status: 'completed',
      completed_at: new Date(),
      duplicate_guardians_reused: duplicateGuardiansReused,
    },
  });

  await logAction({
    school_id: schoolId,
    action: importSession.type === 'students'
      ? `تأكيد استيراد الطلاب: ${importedCount} طالب مستورد`
      : `تأكيد استيراد المعلمين: ${importedCount} معلم مستورد`,
    entity_type: 'import',
    entity_id: session_id,
    performed_by: session.user.name ?? 'المدير',
    request: req,
  });

  return Response.json({
    imported: importedCount,
    skipped: errorRows.length + failedCount,
    duplicate_guardians_reused: duplicateGuardiansReused,
  }, { status: 200 });
}
