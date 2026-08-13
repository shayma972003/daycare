BEGIN;

DO $$
DECLARE conflicts integer;
BEGIN
  SELECT count(*) INTO conflicts FROM "EnrollmentSubmission" s JOIN "EnrollmentToken" t ON t.id=s.token_id WHERE s.school_id<>t.school_id;
  IF conflicts>0 THEN RAISE EXCEPTION 'EnrollmentSubmission/Token tenant conflicts: % row(s)', conflicts; END IF;
  SELECT count(*) INTO conflicts FROM "DeviceToken" d JOIN "GuardianAccount" g ON g.id=d."guardianAccountId" WHERE d."guardianAccountId" IS NOT NULL AND d."schoolId"<>g."schoolId";
  IF conflicts>0 THEN RAISE EXCEPTION 'DeviceToken/GuardianAccount tenant conflicts: % row(s)', conflicts; END IF;
  SELECT count(*) INTO conflicts FROM "DeviceToken" d LEFT JOIN "User" u ON u.id=d."userId" WHERE d."userId" IS NOT NULL AND (u.id IS NULL OR d."schoolId"<>u."schoolId");
  IF conflicts>0 THEN RAISE EXCEPTION 'DeviceToken/User missing or tenant-conflicting references: % row(s)', conflicts; END IF;
  SELECT count(*) INTO conflicts FROM "DeviceToken" WHERE num_nonnulls("guardianAccountId","userId")<>1;
  IF conflicts>0 THEN RAISE EXCEPTION 'DeviceToken owner conflicts: % row(s)', conflicts; END IF;
END $$;

CREATE UNIQUE INDEX "EnrollmentToken_id_school_id_key" ON "EnrollmentToken"("id",school_id);
CREATE UNIQUE INDEX "GuardianAccount_id_schoolId_key" ON "GuardianAccount"("id","schoolId");

ALTER TABLE "EnrollmentSubmission" DROP CONSTRAINT "EnrollmentSubmission_token_id_fkey";
ALTER TABLE "EnrollmentSubmission" ADD CONSTRAINT "EnrollmentSubmission_token_id_school_id_fkey" FOREIGN KEY (token_id,school_id) REFERENCES "EnrollmentToken"("id",school_id) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DeviceToken" DROP CONSTRAINT "DeviceToken_guardianAccountId_fkey";
ALTER TABLE "DeviceToken" ADD CONSTRAINT "DeviceToken_guardianAccountId_schoolId_fkey" FOREIGN KEY ("guardianAccountId","schoolId") REFERENCES "GuardianAccount"("id","schoolId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeviceToken" ADD CONSTRAINT "DeviceToken_userId_schoolId_fkey" FOREIGN KEY ("userId","schoolId") REFERENCES "User"("id","schoolId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeviceToken" ADD CONSTRAINT "DeviceToken_exactly_one_owner_check" CHECK (num_nonnulls("guardianAccountId","userId")=1);

COMMIT;
