import { verifyAdminSessionFromRequest } from "@/lib/admin-auth";
import { runAnonymizationSweep } from "@/lib/anonymization";
import { z } from "zod";
import { logSafeError } from "@/lib/safe-logger";
import { prisma } from "@/lib/prisma";

/**
 * Runs the retention sweep on demand.
 *
 * Exists so an administrator can prove the mechanism works — and satisfy an
 * erasure request on the day it arrives — without waiting for the nightly cron.
 * It processes exactly the same queue: records already past their retention
 * date. It cannot be used to expire a record early.
 *
 * Anonymisation is irreversible, so the caller must spell out the intent rather
 * than send an empty POST. `executedBy` records the admin id, which is the whole
 * reason this is a separate route from the cron one.
 */
const schema = z.object({ confirm: z.literal("ANONYMIZE") });

export async function POST(request: Request) {
  const session = await verifyAdminSessionFromRequest(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!schema.safeParse(body).success) {
    return Response.json({ error: "التأكيد مطلوب" }, { status: 422 });
  }

  try {
    const result = await runAnonymizationSweep({ executedBy: session.adminId });
    await prisma.adminActivityLog.create({
      data: {
        action: "data_retention_sweep_run",
        performed_by: session.adminId,
        metadata: {
          students: result.students,
          teachers: result.teachers,
          guardians: result.guardians,
          failures: result.failures,
          skipped: result.skipped,
        },
      },
    });
    return Response.json({ success: true, ...result });
  } catch (error) {
    logSafeError("admin-data-retention-run", error);
    return Response.json({ error: "تعذر تنفيذ عملية التجهيل" }, { status: 500 });
  }
}
