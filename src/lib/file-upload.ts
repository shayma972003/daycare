/**
 * Upload validation.
 *
 * The routes trusted `file.type`, which is whatever the browser — or a crafted
 * request — chose to send, and allowed 100 MB per file. A 100 MB image becomes a
 * ~133 MB base64 string inside a Postgres row, and the list queries then have to
 * work around it. Limits are now realistic and the type is read from the file's
 * own bytes.
 */

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

/** Detects the real type from the buffer, or null when nothing matches. */
export function sniffMimeType(buffer: Buffer): string | null {
  for (const { mime, bytes, offset = 0 } of SIGNATURES) {
    if (buffer.length < offset + bytes.length) continue;
    if (bytes.every((b, i) => buffer[offset + i] === b)) return mime;
  }
  return null;
}

export interface ValidatedFile {
  buffer: Buffer;
  mime: string;
  dataUrl: string;
}

export type ValidationFailure = { error: string; status: number };

export function isFailure(
  value: ValidatedFile | ValidationFailure
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

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const IMAGE_LABEL = "JPG و PNG و WebP";
export const DOCUMENT_TYPES = [...IMAGE_TYPES, "application/pdf"];
export const DOCUMENT_LABEL = "PDF و JPG و PNG";
export const SPREADSHEET_TYPES = ["application/zip", "application/vnd.ms-excel"];
