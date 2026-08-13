import { storageEnabled } from "@/lib/env";
import { mayReadStoredFile } from "@/lib/stored-file-access";
import { prisma } from "@/lib/prisma";
import { schoolIdFromKey, signedReadUrl } from "@/lib/r2";

const denied = () =>
  Response.json({ error: "File is not available" }, { status: 404 });

export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string[] }> }
) {
  if (!storageEnabled) {
    return Response.json({ error: "Storage is not configured" }, { status: 501 });
  }

  const { key: segments } = await params;
  const key = segments.map(decodeURIComponent).join("/");
  const schoolId = schoolIdFromKey(key);
  if (!schoolId) return denied();

  // The object key itself is not authority. It must still be registered to this
  // tenant and not waiting for deletion before any credential is considered.
  const file = await prisma.storedFile.findFirst({
    where: { key, schoolId, deletePendingAt: null },
    select: { key: true, schoolId: true, ownerType: true, ownerId: true },
  });
  if (!file || !(await mayReadStoredFile(request, file))) return denied();

  return Response.redirect(await signedReadUrl(key), 302);
}
