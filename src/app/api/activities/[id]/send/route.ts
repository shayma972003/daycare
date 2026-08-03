import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { sendNotification } from "@/lib/notifications";
import { buildMessageVars } from "@/lib/message-variables";
import { logAction } from "@/lib/activity-logger";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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
  const { id } = await params;

  const activity = await prisma.activity.findFirst({
    where: { id, schoolId },
    include: {
      activityInvites: {
        include: {
          class: {
            include: { students: { include: { guardian: true } } },
          },
        },
      },
    },
  });

  if (!activity) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const school = await prisma.school.findUnique({ where: { id: schoolId } });
  const schoolName = school?.name ?? "الروضة";

  const template = activity.message ?? "لديك نشاط جديد: <activity_name>";

  const notificationsSent: string[] = [];

  for (const invite of activity.activityInvites) {
    for (const student of invite.class.students) {
      const guardianName = student.guardian?.name ?? student.name;
      const phone = student.guardian?.phone1 ?? student.guardian?.phone2 ?? null;
      const email = student.guardian?.email ?? null;

      const vars = buildMessageVars({
        student: {
          name: student.name,
          registration_fee: student.registration_fee,
          enrollmentEndDate: student.enrollmentEndDate,
        },
        guardian: {
          name: student.guardian?.name,
          name_2: student.guardian?.name_2,
        },
        school: {
          name: school?.name,
          studentCheckinTime: school?.studentCheckinTime,
          studentCheckoutTime: school?.studentCheckoutTime,
        },
        activity: {
          name: activity.name,
          activityFee: activity.activityFee,
          startDate: activity.startDate,
          endDate: activity.endDate,
        },
      });

      await sendNotification(
        schoolId,
        guardianName,
        phone,
        email,
        template,
        vars,
        schoolName,
        "activity",
        { studentId: student.id }
      );

      notificationsSent.push(student.name);
    }
  }

  await logAction({
    school_id: schoolId,
    action: `إرسال إشعار فعالية: ${activity.name} — ${notificationsSent.length} مستلم`,
    entity_type: "activity",
    entity_id: activity.id,
    entity_name: activity.name,
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json({ success: true, notified: notificationsSent.length });
}
