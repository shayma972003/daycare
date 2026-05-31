import { requireSession } from "@/lib/session";
import { writeFile } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";

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
  if (!["jpg", "jpeg", "png"].includes(ext ?? "")) {
    return Response.json(
      { error: "Only .jpg, .jpeg, .png files are allowed" },
      { status: 400 }
    );
  }

  const filename = `${randomUUID()}.${ext}`;
  const uploadDir = join(process.cwd(), "public", "uploads");
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(join(uploadDir, filename), buffer);

  return Response.json({ url: `/uploads/${filename}` });
}
