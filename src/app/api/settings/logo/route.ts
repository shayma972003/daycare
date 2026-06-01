export const runtime = "nodejs";

import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

const ALLOWED_TYPES = ["image/png", "image/svg+xml"];
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

export async function PUT(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("logo");
  if (!(file instanceof File))
    return Response.json({ error: "No file uploaded" }, { status: 400 });

  if (!ALLOWED_TYPES.includes(file.type))
    return Response.json({ error: "يُسمح فقط بملفات PNG و SVG" }, { status: 400 });

  if (file.size > MAX_BYTES)
    return Response.json({ error: "حجم الملف يتجاوز 2 ميغابايت" }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const base64 = buffer.toString("base64");
  const logoUrl = `data:${file.type};base64,${base64}`;

  await prisma.school.update({ where: { id: schoolId }, data: { logoUrl } });

  return Response.json({ logoUrl }, { status: 200 });
}
