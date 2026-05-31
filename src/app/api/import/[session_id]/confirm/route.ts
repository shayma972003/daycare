import { requireSession } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { normalizePhone } from '@/lib/phone-normalizer';

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

export async function POST(_req: Request, { params }: { params: Promise<{ session_id: string }> }) {
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
  let duplicateGuardiansReused = 0;

  try {
    await prisma.$transaction(async (tx) => {
      // Guardian cache for this import session (phone -> id)
      const guardianCache = new Map<string, string>();

      for (const row of validRows) {
        const data = row.mapped_data as Record<string, unknown>;

        if (importSession.type === 'students') {
          let guardianId: string | null = null;
          const guardianName = String(data.guardian_name ?? '').trim();
          const phone1 = data.guardian_phone_1 ? normalizePhone(data.guardian_phone_1 as string) : null;
          const phone2 = data.guardian_phone_2 ? normalizePhone(data.guardian_phone_2 as string) : null;
          const guardianEmail = data.guardian_email ? String(data.guardian_email).trim() : null;

          if (guardianName || phone1) {
            // Check in-session cache
            const cacheKey = phone1 ?? guardianEmail ?? guardianName;
            if (cacheKey && guardianCache.has(cacheKey)) {
              guardianId = guardianCache.get(cacheKey)!;
              duplicateGuardiansReused++;
            } else {
              // Check existing DB guardians
              const conditions: object[] = [];
              if (phone1) conditions.push({ phone1 });
              if (guardianEmail) conditions.push({ email: guardianEmail });

              const existing = conditions.length > 0
                ? await tx.guardian.findFirst({ where: { schoolId, OR: conditions } })
                : null;

              if (existing) {
                guardianId = existing.id;
                duplicateGuardiansReused++;
              } else {
                const created = await tx.guardian.create({
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

          // Map period
          const periodMap: Record<string, string> = { صباحي: 'MORNING', مسائي: 'EVENING', morning: 'MORNING', evening: 'EVENING', MORNING: 'MORNING', EVENING: 'EVENING' };
          const rawPeriod = String(data.period ?? '').trim();
          const period = periodMap[rawPeriod] ?? 'MORNING';

          // Map gender
          const genderMap: Record<string, string> = { ذكر: 'MALE', أنثى: 'FEMALE', male: 'MALE', female: 'FEMALE', MALE: 'MALE', FEMALE: 'FEMALE' };
          const rawGender = String(data.gender ?? '').trim();
          const gender = genderMap[rawGender] ?? 'MALE';

          // Map payment method
          const payMap: Record<string, string> = { نقدي: 'CASH', تحويل: 'TRANSFER', بطاقة: 'CARD', cash: 'CASH', transfer: 'TRANSFER', card: 'CARD', CASH: 'CASH', TRANSFER: 'TRANSFER', CARD: 'CARD' };
          const rawPay = String(data.payment_method ?? '').trim();
          const paymentMethod = payMap[rawPay] ?? 'CASH';

          await tx.student.create({
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
              enrollmentEndDate: parseDate(data.enrollment_end_date),
              paymentMethod: paymentMethod as 'CASH' | 'TRANSFER' | 'CARD',
              registration_fee: 0,
            },
          });
        } else {
          // Teacher import
          const periodMap: Record<string, string> = { صباحي: 'MORNING', مسائي: 'EVENING', morning: 'MORNING', evening: 'EVENING', MORNING: 'MORNING', EVENING: 'EVENING' };
          const rawPeriod = String(data.period ?? '').trim();
          const period = periodMap[rawPeriod] ?? 'MORNING';

          const salary = data.monthly_salary ? Number(data.monthly_salary) : 0;
          const deductionRate = data.late_deduction_rate ? Number(data.late_deduction_rate) : 0;

          await tx.teacher.create({
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

        await tx.importRow.update({ where: { id: row.id }, data: { status: 'imported' } });
        importedCount++;
      }

      // Mark error rows as skipped
      for (const row of errorRows) {
        await tx.importRow.update({ where: { id: row.id }, data: { status: 'skipped' } });
      }
    });

    await prisma.importSession.update({
      where: { id: session_id },
      data: {
        status: 'completed',
        completed_at: new Date(),
        duplicate_guardians_reused: duplicateGuardiansReused,
      },
    });

    return Response.json({
      imported: importedCount,
      skipped: errorRows.length,
      duplicate_guardians_reused: duplicateGuardiansReused,
    }, { status: 200 });
  } catch (error) {
    console.error('Import confirm error:', error);
    return Response.json({ error: 'فشل الاستيراد', details: String(error) }, { status: 500 });
  }
}
