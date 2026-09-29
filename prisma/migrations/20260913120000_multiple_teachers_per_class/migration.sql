-- Add the tenant-scoped many-to-many assignment without removing the legacy
-- Class.teacherId column. That column remains the compatibility primary teacher
-- until every deployed client has moved to ClassTeacher.
CREATE TABLE "ClassTeacher" (
    "schoolId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClassTeacher_pkey" PRIMARY KEY ("schoolId", "classId", "teacherId")
);

CREATE INDEX "ClassTeacher_classId_idx" ON "ClassTeacher"("classId");
CREATE INDEX "ClassTeacher_schoolId_teacherId_idx" ON "ClassTeacher"("schoolId", "teacherId");

ALTER TABLE "ClassTeacher"
ADD CONSTRAINT "ClassTeacher_schoolId_fkey"
FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClassTeacher"
ADD CONSTRAINT "ClassTeacher_classId_schoolId_fkey"
FOREIGN KEY ("classId", "schoolId") REFERENCES "Class"("id", "schoolId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClassTeacher"
ADD CONSTRAINT "ClassTeacher_teacherId_schoolId_fkey"
FOREIGN KEY ("teacherId", "schoolId") REFERENCES "Teacher"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve every current assignment exactly once. Historical rows with no
-- teacher remain unassigned; no teacher is guessed and no existing row changes.
INSERT INTO "ClassTeacher" ("schoolId", "classId", "teacherId")
SELECT "schoolId", "id", "teacherId"
FROM "Class"
WHERE "teacherId" IS NOT NULL
ON CONFLICT DO NOTHING;
