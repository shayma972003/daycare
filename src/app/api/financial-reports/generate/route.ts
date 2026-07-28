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

function getPeriodRange(type: "monthly" | "semi_annual" | "annual") {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  if (type === "annual") {
    return { from: new Date(y, 0, 1), to: new Date(y, 11, 31, 23, 59, 59, 999) };
  }
  if (type === "semi_annual") {
    return { from: new Date(y, m - 5, 1), to: new Date(y, m + 1, 0, 23, 59, 59, 999) };
  }
  return { from: new Date(y, m, 1), to: new Date(y, m + 1, 0, 23, 59, 59, 999) };
}

function countOverlappingMonths(from: Date, to: Date): number {
  if (from > to) return 0;
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth()) + 1;
}

function expenseAmountInPeriod(
  exp: { amount: number; type: string; start_date: Date; stopped_at: Date | null },
  from: Date,
  to: Date
): number {
  const startDate = new Date(exp.start_date);
  if (exp.type === "one_time") {
    return startDate >= from && startDate <= to ? exp.amount : 0;
  }
  const effectiveEnd = exp.stopped_at
    ? new Date(Math.min(new Date(exp.stopped_at).getTime(), to.getTime()))
    : to;
  if (startDate <= effectiveEnd) {
    const months = countOverlappingMonths(new Date(Math.max(startDate.getTime(), from.getTime())), effectiveEnd);
    return exp.amount * months;
  }
  return 0;
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
  const { from, to } = getPeriodRange(type);

  const [school, studentRevenue, teacherInvoices, expenses, paymentStatusGroups] = await Promise.all([
    prisma.school.findUnique({ where: { id: schoolId } }),
    prisma.invoice.aggregate({
      where: { schoolId, type: "STUDENT", createdAt: { gte: from, lte: to } },
      _sum: { amount: true },
    }),
    prisma.invoice.findMany({
      where: { schoolId, type: "TEACHER", createdAt: { gte: from, lte: to } },
      include: { teacher: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.expense.findMany({ where: { school_id: schoolId } }),
    prisma.student.groupBy({ by: ["paymentStatus"], where: { schoolId }, _count: { paymentStatus: true } }),
  ]);

  const revenue = studentRevenue._sum.amount ?? 0;

  const paymentStatusBreakdown: Record<string, number> = { PAID: 0, LATE: 0, "بانتظار الدفع": 0 };
  for (const g of paymentStatusGroups) {
    if (g.paymentStatus in paymentStatusBreakdown) paymentStatusBreakdown[g.paymentStatus] = g._count.paymentStatus;
  }

  const salaryItems = teacherInvoices.map((inv) => ({ name: inv.teacher?.name ?? "معلم", amount: inv.amount }));
  const salariesTotal = salaryItems.reduce((s, i) => s + i.amount, 0);

  const expenseItems = expenses
    .map((e) => ({ title: e.title, amount: expenseAmountInPeriod(e, from, to) }))
    .filter((e) => e.amount > 0);
  const manualExpensesTotal = expenseItems.reduce((s, i) => s + i.amount, 0);

  const totalExpenses = salariesTotal + manualExpensesTotal;
  const netProfit = revenue - totalExpenses;

  const reportName = `${TYPE_LABELS[type] ?? "تقرير"} — ${period_label}`;

  const doc = createElement(Document, null,
    createElement(Page, { size: "A4", style: styles.page },
      createElement(Text, { style: styles.title }, reportName),
      createElement(Text, { style: styles.subtitle }, `المنشأة: ${school?.name ?? ""} — ${period_label}`),

      createElement(View, { style: styles.section },
        createElement(Text, { style: styles.sectionTitle }, "الملخص المالي"),
        createElement(View, { style: styles.row }, createElement(Text, { style: styles.label }, "الإيرادات"), createElement(Text, { style: styles.value }, fmt(revenue))),
        createElement(View, { style: styles.row }, createElement(Text, { style: styles.label }, "المصاريف الكلية"), createElement(Text, { style: styles.value }, fmt(totalExpenses))),
        createElement(View, { style: styles.row }, createElement(Text, { style: styles.label }, netProfit >= 0 ? "صافي الربح" : "صافي الخسارة"), createElement(Text, { style: { ...styles.value, color: netProfit >= 0 ? "#22c55e" : "#ef4444" } }, fmt(Math.abs(netProfit)))),
      ),

      createElement(View, { style: styles.section },
        createElement(Text, { style: styles.sectionTitle }, "توزيع حالات الدفع"),
        createElement(View, { style: styles.row }, createElement(Text, { style: styles.label }, "مدفوع"), createElement(Text, { style: styles.value }, String(paymentStatusBreakdown.PAID))),
        createElement(View, { style: styles.row }, createElement(Text, { style: styles.label }, "متأخر"), createElement(Text, { style: styles.value }, String(paymentStatusBreakdown.LATE))),
        createElement(View, { style: styles.row }, createElement(Text, { style: styles.label }, "بانتظار الدفع"), createElement(Text, { style: styles.value }, String(paymentStatusBreakdown["بانتظار الدفع"]))),
      ),

      createElement(View, { style: styles.section },
        createElement(Text, { style: styles.sectionTitle }, "تفصيل المصاريف"),

        createElement(Text, { style: styles.subsectionTitle }, "الرواتب المصروفة"),
        ...(salaryItems.length > 0
          ? salaryItems.map((s, i) =>
              createElement(View, { key: `sal-${i}`, style: styles.row },
                createElement(Text, { style: styles.label }, s.name),
                createElement(Text, { style: styles.value }, fmt(s.amount)),
              )
            )
          : [createElement(Text, { key: "sal-empty", style: styles.empty }, "لا توجد رواتب مصروفة خلال هذه الفترة")]),

        createElement(Text, { style: styles.subsectionTitle }, "المصاريف المضافة يدويًا"),
        ...(expenseItems.length > 0
          ? expenseItems.map((e, i) =>
              createElement(View, { key: `exp-${i}`, style: styles.row },
                createElement(Text, { style: styles.label }, e.title),
                createElement(Text, { style: styles.value }, fmt(e.amount)),
              )
            )
          : [createElement(Text, { key: "exp-empty", style: styles.empty }, "لا توجد مصاريف مضافة خلال هذه الفترة")]),
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
