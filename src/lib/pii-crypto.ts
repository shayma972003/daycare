import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "crypto";

/**
 * Encryption and blind-index hashing for national ID numbers.
 *
 * Two separate jobs, two separate keys:
 *
 *  - **Encryption** makes the value unreadable at rest, so a database dump does
 *    not hand over anyone's ID. AES-256-GCM is authenticated, so a tampered
 *    ciphertext fails to decrypt rather than returning garbage.
 *
 *  - **The blind index** makes the value searchable without decrypting every
 *    row. This is where the obvious approach is wrong: a Saudi national ID is
 *    10 digits with a known leading digit, so fewer than 10^9 values exist. A
 *    plain SHA-256 of it is reversible by exhaustive search in minutes on a
 *    laptop — storing that hash would be no better than storing the ID. So the
 *    index is an HMAC keyed with a secret pepper held outside the database.
 *    Without the pepper, a stolen dump yields nothing.
 *
 * Both keys live in the environment. Losing PII_ENCRYPTION_KEY makes existing
 * ciphertext unrecoverable; losing PII_INDEX_PEPPER makes existing hashes
 * unmatchable. Rotation is a deliberate, planned operation (see D7.3).
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;
/** Version prefix so a future scheme change can be told apart from this one. */
const FORMAT = "v1";

let cachedKey: Buffer | null = null;
let cachedPepper: string | null = null;

function encryptionKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.PII_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "PII_ENCRYPTION_KEY is not set. Generate one with: " +
        `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
    );
  }

  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(`PII_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (got ${key.length}).`);
  }

  cachedKey = key;
  return key;
}

function indexPepper(): string {
  if (cachedPepper) return cachedPepper;

  const pepper = process.env.PII_INDEX_PEPPER;
  if (!pepper || pepper.length < 32) {
    throw new Error("PII_INDEX_PEPPER is not set, or is shorter than 32 characters.");
  }

  cachedPepper = pepper;
  return pepper;
}

/** True when both secrets are present, so callers can degrade instead of throwing. */
export function piiCryptoConfigured(): boolean {
  try {
    encryptionKey();
    indexPepper();
    return true;
  } catch {
    return false;
  }
}

/** Encrypts a value. Output: `v1.<iv>.<authTag>.<ciphertext>`, all base64url. */
export function encryptPii(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    FORMAT,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/** Reverses `encryptPii`. Returns null for anything malformed or tampered with. */
export function decryptPii(payload: string | null | undefined): string | null {
  if (!payload) return null;

  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== FORMAT) return null;

  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      encryptionKey(),
      Buffer.from(parts[1], "base64url")
    );
    decipher.setAuthTag(Buffer.from(parts[2], "base64url"));

    return Buffer.concat([
      decipher.update(Buffer.from(parts[3], "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Wrong key, or the ciphertext was modified.
    return null;
  }
}

/**
 * Deterministic blind index used for equality lookups.
 *
 * Deterministic by necessity — two records with the same ID must produce the
 * same index — which means it does leak "these two rows share a value". That is
 * the accepted trade-off for being able to search at all.
 */
export function hashPii(value: string): string {
  const normalized = value.trim().replace(/\s+/g, "");
  return createHmac("sha256", indexPepper()).update(normalized).digest("hex");
}

/** Constant-time comparison of two blind indexes. */
export function piiHashMatches(a: string | null, b: string | null): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

export interface ProtectedIdNumber {
  encryptedIdNumber: string | null;
  idNumberHash: string | null;
}

let warnedMissingKeys = false;

/**
 * Prepares an ID number for storage. An empty value clears both columns.
 *
 * Degrades rather than throws when the keys are absent: a deployment that has
 * not set them yet keeps working on the legacy plaintext column instead of
 * failing every student save. The warning fires once so it is visible without
 * flooding the log.
 */
export function protectIdNumber(idNumber: string | null | undefined): ProtectedIdNumber {
  const trimmed = idNumber?.trim();
  if (!trimmed) return { encryptedIdNumber: null, idNumberHash: null };

  if (!piiCryptoConfigured()) {
    if (!warnedMissingKeys) {
      warnedMissingKeys = true;
      console.warn(
        "⚠️  PII_ENCRYPTION_KEY / PII_INDEX_PEPPER not set — ID numbers are being " +
          "stored in plaintext only. Set both to enable encryption."
      );
    }
    return { encryptedIdNumber: null, idNumberHash: null };
  }

  return {
    encryptedIdNumber: encryptPii(trimmed),
    idNumberHash: hashPii(trimmed),
  };
}

/** Masks an ID for display: only the last four digits are ever shown. */
export function maskIdNumber(idNumber: string | null | undefined): string | null {
  if (!idNumber) return null;
  const trimmed = idNumber.trim();
  if (trimmed.length <= 4) return "••••";
  return `••••••${trimmed.slice(-4)}`;
}
