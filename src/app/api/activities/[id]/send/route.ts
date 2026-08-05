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

  let body: { notifyGuardians?: boolean; notifyStaff?: boolean } = {};
  try {
    body = await request.json();
  } catch {
    // No body is the old call shape — both audiences, as the button reads.
  }
  const notifyGuardians = body.notifyGuardians ?? true;
  const notifyStaff = body.notifyStaff ?? true;

  const activity = await prisma.activity.findFirst({
    where: { id, schoolId },
    include: {
      activityInvites: {
        include: {
          class: {
            include: {
              students: { include: { guardian: true } },
              // The room's lead teacher, so staff hear about an activity they
              // are expected to run. Until now the message went to guardians
              // only and the teacher found out when the children arrived.
              teacher: { select: { id: true, name: true, phone1: true, phone2: true, email: true } },
            },
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

  for (const invite of notifyGuardians ? activity.activityInvites : []) {
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

  /**
   * Staff, after the guardians.
   *
   * Deduplicated by teacher id: one person can lead several of the invited
   * rooms, and three copies of the same message is how a notification channel
   * stops being read.
   */
  if (notifyStaff) {
    const seen = new Set<string>();
    for (const invite of activity.activityInvites) {
      const teacher = invite.class.teacher;
      if (!teacher || seen.has(teacher.id)) continue;
      seen.add(teacher.id);

      const vars = buildMessageVars({
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
        teacher.name,
        teacher.phone1 ?? teacher.phone2 ?? null,
        teacher.email ?? null,
        template,
        vars,
        schoolName,
        "activity",
        {}
      );
      notificationsSent.push(teacher.name);
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
