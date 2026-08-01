import { requireSession } from "@/lib/session";
import { getFinancialSummary, type ReportPeriodType } from "@/lib/finance";
import { logExport } from "@/lib/export-audit";
import * as XLSX from "xlsx";
import { z } from "zod";

const schema = z.object({ type: z.enum(["monthly", "semi_annual", "annual"]) });

export async function POST(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const schoolId = session.user.schoolId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const parsed = schema.safeParse(body);
  const type: ReportPeriodType = parsed.success ? parsed.data.type : "monthly";

  const summary = await getFinancialSummary(schoolId, type);

  const wb = XLSX.utils.book_new();

  const revenueSheet = XLSX.utils.json_to_sheet([
    { البند: "الرسوم الشهرية", المبلغ: summary.revenue.monthlyFees },
    { البند: "رسوم التسجيل المحصّلة", المبلغ: summary.revenue.registrationFeesCollected },
    { البند: "رسوم الفعاليات", المبلغ: summary.revenue.activities },
    { البند: "غرامات التأخير", المبلغ: summary.revenue.lateFees },
    { البند: "ضريبة القيمة المضافة المحصَّلة", المبلغ: summary.revenue.vatCollected },
    { البند: "إجمالي الإيرادات", المبلغ: summary.revenue.total },
    ...summary.details.revenue.map((r) => ({ البند: r.label, المبلغ: r.amount, التاريخ: new Date(r.date).toLocaleDateString("ar-SA") })),
  ]);
  XLSX.utils.book_append_sheet(wb, revenueSheet, "الإيرادات");

  const expensesSheet = XLSX.utils.json_to_sheet([
    { البند: "الرواتب", المبلغ: summary.expenses.salaries },
    ...summary.expenses.manual.map((e) => ({ البند: e.title, المبلغ: e.amount })),
    { البند: "إجمالي المصروفات", المبلغ: summary.expenses.total },
  ]);
  XLSX.utils.book_append_sheet(wb, expensesSheet, "المصروفات");

  const paymentsSheet = XLSX.utils.json_to_sheet([
    ...summary.details.revenue.map((r) => ({ النوع: "إيراد", البند: r.label, التاريخ: new Date(r.date).toLocaleDateString("ar-SA"), المبلغ: r.amount })),
    ...summary.details.salaries.map((r) => ({ النوع: "راتب", البند: r.label, التاريخ: new Date(r.date).toLocaleDateString("ar-SA"), المبلغ: -r.amount })),
    ...summary.details.manualExpenses.map((r) => ({ النوع: "مصروف", البند: r.label, التاريخ: new Date(r.date).toLocaleDateString("ar-SA"), المبلغ: -r.amount })),
  ]);
  XLSX.utils.book_append_sheet(wb, paymentsSheet, "المدفوعات");

  const salariesSheet = XLSX.utils.json_to_sheet([
    { البند: "إجمالي الرواتب (عقود المعلمين النشطين)", المبلغ: summary.salaries.totalBudgeted },
    { البند: "مصروف", المبلغ: summary.salaries.paid },
    { البند: "متبقي", المبلغ: summary.salaries.remaining },
    ...summary.expenses.salaryItems.map((s) => ({ البند: s.name, المبلغ: s.amount })),
  ]);
  XLSX.utils.book_append_sheet(wb, salariesSheet, "الرواتب");

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const base64 = buffer.toString("base64");

  await logExport({
    schoolId,
    exportedEntity: "financial_report",
    exportFormat: "excel",
    filters: { period: type, from: summary.period.from, to: summary.period.to },
    recordCount:
      summary.details.revenue.length +
      summary.details.salaries.length +
      summary.details.manualExpenses.length,
    userId: session.user.id,
    userName: session.user.name,
    request,
  });

  return Response.json({
    file: `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${base64}`,
  });
}
