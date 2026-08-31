import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { withNoStore } from "@/lib/auth-response";
import { z } from "zod";

const optionalText = (max: number) => z.string().max(max).nullable().optional();
const optionalTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .nullable()
  .optional();

const updateSettingsSchema = z.object({
    hourlyLateFee: z.number().min(0).max(1_000_000).optional(),
    dailyStudentFee: z.number().min(0).max(1_000_000).optional(),
    monthlyStudentFee: z.number().min(0).max(1_000_000).optional(),
    reminderTemplate: z.string().max(10_000).optional(),
    schoolName: z.string().trim().min(1).max(160).optional(),
    email: z.string().email().max(320).nullable().optional(),
    teacherCheckinTime: optionalTime,
    teacherCheckoutTime: optionalTime,
    studentCheckinTime: optionalTime,
    studentCheckoutTime: optionalTime,
    commercialRegistration: optionalText(80),
    vatNumber: optionalText(80),
    contactNumber: optionalText(40),
    address: optionalText(500),
    phoneNumber: optionalText(40),
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
      monthlyStudentFee: 0,
      reminderTemplate:
        "مرحباً، <guardian_name>، نود إعلامكم بأن الرسوم المستحقة على <child_name> بمبلغ <amount_due> ريال تستحق بتاريخ <due_date>. مع تحيات <school_name>",
    },
    schoolName: school?.name ?? "",
    logoUrl: school?.logoUrl ?? null,
    plan: school?.plan ?? "basic",
    teacherCheckinTime: school?.teacherCheckinTime ?? "",
    teacherCheckoutTime: school?.teacherCheckoutTime ?? "",
    studentCheckinTime: school?.studentCheckinTime ?? "",
    studentCheckoutTime: school?.studentCheckoutTime ?? "",
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
    monthlyStudentFee,
    reminderTemplate,
    schoolName,
    email,
    teacherCheckinTime,
    teacherCheckoutTime,
    studentCheckinTime,
    studentCheckoutTime,
    commercialRegistration,
    vatNumber,
    contactNumber,
    address,
    phoneNumber,
  } = parsed.data;

  const settingsData: Record<string, unknown> = {};
  if (hourlyLateFee !== undefined) settingsData.hourlyLateFee = hourlyLateFee;
  if (dailyStudentFee !== undefined) settingsData.dailyStudentFee = dailyStudentFee;
  if (monthlyStudentFee !== undefined) settingsData.monthlyStudentFee = monthlyStudentFee;
  if (reminderTemplate !== undefined) settingsData.reminderTemplate = reminderTemplate;

  const schoolData: Record<string, unknown> = {};
  if (schoolName !== undefined) schoolData.name = schoolName;
  // School.email is the public contact/Reply-To address, not a User credential.
  if (email !== undefined) schoolData.email = email;
  if (teacherCheckinTime !== undefined) schoolData.teacherCheckinTime = teacherCheckinTime;
  if (teacherCheckoutTime !== undefined) schoolData.teacherCheckoutTime = teacherCheckoutTime;
  if (studentCheckinTime !== undefined) schoolData.studentCheckinTime = studentCheckinTime;
  if (studentCheckoutTime !== undefined) schoolData.studentCheckoutTime = studentCheckoutTime;
  if (commercialRegistration !== undefined) schoolData.commercialRegistration = commercialRegistration;
  if (vatNumber !== undefined) schoolData.vatNumber = vatNumber;
  if (contactNumber !== undefined) schoolData.contactNumber = contactNumber;
  if (address !== undefined) schoolData.address = address;
  if (phoneNumber !== undefined) schoolData.phoneNumber = phoneNumber;

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
