import { prisma } from "@/lib/prisma";
import { VAT_RATE } from "@/lib/finance";

/**
 * Recomputes an invoice's monetary fields on the server.
 *
 * The generate routes accepted `baseTotal`, `vatAmount`, `discountAmount` and
 * `grandTotal` from the request body and wrote `grandTotal` into
 * `Invoice.amount` with no verification at all — so any authenticated caller
 * could issue a financial document for an arbitrary figure. The line items are
 * the only client input that survives; every total is derived from them here.
 *
 * The issuing school's legal identity is read from the database too. It is
 * printed on the document and is not the client's to assert.
 */
export interface InvoiceLineItem {
  description: string;
  qty: number;
  price: number;
  total: number;
}

export interface InvoiceTotalsInput {
  lineItems: InvoiceLineItem[];
  activityItems: InvoiceLineItem[];
  hasDiscount?: boolean | null;
  discountPercent?: number | null;
  hasVat?: boolean | null;
}

export interface RecomputedTotals {
  lineItems: InvoiceLineItem[];
  activityItems: InvoiceLineItem[];
  baseTotal: number;
  activitiesTotal: number;
  discountAmount: number;
  vatAmount: number;
  grandTotal: number;
  school: {
    name: string;
    commercialRegistration: string | null;
    vatNumber: string | null;
    contactNumber: string | null;
    email: string | null;
    address: string | null;
  };
}

/** Rounds to two decimals without the float drift of `toFixed` round-tripping. */
function money(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Line total is quantity times price — the sent `total` is ignored. */
function normaliseItems(items: InvoiceLineItem[]): InvoiceLineItem[] {
  return items.map((item) => {
    const qty = Math.max(0, Number(item.qty) || 0);
    const price = Math.max(0, Number(item.price) || 0);
    return { description: item.description, qty, price, total: money(qty * price) };
  });
}

export async function recomputeInvoiceTotals(
  schoolId: string,
  input: InvoiceTotalsInput
): Promise<RecomputedTotals> {
  const school = await prisma.school.findUniqueOrThrow({
    where: { id: schoolId },
    select: {
      name: true,
      commercialRegistration: true,
      vatNumber: true,
      contactNumber: true,
      address: true,
      email: true,
      vatRegistered: true,
    },
  });

  const lineItems = normaliseItems(input.lineItems);
  const activityItems = normaliseItems(input.activityItems);

  const baseTotal = money(lineItems.reduce((sum, i) => sum + i.total, 0));
  const activitiesTotal = money(activityItems.reduce((sum, i) => sum + i.total, 0));
  const subtotal = money(baseTotal + activitiesTotal);

  // A discount percentage is clamped to 0–100; a negative or >100 value would
  // otherwise invert or inflate the invoice.
  const discountPercent = input.hasDiscount
    ? Math.min(100, Math.max(0, Number(input.discountPercent) || 0))
    : 0;
  const discountAmount = money(subtotal * (discountPercent / 100));
  const afterDiscount = money(subtotal - discountAmount);

  // VAT applies only when the school is actually registered, whatever the
  // client asked for.
  const vatAmount =
    input.hasVat && school.vatRegistered ? money(afterDiscount * VAT_RATE) : 0;

  return {
    lineItems,
    activityItems,
    baseTotal,
    activitiesTotal,
    discountAmount,
    vatAmount,
    grandTotal: money(afterDiscount + vatAmount),
    school: {
      name: school.name,
      commercialRegistration: school.commercialRegistration,
      vatNumber: school.vatNumber,
      contactNumber: school.contactNumber,
      email: school.email,
      address: school.address,
    },
  };
}
