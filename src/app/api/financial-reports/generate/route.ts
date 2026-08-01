export const runtime = "nodejs";

import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logExport } from "@/lib/export-audit";
import { getFinancialSummary, type ReportPeriodType } from "@/lib/finance";
import { renderToBuffer, Document, Page, Text, View, StyleSheet, Font } from "@react-pdf/renderer";
import { createElement } from "react";
import { join } from "path";
import { z } from "zod";

Font.register({
  family: "Arabic",
  fonts: [
    { src: join(process.cwd(), "public", "fonts", "Arabic-Regular.ttf"), fontWeight: "normal" },
    { src: join(process.cwd(), "public", "fonts", "Arabic-Bold.ttf"), fontWeight: "bold" },
  ],
});
Font.registerHyphenationCallback((w) => [w]);

const styles = StyleSheet.create({
  page: { fontFamily: "Arabic", backgroundColor: "#ffffff", padding: 40, fontSize: 11 },
  title: { fontSize: 18, fontWeight: "bold", color: "#1a2340", textAlign: "right", marginBottom: 4 },
  subtitle: { fontSize: 11, color: "#6b7280", textAlign: "right", marginBottom: 24 },
  section: { marginBottom: 16, backgroundColor: "#f9fafb", padding: 12, borderRadius: 4 },
  sectionTitle: { fontSize: 13, fontWeight: "bold", color: "#1a2340", textAlign: "right", marginBottom: 10 },
  subsectionTitle: { fontSize: 11, fontWeight: "bold", color: "#374151", textAlign: "right", marginTop: 8, marginBottom: 6 },
  row: { flexDirection: "row-reverse", justifyContent: "space-between", marginBottom: 6 },
  label: { fontSize: 10, color: "#6b7280" },
  value: { fontSize: 10, fontWeight: "bold", color: "#111827" },
  empty: { fontSize: 10, color: "#9ca3af", textAlign: "right", marginBottom: 6 },
  footer: { position: "absolute", bottom: 30, left: 40, right: 40, textAlign: "center", fontSize: 9, color: "#9ca3af" },
});

const schema = z.object({
  type: z.enum(["monthly", "semi_annual", "annual"]),
  period_label: z.string(),
});

const TYPE_LABELS: Record<string, string> = {
  monthly: "التقرير المالي الشهري",
  semi_annual: "التقرير المالي نصف السنوي",
  annual: "التقرير المالي السنوي",
};

function fmt(n: number) {
  return `${Number(n).toFixed(2)} ر.س`;
}

function pctLabel(pct: number | null): string {
  if (pct === null) return "لا تتوفر بيانات للمقارنة";
  return `${pct >= 0 ? "↑" : "↓"} ${Math.abs(pct).toFixed(1)}%`;
}

function row(label: string, value: string, valueColor?: string) {
  return createElement(View, { style: styles.row },
    createElement(Text, { style: styles.label }, label),
    createElement(Text, { style: valueColor ? { ...styles.value, color: valueColor } : styles.value }, value),
  );
}

export async function POST(request: Request) {
  let session;
  try { session = await requireSession(); } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;

  let body: unknown;
  try { body = await request.json(); } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid data" }, { status: 422 });

  const { type, period_label } = parsed.data;
  const [school, summary] = await Promise.all([
    prisma.school.findUnique({ where: { id: schoolId } }),
    getFinancialSummary(schoolId, type as ReportPeriodType),
  ]);

  const reportName = `${TYPE_LABELS[type] ?? "تقرير"} — ${period_label}`;
  const netColor = summary.netIncome >= 0 ? "#22c55e" : "#ef4444";

  const doc = createElement(Document, null,
    createElement(Page, { size: "A4", style: styles.page },
      createElement(Text, { style: styles.title }, reportName),
      createElement(Text, { style: styles.subtitle }, `المنشأة: ${school?.name ?? ""} — ${period_label}`),

      // المالية
      createElement(View, { style: styles.section },
        createElement(Text, { style: styles.sectionTitle }, "المالية"),
        row("الإيرادات", fmt(summary.revenue.total)),
        row("المصروفات", fmt(summary.expenses.total)),
        row(summary.netIncome >= 0 ? "صافي الدخل" : "صافي الخسارة", fmt(Math.abs(summary.netIncome)), netColor),
        row("المبالغ المستحقة", fmt(summary.amountDue)),
      ),

      // الأداء المالي
      createElement(View, { style: styles.section },
        createElement(Text, { style: styles.sectionTitle }, "الأداء المالي — مقارنة بالفترة السابقة"),
        row("الإيرادات", pctLabel(summary.comparison.revenuePct)),
        row("المصروفات", pctLabel(summary.comparison.expensesPct)),
      ),

      // الإيرادات
      createElement(View, { style: styles.section },
        createElement(Text, { style: styles.sectionTitle }, "الإيرادات"),
        row("الرسوم الشهرية", fmt(summary.revenue.monthlyFees)),
        row("غرامات التأخير", fmt(summary.revenue.lateFees)),
        row("رسوم التسجيل المحصّلة", fmt(summary.revenue.registrationFeesCollected)),
        row("رسوم الفعاليات", fmt(summary.revenue.activities)),
        row("ضريبة القيمة المضافة المحصَّلة", fmt(summary.revenue.vatCollected)),
      ),

      // التحصيل
      createElement(View, { style: styles.section },
        createElement(Text, { style: styles.sectionTitle }, "التحصيل (حسب حالة دفع الطلاب النشطين)"),
        row(`مدفوع — الإجمالي الصافي (${summary.collection.paidCount} طالب)`, fmt(summary.collection.paid)),
        row(`مدفوع — شامل الضريبة (${summary.collection.paidCount} طالب)`, fmt(summary.collection.paidWithVat)),
        row(`متأخر (${summary.collection.lateCount} طالب)`, fmt(summary.collection.late)),
        row(`بانتظار الدفع (${summary.collection.pendingCount} طالب)`, fmt(summary.collection.pending)),
        // Suspended students were absent from this report entirely, so the
        // rows never added up to the receivables figure above.
        row(`موقوف (${summary.collection.suspendedCount} طالب)`, fmt(summary.collection.suspended)),
      ),

      // المصروفات
      createElement(View, { style: styles.section },
        createElement(Text, { style: styles.sectionTitle }, "المصروفات"),
        row("الرواتب", fmt(summary.expenses.salaries)),
        ...(summary.expenses.manual.length > 0
          ? summary.expenses.manual.map((e, i) => createElement(View, { key: `exp-${i}`, style: styles.row },
              createElement(Text, { style: styles.label }, e.title),
              createElement(Text, { style: styles.value }, fmt(e.amount)),
            ))
          : [createElement(Text, { key: "exp-empty", style: styles.empty }, "لا توجد مصاريف مضافة يدويًا خلال هذه الفترة")]),
      ),

      // الرواتب
      createElement(View, { style: styles.section },
        createElement(Text, { style: styles.sectionTitle }, "الرواتب"),
        row("إجمالي الرواتب (حسب عقود المعلمين النشطين)", fmt(summary.salaries.totalBudgeted)),
        row("مصروف", fmt(summary.salaries.paid)),
        row("متبقي", fmt(summary.salaries.remaining)),
      ),

      // التدفق النقدي
      createElement(View, { style: styles.section },
        createElement(Text, { style: styles.sectionTitle }, "التدفق النقدي"),
        row("الرصيد الافتتاحي", fmt(summary.cashFlow.openingBalance)),
        row("المتحصلات", `+ ${fmt(summary.cashFlow.inflows)}`),
        row("المصروفات", `- ${fmt(summary.cashFlow.outflows)}`),
        row("الرصيد الحالي", fmt(summary.cashFlow.closingBalance)),
      ),

      createElement(Text, { style: styles.footer }, school?.name ?? ""),
    )
  );

  const buffer = await renderToBuffer(doc as Parameters<typeof renderToBuffer>[0]);
  const fileUrl = `data:application/pdf;base64,${buffer.toString("base64")}`;

  const report = await prisma.financialReport.create({
    data: { school_id: schoolId, name: reportName, type, period_label, file_url: fileUrl },
  });

  await logExport({
    schoolId,
    exportedEntity: "financial_report",
    exportFormat: "pdf",
    filters: { type, period_label, from: summary.period.from, to: summary.period.to },
    userId: session.user.id,
    userName: session.user.name,
    request,
  });

  return Response.json({ ...report, file_url: fileUrl }, { status: 201 });
}
