/**
 * Upload validation.
 *
 * The routes trusted `file.type`, which is whatever the browser — or a crafted
 * request — chose to send, and allowed 100 MB per file. A 100 MB image becomes a
 * ~133 MB base64 string inside a Postgres row, and the list queries then have to
 * work around it. Limits are now realistic and the type is read from the file's
 * own bytes.
 */

import { storageEnabled } from "@/lib/env";
import type { FileCategory } from "@/lib/r2";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_SPREADSHEET_BYTES = 10 * 1024 * 1024;

/** Leading bytes that identify a format regardless of the declared MIME type. */
const SIGNATURES: Array<{ mime: string; bytes: number[]; offset?: number }> = [
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: "image/webp", bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 },
  { mime: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46] },
  // xlsx/docx are zip containers; xls is the older OLE compound format.
  { mime: "application/zip", bytes: [0x50, 0x4b, 0x03, 0x04] },
  { mime: "application/vnd.ms-excel", bytes: [0xd0, 0xcf, 0x11, 0xe0] },
];

/**
 * SVG has no magic number — it is XML, which may open with a BOM, whitespace, a
 * declaration or a comment. So it is checked by parsing the opening instead:
 * the first tag must be `<svg`, with only a declaration or comments before it.
 *
 * Only the head is examined; a logo's first kilobyte contains its root element
 * many times over, and reading further would mean decoding a whole file to
 * answer a question the first line already settles.
 */
function isSvg(buffer: Buffer): boolean {
  const head = buffer.subarray(0, 1024).toString("utf8").replace(/^﻿/, "").trimStart();
  if (!head.startsWith("<")) return false;

  const withoutPreamble = head
    .replace(/^<\?xml[^>]*\?>/, "")
    .replace(/^\s*<!--[\s\S]*?-->/g, "")
    .replace(/^\s*<!DOCTYPE[^>]*>/i, "")
    .trimStart();

  return /^<svg[\s>]/i.test(withoutPreamble);
}

/** Detects the real type from the buffer, or null when nothing matches. */
export function sniffMimeType(buffer: Buffer): string | null {
  for (const { mime, bytes, offset = 0 } of SIGNATURES) {
    if (buffer.length < offset + bytes.length) continue;
    if (bytes.every((b, i) => buffer[offset + i] === b)) return mime;
  }
  return isSvg(buffer) ? "image/svg+xml" : null;
}

export interface ValidatedFile {
  buffer: Buffer;
  mime: string;
  dataUrl: string;
}

export type ValidationFailure = { error: string; status: number };

/**
 * What a route records after a successful upload.
 *
 * `url` goes into the column unchanged — either a `/api/files/<key>` path or,
 * when R2 is not configured, the base64 data URI. `key` is present only in the
 * first case.
 */
export interface StoredUpload {
  url: string;
  mime: string;
  sizeBytes: number;
  key?: string;
}

export function isFailure<T extends object>(
  value: T | ValidationFailure
): value is ValidationFailure {
  return "error" in value;
}

/**
 * Reads the upload, enforces a size cap, and confirms the bytes match one of
 * `allowed`. The declared MIME type is never used to decide.
 */
export async function validateUpload(
  file: File,
  allowed: string[],
  maxBytes: number,
  humanLabel: string
): Promise<ValidatedFile | ValidationFailure> {
  if (file.size > maxBytes) {
    const mb = Math.round(maxBytes / (1024 * 1024));
    return { error: `حجم الملف كبير. الحد الأقصى ${mb} ميجابايت.`, status: 413 };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length === 0) {
    return { error: "الملف فارغ", status: 400 };
  }

  const mime = sniffMimeType(buffer);
  if (!mime || !allowed.includes(mime)) {
    return { error: `يُقبل فقط ${humanLabel}`, status: 415 };
  }

  return {
    buffer,
    mime,
    dataUrl: `data:${mime};base64,${buffer.toString("base64")}`,
  };
}

/**
 * The same validation, plus the school's storage quota (task 2.31).
 *
 * Separate from `validateUpload` rather than folded into it: that function is
 * pure and testable, while this one needs the database. Routes that store
 * against a tenant use this one; anything that only inspects a file keeps the
 * pure version.
 *
 * The incoming size is measured **after** base64 encoding, because that is what
 * is actually stored — checking the raw file size would let a school a third of
 * the way past its quota.
 */
export async function validateTenantUpload(
  schoolId: string,
  file: File,
  allowed: string[],
  maxBytes: number,
  humanLabel: string
): Promise<ValidatedFile | ValidationFailure> {
  const result = await validateUpload(file, allowed, maxBytes, humanLabel);
  if (isFailure(result)) return result;

  const { storageBlockReason } = await import("@/lib/storage-usage");
  const blocked = await storageBlockReason(schoolId, result.dataUrl.length);
  if (blocked) {
    // 507 Insufficient Storage says exactly this and nothing else — 413 would
    // read as "your file is too big", which is a different problem with a
    // different fix.
    return { error: blocked, status: 507 };
  }

  return result;
}

/**
 * Validate, then store — the one function upload routes should call (task 0.34).
 *
 * With R2 configured the bytes go to the bucket and the column holds a
 * `/api/files/<key>` path. Without it, the column holds the base64 data URI it
 * always did. Both return the same shape, so a route neither knows nor cares
 * which happened, and a missing credential degrades one behaviour instead of
 * breaking every upload.
 *
 * `previousUrl` is the value being replaced. Passing it is what stops a bucket
 * accumulating every avatar a child has ever had: keys are never reused, so
 * without this the old object simply stays, unreferenced and paid for.
 */
export async function storeUpload(
  schoolId: string,
  file: File,
  options: {
    allowed: string[];
    maxBytes: number;
    humanLabel: string;
    category: FileCategory;
    ownerId: string;
    previousUrl?: string | null;
  }
): Promise<StoredUpload | ValidationFailure> {
  const validated = await validateTenantUpload(
    schoolId,
    file,
    options.allowed,
    options.maxBytes,
    options.humanLabel
  );
  if (isFailure(validated)) return validated;

  if (!storageEnabled) {
    return { url: validated.dataUrl, mime: validated.mime, sizeBytes: validated.buffer.length };
  }

  const { buildObjectKey, putObject, keyFromUrl, deleteObjects } = await import("@/lib/r2");
  const { prisma } = await import("@/lib/prisma");

  const key = buildObjectKey(schoolId, options.category, options.ownerId, validated.mime);
  const stored = await putObject(key, validated.buffer, validated.mime);

  await prisma.storedFile.create({
    data: {
      key: stored.key,
      schoolId,
      category: options.category,
      ownerId: options.ownerId,
      contentType: stored.contentType,
      sizeBytes: stored.sizeBytes,
    },
  });

  // After the new object is safely recorded, never before: a crash between the
  // two would otherwise leave the row pointing at a file that no longer exists.
  const oldKey = keyFromUrl(options.previousUrl);
  if (oldKey) {
    await deleteObjects([oldKey]);
    await prisma.storedFile.deleteMany({ where: { key: oldKey } });
  }

  return { url: stored.url, mime: stored.contentType, sizeBytes: stored.sizeBytes, key: stored.key };
}

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const IMAGE_LABEL = "JPG و PNG و WebP";
/** The school logo, which is also a vector in most brand kits. */
export const LOGO_TYPES = [...IMAGE_TYPES, "image/svg+xml"];
export const LOGO_LABEL = "PNG و SVG و JPG و WebP";
export const DOCUMENT_TYPES = [...IMAGE_TYPES, "application/pdf"];
export const DOCUMENT_LABEL = "PDF و JPG و PNG";
export const SPREADSHEET_TYPES = ["application/zip", "application/vnd.ms-excel"];
