import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { deleteObjects, keyFromUrl } from "@/lib/r2";
import { reportError } from "@/lib/monitoring";
import {
  STORED_FILE_OWNER,
  type StoredFileOwner,
} from "@/lib/stored-file-ownership";

type StoredFileDb = Pick<Prisma.TransactionClient, "storedFile">;

export class StoredFileOwnershipError extends Error {
  constructor(message = "Stored file ownership changed") {
    super(message);
    this.name = "StoredFileOwnershipError";
  }
}

export interface ExactStoredFileOwner {
  schoolId: string;
  key: string;
  ownerType: StoredFileOwner;
  ownerId: string;
}

export type StoredFileDeleteResult =
  | { status: "not_stored" }
  | { status: "missing" }
  | { status: "deleted" }
  | { status: "pending" };

/**
 * Moves one registered object between lifecycle owners using a conditional
 * update. A key from another token, tenant, or phase changes zero rows and the
 * caller's transaction must roll back.
 */
export async function transferStoredFileOwnership(
  db: StoredFileDb,
  input: ExactStoredFileOwner & {
    nextOwnerType: StoredFileOwner;
    nextOwnerId: string;
  }
): Promise<void> {
  const moved = await db.storedFile.updateMany({
    where: {
      key: input.key,
      schoolId: input.schoolId,
      category: "students",
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      deletePendingAt: null,
    },
    data: {
      ownerType: input.nextOwnerType,
      ownerId: input.nextOwnerId,
    },
  });

  if (moved.count !== 1) throw new StoredFileOwnershipError();
}

/** Marks an exact owner/key pair before crossing from Postgres into R2. */
export async function markStoredFileForDeletion(
  db: StoredFileDb,
  input: ExactStoredFileOwner,
  now = new Date()
): Promise<"missing" | "pending"> {
  const marked = await db.storedFile.updateMany({
    where: {
      key: input.key,
      schoolId: input.schoolId,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
    },
    data: { deletePendingAt: now },
  });
  return marked.count === 1 ? "pending" : "missing";
}

/**
 * Completes a previously marked deletion. A failed R2 call deliberately leaves
 * the row and its marker in place so a later request or cleanup pass retries it.
 */
export async function completeStoredFileDeletion(
  input: ExactStoredFileOwner
): Promise<StoredFileDeleteResult> {
  const file = await prisma.storedFile.findFirst({
    where: {
      key: input.key,
      schoolId: input.schoolId,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      deletePendingAt: { not: null },
    },
    select: { key: true },
  });
  if (!file) return { status: "missing" };

  const removed = await deleteObjects([file.key]);
  if (removed !== 1) {
    reportError(
      new Error("Stored object deletion remains pending"),
      {
        scope: "stored-file.delete",
        schoolId: input.schoolId,
        extra: { ownerType: input.ownerType },
      },
      "error"
    );
    return { status: "pending" };
  }

  const deleted = await prisma.storedFile.deleteMany({
    where: {
      key: input.key,
      schoolId: input.schoolId,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      deletePendingAt: { not: null },
    },
  });
  return deleted.count === 1 ? { status: "deleted" } : { status: "pending" };
}

/** Deletes a URL registered in StoredFile, retaining the row on R2 failure. */
export async function discardStoredFile(
  url: string | null | undefined
): Promise<StoredFileDeleteResult> {
  const key = keyFromUrl(url);
  if (!key) return { status: "not_stored" };

  const file = await prisma.storedFile.findUnique({
    where: { key },
    select: { key: true, schoolId: true, ownerType: true, ownerId: true },
  });
  if (!file) return { status: "missing" };

  const input: ExactStoredFileOwner = file;
  await markStoredFileForDeletion(prisma, input);
  return completeStoredFileDeletion(input);
}

/** The same for several URLs. Each failed object remains individually retryable. */
export async function discardStoredFiles(
  urls: Array<string | null | undefined>
): Promise<StoredFileDeleteResult[]> {
  const results: StoredFileDeleteResult[] = [];
  for (const url of urls) results.push(await discardStoredFile(url));
  return results;
}

/**
 * Deletes every file owned by specific rows in one tenant. Callers must name
 * the owner type so equal ids in unrelated tables cannot delete each other's
 * objects.
 */
export async function discardFilesOwnedBy(
  schoolId: string,
  ownerIds: string[],
  ownerType: StoredFileOwner,
  context: string
): Promise<{ expected: number; deleted: number }> {
  if (ownerIds.length === 0) return { expected: 0, deleted: 0 };

  const files = await prisma.storedFile.findMany({
    where: { schoolId, ownerType, ownerId: { in: ownerIds } },
    select: { key: true, ownerId: true },
  });

  let deleted = 0;
  for (const file of files) {
    const input = { schoolId, ownerType, ownerId: file.ownerId, key: file.key };
    await markStoredFileForDeletion(prisma, input);
    const result = await completeStoredFileDeletion(input);
    if (result.status === "deleted") deleted += 1;
  }

  if (deleted !== files.length) {
    reportError(
      new Error(`${files.length - deleted} of ${files.length} objects survived deletion`),
      { scope: context, schoolId, extra: { expected: files.length, deleted, ownerType } },
      "fatal"
    );
  }

  return { expected: files.length, deleted };
}

export interface EnrollmentFileCleanupResult {
  inspected: number;
  deleted: number;
  pending: number;
}

/**
 * Bounded cleanup for abandoned token uploads and rejected submissions. Active
 * submissions are never selected. Rows already marked pending are retried.
 */
export async function cleanupEnrollmentStoredFiles(
  options: { now?: Date; limit?: number } = {}
): Promise<EnrollmentFileCleanupResult> {
  const now = options.now ?? new Date();
  const limit = Math.max(1, Math.min(options.limit ?? 100, 500));

  const expiredTokens = await prisma.enrollmentToken.findMany({
    where: { expires_at: { lt: now } },
    select: { id: true, school_id: true },
    orderBy: { expires_at: "asc" },
    take: limit,
  });
  const rejectedSubmissions = await prisma.enrollmentSubmission.findMany({
    where: { status: "rejected", evaluation_file_url: { not: null } },
    select: { id: true, school_id: true },
    orderBy: { reviewed_at: "asc" },
    take: limit,
  });

  const candidates = await prisma.storedFile.findMany({
    where: {
      OR: [
        ...expiredTokens.map((token) => ({
          schoolId: token.school_id,
          ownerType: STORED_FILE_OWNER.ENROLLMENT_TOKEN,
          ownerId: token.id,
        })),
        ...rejectedSubmissions.map((submission) => ({
          schoolId: submission.school_id,
          ownerType: STORED_FILE_OWNER.ENROLLMENT_SUBMISSION,
          ownerId: submission.id,
        })),
        // Retry any cross-system deletion that previously reached R2 and
        // failed, including anonymization and replacement files.
        { deletePendingAt: { not: null } },
      ],
    },
    select: { key: true, schoolId: true, ownerType: true, ownerId: true },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  let deleted = 0;
  let pending = 0;
  for (const file of candidates) {
    const input: ExactStoredFileOwner = file;
    await markStoredFileForDeletion(prisma, input, now);
    const result = await completeStoredFileDeletion(input);
    if (result.status === "deleted") {
      deleted += 1;
      if (file.ownerType === STORED_FILE_OWNER.ENROLLMENT_SUBMISSION) {
        await prisma.enrollmentSubmission.updateMany({
          where: {
            id: file.ownerId,
            school_id: file.schoolId,
            status: "rejected",
          },
          data: { evaluation_file_url: null, evaluation_file_name: null },
        });
      }
    }
    else if (result.status === "pending") pending += 1;
  }

  return { inspected: candidates.length, deleted, pending };
}
