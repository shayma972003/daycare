import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
export const INVOICE_GENERATION_LEASE_MS = 10 * 60 * 1000;

export function invoiceGenerationLeaseExpiry(now = new Date()): Date {
  return new Date(now.getTime() + INVOICE_GENERATION_LEASE_MS);
}

export function readIdempotencyKey(request: Request): string | null {
  const value = request.headers.get("Idempotency-Key")?.trim() ?? "";
  return KEY_PATTERN.test(value) ? value : null;
}

export function missingIdempotencyKeyResponse(): Response {
  return Response.json(
    { error: "Idempotency-Key header is required", code: "IDEMPOTENCY_KEY_REQUIRED" },
    { status: 422 }
  );
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)])
    );
  }
  return value;
}

export function invoiceRequestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

export function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export function idempotencyConflictResponse(code: "IN_PROGRESS" | "KEY_REUSED"): Response {
  return Response.json(
    { error: "تعذر تنفيذ طلب الفاتورة بهذه الهوية", code },
    { status: 409, headers: { "Retry-After": "2" } }
  );
}

export interface InvoiceClaimInput {
  schoolId: string;
  operationKind: string;
  key: string;
  requestHash: string;
  type: "STUDENT" | "TEACHER";
}

export type InvoiceClaim =
  | { state: "owned"; id: string; leaseExpiresAt: Date }
  | { state: "completed"; invoice: { id: string; amount: Prisma.Decimal; pdfUrl: string | null; createdAt: Date } }
  | { state: "conflict"; code: "IN_PROGRESS" | "KEY_REUSED" };

export async function claimInvoice(input: InvoiceClaimInput): Promise<InvoiceClaim> {
  const now = new Date();
  const leaseExpiresAt = invoiceGenerationLeaseExpiry(now);
  try {
    const created = await prisma.invoice.create({
      data: {
        schoolId: input.schoolId,
        operationKind: input.operationKind,
        idempotencyKey: input.key,
        requestHash: input.requestHash,
        generationStatus: "PENDING",
        generationLeaseExpiresAt: leaseExpiresAt,
        type: input.type,
        // The claim is an operation record until generation completes. Delaying
        // the subject FKs prevents an invalid caller-supplied id from turning a
        // clean 404 into a foreign-key error.
        studentId: null,
        teacherId: null,
        amount: 0,
        vat_amount: 0,
        data: {},
      },
      select: { id: true },
    });
    return { state: "owned", id: created.id, leaseExpiresAt };
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.invoice.findUnique({
      where: { schoolId_operationKind_idempotencyKey: { schoolId: input.schoolId, operationKind: input.operationKind, idempotencyKey: input.key } },
      select: { id: true, requestHash: true, generationStatus: true, generationLeaseExpiresAt: true, amount: true, pdfUrl: true, createdAt: true },
    });
    if (!existing || existing.requestHash !== input.requestHash) return { state: "conflict", code: "KEY_REUSED" } as const;
    if (existing.generationStatus === "COMPLETED") return { state: "completed", invoice: existing } as const;
    if (existing.generationStatus === "PENDING" && existing.generationLeaseExpiresAt && existing.generationLeaseExpiresAt > now) {
      return { state: "conflict", code: "IN_PROGRESS" } as const;
    }
    const reclaimed = await tx.invoice.updateMany({
      where: {
        id: existing.id,
        requestHash: input.requestHash,
        OR: [
          { generationStatus: "FAILED" },
          { generationStatus: "PENDING", generationLeaseExpiresAt: null },
          { generationStatus: "PENDING", generationLeaseExpiresAt: { lte: now } },
        ],
      },
      data: { generationStatus: "PENDING", generationError: null, generationLeaseExpiresAt: leaseExpiresAt },
    });
    return reclaimed.count === 1
      ? { state: "owned", id: existing.id, leaseExpiresAt } as const
      : { state: "conflict", code: "IN_PROGRESS" } as const;
  });
}

export async function completeInvoiceClaim(
  id: string,
  leaseExpiresAt: Date,
  data: Prisma.InvoiceUncheckedUpdateManyInput
): Promise<void> {
  const completed = await prisma.invoice.updateMany({
    where: { id, generationStatus: "PENDING", generationLeaseExpiresAt: leaseExpiresAt },
    data: { ...data, generationStatus: "COMPLETED", generationError: null, generationLeaseExpiresAt: null },
  });
  if (completed.count !== 1) throw new Error("INVOICE_CLAIM_LOST");
}

export async function failInvoiceClaim(id: string, leaseExpiresAt: Date): Promise<void> {
  await prisma.invoice.updateMany({
    where: { id, generationStatus: "PENDING", generationLeaseExpiresAt: leaseExpiresAt },
    data: { generationStatus: "FAILED", generationError: "generation_failed", generationLeaseExpiresAt: null },
  });
}

export type AdminInvoiceClaim =
  | { state: "owned"; id: string; invoiceNumber: string; leaseExpiresAt: Date }
  | { state: "completed"; invoice: { id: string; file_url: string | null } }
  | { state: "conflict"; code: "IN_PROGRESS" | "KEY_REUSED" };

export async function claimAdminInvoice(
  schoolId: string,
  key: string,
  requestHash: string,
  invoiceNumber: string,
  data: Omit<Prisma.AdminInvoiceUncheckedCreateInput, "school_id" | "idempotency_key" | "request_hash" | "generation_status" | "invoice_number">
): Promise<AdminInvoiceClaim> {
  const now = new Date();
  const leaseExpiresAt = invoiceGenerationLeaseExpiry(now);
  try {
    const created = await prisma.adminInvoice.create({
      data: { ...data, school_id: schoolId, invoice_number: invoiceNumber, idempotency_key: key, request_hash: requestHash, generation_status: "PENDING", generation_lease_expires_at: leaseExpiresAt },
      select: { id: true, invoice_number: true },
    });
    return { state: "owned", id: created.id, invoiceNumber: created.invoice_number, leaseExpiresAt };
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
  }
  return prisma.$transaction(async (tx) => {
    const existing = await tx.adminInvoice.findUnique({
      where: { school_id_idempotency_key: { school_id: schoolId, idempotency_key: key } },
      select: { id: true, invoice_number: true, request_hash: true, generation_status: true, generation_lease_expires_at: true, file_url: true },
    });
    if (!existing || existing.request_hash !== requestHash) return { state: "conflict", code: "KEY_REUSED" } as const;
    if (existing.generation_status === "COMPLETED") return { state: "completed", invoice: existing } as const;
    if (existing.generation_status === "PENDING" && existing.generation_lease_expires_at && existing.generation_lease_expires_at > now) {
      return { state: "conflict", code: "IN_PROGRESS" } as const;
    }
    const reclaimed = await tx.adminInvoice.updateMany({
      where: {
        id: existing.id,
        OR: [
          { generation_status: "FAILED" },
          { generation_status: "PENDING", generation_lease_expires_at: null },
          { generation_status: "PENDING", generation_lease_expires_at: { lte: now } },
        ],
      },
      data: { generation_status: "PENDING", generation_error: null, generation_lease_expires_at: leaseExpiresAt },
    });
    return reclaimed.count === 1
      ? { state: "owned", id: existing.id, invoiceNumber: existing.invoice_number, leaseExpiresAt } as const
      : { state: "conflict", code: "IN_PROGRESS" } as const;
  });
}

export async function completeAdminInvoiceClaim(
  id: string,
  leaseExpiresAt: Date,
  data: Prisma.AdminInvoiceUncheckedUpdateManyInput
): Promise<void> {
  const completed = await prisma.adminInvoice.updateMany({
    where: { id, generation_status: "PENDING", generation_lease_expires_at: leaseExpiresAt },
    data: { ...data, generation_status: "COMPLETED", generation_error: null, generation_lease_expires_at: null },
  });
  if (completed.count !== 1) throw new Error("ADMIN_INVOICE_CLAIM_LOST");
}

export async function failAdminInvoiceClaim(id: string, leaseExpiresAt: Date): Promise<void> {
  await prisma.adminInvoice.updateMany({
    where: { id, generation_status: "PENDING", generation_lease_expires_at: leaseExpiresAt },
    data: { generation_status: "FAILED", generation_error: "generation_failed", generation_lease_expires_at: null },
  });
}
