import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { withNoStore } from "@/lib/auth-response";
import { z } from "zod";
import { SCHOOL_SCHEDULE_FIELDS, validateSchoolSchedule, type SchoolSchedule } from "@/lib/school-schedule";

const optionalTime = z.preprocess(
  (value) => value === "" ? null : value,
  z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional()
);
const optionalFee = z.number().min(0).max(1_000_000).nullable().optional();

const updateSettingsSchema = z.object({
    hourlyLateFee: z.number().min(0).max(1_000_000).optional(),
    dailyStudentFee: z.number().min(0).max(1_000_000).optional(),
    weeklyStudentFee: optionalFee,
    monthlyStudentFee: z.number().min(0).max(1_000_000).optional(),
    yearlyStudentFee: optionalFee,
    reminderTemplate: z.string().max(10_000).optional(),
    teacherMorningCheckinTime: optionalTime,
    teacherMorningCheckoutTime: optionalTime,
    teacherEveningCheckinTime: optionalTime,
    teacherEveningCheckoutTime: optionalTime,
    studentMorningCheckinTime: optionalTime,
    studentMorningCheckoutTime: optionalTime,
    studentEveningCheckinTime: optionalTime,
    studentEveningCheckoutTime: optionalTime,
}).strict();

function sessionFailure(error: unknown) {
  return sessionErrorResponse(error) ?? Response.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET() {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    return sessionFailure(error);
  }
  const schoolId = session.user.schoolId;

  const [settings, school] = await Promise.all([
    prisma.settings.findUnique({ where: { schoolId } }),
    prisma.school.findUnique({ where: { id: schoolId } }),
  ]);

  const operational = {
    settings: settings ?? {
      schoolId,
      hourlyLateFee: 0,
      dailyStudentFee: 0,
      weeklyStudentFee: null,
      monthlyStudentFee: 0,
      yearlyStudentFee: null,
      reminderTemplate:
        "مرحباً، <guardian_name>، نود إعلامكم بأن الرسوم المستحقة على <child_name> بمبلغ <amount_due> ريال تستحق بتاريخ <due_date>. مع تحيات <school_name>",
    },
    schoolName: school?.name ?? "",
    logoUrl: school?.logoUrl ?? null,
    plan: school?.plan ?? "basic",
    teacherMorningCheckinTime: school?.teacherMorningCheckinTime ?? "",
    teacherMorningCheckoutTime: school?.teacherMorningCheckoutTime ?? "",
    teacherEveningCheckinTime: school?.teacherEveningCheckinTime ?? "",
    teacherEveningCheckoutTime: school?.teacherEveningCheckoutTime ?? "",
    studentMorningCheckinTime: school?.studentMorningCheckinTime ?? "",
    studentMorningCheckoutTime: school?.studentMorningCheckoutTime ?? "",
    studentEveningCheckinTime: school?.studentEveningCheckinTime ?? "",
    studentEveningCheckoutTime: school?.studentEveningCheckoutTime ?? "",
  };

  if (!session.can("settings.manage")) {
    return withNoStore(Response.json(operational, { status: 200 }));
  }

  return withNoStore(
    Response.json(
      {
        ...operational,
        schoolEmail: school?.email ?? "",
        loginEmail: session.user.email ?? "",
        commercialRegistration: school?.commercialRegistration ?? "",
        vatNumber: school?.vatNumber ?? "",
        contactNumber: school?.contactNumber ?? "",
        address: school?.address ?? "",
        phoneNumber: school?.phoneNumber ?? "",
        twoFaEnabled: school?.twoFaEnabled ?? false,
      },
      { status: 200 }
    )
  );
}

export async function PUT(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    return sessionFailure(error);
  }
  if (!session.can("settings.manage")) {
    return Response.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403 });
  }
  const schoolId = session.user.schoolId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = updateSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const {
    hourlyLateFee,
    dailyStudentFee,
    weeklyStudentFee,
    monthlyStudentFee,
    yearlyStudentFee,
    reminderTemplate,
    ...scheduleUpdates
  } = parsed.data;

  const settingsData: Record<string, unknown> = {};
  if (hourlyLateFee !== undefined) settingsData.hourlyLateFee = hourlyLateFee;
  if (dailyStudentFee !== undefined) settingsData.dailyStudentFee = dailyStudentFee;
  if (weeklyStudentFee !== undefined) settingsData.weeklyStudentFee = weeklyStudentFee;
  if (monthlyStudentFee !== undefined) settingsData.monthlyStudentFee = monthlyStudentFee;
  if (yearlyStudentFee !== undefined) settingsData.yearlyStudentFee = yearlyStudentFee;
  if (reminderTemplate !== undefined) settingsData.reminderTemplate = reminderTemplate;

  const schoolData: Partial<SchoolSchedule> = {};
  for (const field of SCHOOL_SCHEDULE_FIELDS) {
    const value = scheduleUpdates[field];
    if (value !== undefined) schoolData[field] = value;
  }

  if (Object.keys(schoolData).length > 0) {
    const current = await prisma.school.findUnique({
      where: { id: schoolId },
      select: Object.fromEntries(SCHOOL_SCHEDULE_FIELDS.map((field) => [field, true])),
    }) as SchoolSchedule | null;
    if (!current) return Response.json({ error: "School not found" }, { status: 404 });
    const issue = validateSchoolSchedule({ ...current, ...schoolData });
    if (issue) return Response.json({ error: issue, code: issue }, { status: 422 });
  }

  if (Object.keys(settingsData).length === 0 && Object.keys(schoolData).length === 0) {
    return Response.json({ error: "No settings changes supplied" }, { status: 422 });
  }

  const result = await prisma.$transaction(async (tx) => {
    const savedSettings =
      Object.keys(settingsData).length > 0
        ? await tx.settings.upsert({
            where: { schoolId },
            create: { schoolId, ...settingsData },
            update: settingsData,
          })
        : await tx.settings.findUnique({ where: { schoolId } });
    const savedSchool =
      Object.keys(schoolData).length > 0
        ? await tx.school.update({ where: { id: schoolId }, data: schoolData })
        : null;
    return { settings: savedSettings, school: savedSchool };
  });

  await logAction({
    school_id: schoolId,
    action: "تم تعديل إعدادات المنشأة",
    entity_type: "settings",
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return withNoStore(Response.json(result, { status: 200 }));
}
