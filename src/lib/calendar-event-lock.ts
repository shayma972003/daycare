import "server-only";

import { Prisma } from "@/generated/prisma/client";

type CalendarLockClient = Pick<Prisma.TransactionClient, "$queryRaw">;

export async function lockCalendarEventForUpdate(
  tx: CalendarLockClient,
  input: { id: string; schoolId: string }
) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "CalendarEvent"
    WHERE "id" = ${input.id} AND "schoolId" = ${input.schoolId}
    FOR UPDATE
  `);
  return rows.length === 1;
}
