import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAction } from "@/lib/activity-logger";
import { z } from "zod";
import bcrypt from "bcryptjs";

const schema = z.object({
  password: z.string().min(1),
});

export async function POST(request: Request) {
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

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "بيانات غير صحيحة" }, { status: 400 });
  }

  const userEmail = session.user.email;
  if (!userEmail) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({ where: { email: userEmail } });
  if (!user) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  const valid = await bcrypt.compare(parsed.data.password, user.password);
  if (!valid) {
    return Response.json({ error: "كلمة المرور غير صحيحة" }, { status: 400 });
  }

  await prisma.school.update({
    where: { id: schoolId },
    data: { twoFaEnabled: false, twoFaPhone: null },
  });

  await logAction({
    school_id: schoolId,
    action: "إيقاف التحقق بخطوتين",
    entity_type: "settings",
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json({ success: true });
}
