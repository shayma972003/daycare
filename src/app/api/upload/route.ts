import { requireSession } from "@/lib/session";
import {
  validateUpload,
  isFailure,
  IMAGE_TYPES,
  IMAGE_LABEL,
  MAX_IMAGE_BYTES,
} from "@/lib/file-upload";

/**
 * Generic image upload used by the class forms.
 *
 * This route previously wrote to `public/uploads` — a directory that does not
 * exist in the repository and is read-only on Vercel, so every call 500'd. It
 * also stored files outside any tenant namespace and served them from a public
 * path with no access control.
 *
 * It now returns a validated data URI, matching how every other upload path in
 * the codebase already works. Object storage replaces this wholesale in a later
 * phase; until then, correctness beats a broken filesystem write.
 */
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

  const validated = await validateUpload(file, IMAGE_TYPES, MAX_IMAGE_BYTES, IMAGE_LABEL);
  if (isFailure(validated)) {
    return Response.json({ error: validated.error }, { status: validated.status });
  }

  return Response.json({ url: validated.dataUrl });
}
