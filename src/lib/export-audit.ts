import { prisma } from "@/lib/prisma";
import { clientIp } from "@/lib/rate-limit";

/**
 * Records a bulk export.
 *
 * An export is the widest data-egress path in the product: one request turns a
 * roster of children into a file that lives outside every control this system
 * has. Nothing recorded who did that, over what filter, or how much left — so a
 * leak could not be investigated and the question "what was taken" had no
 * answer.
 *
 * Never throws: a failure to write the audit row must not fail the export the
 * user asked for. It is logged loudly instead.
 */
export interface ExportAuditEntry {
  schoolId: string;
  /** What was exported: `students`, `financial_report`, `activity_logs`, … */
  exportedEntity: string;
  exportFormat?: "excel" | "csv" | "pdf";
  /** The filters that shaped the result set, for reconstructing the query. */
  filters?: Record<string, unknown>;
  recordCount?: number;
  userId?: string | null;
  userName?: string | null;
  request?: Request;
}

export async function logExport({
  schoolId,
  exportedEntity,
  exportFormat = "excel",
  filters,
  recordCount = 0,
  userId,
  userName,
  request,
}: ExportAuditEntry): Promise<void> {
  try {
    await prisma.exportAuditLog.create({
      data: {
        schoolId,
        exportedEntity,
        exportFormat,
        filters: filters ? JSON.parse(JSON.stringify(filters)) : undefined,
        recordCount,
        userId: userId ?? null,
        userName: userName ?? null,
        ipAddress: request ? clientIp(request) : null,
        userAgent: request?.headers.get("user-agent") ?? null,
      },
    });
  } catch (error) {
    console.error("[export-audit] failed to record export:", error);
  }
}
