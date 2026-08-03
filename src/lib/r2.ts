import "server-only";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env, storageEnabled } from "@/lib/env";

/**
 * Cloudflare R2 object storage (task 0.34).
 *
 * Every upload in this codebase used to become a base64 data URI inside a
 * Postgres column. It worked, and it cost about a third more bytes than the
 * original file, in the one place where bytes are most expensive: a row that is
 * read by list queries, replicated, and copied into every backup. A single
 * nursery with photos on 60 children turned `SELECT * FROM "Student"` into tens
 * of megabytes.
 *
 * ## The bucket is private
 *
 * Public access is disabled on the bucket, deliberately. These are photographs
 * of children and scans of identity documents; a public bucket means one leaked
 * or guessed URL is permanently readable by anyone, with no session to revoke.
 *
 * Reads therefore go through `/api/files/[...key]`, which proves the caller
 * before redirecting to a short-lived signed URL. See that route for the access
 * rules.
 *
 * ## Keys carry the tenant
 *
 * `schools/<schoolId>/<category>/<id>/<random>.<ext>`
 *
 * The tenant is the first meaningful segment so that (a) the file route can
 * check it against the session without a database lookup, and (b) deleting a
 * school — or anonymising a child — is a prefix operation rather than a join.
 * The random segment makes keys unguessable even to someone who knows a child's
 * id.
 */

const ENDPOINT = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

let client: S3Client | null = null;

function s3(): S3Client {
  if (!storageEnabled) {
    throw new Error(
      "R2 is not configured — set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET"
    );
  }
  // Reused across invocations: on a warm serverless instance rebuilding the
  // client per request re-resolves credentials and re-opens sockets for nothing.
  client ??= new S3Client({
    // R2 has no regions; the SDK still requires the field.
    region: "auto",
    endpoint: ENDPOINT,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID!,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    },
  });
  return client;
}

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "application/pdf": "pdf",
  "application/zip": "zip",
  "application/vnd.ms-excel": "xls",
};

/** Upload categories. Also the second key segment, so they are part of the API. */
export type FileCategory =
  | "students"
  | "staff"
  | "care"
  | "units"
  | "activities"
  | "classes"
  | "school";

/**
 * Builds a key for a new object.
 *
 * `ownerId` is the row the file belongs to — a student id, a unit id. It is in
 * the key so that deleting one child's files does not require a table listing
 * them, and `crypto.randomUUID()` is what stops a key being derivable from a
 * child's id alone.
 */
export function buildObjectKey(
  schoolId: string,
  category: FileCategory,
  ownerId: string,
  mime: string
): string {
  const ext = EXTENSIONS[mime] ?? "bin";
  return `schools/${schoolId}/${category}/${ownerId}/${crypto.randomUUID()}.${ext}`;
}

/** The tenant a key belongs to, or null when the key is not ours. */
export function schoolIdFromKey(key: string): string | null {
  const match = /^schools\/([^/]+)\//.exec(key);
  return match ? match[1] : null;
}

/**
 * The value stored in the database and put straight into `<img src>`.
 *
 * A same-origin path, not a signed URL: a signed URL expires, and a database is
 * exactly the wrong place to keep a value with a two-hour lifetime. It also
 * means the ~50 components already reading these columns keep working untouched,
 * and `next.config.ts` needs no `images.remotePatterns` entry (task 0.44) —
 * nothing is ever loaded from a third-party origin.
 */
export function fileUrl(key: string): string {
  return `/api/files/${key}`;
}

/** The key behind a stored URL, or null when the value is a legacy data URI. */
export function keyFromUrl(url: string | null | undefined): string | null {
  if (!url || !url.startsWith("/api/files/")) return null;
  return url.slice("/api/files/".length);
}

export interface StoredObject {
  key: string;
  url: string;
  sizeBytes: number;
  contentType: string;
}

/** Uploads and returns what the caller needs to record. */
export async function putObject(
  key: string,
  body: Buffer,
  contentType: string
): Promise<StoredObject> {
  await s3().send(
    new PutObjectCommand({
      Bucket: env.R2_BUCKET!,
      Key: key,
      Body: body,
      ContentType: contentType,
      /**
       * Immutable: a key is never reused — a replacement avatar gets a new UUID
       * and the old object is deleted. So the browser and the CDN may cache it
       * for as long as they like.
       */
      CacheControl: "private, max-age=31536000, immutable",
    })
  );

  return { key, url: fileUrl(key), sizeBytes: body.length, contentType };
}

/**
 * A short-lived URL the browser can fetch directly.
 *
 * Five minutes: long enough to load a page full of photos, short enough that a
 * URL copied out of devtools and pasted elsewhere is dead before it travels.
 * Bytes go straight from Cloudflare to the browser rather than through our
 * function, which is the difference between a 200 KB response and a 200 KB
 * response *plus* 200 KB of function egress.
 */
export function signedReadUrl(key: string, expiresInSeconds = 300): Promise<string> {
  return getSignedUrl(
    s3(),
    new GetObjectCommand({ Bucket: env.R2_BUCKET!, Key: key }),
    { expiresIn: expiresInSeconds }
  );
}

/**
 * Deletes objects, never throwing.
 *
 * Callers are cleanup paths — replacing an avatar, anonymising a child, deleting
 * a school. In every one of them the database change is the thing that matters
 * and must not be rolled back because a storage call failed; a surviving object
 * is a wasted byte, while a failed transaction is lost work. Failures are
 * reported and swallowed.
 *
 * The one place this rule is *not* good enough is anonymisation, where a
 * surviving object is a surviving photograph of a child whose record was
 * supposed to be erased. That path checks the returned count and logs a
 * `fatal` when it does not match — see `src/lib/anonymization.ts`.
 */
export async function deleteObjects(keys: string[]): Promise<number> {
  const valid = keys.filter(Boolean);
  if (valid.length === 0 || !storageEnabled) return 0;

  let deleted = 0;
  // DeleteObjects caps at 1000 keys per call.
  for (let i = 0; i < valid.length; i += 1000) {
    const batch = valid.slice(i, i + 1000);
    try {
      const result = await s3().send(
        new DeleteObjectsCommand({
          Bucket: env.R2_BUCKET!,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        })
      );
      deleted += batch.length - (result.Errors?.length ?? 0);
      if (result.Errors?.length) {
        console.error("[r2] some objects were not deleted:", result.Errors.length);
      }
    } catch (error) {
      console.error("[r2] delete failed:", error);
    }
  }

  return deleted;
}
