export const runtime = "nodejs";

import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
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
  row: { flexDirection: "row-reverse", justifyContent: "space-between", marginBottom: 6 },
  label: { fontSize: 10, color: "#6b7280" },
  value: { fontSize: 10, fontWeight: "bold", color: "#111827" },
  footer: { position: "absolute", bottom: 30, left: 40, right: 40, textAlign: "center", fontSize: 9, color: "#9ca3af" },
});

const schema = z.object({
  type: z.enum(["monthly", "semi_annual", "annual"]),
  period_label: z.string(),
  stats: z.any().optional(),
  expenseData: z.any().optional(),
});

const TYPE_LABELS: Record<string, string> = {
  monthly: "التقرير المالي الشهري",
  semi_annual: "التقرير المالي نصف السنوي",
  annual: "التقرير المالي السنوي",
};

function fmt(n: number) {
  return `${Number(n).toFixed(2)} ر.س`;
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

  const { type, period_label, stats, expenseData } = parsed.data;

  const school = await prisma.school.findUnique({ where: { id: schoolId } });

  const revenue = stats?.financialSummary?.revenue ?? 0;
  const expenses = stats?.financialSummary?.expenses ?? 0;
  const netProfit = stats?.financialSummary?.netProfit ?? 0;
  const regFees = stats?.financialSummary?.totalRegistrationFees ?? 0;

  const paid = stats?.paymentStatusBreakdown?.PAID ?? 0;
  const late = stats?.paymentStatusBreakdown?.LATE ?? 0;
  const pending = stats?.paymentStatusBreakdown?.["بانتظار الدفع"] ?? 0;

  const rent = expenseData?.expense?.rent ?? 0;
  const maintenance = expenseData?.expense?.maintenance ?? 0;
  const materials = expenseData?.expense?.materials ?? 0;
  const misc = expenseData?.expense?.misc ?? 0;
  const salaries = expenseData?.salaries ?? 0;

  const reportName = `${TYPE_LABELS[type] ?? "تقرير"} — ${period_label}`;

  const doc = createElement(Document, null,
    createElement(Page, { size: "A4", style: styles.page },
      createElement(Text, { style: styles.title }, reportName),
      createElement(Text, { style: styles.subtitle }, `المنشأة: ${school?.name ?? ""} — ${period_label}`),

      createElement(View, { style: styles.section },
        createElement(Text, { style: styles.sectionTitle }, "الملخص المالي"),
        createElement(View, { style: styles.row }, createElement(Text, { style: styles.label }, "الإيرادات"), createElement(Text, { style: styles.value }, fmt(revenue))),
        createElement(View, { style: styles.row }, createElement(Text, { style: styles.label }, "رسوم التسجيل"), createElement(Text, { style: styles.value }, fmt(regFees))),
        createElement(View, { style: styles.row }, createElement(Text, { style: styles.label }, "المصاريف الكلية"), createElement(Text, { style: styles.value }, fmt(expenses))),
        createElement(View, { style: styles.row }, createElement(Text, { style: styles.label }, netProfit >= 0 ? "صافي الربح" : "صافي الخسارة"), createElement(Text, { style: { ...styles.value, color: netProfit >= 0 ? "#22c55e" : "#ef4444" } }, fmt(Math.abs(netProfit)))),
      ),

      createElement(View, { style: styles.section },
        createElement(Text, { style: styles.sectionTitle }, "توزيع حالات الدفع"),
        createElement(View, { style: styles.row }, createElement(Text, { style: styles.label }, "مدفوع"), createElement(Text, { style: styles.value }, String(paid))),
        createElement(View, { style: styles.row }, createElement(Text, { style: styles.label }, "متأخر"), createElement(Text, { style: styles.value }, String(late))),
        createElement(View, { style: styles.row }, createElement(Text, { style: styles.label }, "بانتظار الدفع"), createElement(Text, { style: styles.value }, String(pending))),
      ),

      createElement(View, { style: styles.section },
        createElement(Text, { style: styles.sectionTitle }, "تفصيل المصاريف"),
        createElement(View, { style: styles.row }, createElement(Text, { style: styles.label }, "الإيجار"), createElement(Text, { style: styles.value }, fmt(rent))),
        createElement(View, { style: styles.row }, createElement(Text, { style: styles.label }, "الصيانة"), createElement(Text, { style: styles.value }, fmt(maintenance))),
        createElement(View, { style: styles.row }, createElement(Text, { style: styles.label }, "المواد"), createElement(Text, { style: styles.value }, fmt(materials))),
        createElement(View, { style: styles.row }, createElement(Text, { style: styles.label }, "مصاريف إضافية"), createElement(Text, { style: styles.value }, fmt(misc))),
        createElement(View, { style: styles.row }, createElement(Text, { style: styles.label }, "الرواتب"), createElement(Text, { style: styles.value }, fmt(salaries))),
      ),

      createElement(Text, { style: styles.footer }, school?.name ?? ""),
    )
  );

  const buffer = await renderToBuffer(doc as Parameters<typeof renderToBuffer>[0]);
  const fileUrl = `data:application/pdf;base64,${buffer.toString("base64")}`;

  const report = await prisma.financialReport.create({
    data: { school_id: schoolId, name: reportName, type, period_label, file_url: fileUrl },
  });

  return Response.json({ ...report, file_url: fileUrl }, { status: 201 });
}
