import Fuse from 'fuse.js';

export const STUDENT_FIELD_ALIASES: Record<string, string[]> = {
  full_name: ['student', 'child', 'child name', 'kid', 'name', 'student name', 'اسم الطفل', 'الطالب', 'اسم الطالب', 'الاسم', 'اسم الطالب الكامل', 'الاسم الكامل'],
  date_of_birth: ['dob', 'birth', 'birthday', 'birth date', 'birthdate', 'تاريخ الميلاد', 'الميلاد', 'تاريخ الولادة'],
  gender: ['gender', 'sex', 'الجنس', 'النوع'],
  nationality: ['nationality', 'nation', 'country', 'الجنسية', 'البلد'],
  id_number: ['id', 'national id', 'iqama', 'id number', 'student id', 'رقم الهوية', 'الهوية', 'رقم الإقامة', 'الإقامة', 'رقم الهوية/الإقامة'],
  health_condition: ['health', 'health condition', 'medical', 'الحالة الصحية', 'الصحة', 'الحالة الطبية'],
  allergies: ['allergy', 'allergies', 'alerts', 'sensitivities', 'الحساسية', 'التنبيهات', 'الحساسية والتنبيهات'],
  academic_stage: ['stage', 'grade', 'level', 'class group', 'kg', 'المرحلة', 'المرحلة الدراسية', 'الصف', 'المستوى'],
  period: ['period', 'shift', 'time', 'الفترة', 'الدوام', 'الوقت'],
  registration_date: ['registration', 'reg date', 'enrolled', 'enrollment date', 'join date', 'تاريخ التسجيل', 'التسجيل', 'تاريخ الالتحاق'],
  enrollment_end_date: ['end date', 'expiry', 'subscription end', 'enrollment end', 'تاريخ انتهاء الاشتراك', 'انتهاء الاشتراك', 'تاريخ الانتهاء'],
  payment_method: ['payment', 'payment method', 'pay method', 'طريقة الدفع', 'الدفع', 'وسيلة الدفع'],
  guardian_name: ['parent', 'guardian', 'parent name', 'guardian name', 'father', 'mother', 'ولي الأمر', 'اسم ولي الأمر', 'الوالد', 'الوالدة', 'الأب', 'الأم'],
  guardian_phone_1: ['phone', 'mobile', 'parent phone', 'guardian phone', 'phone 1', 'phone1', 'رقم الجوال', 'جوال ولي الامر', 'الجوال', 'رقم الجوال 1', 'جوال 1'],
  guardian_phone_2: ['phone 2', 'phone2', 'mobile 2', 'secondary phone', 'alternate phone', 'رقم الجوال 2', 'جوال 2', 'الجوال الثاني'],
  guardian_email: ['email', 'parent email', 'guardian email', 'mail', 'البريد الإلكتروني', 'الإيميل', 'البريد'],
};

export const TEACHER_FIELD_ALIASES: Record<string, string[]> = {
  full_name: ['teacher name', 'name', 'employee', 'اسم المعلم', 'الاسم', 'اسم الموظف', 'الاسم الكامل'],
  id_number: ['id', 'national id', 'iqama', 'رقم الهوية', 'الهوية', 'رقم الإقامة'],
  date_of_birth: ['dob', 'birth date', 'تاريخ الميلاد', 'الميلاد'],
  nationality: ['nationality', 'الجنسية'],
  email: ['email', 'mail', 'البريد الإلكتروني', 'الإيميل'],
  phone_1: ['phone', 'mobile', 'رقم الجوال', 'الجوال', 'رقم الجوال 1'],
  phone_2: ['phone 2', 'mobile 2', 'رقم الجوال 2', 'جوال 2'],
  period: ['period', 'shift', 'الفترة', 'الدوام'],
  monthly_salary: ['salary', 'monthly salary', 'الراتب', 'الراتب الشهري'],
  late_deduction_rate: ['deduction', 'late deduction', 'خصم التأخير', 'الخصم'],
  join_date: ['join date', 'start date', 'تاريخ الانضمام', 'تاريخ البدء'],
  qualification_1: ['qualification', 'degree', 'المؤهل', 'المؤهل 1', 'الدرجة العلمية'],
};

export type MappingEntry = {
  uploadedColumn: string;
  mappedField: string | null;
  confidence: number;
  needs_review: boolean;
};

function buildSearchItems(aliases: Record<string, string[]>): Array<{ field: string; alias: string }> {
  const items: Array<{ field: string; alias: string }> = [];
  for (const [field, aliasList] of Object.entries(aliases)) {
    for (const alias of aliasList) {
      items.push({ field, alias });
    }
  }
  return items;
}

export function detectMapping(headers: string[], type: 'students' | 'teachers'): MappingEntry[] {
  const aliases = type === 'students' ? STUDENT_FIELD_ALIASES : TEACHER_FIELD_ALIASES;
  const searchItems = buildSearchItems(aliases);
  const fuse = new Fuse(searchItems, { keys: ['alias'], threshold: 0.45, includeScore: true });

  return headers.map((header) => {
    const results = fuse.search(header.toLowerCase().trim());
    if (!results.length) {
      return { uploadedColumn: header, mappedField: null, confidence: 0, needs_review: true };
    }
    const best = results[0];
    const score = best.score ?? 1;
    const confidence = Math.round((1 - score) * 100) / 100;
    const needs_review = confidence < 0.70;
    return {
      uploadedColumn: header,
      mappedField: needs_review ? null : best.item.field,
      confidence,
      needs_review,
    };
  });
}
