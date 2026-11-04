import { normalizePhone } from './phone-normalizer';
import type { ImportRowIssue, ImportRowPayload } from './import-row-payload';
import { normalizeEducationLevel, normalizeEmployeeJobTitle } from './employee-role-options';

export type ImportMappingEntry = {
  uploadedColumn: string;
  mappedField: string | null;
};

function parseExcelDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return new Date((value - 25569) * 86400 * 1000);
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function applyImportMapping(
  rawData: Record<string, unknown>,
  mapping: ImportMappingEntry[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const entry of mapping) {
    if (entry.mappedField) result[entry.mappedField] = rawData[entry.uploadedColumn];
  }
  return result;
}

export function validateImportRow(
  payload: ImportRowPayload,
  mapping: ImportMappingEntry[],
  type: 'students' | 'teachers',
  duplicateRowNumber?: number
): { mappedData: Record<string, unknown>; errors: ImportRowIssue[]; warnings: ImportRowIssue[] } {
  const mapped = applyImportMapping(payload.rawData, mapping);
  const errors: ImportRowIssue[] = [];
  const warnings: ImportRowIssue[] = [];
  const isStudent = type === 'students';
  const name = String(mapped.full_name ?? '').trim();

  if (!name) {
    errors.push({
      field: 'full_name',
      message: isStudent ? 'اسم الطالب مطلوب' : 'اسم الموظف مطلوب',
      type: 'error',
    });
  }

  if (mapped.date_of_birth !== undefined && mapped.date_of_birth !== null && mapped.date_of_birth !== '') {
    const dateOfBirth = parseExcelDate(mapped.date_of_birth);
    if (!dateOfBirth) {
      warnings.push({ field: 'date_of_birth', message: 'تاريخ الميلاد غير صحيح', type: 'warning' });
    } else {
      if (isStudent) {
        const ageYears = (Date.now() - dateOfBirth.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
        if (ageYears < 1 || ageYears > 10) {
          warnings.push({ field: 'date_of_birth', message: 'تاريخ الميلاد غير صحيح', type: 'warning' });
        }
      }
      mapped.date_of_birth = dateOfBirth.toISOString();
    }
  }

  const phone1Field = isStudent ? 'guardian_phone_1' : 'phone_1';
  if (mapped[phone1Field] !== undefined && mapped[phone1Field] !== null && mapped[phone1Field] !== '') {
    const normalized = normalizePhone(mapped[phone1Field] as string | number);
    if (!normalized) {
      errors.push({ field: phone1Field, message: 'رقم الجوال غير صحيح', type: 'error' });
    } else {
      mapped[phone1Field] = normalized;
    }
  }

  const optionalPhoneFields = isStudent
    ? ['guardian_phone_2', 'guardian_phone_3', 'guardian_phone_4']
    : ['phone_2'];
  for (const phoneField of optionalPhoneFields) {
    if (mapped[phoneField] !== undefined && mapped[phoneField] !== null && mapped[phoneField] !== '') {
      const normalized = normalizePhone(mapped[phoneField] as string | number);
      if (normalized) mapped[phoneField] = normalized;
      else mapped[phoneField] = null;
    }
  }

  const emailField = isStudent ? 'guardian_email' : 'email';
  if (mapped[emailField] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(mapped[emailField]))) {
    warnings.push({ field: emailField, message: 'البريد الإلكتروني غير صحيح', type: 'warning' });
  }

  if (!isStudent && mapped.job_title !== undefined && mapped.job_title !== null && mapped.job_title !== '') {
    const jobTitle = normalizeEmployeeJobTitle(String(mapped.job_title));
    if (!jobTitle) {
      warnings.push({ field: 'job_title', message: 'المسمى الوظيفي غير معروف وسيحتاج تعبئة يدوية', type: 'warning' });
      mapped.job_title = null;
    } else {
      mapped.job_title = jobTitle;
    }
  }

  if (!isStudent && mapped.education_level !== undefined && mapped.education_level !== null && mapped.education_level !== '') {
    const educationLevel = normalizeEducationLevel(String(mapped.education_level));
    if (!educationLevel) {
      warnings.push({ field: 'education_level', message: 'المستوى التعليمي غير معروف وسيحتاج تعبئة يدوية', type: 'warning' });
      mapped.education_level = null;
    } else {
      mapped.education_level = educationLevel;
    }
  }

  if (!isStudent && mapped.monthly_salary !== undefined && mapped.monthly_salary !== null && mapped.monthly_salary !== '') {
    const salary = Number(mapped.monthly_salary);
    if (Number.isNaN(salary) || salary <= 0) {
      warnings.push({ field: 'monthly_salary', message: 'الراتب الشهري يجب أن يكون رقماً موجباً', type: 'warning' });
    }
  }

  if (duplicateRowNumber !== undefined) {
    warnings.push({
      field: 'full_name',
      message: `صف مكرر محتمل مع الصف رقم ${duplicateRowNumber}`,
      type: 'warning',
    });
  }

  return { mappedData: mapped, errors, warnings };
}
