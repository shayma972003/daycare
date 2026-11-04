import Fuse from 'fuse.js';

export const STUDENT_FIELD_ALIASES: Record<string, string[]> = {
  full_name: ['student', 'child', 'child name', 'kid', 'name', 'student name', 'اسم الطفل', 'الطالب', 'اسم الطالب', 'الاسم', 'اسم الطالب الكامل', 'الاسم الكامل'],
  date_of_birth: ['dob', 'birth', 'birthday', 'birth date', 'birthdate', 'تاريخ الميلاد', 'الميلاد', 'ميلاد', 'تاريخ الولادة'],
  gender: ['gender', 'sex', 'الجنس', 'النوع'],
  nationality: ['nationality', 'nation', 'country', 'الجنسية', 'البلد'],
  id_number: ['id', 'national id', 'iqama', 'id number', 'student id', 'رقم الهوية', 'الهوية', 'هويه', 'رقم الإقامة', 'الإقامة', 'رقم الهوية/الإقامة'],
  health_condition: ['health', 'health condition', 'medical', 'الحالة الصحية', 'الصحة', 'الحالة الطبية'],
  allergies: ['allergy', 'allergies', 'alerts', 'sensitivities', 'الحساسية', 'التنبيهات', 'الحساسية والتنبيهات'],
  academic_stage: ['stage', 'grade', 'level', 'class group', 'kg', 'المرحلة', 'المرحلة الدراسية', 'الصف', 'المستوى'],
  period: ['period', 'shift', 'time', 'الفترة', 'الدوام', 'الوقت'],
  registration_date: ['registration', 'reg date', 'enrolled', 'تاريخ التسجيل', 'التسجيل'],
  enrollment_date: ['enrollment date', 'join date', 'joined', 'تاريخ الانضمام', 'تاريخ الإنضمام', 'تاريخ الالتحاق'],
  enrollment_end_date: ['end date', 'expiry', 'subscription end', 'enrollment end', 'تاريخ انتهاء الاشتراك', 'انتهاء الاشتراك', 'تاريخ الانتهاء'],
  payment_method: ['payment', 'payment method', 'pay method', 'طريقة الدفع', 'الدفع', 'وسيلة الدفع'],
  payment_status: ['payment status', 'status', 'حالة الدفع', 'الحالة'],
  guardian_name: ['parent', 'guardian', 'parent name', 'guardian name', 'father', 'mother', 'ولي الأمر', 'ولي الامر', 'اسم ولي الأمر', 'اسم ولي الامر', 'الوالد', 'الوالدة', 'الأب', 'الأم'],
  guardian_name_2: ['second guardian', 'second guardian name', 'guardian 2', 'guardian name 2', 'اسم ولي الأمر 2', 'اسم ولي الامر 2', 'ولي الأمر 2', 'ولي الامر 2'],
  guardian_phone_1: ['phone', 'mobile', 'parent phone', 'guardian phone', 'phone 1', 'phone1', 'رقم الجوال', 'جوال ولي الامر', 'الجوال', 'رقم الجوال 1', 'جوال 1'],
  guardian_phone_2: ['phone 2', 'phone2', 'mobile 2', 'secondary phone', 'alternate phone', 'رقم الجوال 2', 'جوال 2', 'الجوال الثاني'],
  guardian_email: ['email', 'parent email', 'guardian email', 'mail', 'البريد الإلكتروني', 'الإيميل', 'البريد'],
  guardian_phone_3: ['second guardian phone', 'guardian 2 phone', 'guardian phone 3', 'جوال ولي الأمر 2', 'جوال ولي الامر 2', 'رقم جوال ولي الأمر 2'],
  guardian_phone_4: ['second guardian alternate phone', 'guardian phone 4', 'رقم الجوال 4', 'جوال 4'],
  guardian_email_2: ['second guardian email', 'guardian 2 email', 'بريد ولي الأمر 2', 'بريد ولي الامر 2'],
};

export const TEACHER_FIELD_ALIASES: Record<string, string[]> = {
  full_name: ['teacher name', 'name', 'employee', 'اسم المعلم', 'الاسم', 'اسم الموظف', 'الاسم الكامل'],
  job_title: ['job title', 'role', 'position', 'employee role', 'المسمى الوظيفي', 'المسمى', 'الوظيفة', 'الدور الوظيفي'],
  id_number: ['id', 'national id', 'iqama', 'رقم الهوية', 'الهوية', 'رقم الإقامة'],
  date_of_birth: ['dob', 'birth date', 'تاريخ الميلاد', 'الميلاد'],
  nationality: ['nationality', 'الجنسية'],
  email: ['email', 'mail', 'البريد الإلكتروني', 'الإيميل'],
  phone_1: ['phone', 'mobile', 'رقم الجوال', 'الجوال', 'رقم الجوال 1'],
  phone_2: ['phone 2', 'mobile 2', 'رقم الجوال 2', 'جوال 2'],
  period: ['period', 'shift', 'الفترة', 'الدوام'],
  payment_method: ['payment method', 'pay method', 'طريقة الدفع', 'الدفع', 'وسيلة الدفع'],
  monthly_salary: ['salary', 'monthly salary', 'الراتب', 'الراتب الشهري'],
  late_deduction_rate: ['deduction', 'late deduction', 'خصم التأخير', 'الخصم'],
  join_date: ['join date', 'start date', 'تاريخ الانضمام', 'تاريخ البدء'],
  enrollment_end_date: ['contract end', 'end date', 'employment end', 'تاريخ انتهاء العقد', 'انتهاء العقد', 'تاريخ نهاية العقد'],
  education_level: ['education level', 'highest education', 'المستوى التعليمي', 'المؤهل الأعلى'],
  specialization: ['specialization', 'major', 'field of study', 'التخصص', 'التخصص الدراسي'],
  qualification_1: ['qualification', 'degree', 'المؤهل', 'المؤهل 1', 'الدرجة العلمية'],
  qualification_2: ['qualification 2', 'degree 2', 'المؤهل 2'],
  qualification_3: ['qualification 3', 'degree 3', 'المؤهل 3'],
  qualification_4: ['qualification 4', 'degree 4', 'المؤهل 4'],
  qualification_5: ['qualification 5', 'degree 5', 'المؤهل 5'],
  qualification_6: ['qualification 6', 'degree 6', 'المؤهل 6'],
  qualification_7: ['qualification 7', 'degree 7', 'المؤهل 7'],
  qualification_8: ['qualification 8', 'degree 8', 'المؤهل 8'],
  qualification_9: ['qualification 9', 'degree 9', 'المؤهل 9'],
  qualification_10: ['qualification 10', 'degree 10', 'المؤهل 10'],
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

  const normalizedHeaders = headers.map((header) => header.toLowerCase().trim());
  const hasSecondGuardian = type === 'students' && normalizedHeaders.some((header) =>
    STUDENT_FIELD_ALIASES.guardian_name_2.some((alias) => alias.toLowerCase() === header)
  );

  return headers.map((header) => {
    const normalizedHeader = header.toLowerCase().trim();
    // Age is derived from the date of birth in the product. Mapping a numeric
    // age to the fuzzy "academic stage" match corrupts the child's stage, so a
    // standalone age column is deliberately ignored.
    if (type === 'students' && ['age', 'العمر', 'عمر', 'السن', 'سن'].includes(normalizedHeader)) {
      return {
        uploadedColumn: header,
        mappedField: null,
        confidence: 1,
        needs_review: false,
      };
    }
    if (hasSecondGuardian && ['جوال 2', 'رقم الجوال 2'].includes(normalizedHeader)) {
      return {
        uploadedColumn: header,
        mappedField: 'guardian_phone_3',
        confidence: 1,
        needs_review: false,
      };
    }
    const results = fuse.search(normalizedHeader);
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
