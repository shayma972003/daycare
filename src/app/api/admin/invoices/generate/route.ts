export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { verifyAdminSessionFromRequest } from "@/lib/admin-auth";
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
  companyName: { fontSize: 18, fontWeight: "bold", color: "#1a2340" },
  companyMeta: { fontSize: 9, color: "#6b7280", marginTop: 2 },
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
  col5: { flex: 1 },
  total: { flexDirection: "row-reverse", justifyContent: "space-between", marginTop: 8, padding: "8pt 0", borderTop: "1pt solid #1a2340" },
  totalLabel: { fontSize: 12, fontWeight: "bold", color: "#1a2340" },
  totalValue: { fontSize: 12, fontWeight: "bold", color: "#22c55e" },
  footer: { position: "absolute", bottom: 30, left: 40, right: 40, textAlign: "center", fontSize: 9, color: "#9ca3af" },
});

const lineItemSchema = z.object({
  description: z.string(),
  quantity: z.number(),
  price: z.number(),
  vat: z.number(),
  total: z.number(),
});

const generateSchema = z.object({
  school_id: z.string(),
  subscription_type: z.string().nullish(),
  issue_date: z.string(),
  due_date: z.string().nullish(),
  status: z.string(),
  payment_method: z.string().nullish(),

  our_company_name: z.string().nullish(),
  our_commercial_reg: z.string().nullish(),
  our_vat_number: z.string().nullish(),
  our_contact_number: z.string().nullish(),
  our_email: z.string().nullish(),
  our_address: z.string().nullish(),

  school_name: z.string(),
  school_commercial_reg: z.string().nullish(),
  school_vat_number: z.string().nullish(),
  school_contact: z.string().nullish(),
  school_email: z.string().nullish(),
  school_address: z.string().nullish(),

  line_items: z.array(lineItemSchema),
  total_amount: z.number(),
});

function savePdf(buffer: Buffer): string {
  return `data:application/pdf;base64,${buffer.toString("base64")}`;
}

function maybeMeta(condition: unknown, text: string) {
  if (!condition) return undefined;
  return createElement(Text, { style: styles.companyMeta }, text);
}

function maybeRow(condition: unknown, label: string, value: string) {
  if (!condition) return undefined;
  return createElement(
    View,
    { style: styles.row },
    createElement(Text, { style: styles.label }, label),
    createElement(Text, { style: styles.value }, value),
  );
}

export async function POST(request: Request) {
  const session = await verifyAdminSessionFromRequest(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

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

  const parsed = generateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const school = await prisma.school.findUnique({ where: { id: d.school_id } });
  if (!school) return Response.json({ error: "School not found" }, { status: 404 });

  const count = await prisma.adminInvoice.count({ where: { school_id: d.school_id } });
  const invoiceNumber = `SINV-${String(count + 1).padStart(4, "0")}`;

  const issueDateStr = new Date(d.issue_date).toLocaleDateString("ar-SA");
  const dueDateStr = d.due_date ? new Date(d.due_date).toLocaleDateString("ar-SA") : null;

  const pdfDoc = createElement(
    Document,
    null,
    createElement(
      Page,
      { size: "A4", style: styles.page },
      // Header — our company info
      createElement(
        View,
        { style: styles.header },
        createElement(
          View,
          null,
          ...[
            createElement(Text, { style: styles.companyName }, d.our_company_name || "—"),
            maybeMeta(d.our_commercial_reg, `سجل تجاري: ${d.our_commercial_reg}`),
            maybeMeta(d.our_vat_number, `الرقم الضريبي: ${d.our_vat_number}`),
            maybeMeta(d.our_contact_number, `رقم التواصل: ${d.our_contact_number}`),
            maybeMeta(d.our_email, d.our_email ?? ""),
            maybeMeta(d.our_address, d.our_address ?? ""),
          ].filter(Boolean)
        ),
        createElement(
          View,
          null,
          ...[
            createElement(Text, { style: styles.invoiceTitle }, `فاتورة رقم ${invoiceNumber}`),
            createElement(Text, { style: styles.invoiceMeta }, `تاريخ الإصدار: ${issueDateStr}`),
            dueDateStr ? createElement(Text, { style: styles.invoiceMeta }, `تاريخ الاستحقاق: ${dueDateStr}`) : undefined,
            createElement(Text, { style: styles.invoiceMeta }, `الحالة: ${d.status}`),
          ].filter(Boolean)
        ),
      ),
      // Bill to — school info
      createElement(
        View,
        { style: styles.section },
        ...[
          createElement(Text, { style: styles.sectionTitle }, "فاتورة إلى"),
          maybeRow(true, "اسم المدرسة", d.school_name || "—"),
          maybeRow(d.school_commercial_reg, "رقم السجل التجاري", d.school_commercial_reg ?? ""),
          maybeRow(d.school_vat_number, "الرقم الضريبي", d.school_vat_number ?? ""),
          maybeRow(d.school_contact, "رقم التواصل", d.school_contact ?? ""),
          maybeRow(d.school_email, "البريد الإلكتروني", d.school_email ?? ""),
          maybeRow(d.school_address, "العنوان", d.school_address ?? ""),
        ].filter(Boolean)
      ),
      // Invoice meta
      createElement(
        View,
        { style: styles.section },
        ...[
          createElement(Text, { style: styles.sectionTitle }, "بيانات الفاتورة"),
          maybeRow(d.subscription_type, "نوع الاشتراك", d.subscription_type ?? ""),
          maybeRow(d.payment_method, "طريقة الدفع", d.payment_method ?? ""),
        ].filter(Boolean)
      ),
      // Line items
      createElement(
        View,
        { style: styles.section },
        createElement(Text, { style: styles.sectionTitle }, "بنود الفاتورة"),
        createElement(
          View,
          { style: styles.table },
          createElement(
            View,
            { style: styles.tableHeader },
            createElement(Text, { style: { ...styles.tableCell, ...styles.col1 } }, "الوصف"),
            createElement(Text, { style: { ...styles.tableCell, ...styles.col2 } }, "الكمية"),
            createElement(Text, { style: { ...styles.tableCell, ...styles.col3 } }, "السعر"),
            createElement(Text, { style: { ...styles.tableCell, ...styles.col4 } }, "ضريبة (15%)"),
            createElement(Text, { style: { ...styles.tableCell, ...styles.col5 } }, "الإجمالي"),
          ),
          ...d.line_items.map((item, i) =>
            createElement(
              View,
              { key: i, style: styles.tableRow },
              createElement(Text, { style: { ...styles.tableBodyCell, ...styles.col1 } }, item.description || "—"),
              createElement(Text, { style: { ...styles.tableBodyCell, ...styles.col2 } }, String(item.quantity)),
              createElement(Text, { style: { ...styles.tableBodyCell, ...styles.col3 } }, `${item.price.toFixed(2)} ر.س`),
              createElement(Text, { style: { ...styles.tableBodyCell, ...styles.col4 } }, `${item.vat.toFixed(2)} ر.س`),
              createElement(Text, { style: { ...styles.tableBodyCell, ...styles.col5 } }, `${item.total.toFixed(2)} ر.س`),
            )
          ),
        ),
      ),
      // Grand total
      createElement(
        View,
        { style: { ...styles.section, backgroundColor: "#1a2340" } },
        createElement(
          View,
          { style: styles.total },
          createElement(Text, { style: { ...styles.totalLabel, color: "#fff" } }, "الإجمالي الكلي"),
          createElement(Text, { style: { ...styles.totalValue, fontSize: 14 } }, `${d.total_amount.toFixed(2)} ر.س`),
        ),
      ),
      createElement(Text, { style: styles.footer }, d.our_company_name || ""),
    )
  );

  try {
    const pdfBuffer = await renderToBuffer(pdfDoc as Parameters<typeof renderToBuffer>[0]);
    const fileUrl = savePdf(pdfBuffer);

    const invoice = await prisma.adminInvoice.create({
      data: {
        school_id: d.school_id,
        invoice_number: invoiceNumber,
        subscription_type: d.subscription_type ?? null,
        issue_date: new Date(d.issue_date),
        due_date: d.due_date ? new Date(d.due_date) : null,
        status: d.status,
        payment_method: d.payment_method ?? null,
        our_company_name: d.our_company_name ?? null,
        our_commercial_reg: d.our_commercial_reg ?? null,
        our_vat_number: d.our_vat_number ?? null,
        our_contact_number: d.our_contact_number ?? null,
        our_email: d.our_email ?? null,
        our_address: d.our_address ?? null,
        school_name: d.school_name,
        school_commercial_reg: d.school_commercial_reg ?? null,
        school_vat_number: d.school_vat_number ?? null,
        school_contact: d.school_contact ?? null,
        school_email: d.school_email ?? null,
        school_address: d.school_address ?? null,
        line_items: d.line_items,
        total_amount: d.total_amount,
        file_url: fileUrl,
      },
    });

    await prisma.adminActivityLog.create({
      data: { school_id: d.school_id, action: "invoice_generated", metadata: { invoice_number: invoiceNumber, amount: d.total_amount }, performed_by: "admin" },
    });

    return Response.json({ invoice_id: invoice.id, file_url: fileUrl }, { status: 201 });
  } catch (error) {
    console.error("Admin invoice generation error:", error);
    return Response.json({ error: "تعذر إنشاء الفاتورة" }, { status: 500 });
  }
}
