-- Object storage index (task 0.34).
--
-- One row per object in R2. Records the size, because the object store cannot be
-- asked for it cheaply, and the key, because deleting a row no longer deletes
-- the file once the bytes live outside Postgres.

CREATE TABLE "StoredFile" (
    "key" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoredFile_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "StoredFile_schoolId_category_idx" ON "StoredFile"("schoolId", "category");
CREATE INDEX "StoredFile_schoolId_ownerId_idx" ON "StoredFile"("schoolId", "ownerId");

-- RESTRICT, matching every other tenant table: deleting a school must fail
-- loudly while files remain, rather than orphaning objects in the bucket that
-- nothing then knows to remove.
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_schoolId_fkey"
    FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
