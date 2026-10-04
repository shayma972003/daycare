import type { Prisma } from "@/generated/prisma/client";
import { mobileAuthResponse, requireMobileAuth } from "@/lib/mobile-guard";
import { prisma } from "@/lib/prisma";
import { studentClassWhere } from "@/lib/student-access-scope";

type ReturnedRow = Prisma.CareReportGetPayload<{
  include: {
    student: {
      select: {
        id: true;
        name: true;
        avatarUrl: true;
        class: { select: { name: true } };
      };
    };
  };
}>;

function toIso(value: Date | null | undefined) {
  return value?.toISOString() ?? null;
}

function serializeBatch(batchId: string, rows: ReturnedRow[]) {
  const meal = rows.find((row) => row.dailyItemKey === "meal");
  if (!meal?.mealSource) return null;

  const rejected = rows.find((row) => row.reviewStatus === "REJECTED");
  const byStudent = new Map<string, ReturnedRow[]>();
  for (const row of rows) {
    byStudent.set(row.studentId, [...(byStudent.get(row.studentId) ?? []), row]);
  }

  return {
    batchId,
    reviewNote: rejected?.reviewNote ?? null,
    returnedAt: toIso(rejected?.reviewedAt),
    reportedByName: meal.reportedByName,
    meal: {
      source: meal.mealSource,
      name: meal.mealName,
      occurredAt: meal.occurredAt.toISOString(),
    },
    students: [...byStudent.values()].map((studentRows) => ({
      id: studentRows[0].student.id,
      name: studentRows[0].student.name,
      avatarUrl: studentRows[0].student.avatarUrl,
      classId: studentRows[0].classId,
      className: studentRows[0].student.class?.name ?? null,
    })),
    entries: [...byStudent.entries()].map(([studentId, studentRows]) => {
      const studentMeal = studentRows.find((row) => row.dailyItemKey === "meal");
      const nap = studentRows.find((row) => row.dailyItemKey === "nap");
      const toilet = studentRows.find((row) => row.dailyItemKey === "toilet");
      const mood = studentRows.find((row) => row.dailyItemKey === "mood");
      const note = studentRows.find((row) => row.dailyItemKey === "note");
      const supplies = studentRows.find((row) => row.dailyItemKey === "supplies");
      const health = studentRows.find((row) => row.dailyItemKey === "health");
      const medication = studentRows.find((row) => row.dailyItemKey === "medication");

      return {
        studentId,
        mealAmount: studentMeal?.mealAmount ?? null,
        napStatus: nap
          ? (nap.napQuality === "DID_NOT_SLEEP" ? "DID_NOT_SLEEP" : "SLEPT")
          : "NO_RECORD",
        napStartAt: toIso(nap?.napStartAt),
        napEndAt: toIso(nap?.napEndAt),
        toilet: toilet
          ? (toilet.toiletKind === "POTTY"
            ? "POTTY"
            : toilet.toiletState === "SOILED"
              ? "DIAPER_SOILED"
              : "DIAPER_WET")
          : "NO_RECORD",
        toiletOccurredAt: toilet ? toilet.occurredAt.toISOString() : null,
        mood: mood?.mood ?? null,
        note: note?.note ?? null,
        extraEvents: [],
        supplies: supplies?.supplyItem ?? null,
        health: health?.symptom ?? null,
        medication: medication
          ? {
              name: medication.medicationName ?? "",
              dose: medication.medicationDose ?? "",
              occurredAt: medication.occurredAt.toISOString(),
            }
          : null,
      };
    }),
  };
}

/** Returns only the signed-in teacher's batches that management returned. */
export async function GET(request: Request) {
  let context;
  try {
    context = await requireMobileAuth(request, {
      kind: "staff",
      permission: "attendance.students",
    });
  } catch (error) {
    return mobileAuthResponse(error) ?? Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const schoolId = context.claims.schoolId;
  if (!context.teacherId) return Response.json([]);

  const returned = await prisma.careReport.findMany({
    where: {
      schoolId,
      teacherId: context.teacherId,
      reviewStatus: "REJECTED",
      dailyBatchId: { not: null },
      deletedAt: null,
      student: studentClassWhere(context),
    },
    select: { dailyBatchId: true },
    orderBy: { reviewedAt: "desc" },
    take: 200,
  });
  const batchIds = [...new Set(
    returned.flatMap((row) => row.dailyBatchId ? [row.dailyBatchId] : [])
  )].slice(0, 30);
  if (batchIds.length === 0) return Response.json([]);

  const rows = await prisma.careReport.findMany({
    where: {
      schoolId,
      teacherId: context.teacherId,
      dailyBatchId: { in: batchIds },
      deletedAt: null,
      student: studentClassWhere(context),
    },
    include: {
      student: {
        select: {
          id: true,
          name: true,
          avatarUrl: true,
          class: { select: { name: true } },
        },
      },
    },
    orderBy: [{ reviewedAt: "desc" }, { studentId: "asc" }, { dailyItemKey: "asc" }],
  });

  const grouped = new Map<string, ReturnedRow[]>();
  for (const row of rows) {
    if (!row.dailyBatchId) continue;
    grouped.set(row.dailyBatchId, [...(grouped.get(row.dailyBatchId) ?? []), row]);
  }

  return Response.json(
    [...grouped.entries()]
      .filter(([, batchRows]) => (
        batchRows.some((row) => row.reviewStatus === "REJECTED") &&
        batchRows.every((row) => row.reviewStatus !== "APPROVED")
      ))
      .map(([batchId, batchRows]) => serializeBatch(batchId, batchRows))
      .filter(Boolean)
  );
}
