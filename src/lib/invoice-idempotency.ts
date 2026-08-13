import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

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
  studentId?: string | null;
  teacherId?: string | null;
}

export type InvoiceClaim =
  | { state: "owned"; id: string }
  | { state: "completed"; invoice: { id: string; amount: Prisma.Decimal; pdfUrl: string | null; createdAt: Date } }
  | { state: "conflict"; code: "IN_PROGRESS" | "KEY_REUSED" };

export async function claimInvoice(input: InvoiceClaimInput): Promise<InvoiceClaim> {
  try {
    const created = await prisma.invoice.create({
      data: {
        schoolId: input.schoolId,
        operationKind: input.operationKind,
        idempotencyKey: input.key,
        requestHash: input.requestHash,
        generationStatus: "PENDING",
        type: input.type,
        studentId: input.studentId ?? null,
        teacherId: input.teacherId ?? null,
        amount: 0,
        vat_amount: 0,
        data: {},
      },
      select: { id: true },
    });
    return { state: "owned", id: created.id };
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.invoice.findUnique({
      where: { schoolId_operationKind_idempotencyKey: { schoolId: input.schoolId, operationKind: input.operationKind, idempotencyKey: input.key } },
      select: { id: true, requestHash: true, generationStatus: true, amount: true, pdfUrl: true, createdAt: true },
    });
    if (!existing || existing.requestHash !== input.requestHash) return { state: "conflict", code: "KEY_REUSED" } as const;
    if (existing.generationStatus === "COMPLETED") return { state: "completed", invoice: existing } as const;
    if (existing.generationStatus === "PENDING") return { state: "conflict", code: "IN_PROGRESS" } as const;
    const reclaimed = await tx.invoice.updateMany({
      where: { id: existing.id, generationStatus: "FAILED", requestHash: input.requestHash },
      data: { generationStatus: "PENDING", generationError: null },
    });
    return reclaimed.count === 1
      ? { state: "owned", id: existing.id } as const
      : { state: "conflict", code: "IN_PROGRESS" } as const;
  });
}

export async function failInvoiceClaim(id: string): Promise<void> {
  await prisma.invoice.updateMany({ where: { id, generationStatus: "PENDING" }, data: { generationStatus: "FAILED", generationError: "generation_failed" } });
}

export type AdminInvoiceClaim =
  | { state: "owned"; id: string; invoiceNumber: string }
  | { state: "completed"; invoice: { id: string; file_url: string | null } }
  | { state: "conflict"; code: "IN_PROGRESS" | "KEY_REUSED" };

export async function claimAdminInvoice(
  schoolId: string,
  key: string,
  requestHash: string,
  invoiceNumber: string,
  data: Omit<Prisma.AdminInvoiceUncheckedCreateInput, "school_id" | "idempotency_key" | "request_hash" | "generation_status" | "invoice_number">
): Promise<AdminInvoiceClaim> {
  try {
    const created = await prisma.adminInvoice.create({
      data: { ...data, school_id: schoolId, invoice_number: invoiceNumber, idempotency_key: key, request_hash: requestHash, generation_status: "PENDING" },
      select: { id: true, invoice_number: true },
    });
    return { state: "owned", id: created.id, invoiceNumber: created.invoice_number };
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
  }
  return prisma.$transaction(async (tx) => {
    const existing = await tx.adminInvoice.findUnique({
      where: { school_id_idempotency_key: { school_id: schoolId, idempotency_key: key } },
      select: { id: true, invoice_number: true, request_hash: true, generation_status: true, file_url: true },
    });
    if (!existing || existing.request_hash !== requestHash) return { state: "conflict", code: "KEY_REUSED" } as const;
    if (existing.generation_status === "COMPLETED") return { state: "completed", invoice: existing } as const;
    if (existing.generation_status === "PENDING") return { state: "conflict", code: "IN_PROGRESS" } as const;
    const reclaimed = await tx.adminInvoice.updateMany({ where: { id: existing.id, generation_status: "FAILED" }, data: { generation_status: "PENDING", generation_error: null } });
    return reclaimed.count === 1
      ? { state: "owned", id: existing.id, invoiceNumber: existing.invoice_number } as const
      : { state: "conflict", code: "IN_PROGRESS" } as const;
  });
}

export async function failAdminInvoiceClaim(id: string): Promise<void> {
  await prisma.adminInvoice.updateMany({ where: { id, generation_status: "PENDING" }, data: { generation_status: "FAILED", generation_error: "generation_failed" } });
}
