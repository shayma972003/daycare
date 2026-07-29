import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { z } from "zod";

const updateSettingsSchema = z.object({
  hourlyLateFee: z.number().optional(),
  dailyStudentFee: z.number().optional(),
  monthlyStudentFee: z.number().optional(),
  reminderTemplate: z.string().optional(),
  schoolName: z.string().optional(),
  email: z.string().optional(),
  // School hours
  teacherCheckinTime: z.string().optional(),
  teacherCheckoutTime: z.string().optional(),
  studentCheckinTime: z.string().optional(),
  studentCheckoutTime: z.string().optional(),
  // Legal info
  commercialRegistration: z.string().optional(),
  vatNumber: z.string().optional(),
  contactNumber: z.string().optional(),
  address: z.string().optional(),
  phoneNumber: z.string().optional(),
});

export async function GET(_request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;

  const [settings, school] = await Promise.all([
    prisma.settings.findUnique({ where: { schoolId } }),
    prisma.school.findUnique({ where: { id: schoolId } }),
  ]);

  return Response.json({
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
    schoolEmail: school?.email ?? "",
    teacherCheckinTime: school?.teacherCheckinTime ?? "",
    teacherCheckoutTime: school?.teacherCheckoutTime ?? "",
    studentCheckinTime: school?.studentCheckinTime ?? "",
    studentCheckoutTime: school?.studentCheckoutTime ?? "",
    commercialRegistration: school?.commercialRegistration ?? "",
    vatNumber: school?.vatNumber ?? "",
    contactNumber: school?.contactNumber ?? "",
    address: school?.address ?? "",
    phoneNumber: school?.phoneNumber ?? "",
    twoFaEnabled: school?.twoFaEnabled ?? false,
  }, { status: 200 });
}

export async function PUT(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = updateSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
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

  const [settings] = await Promise.all([
    prisma.settings.upsert({
      where: { schoolId },
      create: { schoolId, ...settingsData },
      update: settingsData,
    }),
    Object.keys(schoolData).length > 0
      ? prisma.school.update({ where: { id: schoolId }, data: schoolData })
      : Promise.resolve(null),
  ]);

  await logAction({
    school_id: schoolId,
    action: "تم تعديل إعدادات المنشأة",
    entity_type: "settings",
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json(settings, { status: 200 });
}
