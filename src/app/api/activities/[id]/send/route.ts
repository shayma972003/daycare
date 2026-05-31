import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { sendNotification } from "@/lib/notifications";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
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

      await sendNotification(
        schoolId,
        guardianName,
        phone,
        email,
        template,
        {
          child_name: student.name,
          guardian_name: guardianName,
          activity_name: activity.name,
          school_name: schoolName,
        },
        schoolName
      );

      notificationsSent.push(student.name);
    }
  }

  return Response.json({ success: true, notified: notificationsSent.length });
}
