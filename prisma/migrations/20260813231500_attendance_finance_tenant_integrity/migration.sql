BEGIN;

DO $$
DECLARE conflicts integer;
BEGIN
  SELECT count(*) INTO conflicts FROM "CareReport" r JOIN "Student" s ON s.id=r."studentId" WHERE r."schoolId"<>s."schoolId";
  IF conflicts>0 THEN RAISE EXCEPTION 'CareReport/Student tenant conflicts: % row(s)', conflicts; END IF;
  SELECT count(*) INTO conflicts FROM "CareReport" r LEFT JOIN "Class" c ON c.id=r."classId" WHERE r."classId" IS NOT NULL AND (c.id IS NULL OR r."schoolId"<>c."schoolId");
  IF conflicts>0 THEN RAISE EXCEPTION 'CareReport/Class missing or tenant-conflicting references: % row(s)', conflicts; END IF;
  SELECT count(*) INTO conflicts FROM "CareReport" r LEFT JOIN "Teacher" t ON t.id=r."teacherId" WHERE r."teacherId" IS NOT NULL AND (t.id IS NULL OR r."schoolId"<>t."schoolId");
  IF conflicts>0 THEN RAISE EXCEPTION 'CareReport/Teacher missing or tenant-conflicting references: % row(s)', conflicts; END IF;
  SELECT count(*) INTO conflicts FROM "Attendance" a JOIN "Student" s ON s.id=a."studentId" WHERE a."schoolId"<>s."schoolId";
  IF conflicts>0 THEN RAISE EXCEPTION 'Attendance/Student tenant conflicts: % row(s)', conflicts; END IF;
  SELECT count(*) INTO conflicts FROM "Attendance" a JOIN "Class" c ON c.id=a."classId" WHERE a."classId" IS NOT NULL AND a."schoolId"<>c."schoolId";
  IF conflicts>0 THEN RAISE EXCEPTION 'Attendance/Class tenant conflicts: % row(s)', conflicts; END IF;
  SELECT count(*) INTO conflicts FROM "TeacherAttendance" a JOIN "Teacher" t ON t.id=a."teacherId" WHERE a."schoolId"<>t."schoolId";
  IF conflicts>0 THEN RAISE EXCEPTION 'TeacherAttendance tenant conflicts: % row(s)', conflicts; END IF;
  SELECT count(*) INTO conflicts FROM "Shift" s JOIN "Teacher" t ON t.id=s."teacherId" WHERE s."schoolId"<>t."schoolId";
  IF conflicts>0 THEN RAISE EXCEPTION 'Shift tenant conflicts: % row(s)', conflicts; END IF;
  SELECT count(*) INTO conflicts FROM "Invoice" i JOIN "Student" s ON s.id=i."studentId" WHERE i."studentId" IS NOT NULL AND i."schoolId"<>s."schoolId";
  IF conflicts>0 THEN RAISE EXCEPTION 'Invoice/Student tenant conflicts: % row(s)', conflicts; END IF;
  SELECT count(*) INTO conflicts FROM "Invoice" i JOIN "Teacher" t ON t.id=i."teacherId" WHERE i."teacherId" IS NOT NULL AND i."schoolId"<>t."schoolId";
  IF conflicts>0 THEN RAISE EXCEPTION 'Invoice/Teacher tenant conflicts: % row(s)', conflicts; END IF;
  SELECT count(*) INTO conflicts FROM "PaymentCycle" p JOIN "Student" s ON s.id=p.student_id WHERE p.school_id<>s."schoolId";
  IF conflicts>0 THEN RAISE EXCEPTION 'PaymentCycle/Student tenant conflicts: % row(s)', conflicts; END IF;
END $$;

CREATE UNIQUE INDEX "Teacher_id_schoolId_key" ON "Teacher"("id", "schoolId");

ALTER TABLE "CareReport" DROP CONSTRAINT "CareReport_studentId_fkey";
ALTER TABLE "CareReport" ADD CONSTRAINT "CareReport_studentId_schoolId_fkey" FOREIGN KEY ("studentId","schoolId") REFERENCES "Student"("id","schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CareReport" ADD CONSTRAINT "CareReport_classId_schoolId_fkey" FOREIGN KEY ("classId","schoolId") REFERENCES "Class"("id","schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CareReport" ADD CONSTRAINT "CareReport_teacherId_schoolId_fkey" FOREIGN KEY ("teacherId","schoolId") REFERENCES "Teacher"("id","schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Attendance" DROP CONSTRAINT "Attendance_studentId_fkey";
ALTER TABLE "Attendance" DROP CONSTRAINT "Attendance_classId_fkey";
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_studentId_schoolId_fkey" FOREIGN KEY ("studentId","schoolId") REFERENCES "Student"("id","schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_classId_schoolId_fkey" FOREIGN KEY ("classId","schoolId") REFERENCES "Class"("id","schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TeacherAttendance" DROP CONSTRAINT "TeacherAttendance_teacherId_fkey";
ALTER TABLE "TeacherAttendance" ADD CONSTRAINT "TeacherAttendance_teacherId_schoolId_fkey" FOREIGN KEY ("teacherId","schoolId") REFERENCES "Teacher"("id","schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Shift" DROP CONSTRAINT "Shift_teacherId_fkey";
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_teacherId_schoolId_fkey" FOREIGN KEY ("teacherId","schoolId") REFERENCES "Teacher"("id","schoolId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_studentId_fkey";
ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_teacherId_fkey";
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_studentId_schoolId_fkey" FOREIGN KEY ("studentId","schoolId") REFERENCES "Student"("id","schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_teacherId_schoolId_fkey" FOREIGN KEY ("teacherId","schoolId") REFERENCES "Teacher"("id","schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentCycle" DROP CONSTRAINT "PaymentCycle_student_id_fkey";
ALTER TABLE "PaymentCycle" ADD CONSTRAINT "PaymentCycle_student_id_school_id_fkey" FOREIGN KEY (student_id,school_id) REFERENCES "Student"("id","schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
