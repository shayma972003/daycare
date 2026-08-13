import { maskIdNumber, revealIdNumber } from "@/lib/pii-crypto";

export interface RosterDtoAccess {
  contact: boolean;
  health: boolean;
  financial: boolean;
  revealIdentity: boolean;
}

export const studentDetailSelect = {
  id: true,
  name: true,
  stageId: true,
  academicStage: true,
  period: true,
  classId: true,
  class: { select: { id: true, name: true } },
  guardianId: true,
  guardian: {
    select: {
      id: true,
      name: true,
      phone1: true,
      phone2: true,
      email: true,
      name_2: true,
      phone_3: true,
      phone_4: true,
      email_2: true,
    },
  },
  healthCondition: true,
  allergies: true,
  idNumber: true,
  encryptedIdNumber: true,
  dateOfBirth: true,
  nationality: true,
  gender: true,
  registrationDate: true,
  attendanceType: true,
  attendanceHours: true,
  lateHours: true,
  paymentMethod: true,
  paymentStatus: true,
  billingCycle: true,
  billingIntervalDays: true,
  cycleFee: true,
  enrollment_date: true,
  enrollmentEndDate: true,
  registration_fee: true,
  evaluationFileUrl: true,
  evaluationFileName: true,
  avatarUrl: true,
  isActive: true,
  status: true,
  leftAt: true,
  retentionUntil: true,
} as const;

export const teacherDetailSelect = {
  id: true,
  name: true,
  period: true,
  classes: { select: { id: true, name: true } },
  idNumber: true,
  encryptedIdNumber: true,
  dateOfBirth: true,
  nationality: true,
  email: true,
  phone1: true,
  phone2: true,
  paymentMethod: true,
  joinDate: true,
  enrollmentEndDate: true,
  monthlySalary: true,
  lateDeductionRate: true,
  qualification1: true,
  qualification2: true,
  qualification3: true,
  qualification4: true,
  qualification5: true,
  qualification6: true,
  qualification7: true,
  qualification8: true,
  qualification9: true,
  qualification10: true,
  jobTitle: true,
  educationLevel: true,
  specialization: true,
  attendanceHours: true,
  lateHours: true,
  isActive: true,
  status: true,
  leftAt: true,
  retentionUntil: true,
} as const;

type IdFields = {
  idNumber: string | null;
  encryptedIdNumber: string | null;
};

export function identityDto(row: IdFields, reveal: boolean) {
  const value = revealIdNumber(row);
  return {
    idNumber: reveal ? value : null,
    maskedIdNumber: maskIdNumber(value),
  };
}

export function studentListDto(
  student: {
    id: string;
    name: string;
    period: unknown;
    paymentStatus: unknown;
    classId: string | null;
    class: { id: string; name: string } | null;
    guardian: {
      id: string;
      name: string;
      phone1: string | null;
      phone2: string | null;
      email: string | null;
    } | null;
    isActive: boolean;
    needsClassWarning: boolean;
    avatarUrl: string | null;
  },
  access: Pick<RosterDtoAccess, "contact" | "financial">
) {
  return {
    id: student.id,
    name: student.name,
    period: student.period,
    classId: student.classId,
    class: student.class,
    guardian: student.guardian && access.contact
      ? {
          id: student.guardian.id,
          name: student.guardian.name,
          phone1: student.guardian.phone1,
          phone2: student.guardian.phone2,
          email: student.guardian.email,
        }
      : null,
    ...(access.financial ? { paymentStatus: student.paymentStatus } : {}),
    isActive: student.isActive,
    needsClassWarning: student.needsClassWarning,
    avatarUrl: student.avatarUrl,
  };
}

export function studentDetailDto(
  student: Record<string, unknown> & IdFields,
  access: RosterDtoAccess,
  extras: {
    registrationFee: number | null;
    registrationFeeIsDefault: boolean;
    siblings: Array<{ id: string; name: string; avatarUrl: string | null }>;
  }
) {
  const guardian = student.guardian as Record<string, unknown> | null;
  const base = {
    id: student.id,
    name: student.name,
    stageId: student.stageId,
    academicStage: student.academicStage,
    period: student.period,
    classId: student.classId,
    class: student.class,
    dateOfBirth: student.dateOfBirth,
    nationality: student.nationality,
    gender: student.gender,
    registrationDate: student.registrationDate,
    attendanceType: student.attendanceType,
    attendanceHours: student.attendanceHours,
    lateHours: student.lateHours,
    isActive: student.isActive,
    status: student.status,
    leftAt: student.leftAt,
    retentionUntil: student.retentionUntil,
    evaluationFileUrl: student.evaluationFileUrl,
    evaluationFileName: student.evaluationFileName,
    avatarUrl: student.avatarUrl,
    guardianId: student.guardianId,
    guardian: guardian
      ? {
          id: guardian.id,
          name: guardian.name,
          ...(access.contact
            ? {
                phone1: guardian.phone1,
                phone2: guardian.phone2,
                email: guardian.email,
                name_2: guardian.name_2,
                phone_3: guardian.phone_3,
                phone_4: guardian.phone_4,
                email_2: guardian.email_2,
              }
            : {}),
        }
      : null,
    siblings: extras.siblings,
    ...identityDto(student, access.revealIdentity),
  };

  return {
    ...base,
    ...(access.health
      ? { healthCondition: student.healthCondition, allergies: student.allergies }
      : {}),
    ...(access.financial
      ? {
          paymentMethod: student.paymentMethod,
          paymentStatus: student.paymentStatus,
          billingCycle: student.billingCycle,
          billingIntervalDays: student.billingIntervalDays,
          cycleFee: student.cycleFee,
          enrollmentDate: student.enrollment_date,
          enrollmentEndDate: student.enrollmentEndDate,
          registration_fee: extras.registrationFee,
          registration_fee_is_default: extras.registrationFeeIsDefault,
        }
      : {}),
  };
}

export function teacherListDto(teacher: {
  id: string;
  name: string;
  period: unknown;
  isActive: boolean;
  classes: Array<{ id: string; name: string }>;
}) {
  return { ...teacher };
}

export function teacherDetailDto(
  teacher: Record<string, unknown> & IdFields,
  access: Pick<RosterDtoAccess, "contact" | "financial" | "revealIdentity">,
  lateCountThisMonth: number
) {
  return {
    id: teacher.id,
    name: teacher.name,
    period: teacher.period,
    classes: teacher.classes,
    dateOfBirth: teacher.dateOfBirth,
    nationality: teacher.nationality,
    joinDate: teacher.joinDate,
    enrollmentEndDate: teacher.enrollmentEndDate,
    qualification1: teacher.qualification1,
    qualification2: teacher.qualification2,
    qualification3: teacher.qualification3,
    qualification4: teacher.qualification4,
    qualification5: teacher.qualification5,
    qualification6: teacher.qualification6,
    qualification7: teacher.qualification7,
    qualification8: teacher.qualification8,
    qualification9: teacher.qualification9,
    qualification10: teacher.qualification10,
    jobTitle: teacher.jobTitle,
    educationLevel: teacher.educationLevel,
    specialization: teacher.specialization,
    attendanceHours: teacher.attendanceHours,
    lateHours: teacher.lateHours,
    isActive: teacher.isActive,
    status: teacher.status,
    leftAt: teacher.leftAt,
    retentionUntil: teacher.retentionUntil,
    lateCountThisMonth,
    ...identityDto(teacher, access.revealIdentity),
    ...(access.contact
      ? { email: teacher.email, phone1: teacher.phone1, phone2: teacher.phone2 }
      : {}),
    ...(access.financial
      ? {
          paymentMethod: teacher.paymentMethod,
          monthlySalary: teacher.monthlySalary,
          lateDeductionRate: teacher.lateDeductionRate,
        }
      : {}),
  };
}
