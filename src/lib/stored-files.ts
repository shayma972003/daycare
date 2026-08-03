import "server-only";
import { prisma } from "@/lib/prisma";
import { deleteObjects, keyFromUrl } from "@/lib/r2";
import { reportError } from "@/lib/monitoring";

/**
 * Removing files, from the database's point of view (task 0.34).
 *
 * Once bytes live outside Postgres, nulling a column stops being a deletion —
 * it only forgets where the file is. Every path that used to write `null` now
 * has to name the object as well, and this is the one function that does it, so
 * "delete the row, forget the object" cannot be reintroduced one route at a
 * time.
 *
 * Legacy base64 values pass through as a no-op: nulling the column really did
 * delete those, and there is nothing in the bucket to chase.
 */

/** Deletes the object behind a stored URL, if there is one. Never throws. */
export async function discardStoredFile(url: string | null | undefined): Promise<void> {
  const key = keyFromUrl(url);
  if (!key) return;

  await deleteObjects([key]);
  await prisma.storedFile.deleteMany({ where: { key } });
}

/** The same for several URLs at once — one batched call to the object store. */
export async function discardStoredFiles(
  urls: Array<string | null | undefined>
): Promise<void> {
  const keys = urls.map(keyFromUrl).filter((key): key is string => Boolean(key));
  if (keys.length === 0) return;

  await deleteObjects(keys);
  await prisma.storedFile.deleteMany({ where: { key: { in: keys } } });
}

/**
 * Deletes every object a row owns, found by owner rather than by column.
 *
 * Used where the caller cannot enumerate the URLs — anonymising a child whose
 * columns are about to be overwritten, or deleting a school. Going through
 * `StoredFile` is what makes this possible at all: the alternative is a prefix
 * listing against the bucket, which is a paginated network call.
 *
 * Returns how many objects were removed, and reports a mismatch. In the
 * anonymisation path a surviving object is not a wasted byte — it is a surviving
 * photograph of a child whose record was supposed to be erased — so the caller
 * needs to know, and someone needs to be told.
 */
export async function discardFilesOwnedBy(
  schoolId: string,
  ownerIds: string[],
  context: string
): Promise<{ expected: number; deleted: number }> {
  if (ownerIds.length === 0) return { expected: 0, deleted: 0 };

  const files = await prisma.storedFile.findMany({
    where: { schoolId, ownerId: { in: ownerIds } },
    select: { key: true },
  });
  if (files.length === 0) return { expected: 0, deleted: 0 };

  const keys = files.map((file) => file.key);
  const deleted = await deleteObjects(keys);

  // Only the rows whose objects are actually gone. Keeping the rest means the
  // next sweep tries again, instead of the record of the file disappearing while
  // the file itself remains.
  if (deleted === keys.length) {
    await prisma.storedFile.deleteMany({ where: { key: { in: keys } } });
  } else {
    reportError(
      new Error(
        `${keys.length - deleted} of ${keys.length} objects survived deletion`
      ),
      { scope: context, schoolId, extra: { expected: keys.length, deleted } },
      "fatal"
    );
  }

  return { expected: keys.length, deleted };
}
