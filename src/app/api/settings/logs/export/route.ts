export const runtime = "nodejs";

import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logExport } from "@/lib/export-audit";
import { renderToBuffer, Document, Page, Text, View, StyleSheet, Font } from "@react-pdf/renderer";
import { createElement } from "react";
import { join } from "path";

/** Newest-first cap on a single PDF export. */
const MAX_EXPORT_ROWS = 2000;

Font.register({
  family: "Arabic",
  fonts: [
    { src: join(process.cwd(), "public", "fonts", "Arabic-Regular.ttf"), fontWeight: "normal" },
    { src: join(process.cwd(), "public", "fonts", "Arabic-Bold.ttf"), fontWeight: "bold" },
  ],
});
Font.registerHyphenationCallback((w) => [w]);

const styles = StyleSheet.create({
  page: { fontFamily: "Arabic", backgroundColor: "#ffffff", padding: 32, fontSize: 9 },
  title: { fontSize: 16, fontWeight: "bold", color: "#111111", textAlign: "right", marginBottom: 4 },
  subtitle: { fontSize: 9, color: "#6b7280", textAlign: "right", marginBottom: 16 },
  row: { flexDirection: "row-reverse", paddingVertical: 6, paddingHorizontal: 8, borderBottom: "0.5pt solid #f0f0f0" },
  rowAlt: { backgroundColor: "#fafafa" },
  colAction: { flex: 3, textAlign: "right", color: "#111111" },
  colBy: { flex: 1.5, textAlign: "right", color: "#374151" },
  colDevice: { flex: 1.5, textAlign: "right", color: "#9ca3af", fontSize: 8 },
  colIp: { flex: 1, textAlign: "right", color: "#9ca3af", fontSize: 8 },
  colDate: { flex: 1.5, textAlign: "right", color: "#6b7280", fontSize: 8 },
  headerRow: { flexDirection: "row-reverse", paddingVertical: 6, paddingHorizontal: 8, borderBottom: "1pt solid #e5e7eb" },
  headerCell: { fontWeight: "bold", color: "#111111", fontSize: 8 },
});

export async function POST(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const schoolId = session.user.schoolId;

  const [school, logs] = await Promise.all([
    prisma.school.findUnique({ where: { id: schoolId } }),
    prisma.activityLog.findMany({
      where: { school_id: schoolId },
      orderBy: { created_at: "desc" },
      // Was unbounded: an established tenant's full history rendered into one
      // PDF is a straight route to an out-of-memory function.
      take: MAX_EXPORT_ROWS,
    }),
  ]);

  const now = new Date();
  const exportedAt = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  const doc = createElement(
    Document,
    null,
    createElement(
      Page,
      { size: "A4", style: styles.page },
      createElement(Text, { style: styles.title }, `${school?.name ?? ""} — سجل التغييرات والإجراءات`),
      createElement(Text, { style: styles.subtitle }, `تاريخ التصدير: ${exportedAt}`),
      createElement(
        View,
        { style: styles.headerRow },
        createElement(Text, { style: { ...styles.headerCell, flex: 3, textAlign: "right" } }, "الإجراء"),
        createElement(Text, { style: { ...styles.headerCell, flex: 1.5, textAlign: "right" } }, "المنفذ"),
        createElement(Text, { style: { ...styles.headerCell, flex: 1.5, textAlign: "right" } }, "الجهاز"),
        createElement(Text, { style: { ...styles.headerCell, flex: 1, textAlign: "right" } }, "IP"),
        createElement(Text, { style: { ...styles.headerCell, flex: 1.5, textAlign: "right" } }, "التاريخ والوقت"),
      ),
      ...logs.map((log, i) =>
        createElement(
          View,
          { key: log.id, style: i % 2 === 1 ? { ...styles.row, ...styles.rowAlt } : styles.row },
          createElement(Text, { style: styles.colAction }, log.action),
          createElement(Text, { style: styles.colBy }, log.performed_by),
          createElement(Text, { style: styles.colDevice }, log.device_info ?? "—"),
          createElement(Text, { style: styles.colIp }, log.ip_address ?? "—"),
          createElement(
            Text,
            { style: styles.colDate },
            `${new Date(log.created_at).toLocaleDateString("ar-SA")} ${new Date(log.created_at).toLocaleTimeString("ar-SA")}`
          ),
        )
      ),
    )
  );

  const buffer = await renderToBuffer(doc as Parameters<typeof renderToBuffer>[0]);
  const fileUrl = `data:application/pdf;base64,${buffer.toString("base64")}`;

  await logExport({
    schoolId,
    exportedEntity: "activity_logs",
    exportFormat: "pdf",
    filters: { limit: MAX_EXPORT_ROWS },
    recordCount: logs.length,
    userId: session.user.id,
    userName: session.user.name,
    request,
  });

  return Response.json({ file_url: fileUrl }, { status: 200 });
}
