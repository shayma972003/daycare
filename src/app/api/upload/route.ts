import { requireSession } from "@/lib/session";
import { writeFile } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png"];

export async function POST(request: Request) {
  try {
    await requireSession();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return Response.json({ error: "No file provided" }, { status: 400 });
  }

  const ext = file.name.split(".").pop()?.toLowerCase();
  if (!["jpg", "jpeg", "png"].includes(ext ?? "") || !ALLOWED_MIME_TYPES.includes(file.type)) {
    return Response.json(
      { error: "Only .jpg, .jpeg, .png files are allowed" },
      { status: 400 }
    );
  }

  if (file.size > MAX_FILE_SIZE) {
    return Response.json(
      { error: "حجم الملف كبير جدا، الحجم المسموح للملف هو 100 MB أو أقل" },
      { status: 400 }
    );
  }

  const filename = `${randomUUID()}.${ext}`;
  const uploadDir = join(process.cwd(), "public", "uploads");
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(join(uploadDir, filename), buffer);

  return Response.json({ url: `/uploads/${filename}` });
}
