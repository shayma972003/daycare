import { requireSession, sessionErrorResponse } from "@/lib/session";
import { logAction } from "@/lib/activity-logger";
import {
  getStorageQuota,
  refreshStorageUsage,
  purgeInvoicePdfs,
  STORAGE_CATEGORY_LABELS,
} from "@/lib/storage-usage";
import { z } from "zod";

/**
 * Storage usage for the current school (tasks 2.29–2.31).
 */
export async function GET(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    return (
      sessionErrorResponse(error) ??
      Response.json({ error: "Unauthorized" }, { status: 401 })
    );
  }
  const schoolId = session.user.schoolId;

  // `?refresh=1` recomputes; the default reads the nightly cache so opening the
  // settings screen does not run six aggregates.
  const refresh = new URL(request.url).searchParams.get("refresh") === "1";
  if (refresh) await refreshStorageUsage(schoolId);

  const quota = await getStorageQuota(schoolId);

  return Response.json({ ...quota, labels: STORAGE_CATEGORY_LABELS });
}

const actionSchema = z.object({
  action: z.literal("purge_invoice_pdfs"),
  /** Optional cut-off, so a school can keep this year's documents. */
  olderThanDays: z.number().int().min(0).max(3650).optional(),
});

/**
 * Frees space (task 2.30).
 *
 * Only invoice PDFs. They are the largest category and the only one that is
 * *reproducible*: the PDF is a rendering, and every figure needed to make it
 * again sits in `amount`, `vat_amount` and the `data` JSON beside it. A child's
 * photo cannot be regenerated, so clearing those in bulk is a decision for the
 * individual file rather than for a button labelled "free up space".
 */
export async function POST(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    return (
      sessionErrorResponse(error) ??
      Response.json({ error: "Unauthorized" }, { status: 401 })
    );
  }
  const schoolId = session.user.schoolId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "إجراء غير معروف" }, { status: 422 });
  }

  const olderThan =
    parsed.data.olderThanDays !== undefined
      ? new Date(Date.now() - parsed.data.olderThanDays * 86400000)
      : undefined;

  const result = await purgeInvoicePdfs(schoolId, olderThan);

  await logAction({
    school_id: schoolId,
    action: `إفراغ مساحة: حذف ${result.cleared} ملف فاتورة`,
    entity_type: "storage",
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return Response.json(result);
}
