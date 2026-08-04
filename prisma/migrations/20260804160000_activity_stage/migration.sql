-- Activities join the shared academic-stage list (task 2.44).
--
-- The activity carried its own `ClassGroup`, the third copy of the same four
-- values. Existing rows are carried across by name, exactly as the class and
-- child rows were.

ALTER TABLE "Activity" ADD COLUMN "stageId" TEXT;

ALTER TABLE "Activity" ADD CONSTRAINT "Activity_stageId_fkey"
    FOREIGN KEY ("stageId") REFERENCES "AcademicStageOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "Activity" a
SET "stageId" = o."id"
FROM "AcademicStageOption" o
WHERE o."schoolId" = a."schoolId"
  AND o."nameAr" = CASE a."group"
      WHEN 'NURSERY' THEN 'حضانة'
      WHEN 'KG1'     THEN 'روضة أولى'
      WHEN 'KG2'     THEN 'روضة ثانية'
      WHEN 'KG3'     THEN 'تمهيدي'
  END;

CREATE INDEX "Activity_stageId_idx" ON "Activity"("stageId");
