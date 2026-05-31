export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { Document, Page, Text, View, StyleSheet, Font } from "@react-pdf/renderer";
import { writeFile, mkdir, access } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";

Font.register({
  family: "Arabic",
  fonts: [
    { src: join(process.cwd(), "public", "fonts", "Arabic-Regular.ttf"), fontWeight: "normal" },
    { src: join(process.cwd(), "public", "fonts", "Arabic-Bold.ttf"), fontWeight: "bold" },
  ],
});

Font.registerHyphenationCallback((word) => [word]);

const styles = StyleSheet.create({
  page:             { fontFamily: "Arabic", padding: 40, direction: "rtl", fontSize: 11 },
  header:           { flexDirection: "row-reverse", justifyContent: "space-between", marginBottom: 24, borderBottom: "1pt solid #e5e7eb", paddingBottom: 16 },
  schoolName:       { fontSize: 18, fontWeight: "bold", color: "#1a2340" },
  schoolMeta:       { fontSize: 9, color: "#6b7280", marginTop: 2 },
  invoiceTitle:     { fontSize: 16, fontWeight: "bold", color: "#1a2340", textAlign: "right" },
  invoiceMeta:      { fontSize: 9, color: "#6b7280", textAlign: "right", marginTop: 2 },
  section:          { marginBottom: 16, backgroundColor: "#f9fafb", padding: 12, borderRadius: 4 },
  sectionTitle:     { fontSize: 12, fontWeight: "bold", color: "#1a2340", marginBottom: 8, textAlign: "right" },
  row:              { flexDirection: "row-reverse", justifyContent: "space-between", marginBottom: 4 },
  label:            { color: "#6b7280", fontSize: 10 },
  value:            { fontWeight: "bold", color: "#111827", fontSize: 10 },
  table:            { marginTop: 8 },
  tableHeader:      { flexDirection: "row-reverse", backgroundColor: "#1a2340", padding: 8 },
  tableRow:         { flexDirection: "row-reverse", padding: 8, borderBottom: "0.5pt solid #e5e7eb" },
  tableCell:        { color: "#fff", fontSize: 10, textAlign: "right" },
  tableBodyCell:    { fontSize: 10, textAlign: "right", color: "#111827" },
  tableBodyCellRed: { fontSize: 10, textAlign: "right", color: "#ef4444" },
  col1: { flex: 3 },
  col2: { flex: 1 },
  col3: { flex: 1 },
  col4: { flex: 1 },
  total:    { flexDirection: "row-reverse", justifyContent: "space-between", marginTop: 8, padding: "8pt 0", borderTop: "1pt solid #1a2340" },
  totalLabel: { fontSize: 12, fontWeight: "bold", color: "#1a2340" },
  totalValue: { fontSize: 12, fontWeight: "bold", color: "#22c55e" },
  footer:   { position: "absolute", bottom: 30, left: 40, right: 40, textAlign: "center", fontSize: 9, color: "#9ca3af" },
});

const lineItemSchema = z.object({
  description: z.string(),
  lateHours: z.union([z.number(), z.literal("")]),
  price: z.number(),
  total: z.number(),
});

const bodySchema = z.object({
  teacherId: z.string(),
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
    teacher: z.object({
      full_name: z.string(),
      class_name: z.string().nullish(),
      phone_1: z.string().nullish(),
      email: z.string().nullish(),
    }),
    paymentMethod: z.string(),
    lineItems: z.array(lineItemSchema),
    netSalary: z.number(),
  }),
});

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: "نقدي",
  TRANSFER: "تحويل بنكي",
  CARD: "بطاقة",
};

// Returns undefined so .filter(Boolean) removes it — same pattern as working student invoice
function maybeMeta(cond: unknown, text: string) {
  if (!cond) return undefined;
  return createElement(Text, { style: styles.schoolMeta }, String(text));
}

function maybeRow(cond: unknown, label: string, val: string) {
  if (!cond) return undefined;
  return createElement(
    View,
    { style: styles.row },
    createElement(Text, { style: styles.label }, String(label)),
    createElement(Text, { style: styles.value }, String(val || "—"))
  );
}

async function savePdf(buffer: Buffer): Promise<string> {
  const dir = join(process.cwd(), "public", "invoices");
  await mkdir(dir, { recursive: true });
  const filename = `invoice-${randomUUID()}.pdf`;
  await writeFile(join(dir, filename), buffer);
  return `/invoices/${filename}`;
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

  try {
    let body: unknown;
    try { body = await request.json(); } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
    }

    const { teacherId, invoiceData: inv } = parsed.data;

    const teacher = await prisma.teacher.findFirst({ where: { id: teacherId, schoolId } });
    if (!teacher) return Response.json({ error: "Teacher not found" }, { status: 404 });

    // Mirror EXACTLY the same structure as the working student invoice route:
    // - Document, null (not {})
    // - Inner header Views use null props
    // - All children built inline, not from pre-built arrays
    // - .filter(Boolean) on every array that can contain undefined
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
        // Teacher info
        createElement(
          View,
          { style: styles.section },
          ...[
            createElement(Text, { style: styles.sectionTitle }, "بيانات المعلم"),
            maybeRow(true, "الاسم", inv.teacher.full_name || "—"),
            maybeRow(inv.teacher.class_name, "الصف", inv.teacher.class_name ?? ""),
            maybeRow(inv.teacher.phone_1, "رقم الجوال", inv.teacher.phone_1 ?? ""),
            maybeRow(inv.teacher.email, "البريد الإلكتروني", inv.teacher.email ?? ""),
          ].filter(Boolean)
        ),
        // Line items table
        createElement(
          View,
          { style: styles.section },
          createElement(Text, { style: styles.sectionTitle }, "تفاصيل الراتب"),
          createElement(
            View,
            { style: styles.table },
            createElement(
              View,
              { style: styles.tableHeader },
              createElement(Text, { style: { ...styles.tableCell, ...styles.col1 } }, "الوصف"),
              createElement(Text, { style: { ...styles.tableCell, ...styles.col2 } }, "ساعات التأخير"),
              createElement(Text, { style: { ...styles.tableCell, ...styles.col3 } }, "السعر"),
              createElement(Text, { style: { ...styles.tableCell, ...styles.col4 } }, "الإجمالي"),
            ),
            ...inv.lineItems.map((item, i) => {
              const isNeg = item.total < 0;
              const lateHoursText =
                item.lateHours === "" || item.lateHours === 0 ? "—" : `${item.lateHours} س`;
              return createElement(
                View,
                { key: i, style: styles.tableRow },
                createElement(Text, { style: { ...styles.tableBodyCell, ...styles.col1 } }, item.description || "—"),
                createElement(Text, { style: { ...styles.tableBodyCell, ...styles.col2 } }, lateHoursText),
                createElement(Text, { style: { ...styles.tableBodyCell, ...styles.col3 } }, `${Number(item.price).toFixed(2)} ر.س`),
                createElement(Text, { style: { ...(isNeg ? styles.tableBodyCellRed : styles.tableBodyCell), ...styles.col4 } }, `${Number(item.total).toFixed(2)} ر.س`),
              );
            }),
          ),
          // Net salary row
          createElement(
            View,
            { style: styles.total },
            createElement(Text, { style: styles.totalLabel }, "صافي الراتب"),
            createElement(Text, { style: styles.totalValue }, `${Number(inv.netSalary).toFixed(2)} ر.س`),
          ),
          createElement(
            Text,
            { style: { fontSize: 10, color: "#6b7280", textAlign: "right", marginTop: 4 } },
            `طريقة الدفع: ${PAYMENT_METHOD_LABELS[inv.paymentMethod] ?? String(inv.paymentMethod)}`
          ),
        ),
        // Footer
        createElement(Text, { style: styles.footer }, inv.school.name || ""),
      )
    );

    const pdfBuffer = await renderToBuffer(pdfDoc as Parameters<typeof renderToBuffer>[0]);
    const fileUrl = await savePdf(pdfBuffer);

    const invoice = await prisma.invoice.create({
      data: {
        schoolId,
        type: "TEACHER",
        teacherId,
        studentId: null,
        amount: inv.netSalary,
        pdfUrl: fileUrl,
        data: inv as object,
      },
    });

    return Response.json(
      { id: invoice.id, amount: invoice.amount, pdfUrl: fileUrl, createdAt: invoice.createdAt },
      { status: 201 }
    );
  } catch (error) {
    console.error("=== TEACHER INVOICE GENERATE ERROR ===");
    console.error(error);
    return Response.json(
      { error: String(error), stack: error instanceof Error ? error.stack : undefined },
      { status: 500 }
    );
  }
}
