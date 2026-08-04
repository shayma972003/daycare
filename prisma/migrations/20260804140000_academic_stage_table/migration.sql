-- Academic stages become the school's own list (task 2.44).
--
-- Two frozen enums described the same thing under different names — the child
-- carried `academicStage` (NURSERY/KG1/KG2/KG3) and the room carried `group`
-- with identical values — and each had its own set of Arabic labels, which is
-- why one screen said "المجموعة" and another said "المرحلة الدراسية". Neither
-- could be added to: a nursery running a pre-KG room had nowhere to put it.
--
-- Existing values are carried across rather than reset, so no room and no child
-- loses the stage it already had.

CREATE TABLE "AcademicStageOption" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcademicStageOption_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AcademicStageOption_schoolId_nameAr_key"
    ON "AcademicStageOption"("schoolId", "nameAr");
CREATE INDEX "AcademicStageOption_schoolId_archivedAt_idx"
    ON "AcademicStageOption"("schoolId", "archivedAt");

ALTER TABLE "AcademicStageOption" ADD CONSTRAINT "AcademicStageOption_schoolId_fkey"
    FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── The four standard stages, for every school that exists ──────────────────
--
-- Named as the sector names them. `CLASS_GROUP_LABELS` and the `groups`
-- dictionary disagreed ("روضة أولى" against "كي جي 1"); the sector's own wording
-- wins, and any school is free to rename them.

INSERT INTO "AcademicStageOption" ("id", "schoolId", "nameAr", "nameEn", "sortOrder", "isSystem", "createdAt", "updatedAt")
SELECT
    'stg_' || substr(md5(random()::text || s."id" || stage.name_ar), 1, 21),
    s."id",
    stage.name_ar,
    stage.name_en,
    stage.sort_order,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "School" s
CROSS JOIN (VALUES
    ('حضانة',      'Nursery', 0),
    ('روضة أولى',  'KG 1',    1),
    ('روضة ثانية', 'KG 2',    2),
    ('تمهيدي',     'KG 3',    3)
) AS stage(name_ar, name_en, sort_order)
ON CONFLICT ("schoolId", "nameAr") DO NOTHING;

-- ── Point rooms and children at their existing stage ────────────────────────

ALTER TABLE "Class" ADD COLUMN "stageId" TEXT;
ALTER TABLE "Student" ADD COLUMN "stageId" TEXT;

ALTER TABLE "Class" ADD CONSTRAINT "Class_stageId_fkey"
    FOREIGN KEY ("stageId") REFERENCES "AcademicStageOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Student" ADD CONSTRAINT "Student_stageId_fkey"
    FOREIGN KEY ("stageId") REFERENCES "AcademicStageOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "Class" c
SET "stageId" = o."id"
FROM "AcademicStageOption" o
WHERE o."schoolId" = c."schoolId"
  AND o."nameAr" = CASE c."group"
      WHEN 'NURSERY' THEN 'حضانة'
      WHEN 'KG1'     THEN 'روضة أولى'
      WHEN 'KG2'     THEN 'روضة ثانية'
      WHEN 'KG3'     THEN 'تمهيدي'
  END;

UPDATE "Student" st
SET "stageId" = o."id"
FROM "AcademicStageOption" o
WHERE st."academicStage" IS NOT NULL
  AND o."schoolId" = st."schoolId"
  AND o."nameAr" = CASE st."academicStage"
      WHEN 'NURSERY' THEN 'حضانة'
      WHEN 'KG1'     THEN 'روضة أولى'
      WHEN 'KG2'     THEN 'روضة ثانية'
      WHEN 'KG3'     THEN 'تمهيدي'
  END;

CREATE INDEX "Class_stageId_idx" ON "Class"("stageId");
CREATE INDEX "Student_stageId_idx" ON "Student"("stageId");
