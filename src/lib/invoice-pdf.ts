import { access } from "fs/promises";
import { join } from "path";
import { createElement } from "react";
import {
  Document,
  Font,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";

const FONT_FAMILY = "InvoiceArabic";
let fontsRegistered = false;

const styles = StyleSheet.create({
  page: { fontFamily: FONT_FAMILY, backgroundColor: "#ffffff", padding: 40, fontSize: 11 },
  header: {
    flexDirection: "row-reverse",
    justifyContent: "space-between",
    marginBottom: 24,
    borderBottom: "1pt solid #e5e7eb",
    paddingBottom: 16,
  },
  schoolName: { fontSize: 18, fontWeight: "bold", color: "#1a2340", textAlign: "right" },
  meta: { fontSize: 9, color: "#6b7280", marginTop: 2, textAlign: "right" },
  invoiceTitle: { fontSize: 16, fontWeight: "bold", color: "#1a2340", textAlign: "right" },
  section: { marginBottom: 16, backgroundColor: "#f9fafb", padding: 12, borderRadius: 4 },
  sectionTitle: { fontSize: 12, fontWeight: "bold", color: "#1a2340", marginBottom: 8, textAlign: "right" },
  row: { flexDirection: "row-reverse", justifyContent: "space-between", marginBottom: 5, gap: 12 },
  label: { color: "#6b7280", fontSize: 10, textAlign: "right" },
  value: { color: "#111827", fontSize: 10, fontWeight: "bold", textAlign: "left" },
  total: {
    flexDirection: "row-reverse",
    justifyContent: "space-between",
    marginTop: 8,
    paddingTop: 8,
    borderTop: "1pt solid #1a2340",
  },
  totalLabel: { fontSize: 12, fontWeight: "bold", color: "#1a2340" },
  totalValue: { fontSize: 12, fontWeight: "bold", color: "#22c55e" },
  footer: {
    position: "absolute",
    bottom: 30,
    left: 40,
    right: 40,
    textAlign: "center",
    fontSize: 9,
    color: "#9ca3af",
  },
});

type JsonRecord = Record<string, unknown>;

export interface StoredInvoicePdfInput {
  id: string;
  type: "STUDENT" | "TEACHER";
  amount: number;
  vatAmount: number;
  createdAt: Date;
  data: unknown;
  school: {
    name: string;
    commercialRegistration: string | null;
    vatNumber: string | null;
    contactNumber: string | null;
    email: string | null;
    address: string | null;
  };
}
function record(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

function money(value: number | null): string {
  return `${(value ?? 0).toFixed(2)} ر.س`;
}

function row(label: string, value: string) {
  if (!value) return undefined;
  return createElement(
    View,
    { style: styles.row },
    createElement(Text, { style: styles.label }, label),
    createElement(Text, { style: styles.value }, value),
  );
}

function registerFonts() {
  if (fontsRegistered) return;
  Font.register({
    family: FONT_FAMILY,
    fonts: [
      { src: join(process.cwd(), "public", "fonts", "Arabic-Regular.ttf"), fontWeight: "normal" },
      { src: join(process.cwd(), "public", "fonts", "Arabic-Bold.ttf"), fontWeight: "bold" },
    ],
  });
  Font.registerHyphenationCallback((word) => [word]);
  fontsRegistered = true;
}

async function ensureFontsExist() {
  await Promise.all([
    access(join(process.cwd(), "public", "fonts", "Arabic-Regular.ttf")),
    access(join(process.cwd(), "public", "fonts", "Arabic-Bold.ttf")),
  ]);
}

function subjectRows(input: StoredInvoicePdfInput, data: JsonRecord) {
  if (input.type === "STUDENT") {
    const student = record(data.student);
    const guardian = record(data.guardian);
    return [
      createElement(Text, { key: "title", style: styles.sectionTitle }, "بيانات الطالب"),
      row("اسم الطالب", firstText(student.name, data.studentName)),
      row("الفصل", firstText(student.className, data.className, data.class)),
      row("ولي الأمر", firstText(guardian.name, data.guardianName)),
      row("الجوال", firstText(guardian.phone1, data.guardianPhone, data.phone)),
      row("البريد", firstText(guardian.email, data.guardianEmail)),
    ].filter(Boolean);
  }

  const teacher = record(data.teacher);
  return [
    createElement(Text, { key: "title", style: styles.sectionTitle }, "بيانات الموظف"),
    row("الاسم", firstText(teacher.full_name, data.teacherName)),
    row("الفصل", firstText(teacher.class_name, data.className)),
    row("الجوال", firstText(teacher.phone_1)),
    row("البريد", firstText(teacher.email)),
  ].filter(Boolean);
}

function detailRows(input: StoredInvoicePdfInput, data: JsonRecord) {
  const customLines = Array.isArray(data.lineItems) ? data.lineItems.map(record) : [];
  const activityLines = Array.isArray(data.activityItems) ? data.activityItems.map(record) : [];

  if (customLines.length || activityLines.length) {
    return [...customLines, ...activityLines].flatMap((item, index) => {
      const description = firstText(item.description, `بند ${index + 1}`);
      const quantity = firstNumber(item.qty, item.lateHours);
      const total = firstNumber(item.total, item.price);
      const suffix = quantity !== null && quantity !== 0 ? ` (${quantity})` : "";
      return [row(`${description}${suffix}`, money(total))].filter(Boolean);
    });
  }

  if (input.type === "STUDENT") {
    const subscription = firstNumber(data.monthlyFee);
    const lateFee = firstNumber(data.lateHoursFee, data.lateFee);
    const lateHours = firstNumber(data.lateHours);
    return [
      row("رسوم الاشتراك", subscription === null ? "" : money(subscription)),
      row(
        lateHours ? `رسوم التأخير (${lateHours} ساعة)` : "رسوم التأخير",
        lateFee && lateFee > 0 ? money(lateFee) : "",
      ),
    ].filter(Boolean);
  }

  const baseSalary = firstNumber(data.baseSalary, data.monthlySalary);
  const deduction = firstNumber(data.deduction, data.lateDeduction);
  const lateHours = firstNumber(data.lateHours);
  return [
    row("الراتب الأساسي", baseSalary === null ? "" : money(baseSalary)),
    row(
      lateHours ? `خصم التأخير (${lateHours} ساعة)` : "خصم التأخير",
      deduction && deduction > 0 ? `- ${money(deduction)}` : "",
    ),
  ].filter(Boolean);
}

/** Decodes only PDFs created by this application. Other values are regenerated. */
export function decodeStoredInvoicePdf(value: string | null): Buffer | null {
  const prefix = "data:application/pdf;base64,";
  if (!value?.startsWith(prefix)) return null;
  const buffer = Buffer.from(value.slice(prefix.length), "base64");
  return buffer.subarray(0, 4).toString("ascii") === "%PDF" ? buffer : null;
}

/**
 * Rebuilds an invoice from its immutable financial snapshot.
 *
 * The returned buffer is intentionally not persisted. Callers stream it to the
 * browser and discard it, so downloading an archived PDF does not consume the
 * nursery's database storage again.
 */
export async function renderStoredInvoicePdf(input: StoredInvoicePdfInput): Promise<Buffer> {
  await ensureFontsExist();
  registerFonts();

  const data = record(input.data);
  const snapshotSchool = record(data.school);
  const school = {
    name: firstText(snapshotSchool.name, input.school.name, "الحضانة"),
    commercialRegistration: firstText(snapshotSchool.commercialRegistration, input.school.commercialRegistration),
    vatNumber: firstText(snapshotSchool.vatNumber, input.school.vatNumber),
    contactNumber: firstText(snapshotSchool.contactNumber, input.school.contactNumber),
    email: firstText(snapshotSchool.email, input.school.email),
    address: firstText(snapshotSchool.address, input.school.address),
  };
  const invoiceNumber = firstText(data.invoiceNumber, input.id.slice(0, 8));
  const issuedAt = firstText(
    data.issuedAt,
    data.issueDate,
    new Intl.DateTimeFormat("ar-SA", { timeZone: "Asia/Riyadh", dateStyle: "long" }).format(input.createdAt),
  );
  const dueDate = firstText(data.dueDate);
  const status = firstText(data.invoiceStatus, data.paymentStatus);
  const paymentMethod = firstText(data.paymentMethod);
  const vat = firstNumber(data.vatAmount, input.vatAmount) ?? 0;

  const document = createElement(
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
            createElement(Text, { key: "name", style: styles.schoolName }, school.name),
            row("السجل التجاري", school.commercialRegistration),
            row("الرقم الضريبي", school.vatNumber),
            row("التواصل", school.contactNumber),
            school.email ? createElement(Text, { key: "email", style: styles.meta }, school.email) : undefined,
            school.address ? createElement(Text, { key: "address", style: styles.meta }, school.address) : undefined,
          ].filter(Boolean),
        ),
        createElement(
          View,
          null,
          ...[
            createElement(Text, { key: "title", style: styles.invoiceTitle }, `فاتورة رقم ${invoiceNumber}`),
            createElement(Text, { key: "issued", style: styles.meta }, `تاريخ الإصدار: ${issuedAt}`),
            dueDate ? createElement(Text, { key: "due", style: styles.meta }, `تاريخ الاستحقاق: ${dueDate}`) : undefined,
            status ? createElement(Text, { key: "status", style: styles.meta }, `الحالة: ${status}`) : undefined,
          ].filter(Boolean),
        ),
      ),
      createElement(View, { style: styles.section }, ...subjectRows(input, data)),
      createElement(
        View,
        { style: styles.section },
        createElement(Text, { style: styles.sectionTitle }, input.type === "STUDENT" ? "تفاصيل الفاتورة" : "تفاصيل الراتب"),
        ...detailRows(input, data),
        ...(vat > 0 ? [row("ضريبة القيمة المضافة", money(vat))].filter(Boolean) : []),
        createElement(
          View,
          { style: styles.total },
          createElement(Text, { style: styles.totalLabel }, input.type === "STUDENT" ? "الإجمالي" : "صافي الراتب"),
          createElement(Text, { style: styles.totalValue }, money(input.amount)),
        ),
        ...(paymentMethod ? [row("طريقة الدفع", paymentMethod)].filter(Boolean) : []),
      ),
      createElement(Text, { style: styles.footer }, school.name),
    ),
  );

  return renderToBuffer(document as Parameters<typeof renderToBuffer>[0]);
}
