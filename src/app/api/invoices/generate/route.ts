export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
} from "@react-pdf/renderer";
import { access } from "fs/promises";
import { join } from "path";

Font.register({
  family: "Arabic",
  fonts: [
    { src: join(process.cwd(), "public", "fonts", "Arabic-Regular.ttf"), fontWeight: "normal" },
    { src: join(process.cwd(), "public", "fonts", "Arabic-Bold.ttf"), fontWeight: "bold" },
  ],
});

Font.registerHyphenationCallback((word) => [word]);

const styles = StyleSheet.create({
  page: { fontFamily: "Arabic", backgroundColor: "#ffffff", padding: 40, fontSize: 11 },
  header: { flexDirection: "row-reverse", justifyContent: "space-between", marginBottom: 24, borderBottom: "1pt solid #e5e7eb", paddingBottom: 16 },
  schoolName: { fontSize: 18, fontWeight: "bold", color: "#1a2340" },
  schoolMeta: { fontSize: 9, color: "#6b7280", marginTop: 2 },
  invoiceTitle: { fontSize: 16, fontWeight: "bold", color: "#1a2340", textAlign: "right" },
  invoiceMeta: { fontSize: 9, color: "#6b7280", textAlign: "right", marginTop: 2 },
  section: { marginBottom: 16, backgroundColor: "#f9fafb", padding: 12, borderRadius: 4 },
  sectionTitle: { fontSize: 12, fontWeight: "bold", color: "#1a2340", marginBottom: 8, textAlign: "right" },
  row: { flexDirection: "row-reverse", justifyContent: "space-between", marginBottom: 4 },
  label: { color: "#6b7280", fontSize: 10 },
  value: { fontWeight: "bold", color: "#111827", fontSize: 10 },
  table: { marginTop: 8 },
  tableHeader: { flexDirection: "row-reverse", backgroundColor: "#1a2340", padding: 8 },
  tableRow: { flexDirection: "row-reverse", padding: 8, borderBottom: "0.5pt solid #e5e7eb" },
  tableCell: { color: "#fff", fontSize: 10, textAlign: "right" },
  tableBodyCell: { fontSize: 10, textAlign: "right", color: "#111827" },
  col1: { flex: 3 },
  col2: { flex: 1 },
  col3: { flex: 1 },
  col4: { flex: 1 },
  total: { flexDirection: "row-reverse", justifyContent: "space-between", marginTop: 8, padding: "8pt 0", borderTop: "1pt solid #1a2340" },
  totalLabel: { fontSize: 12, fontWeight: "bold", color: "#1a2340" },
  totalValue: { fontSize: 12, fontWeight: "bold", color: "#22c55e" },
  paymentBadge: { textAlign: "center", padding: 4, borderRadius: 4, fontSize: 10, marginTop: 8 },
  footer: { position: "absolute", bottom: 30, left: 40, right: 40, textAlign: "center", fontSize: 9, color: "#9ca3af" },
});

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  PAID: "مدفوع",
  LATE: "متأخر",
  CANCELLED: "ملغي",
  SUSPENDED: "موقف",
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: "نقدي",
  TRANSFER: "تحويل بنكي",
  CARD: "بطاقة",
};

const lineItemSchema = z.object({
  description: z.string(),
  qty: z.number(),
  price: z.number(),
  total: z.number(),
});

const fullInvoiceSchema = z.object({
  studentId: z.string(),
  invoiceData: z.object({
    school: z.object({
      name: z.string(),
      commercialRegistration: z.string().nullish(),
      vatNumber: z.string().nullish(),
      contactNumber: z.string().nullish(),
      email: z.string().nullish(),
      address: z.string().nullish(),
    }),
    invoiceNumber: z.string(),
    issuedAt: z.string(),
    dueDate: z.string().nullish(),
    invoiceStatus: z.string(),
    student: z.object({ name: z.string(), idNumber: z.string().nullish(), className: z.string().nullish() }),
    guardian: z.object({ name: z.string().nullish(), phone1: z.string().nullish(), email: z.string().nullish() }),
    paymentMethod: z.string(),
    lineItems: z.array(lineItemSchema),
    activityItems: z.array(lineItemSchema),
    baseTotal: z.number(),
    activitiesTotal: z.number(),
    grandTotal: z.number(),
  }),
});

const simpleSchema = z.object({
  studentId: z.string().optional(),
  teacherId: z.string().optional(),
});

function savePdf(buffer: Buffer): string {
  return `data:application/pdf;base64,${buffer.toString("base64")}`;
}

// Returns a row element or undefined (never null — filter(Boolean) removes undefined too)
function maybeRow(condition: unknown, label: string, value: string) {
  if (!condition) return undefined;
  return createElement(
    View,
    { style: styles.row },
    createElement(Text, { style: styles.label }, label),
    createElement(Text, { style: styles.value }, value),
  );
}

function maybeMeta(condition: unknown, text: string) {
  if (!condition) return undefined;
  return createElement(Text, { style: styles.schoolMeta }, text);
}

export async function POST(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;

  const regularFont = join(process.cwd(), "public", "fonts", "Arabic-Regular.ttf");
  const boldFont = join(process.cwd(), "public", "fonts", "Arabic-Bold.ttf");
  try {
    await access(regularFont);
    await access(boldFont);
  } catch {
    console.error("Font files missing at:", regularFont);
    return Response.json({ error: "Font files missing — run the build script first" }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Branch: full invoice data from modal
  const fullParsed = fullInvoiceSchema.safeParse(body);
  if (fullParsed.success) {
    const { studentId, invoiceData: inv } = fullParsed.data;

    const student = await prisma.student.findFirst({ where: { id: studentId, schoolId } });
    if (!student) return Response.json({ error: "Student not found" }, { status: 404 });

    const PAYMENT_METHODS: Record<string, string> = { CASH: "نقدي", TRANSFER: "تحويل بنكي", CARD: "بطاقة" };

    const activitiesSection =
      inv.activityItems.length > 0
        ? createElement(
            View,
            { style: styles.section },
            createElement(Text, { style: styles.sectionTitle }, "الفعاليات"),
            createElement(
              View,
              { style: styles.table },
              createElement(
                View,
                { style: styles.tableHeader },
                createElement(Text, { style: { ...styles.tableCell, ...styles.col1 } }, "الوصف"),
                createElement(Text, { style: { ...styles.tableCell, ...styles.col2 } }, "الكمية"),
                createElement(Text, { style: { ...styles.tableCell, ...styles.col3 } }, "السعر"),
                createElement(Text, { style: { ...styles.tableCell, ...styles.col4 } }, "الإجمالي"),
              ),
              ...inv.activityItems.map((item, i) =>
                createElement(
                  View,
                  { key: i, style: styles.tableRow },
                  createElement(Text, { style: { ...styles.tableBodyCell, ...styles.col1 } }, item.description || "—"),
                  createElement(Text, { style: { ...styles.tableBodyCell, ...styles.col2 } }, String(item.qty)),
                  createElement(Text, { style: { ...styles.tableBodyCell, ...styles.col3 } }, `${item.price} ر.س`),
                  createElement(Text, { style: { ...styles.tableBodyCell, ...styles.col4 } }, `${item.total.toFixed(2)} ر.س`),
                )
              ),
            ),
            createElement(
              View,
              { style: styles.total },
              createElement(Text, { style: styles.totalLabel }, "إجمالي الفعاليات"),
              createElement(Text, { style: styles.totalValue }, `${inv.activitiesTotal.toFixed(2)} ر.س`),
            ),
          )
        : undefined;

    const pdfDoc = createElement(
      Document,
      null,
      createElement(
        Page,
        { size: "A4", style: styles.page },
        // Header
        createElement(
          View,
          { style: styles.header },
          createElement(
            View,
            null,
            ...[
              createElement(Text, { style: styles.schoolName }, inv.school.name || "—"),
              maybeMeta(inv.school.commercialRegistration, `سجل تجاري: ${inv.school.commercialRegistration}`),
              maybeMeta(inv.school.vatNumber, `رقم ضريبي: ${inv.school.vatNumber}`),
              maybeMeta(inv.school.contactNumber, `تواصل: ${inv.school.contactNumber}`),
              maybeMeta(inv.school.email, inv.school.email ?? ""),
              maybeMeta(inv.school.address, inv.school.address ?? ""),
            ].filter(Boolean)
          ),
          createElement(
            View,
            null,
            ...[
              createElement(Text, { style: styles.invoiceTitle }, `فاتورة رقم ${inv.invoiceNumber}`),
              createElement(Text, { style: styles.invoiceMeta }, `تاريخ الإصدار: ${inv.issuedAt}`),
              inv.dueDate
                ? createElement(Text, { style: styles.invoiceMeta }, `تاريخ الاستحقاق: ${inv.dueDate}`)
                : undefined,
              createElement(Text, { style: styles.invoiceMeta }, `الحالة: ${inv.invoiceStatus}`),
            ].filter(Boolean)
          ),
        ),
        // Student info
        createElement(
          View,
          { style: styles.section },
          ...[
            createElement(Text, { style: styles.sectionTitle }, "بيانات الطالب"),
            maybeRow(true, "اسم الطالب", inv.student.name || "—"),
            maybeRow(inv.student.idNumber, "الرقم الطلابي", inv.student.idNumber ?? ""),
            maybeRow(inv.student.className, "الصف", inv.student.className ?? ""),
            maybeRow(inv.guardian.name, "ولي الأمر", inv.guardian.name ?? ""),
            maybeRow(inv.guardian.phone1, "الجوال", inv.guardian.phone1 ?? ""),
            maybeRow(inv.guardian.email, "البريد", inv.guardian.email ?? ""),
          ].filter(Boolean)
        ),
        // Main line items
        createElement(
          View,
          { style: styles.section },
          createElement(Text, { style: styles.sectionTitle }, "تفاصيل الفاتورة"),
          createElement(
            View,
            { style: styles.table },
            createElement(
              View,
              { style: styles.tableHeader },
              createElement(Text, { style: { ...styles.tableCell, ...styles.col1 } }, "الوصف"),
              createElement(Text, { style: { ...styles.tableCell, ...styles.col2 } }, "الكمية"),
              createElement(Text, { style: { ...styles.tableCell, ...styles.col3 } }, "السعر"),
              createElement(Text, { style: { ...styles.tableCell, ...styles.col4 } }, "الإجمالي"),
            ),
            ...inv.lineItems.map((item, i) =>
              createElement(
                View,
                { key: i, style: styles.tableRow },
                createElement(Text, { style: { ...styles.tableBodyCell, ...styles.col1 } }, item.description || "—"),
                createElement(Text, { style: { ...styles.tableBodyCell, ...styles.col2 } }, String(item.qty)),
                createElement(Text, { style: { ...styles.tableBodyCell, ...styles.col3 } }, `${item.price} ر.س`),
                createElement(Text, { style: { ...styles.tableBodyCell, ...styles.col4 } }, `${item.total.toFixed(2)} ر.س`),
              )
            ),
          ),
          createElement(
            View,
            { style: styles.total },
            createElement(Text, { style: styles.totalLabel }, "إجمالي البنود"),
            createElement(Text, { style: styles.totalValue }, `${inv.baseTotal.toFixed(2)} ر.س`),
          ),
        ),
        // Activities section (spread into page children so undefined is filtered)
        ...([activitiesSection].filter(Boolean) as ReturnType<typeof createElement>[]),
        // Grand total + payment method
        createElement(
          View,
          { style: { ...styles.section, backgroundColor: "#1a2340" } },
          createElement(
            View,
            { style: styles.total },
            createElement(Text, { style: { ...styles.totalLabel, color: "#fff" } }, "الإجمالي الكلي"),
            createElement(Text, { style: { ...styles.totalValue, fontSize: 14 } }, `${inv.grandTotal.toFixed(2)} ر.س`),
          ),
          createElement(
            Text,
            { style: { fontSize: 10, color: "#9ca3af", textAlign: "right", marginTop: 4 } },
            `طريقة الدفع: ${PAYMENT_METHODS[inv.paymentMethod] ?? inv.paymentMethod}`,
          ),
        ),
        createElement(Text, { style: styles.footer }, inv.school.name || ""),
      )
    );

    try {
      console.log("=== invoiceData sent to PDF ===");
      console.log(JSON.stringify({ school: inv.school, student: inv.student, lineItemsCount: inv.lineItems.length, grandTotal: inv.grandTotal }, null, 2));
      const pdfBuffer = await renderToBuffer(pdfDoc as Parameters<typeof renderToBuffer>[0]);
      const fileUrl = savePdf(pdfBuffer);

      const invoice = await prisma.invoice.create({
        data: {
          schoolId,
          type: "STUDENT",
          studentId,
          amount: inv.grandTotal,
          pdfUrl: fileUrl,
          data: inv as object,
        },
      });

      return Response.json({ id: invoice.id, amount: invoice.amount, pdfUrl: fileUrl, createdAt: invoice.createdAt }, { status: 201 });
    } catch (error) {
      console.error("Invoice generation error:", error);
      console.error("Error details:", JSON.stringify(error, Object.getOwnPropertyNames(error as object)));
      return Response.json({ error: String(error) }, { status: 500 });
    }
  }

  // Fallback: simple auto-generate (existing behavior)
  const parsed = simpleSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const { studentId, teacherId } = parsed.data;
  if (!studentId && !teacherId) {
    return Response.json({ error: "studentId or teacherId required" }, { status: 400 });
  }

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    include: { settings: true },
  });
  if (!school) return Response.json({ error: "School not found" }, { status: 404 });

  const invoiceCount = await prisma.invoice.count({ where: { schoolId } });
  const invoiceNumber = String(invoiceCount + 1).padStart(5, "0");

  const today = new Date();
  const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const monthlyFee = school.settings?.monthlyStudentFee ?? 0;

  let pdfDoc: unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let invoiceData: any = {};
  let amount = 0;
  let invoiceType: "STUDENT" | "TEACHER";

  if (studentId) {
    invoiceType = "STUDENT";
    const student = await prisma.student.findUnique({
      where: { id: studentId, schoolId },
      include: { class: true, guardian: true },
    });
    if (!student) return Response.json({ error: "Student not found" }, { status: 404 });

    const lateHoursFee = (student.lateHours ?? 0) * (school.settings?.hourlyLateFee ?? 0);
    amount = monthlyFee + lateHoursFee;

    invoiceData = {
      type: "STUDENT",
      studentName: student.name,
      studentId: student.idNumber,
      className: student.class?.name,
      guardianName: student.guardian?.name,
      guardianPhone: student.guardian?.phone1,
      guardianEmail: student.guardian?.email,
      paymentStatus: student.paymentStatus,
      paymentMethod: student.paymentMethod,
      monthlyFee,
      lateHours: student.lateHours,
      lateHoursFee,
      amount,
    };

    pdfDoc = createElement(
      Document,
      null,
      createElement(
        Page,
        { size: "A4", style: styles.page },
        // Header
        createElement(
          View,
          { style: styles.header },
          createElement(
            View,
            null,
            ...[
              createElement(Text, { style: styles.schoolName }, school.name),
              school.commercialRegistration ? createElement(Text, { style: styles.schoolMeta }, `سجل تجاري: ${school.commercialRegistration}`) : undefined,
              school.vatNumber ? createElement(Text, { style: styles.schoolMeta }, `رقم ضريبي: ${school.vatNumber}`) : undefined,
              school.contactNumber ? createElement(Text, { style: styles.schoolMeta }, `تواصل: ${school.contactNumber}`) : undefined,
              school.email ? createElement(Text, { style: styles.schoolMeta }, school.email) : undefined,
              school.address ? createElement(Text, { style: styles.schoolMeta }, school.address) : undefined,
            ].filter(Boolean)
          ),
          createElement(
            View,
            null,
            createElement(Text, { style: styles.invoiceTitle }, `فاتورة رقم #${invoiceNumber}`),
            createElement(Text, { style: styles.invoiceMeta }, `تاريخ الإصدار: ${today.toLocaleDateString("ar-SA")}`),
            createElement(Text, { style: styles.invoiceMeta }, `تاريخ الاستحقاق: ${lastDayOfMonth.toLocaleDateString("ar-SA")}`),
            createElement(Text, { style: { ...styles.invoiceMeta, color: student.paymentStatus === "PAID" ? "#22c55e" : "#ef4444" } }, `الحالة: ${PAYMENT_STATUS_LABELS[student.paymentStatus] ?? student.paymentStatus}`),
          )
        ),
        // Student info
        createElement(
          View,
          { style: styles.section },
          ...[
            createElement(Text, { style: styles.sectionTitle }, "بيانات الطالب"),
            createElement(View, { style: styles.row }, createElement(Text, { style: styles.label }, "اسم الطالب"), createElement(Text, { style: styles.value }, student.name ?? "")),
            student.idNumber ? createElement(View, { style: styles.row }, createElement(Text, { style: styles.label }, "رقم الهوية"), createElement(Text, { style: styles.value }, student.idNumber)) : undefined,
            student.class?.name ? createElement(View, { style: styles.row }, createElement(Text, { style: styles.label }, "الفصل"), createElement(Text, { style: styles.value }, student.class.name)) : undefined,
            student.guardian?.name ? createElement(View, { style: styles.row }, createElement(Text, { style: styles.label }, "ولي الأمر"), createElement(Text, { style: styles.value }, student.guardian.name)) : undefined,
            student.guardian?.phone1 ? createElement(View, { style: styles.row }, createElement(Text, { style: styles.label }, "الهاتف"), createElement(Text, { style: styles.value }, student.guardian.phone1)) : undefined,
          ].filter(Boolean)
        ),
        // Line items
        createElement(
          View,
          { style: styles.section },
          createElement(Text, { style: styles.sectionTitle }, "تفاصيل الفاتورة"),
          createElement(
            View,
            { style: styles.table },
            createElement(View, { style: styles.tableHeader },
              createElement(Text, { style: { ...styles.tableCell, ...styles.col1 } }, "الوصف"),
              createElement(Text, { style: { ...styles.tableCell, ...styles.col2 } }, "الكمية"),
              createElement(Text, { style: { ...styles.tableCell, ...styles.col3 } }, "السعر"),
              createElement(Text, { style: { ...styles.tableCell, ...styles.col4 } }, "الإجمالي"),
            ),
            createElement(View, { style: styles.tableRow },
              createElement(Text, { style: { ...styles.tableBodyCell, ...styles.col1 } }, "الرسوم الشهرية"),
              createElement(Text, { style: { ...styles.tableBodyCell, ...styles.col2 } }, "1"),
              createElement(Text, { style: { ...styles.tableBodyCell, ...styles.col3 } }, `${monthlyFee} ر.س`),
              createElement(Text, { style: { ...styles.tableBodyCell, ...styles.col4 } }, `${monthlyFee} ر.س`),
            ),
            ...([
              lateHoursFee > 0 ? createElement(View, { style: styles.tableRow },
                createElement(Text, { style: { ...styles.tableBodyCell, ...styles.col1 } }, `رسوم تأخير (${student.lateHours} ساعة)`),
                createElement(Text, { style: { ...styles.tableBodyCell, ...styles.col2 } }, `${student.lateHours}`),
                createElement(Text, { style: { ...styles.tableBodyCell, ...styles.col3 } }, `${school.settings?.hourlyLateFee} ر.س`),
                createElement(Text, { style: { ...styles.tableBodyCell, ...styles.col4 } }, `${lateHoursFee} ر.س`),
              ) : undefined,
            ].filter(Boolean) as ReturnType<typeof createElement>[]),
          ),
          createElement(View, { style: styles.total },
            createElement(Text, { style: styles.totalLabel }, "الإجمالي"),
            createElement(Text, { style: styles.totalValue }, `${amount} ر.س`),
          ),
          createElement(Text, { style: { fontSize: 10, color: "#6b7280", marginTop: 4, textAlign: "right" } }, `طريقة الدفع: ${PAYMENT_METHOD_LABELS[student.paymentMethod] ?? student.paymentMethod}`),
        ),
        // Footer
        createElement(Text, { style: styles.footer }, school.name),
      )
    );
  } else {
    // Teacher invoice
    invoiceType = "TEACHER";
    const teacher = await prisma.teacher.findUnique({
      where: { id: teacherId!, schoolId },
      include: { classes: true },
    });
    if (!teacher) return Response.json({ error: "Teacher not found" }, { status: 404 });

    const deduction = (teacher.lateHours ?? 0) * (teacher.lateDeductionRate ?? 0);
    const netSalary = (teacher.monthlySalary ?? 0) - deduction;
    amount = netSalary;

    invoiceData = {
      type: "TEACHER",
      teacherName: teacher.name,
      teacherId: teacher.idNumber,
      className: teacher.classes?.[0]?.name,
      baseSalary: teacher.monthlySalary,
      lateHours: teacher.lateHours,
      deduction,
      netSalary,
    };

    pdfDoc = createElement(
      Document,
      null,
      createElement(
        Page,
        { size: "A4", style: styles.page },
        createElement(
          View,
          { style: styles.header },
          createElement(
            View,
            null,
            ...[
              createElement(Text, { style: styles.schoolName }, school.name),
              school.commercialRegistration ? createElement(Text, { style: styles.schoolMeta }, `سجل تجاري: ${school.commercialRegistration}`) : undefined,
              school.vatNumber ? createElement(Text, { style: styles.schoolMeta }, `رقم ضريبي: ${school.vatNumber}`) : undefined,
              school.email ? createElement(Text, { style: styles.schoolMeta }, school.email) : undefined,
            ].filter(Boolean)
          ),
          createElement(
            View,
            null,
            createElement(Text, { style: styles.invoiceTitle }, `فاتورة رقم #${invoiceNumber}`),
            createElement(Text, { style: styles.invoiceMeta }, `تاريخ الإصدار: ${today.toLocaleDateString("ar-SA")}`),
          )
        ),
        createElement(
          View,
          { style: styles.section },
          ...[
            createElement(Text, { style: styles.sectionTitle }, "بيانات المعلم"),
            createElement(View, { style: styles.row }, createElement(Text, { style: styles.label }, "الاسم"), createElement(Text, { style: styles.value }, teacher.name ?? "")),
            teacher.idNumber ? createElement(View, { style: styles.row }, createElement(Text, { style: styles.label }, "رقم الهوية"), createElement(Text, { style: styles.value }, teacher.idNumber)) : undefined,
            teacher.classes?.[0]?.name ? createElement(View, { style: styles.row }, createElement(Text, { style: styles.label }, "الفصل"), createElement(Text, { style: styles.value }, teacher.classes[0].name)) : undefined,
          ].filter(Boolean)
        ),
        createElement(
          View,
          { style: styles.section },
          createElement(Text, { style: styles.sectionTitle }, "تفاصيل الراتب"),
          createElement(View, { style: styles.row }, createElement(Text, { style: styles.label }, "الراتب الأساسي"), createElement(Text, { style: styles.value }, `${teacher.monthlySalary} ر.س`)),
          createElement(View, { style: styles.row }, createElement(Text, { style: styles.label }, `ساعات التأخير (${teacher.lateHours})`), createElement(Text, { style: { ...styles.value, color: "#ef4444" } }, `- ${deduction} ر.س`)),
          createElement(View, { style: styles.total },
            createElement(Text, { style: styles.totalLabel }, "صافي الراتب"),
            createElement(Text, { style: styles.totalValue }, `${netSalary} ر.س`),
          ),
        ),
        createElement(Text, { style: styles.footer }, school.name),
      )
    );
  }

  // Generate PDF
  try {
    const pdfBuffer = await renderToBuffer(pdfDoc as Parameters<typeof renderToBuffer>[0]);
    const fileUrl = savePdf(pdfBuffer);

    const invoice = await prisma.invoice.create({
      data: {
        schoolId,
        type: invoiceType,
        studentId: studentId ?? null,
        teacherId: teacherId ?? null,
        amount,
        pdfUrl: fileUrl,
        data: invoiceData,
      },
    });

    return Response.json({ ...invoice, pdfUrl: fileUrl });
  } catch (error) {
    console.error("Auto-generate invoice error:", error);
    console.error("Error details:", JSON.stringify(error, Object.getOwnPropertyNames(error as object)));
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
