BEGIN;

-- Refuse to hide or rewrite cross-tenant rows. If any exist, deployment stops
-- before changing constraints so they can be investigated explicitly.
DO $$
DECLARE
    conflicting_rows INTEGER;
BEGIN
    SELECT count(*)
      INTO conflicting_rows
      FROM "SchoolAdminInvitation" AS invitation
      JOIN "User" AS account ON account."id" = invitation."userId"
     WHERE invitation."schoolId" <> account."schoolId";

    IF conflicting_rows > 0 THEN
        RAISE EXCEPTION
            'Cannot enforce SchoolAdminInvitation tenant consistency: % conflicting row(s)',
            conflicting_rows;
    END IF;
END $$;

-- PostgreSQL requires the referenced column pair to be unique. `id` is already
-- globally unique; this composite key exists to make the tenant invariant part
-- of the foreign key and is also represented in schema.prisma.
CREATE UNIQUE INDEX "User_id_schoolId_key"
ON "User"("id", "schoolId");

ALTER TABLE "SchoolAdminInvitation"
DROP CONSTRAINT "SchoolAdminInvitation_userId_fkey";

ALTER TABLE "SchoolAdminInvitation"
ADD CONSTRAINT "SchoolAdminInvitation_userId_schoolId_fkey"
FOREIGN KEY ("userId", "schoolId") REFERENCES "User"("id", "schoolId")
ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
