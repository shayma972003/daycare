import { requireSession, sessionErrorResponse } from "@/lib/session";
import {
  storeUpload,
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
 * It now stores to R2 and returns a `/api/files/…` path, like every other upload
 * path in the codebase (task 0.34).
 *
 * The caller — a class or activity form — may still be abandoned without saving,
 * leaving an object nothing references. `category` and `ownerId` are recorded
 * anyway, so `orphaned-uploads` can find and sweep them; the alternative,
 * uploading only on submit, means the form cannot show a preview.
 */
export async function POST(request: Request) {
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

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return Response.json({ error: "No file provided" }, { status: 400 });
  }

  // Tenant-aware: also refuses when the school is over its storage quota
  // (task 2.31).
  const stored = await storeUpload(session.user.schoolId, file, {
    allowed: IMAGE_TYPES,
    maxBytes: MAX_IMAGE_BYTES,
    humanLabel: IMAGE_LABEL,
    // No row exists yet — the form is still open. `pending` is a real owner id
    // that the orphan sweep looks for, rather than a blank that means nothing.
    category: "classes",
    ownerId: "pending",
  });
  if (isFailure(stored)) {
    return Response.json({ error: stored.error }, { status: stored.status });
  }

  return Response.json({ url: stored.url });
}
