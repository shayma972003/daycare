import { describe, it, expect, beforeAll } from "vitest";

/**
 * Object storage: key handling, grants, and type sniffing (tasks 0.34/0.35).
 *
 * The pure parts only — the parts where a mistake is a security hole rather than
 * a failed upload. Whether R2 accepts a PUT is not something a unit test can
 * usefully answer; whether a grant minted for one child's photo also opens
 * another's is exactly what one should.
 */

// `signFileToken` derives its key from NEXTAUTH_SECRET, which `env.ts` demands
// at import time.
beforeAll(() => {
  process.env.NEXTAUTH_SECRET ??= "test-secret-at-least-32-characters-long!";
  process.env.DATABASE_URL ??= "postgres://localhost/test";
  process.env.NEXTAUTH_URL ??= "http://localhost:3000";
  process.env.ADMIN_JWT_SECRET ??= "test-admin-secret-at-least-32-chars!!";
});

describe("object keys", () => {
  it("puts the tenant first so the file route can check it without a query", async () => {
    const { buildObjectKey, schoolIdFromKey } = await import("@/lib/r2");

    const key = buildObjectKey("school_1", "students", "student_9", "image/png");

    expect(key.startsWith("schools/school_1/students/student_9/")).toBe(true);
    expect(key.endsWith(".png")).toBe(true);
    expect(schoolIdFromKey(key)).toBe("school_1");
  });

  it("ends in a random segment, so a key cannot be derived from a child's id", async () => {
    const { buildObjectKey } = await import("@/lib/r2");

    const first = buildObjectKey("s", "students", "child", "image/jpeg");
    const second = buildObjectKey("s", "students", "child", "image/jpeg");

    expect(first).not.toBe(second);
  });

  it("refuses to read a tenant out of a key that is not ours", async () => {
    const { schoolIdFromKey } = await import("@/lib/r2");

    // Anything else must be rejected rather than passed to the bucket.
    expect(schoolIdFromKey("uploads/foo.png")).toBeNull();
    expect(schoolIdFromKey("../../etc/passwd")).toBeNull();
    expect(schoolIdFromKey("schools/")).toBeNull();
  });

  it("round-trips a URL to a key and ignores legacy data URIs", async () => {
    const { buildObjectKey, fileUrl, keyFromUrl } = await import("@/lib/r2");

    const key = buildObjectKey("s", "care", "child", "image/webp");

    expect(keyFromUrl(fileUrl(key))).toBe(key);
    // A column not yet migrated still holds base64; it has no key and must not
    // be mistaken for one.
    expect(keyFromUrl("data:image/png;base64,AAAA")).toBeNull();
    expect(keyFromUrl(null)).toBeNull();
  });
});

describe("file grants", () => {
  it("accepts a grant only for the key it was minted for", async () => {
    const { signFileToken, verifyFileToken } = await import("@/lib/file-token");

    const token = signFileToken("schools/a/students/1/photo.jpg");

    expect(verifyFileToken("schools/a/students/1/photo.jpg", token)).toBe(true);
    // The whole point: a parent given one photo's link cannot walk it to
    // another child's.
    expect(verifyFileToken("schools/a/students/2/photo.jpg", token)).toBe(false);
    expect(verifyFileToken("schools/b/students/1/photo.jpg", token)).toBe(false);
  });

  it("rejects an expired grant", async () => {
    const { signFileToken, verifyFileToken } = await import("@/lib/file-token");

    const key = "schools/a/care/1/photo.jpg";

    expect(verifyFileToken(key, signFileToken(key, -1))).toBe(false);
  });

  it("rejects a tampered signature and a forged expiry", async () => {
    const { signFileToken, verifyFileToken } = await import("@/lib/file-token");

    const key = "schools/a/care/1/photo.jpg";
    const token = signFileToken(key, 600);
    const [expiry, mac] = token.split(".");

    expect(verifyFileToken(key, `${expiry}.${mac.slice(0, -1)}x`)).toBe(false);
    // Pushing the expiry out invalidates the MAC, which covers it.
    expect(verifyFileToken(key, `${Number(expiry) + 100000}.${mac}`)).toBe(false);
    expect(verifyFileToken(key, "not-a-token")).toBe(false);
    expect(verifyFileToken(key, null)).toBe(false);
  });

  it("leaves values that are not stored files untouched", async () => {
    const { stampFileUrl } = await import("@/lib/file-token");

    expect(stampFileUrl(null)).toBeNull();
    // A column still holding base64 must pass through unchanged, so a caller can
    // stamp a whole response without knowing what has been migrated.
    expect(stampFileUrl("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
    expect(stampFileUrl("/api/files/schools/a/x/1/y.png")).toMatch(
      /^\/api\/files\/schools\/a\/x\/1\/y\.png\?t=\d+\./
    );
  });
});

describe("type sniffing", () => {
  it("reads the type from the bytes, not the declared MIME type", async () => {
    const { sniffMimeType } = await import("@/lib/file-upload");

    expect(sniffMimeType(Buffer.from([0xff, 0xd8, 0xff, 0x00]))).toBe("image/jpeg");
    expect(
      sniffMimeType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    ).toBe("image/png");
    expect(sniffMimeType(Buffer.from("%PDF-1.7"))).toBe("application/pdf");
    // An executable renamed to .png must not be accepted as one.
    expect(sniffMimeType(Buffer.from("MZ\x90\x00"))).toBeNull();
  });

  it("recognises SVG despite it having no magic number", async () => {
    const { sniffMimeType } = await import("@/lib/file-upload");

    expect(sniffMimeType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe(
      "image/svg+xml"
    );
    expect(
      sniffMimeType(Buffer.from('<?xml version="1.0"?>\n<!-- a note -->\n<svg width="1"></svg>'))
    ).toBe("image/svg+xml");
    // Plain XML or HTML is not a logo.
    expect(sniffMimeType(Buffer.from("<html><body></body></html>"))).toBeNull();
    expect(sniffMimeType(Buffer.from('<?xml version="1.0"?><rss></rss>'))).toBeNull();
  });
});
