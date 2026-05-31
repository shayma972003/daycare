import { requireSession } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { normalizePhone } from '@/lib/phone-normalizer';

type MappingEntry = {
  uploadedColumn: string;
  mappedField: string | null;
};

type RowError = { field: string; message: string; type: 'error' | 'warning' };

function parseExcelDate(val: unknown): Date | null {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') {
    return new Date((val - 25569) * 86400 * 1000);
  }
  const d = new Date(String(val));
  return isNaN(d.getTime()) ? null : d;
}

function applyMapping(rawData: Record<string, unknown>, mapping: MappingEntry[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const entry of mapping) {
    if (!entry.mappedField) continue;
    result[entry.mappedField] = rawData[entry.uploadedColumn];
  }
  return result;
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

  const mapping = (importSession.column_mapping as MappingEntry[]) ?? [];

  // For duplicate detection: track name+phone combos
  const seenKeys = new Map<string, number>(); // key -> row_number

  const updates: Array<{
    id: string;
    mappedData: Record<string, unknown>;
    errors: RowError[];
    warnings: RowError[];
    status: string;
  }> = [];

  for (const row of importSession.rows) {
    const rawData = row.raw_data as Record<string, unknown>;
    const mapped = applyMapping(rawData, mapping);
    const errors: RowError[] = [];
    const warnings: RowError[] = [];
    const isStudent = importSession.type === 'students';

    // Validate full_name
    const name = String(mapped.full_name ?? '').trim();
    if (!name) {
      errors.push({ field: 'full_name', message: isStudent ? 'اسم الطالب مطلوب' : 'اسم المعلم مطلوب', type: 'error' });
    }

    // Validate date_of_birth
    if (mapped.date_of_birth !== undefined && mapped.date_of_birth !== null && mapped.date_of_birth !== '') {
      const dob = parseExcelDate(mapped.date_of_birth);
      if (!dob) {
        warnings.push({ field: 'date_of_birth', message: 'تاريخ الميلاد غير صحيح', type: 'warning' });
      } else if (isStudent) {
        const ageMs = Date.now() - dob.getTime();
        const ageYears = ageMs / (365.25 * 24 * 60 * 60 * 1000);
        if (ageYears < 1 || ageYears > 10) {
          warnings.push({ field: 'date_of_birth', message: 'تاريخ الميلاد غير صحيح', type: 'warning' });
        }
        mapped.date_of_birth = dob.toISOString();
      } else {
        mapped.date_of_birth = dob.toISOString();
      }
    }

    // Normalize phone fields
    const phone1Field = isStudent ? 'guardian_phone_1' : 'phone_1';
    if (mapped[phone1Field] !== undefined && mapped[phone1Field] !== null && mapped[phone1Field] !== '') {
      const normalized = normalizePhone(mapped[phone1Field] as string | number);
      if (!normalized) {
        errors.push({ field: phone1Field, message: `رقم الجوال غير صحيح: ${mapped[phone1Field]}`, type: 'error' });
      } else {
        mapped[phone1Field] = normalized;
      }
    }

    const phone2Field = isStudent ? 'guardian_phone_2' : 'phone_2';
    if (mapped[phone2Field] !== undefined && mapped[phone2Field] !== null && mapped[phone2Field] !== '') {
      const normalized = normalizePhone(mapped[phone2Field] as string | number);
      if (normalized) mapped[phone2Field] = normalized;
    }

    // Validate email
    const emailField = isStudent ? 'guardian_email' : 'email';
    if (mapped[emailField]) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(String(mapped[emailField]))) {
        warnings.push({ field: emailField, message: 'البريد الإلكتروني غير صحيح', type: 'warning' });
      }
    }

    // Teacher: monthly_salary must be positive number
    if (!isStudent && mapped.monthly_salary !== undefined && mapped.monthly_salary !== null && mapped.monthly_salary !== '') {
      const salary = Number(mapped.monthly_salary);
      if (isNaN(salary) || salary <= 0) {
        warnings.push({ field: 'monthly_salary', message: 'الراتب الشهري يجب أن يكون رقماً موجباً', type: 'warning' });
      }
    }

    // Duplicate detection within file
    if (name) {
      const phone1Val = String(mapped[phone1Field] ?? '').trim();
      const dupKey = `${name.toLowerCase()}|${phone1Val}`;
      if (seenKeys.has(dupKey)) {
        warnings.push({ field: 'full_name', message: `صف مكرر محتمل مع الصف رقم ${seenKeys.get(dupKey)}`, type: 'warning' });
      } else {
        seenKeys.set(dupKey, row.row_number);
      }
    }

    const hasErrors = errors.length > 0;
    updates.push({
      id: row.id,
      mappedData: mapped,
      errors,
      warnings,
      status: hasErrors ? 'error' : 'valid',
    });
  }

  // Batch update rows
  await Promise.all(updates.map((u) =>
    prisma.importRow.update({
      where: { id: u.id },
      data: {
        mapped_data: u.mappedData as object,
        errors: u.errors as object[],
        warnings: u.warnings as object[],
        status: u.status,
      },
    })
  ));

  const validCount = updates.filter((u) => u.status === 'valid').length;
  const errorCount = updates.filter((u) => u.status === 'error').length;

  await prisma.importSession.update({
    where: { id: session_id },
    data: { status: 'validated', valid_rows: validCount, error_rows: errorCount },
  });

  return Response.json({ valid_rows: validCount, error_rows: errorCount }, { status: 200 });
}
