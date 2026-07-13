import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";

const ALLOWED_EXTENSIONS = ["pdf", "png", "jpg", "jpeg"];

async function deleteUploadedFile(url: string | null | undefined) {
  if (!url) return;
  try {
    const filename = url.split("/").pop();
    if (!filename) return;
    await unlink(join(process.cwd(), "public", "uploads", filename));
  } catch {
    // best-effort — ignore errors
  }
}

export async function POST(
  request: Request,
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

  const student = await prisma.student.findFirst({ where: { id, schoolId, deletedAt: null } });
  if (!student) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return Response.json({ error: "No file provided" }, { status: 400 });
  }

  const ext = file.name.split(".").pop()?.toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext ?? "")) {
    return Response.json({ error: "نوع الملف غير مدعوم" }, { status: 400 });
  }

  const filename = `${randomUUID()}.${ext}`;
  const uploadDir = join(process.cwd(), "public", "uploads");
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(join(uploadDir, filename), buffer);

  // best-effort delete of previous evaluation file
  await deleteUploadedFile(student.evaluationFileUrl);

  const url = `/uploads/${filename}`;
  const updated = await prisma.student.update({
    where: { id },
    data: { evaluationFileUrl: url, evaluationFileName: file.name },
  });

  return Response.json({
    evaluationFileUrl: updated.evaluationFileUrl,
    evaluationFileName: updated.evaluationFileName,
  });
}

export async function DELETE(
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

  const student = await prisma.student.findFirst({ where: { id, schoolId, deletedAt: null } });
  if (!student) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  await deleteUploadedFile(student.evaluationFileUrl);

  await prisma.student.update({
    where: { id },
    data: { evaluationFileUrl: null, evaluationFileName: null },
  });

  return Response.json({ success: true });
}
