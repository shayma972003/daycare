import { requireSession, sessionErrorResponse } from "@/lib/session";
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
  } catch (error) {
    // 403 when the caller is known but lacks the permission; 401 otherwise.
    return (
      sessionErrorResponse(error) ??
      Response.json({ error: "Unauthorized" }, { status: 401 })
    );
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;

  const [settings, school] = await Promise.all([
    prisma.settings.findUnique({ where: { schoolId } }),
    prisma.school.findUnique({ where: { id: schoolId } }),
  ]);

  /**
   * Two tiers in one response.
   *
   * The route is readable by every signed-in member of the school, because the
   * fee settings and the school's hours are needed on almost every screen and a
   * teacher who cannot read them sees an empty timetable. That is why the
   * permission table lists `GET: null`.
   *
   * It was returning the whole `School` row with it: the commercial
   * registration, the VAT number, the postal address and whether two-factor is
   * switched on. None of that is needed to render a timetable — the first two
   * belong on tax documents, and the last is a fact about the account's
   * defences. They are now gated behind `settings.manage`, the same permission
   * that lets someone change them.
   */
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
    return Response.json(operational, { status: 200 });
  }

  return Response.json(
    {
      ...operational,
      schoolEmail: school?.email ?? "",
      commercialRegistration: school?.commercialRegistration ?? "",
      vatNumber: school?.vatNumber ?? "",
      contactNumber: school?.contactNumber ?? "",
      address: school?.address ?? "",
      phoneNumber: school?.phoneNumber ?? "",
      twoFaEnabled: school?.twoFaEnabled ?? false,
    },
    { status: 200 }
  );
}

export async function PUT(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    // 403 when the caller is known but lacks the permission; 401 otherwise.
    return (
      sessionErrorResponse(error) ??
      Response.json({ error: "Unauthorized" }, { status: 401 })
    );
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

  /**
   * The account email is the login credential, and it lives on `User`, not on
   * `School`.
   *
   * Editing it here only ever touched `School.email`, so the address shown in
   * settings drifted away from the one that actually signs in — and password
   * reset, 2FA and every notification kept going to the old one. The two are
   * written together now, inside a transaction, so they cannot diverge again.
   *
   * Refused rather than silently skipped when the school has more than one user
   * (there is no way to know whose login was meant) or when the address is
   * already taken (`User.email` is unique, and a raw constraint violation would
   * surface as a 500).
   */
  if (email !== undefined) {
    const users = await prisma.user.findMany({
      where: { schoolId },
      select: { id: true, email: true },
    });

    if (users.length > 1) {
      return Response.json(
        { error: "لا يمكن تغيير البريد من هنا لوجود أكثر من مستخدم للمنشأة" },
        { status: 409 }
      );
    }

    if (users.length === 1 && users[0].email !== email) {
      const taken = await prisma.user.findFirst({
        where: { email, id: { not: users[0].id } },
        select: { id: true },
      });
      if (taken) {
        return Response.json(
          { error: "هذا البريد مستخدم في حساب آخر" },
          { status: 409 }
        );
      }
      schoolData.__syncUserId = users[0].id;
    }
  }

  const syncUserId = schoolData.__syncUserId as string | undefined;
  delete schoolData.__syncUserId;

  const [settings] = await prisma.$transaction([
    prisma.settings.upsert({
      where: { schoolId },
      create: { schoolId, ...settingsData },
      update: settingsData,
    }),
    ...(Object.keys(schoolData).length > 0
      ? [prisma.school.update({ where: { id: schoolId }, data: schoolData })]
      : []),
    ...(syncUserId
      ? [prisma.user.update({ where: { id: syncUserId }, data: { email: email! } })]
      : []),
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
