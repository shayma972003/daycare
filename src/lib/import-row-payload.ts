import { Prisma } from "../generated/prisma/client";
import { decryptPii, encryptPii, piiCryptoConfigured } from "./pii-crypto";

export type ImportRowIssue = {
  field?: string;
  message: string;
  type?: "error" | "warning";
};

export type ImportRowPayload = {
  rawData: Record<string, unknown>;
  mappedData: Record<string, unknown> | null;
  errors: ImportRowIssue[] | null;
  warnings: ImportRowIssue[] | null;
};

export type ImportRowPayloadSource = {
  encrypted_payload: string | null;
  raw_data: unknown;
  mapped_data: unknown;
  errors: unknown;
  warnings: unknown;
};

export class ImportRowPayloadError extends Error {
  constructor() {
    super("Import row payload is unavailable");
    this.name = "ImportRowPayloadError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issues(value: unknown): ImportRowIssue[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) throw new ImportRowPayloadError();
  return value.map((item) => {
    if (!isRecord(item) || typeof item.message !== "string") {
      throw new ImportRowPayloadError();
    }
    return {
      ...(typeof item.field === "string" ? { field: item.field } : {}),
      message: item.message,
      ...(item.type === "error" || item.type === "warning" ? { type: item.type } : {}),
    };
  });
}

function parsePayload(value: unknown): ImportRowPayload {
  if (!isRecord(value) || !isRecord(value.rawData)) throw new ImportRowPayloadError();
  if (value.mappedData !== null && !isRecord(value.mappedData)) {
    throw new ImportRowPayloadError();
  }
  return {
    rawData: value.rawData,
    mappedData: value.mappedData,
    errors: issues(value.errors),
    warnings: issues(value.warnings),
  };
}

export function encryptImportRowPayload(payload: ImportRowPayload): string {
  if (!piiCryptoConfigured()) throw new ImportRowPayloadError();
  return encryptPii(JSON.stringify(parsePayload(payload)));
}

/**
 * Reads the encrypted package first. A present but invalid ciphertext is never
 * allowed to fall back to legacy plaintext columns.
 */
export function revealImportRowPayload(row: ImportRowPayloadSource): ImportRowPayload {
  if (row.encrypted_payload) {
    const plaintext = decryptPii(row.encrypted_payload);
    if (plaintext === null) throw new ImportRowPayloadError();
    try {
      return parsePayload(JSON.parse(plaintext));
    } catch {
      throw new ImportRowPayloadError();
    }
  }

  if (!isRecord(row.raw_data)) throw new ImportRowPayloadError();
  return parsePayload({
    rawData: row.raw_data,
    mappedData: row.mapped_data ?? null,
    errors: row.errors ?? null,
    warnings: row.warnings ?? null,
  });
}

export function updateImportRowPayload(
  payload: ImportRowPayload,
  patch: Partial<ImportRowPayload>
): ImportRowPayload {
  return parsePayload({ ...payload, ...patch });
}

/** One canonical write shape: ciphertext plus SQL NULL in every legacy JSON column. */
export function protectedImportRowPayload(payload: ImportRowPayload) {
  return {
    encrypted_payload: encryptImportRowPayload(payload),
    raw_data: Prisma.DbNull,
    mapped_data: Prisma.DbNull,
    errors: Prisma.DbNull,
    warnings: Prisma.DbNull,
  };
}

/** Successful rows retain only status/count metadata, never staged PII. */
export function clearedImportRowPayload() {
  return {
    encrypted_payload: null,
    raw_data: Prisma.DbNull,
    mapped_data: Prisma.DbNull,
    errors: Prisma.DbNull,
    warnings: Prisma.DbNull,
  };
}

type BackfillTransaction = Pick<Prisma.TransactionClient, '$queryRaw' | 'importRow'>;
type BackfillDatabase = {
  $transaction<T>(callback: (tx: BackfillTransaction) => Promise<T>): Promise<T>;
};

export async function backfillImportRowPayloads(
  db: BackfillDatabase,
  limit = 100
): Promise<{ staged: number; skipped: number }> {
  if (!piiCryptoConfigured()) throw new ImportRowPayloadError();
  const take = Math.max(1, Math.min(limit, 500));
  return db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "ImportRow"
      WHERE "encrypted_payload" IS NULL
        AND (
          "raw_data" IS NOT NULL OR "mapped_data" IS NOT NULL
          OR "errors" IS NOT NULL OR "warnings" IS NOT NULL
        )
      ORDER BY "id"
      LIMIT ${take}
      FOR UPDATE SKIP LOCKED
    `);
    if (locked.length === 0) return { staged: 0, skipped: 0 };

    const rows = await tx.importRow.findMany({
      where: { id: { in: locked.map((row) => row.id) }, encrypted_payload: null },
      orderBy: { id: 'asc' },
    });
    let staged = 0;
    for (const row of rows) {
      const payload = revealImportRowPayload(row);
      const updated = await tx.importRow.updateMany({
        where: { id: row.id, encrypted_payload: null },
        data: protectedImportRowPayload(payload),
      });
      staged += updated.count;
    }
    return { staged, skipped: locked.length - staged };
  });
}

export async function lockImportRow(
  tx: Pick<Prisma.TransactionClient, '$queryRaw'>,
  id: string
): Promise<boolean> {
  const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "ImportRow" WHERE "id" = ${id} FOR UPDATE
  `);
  return locked.length === 1;
}

export function importRowPayloadForResponse(row: ImportRowPayloadSource) {
  if (!row.encrypted_payload && !isRecord(row.raw_data)) {
    return { raw_data: null, mapped_data: null, errors: null, warnings: null };
  }
  const payload = revealImportRowPayload(row);
  return {
    raw_data: payload.rawData,
    mapped_data: payload.mappedData,
    errors: payload.errors,
    warnings: payload.warnings,
  };
}
