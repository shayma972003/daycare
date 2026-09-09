import { createHash } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { requireSession, sessionErrorResponse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { notifyGuardiansOfReport } from "@/lib/care-report-notify";
import { logAction } from "@/lib/activity-logger";
import { logSafeError } from "@/lib/safe-logger";

const mealAmountSchema = z.enum(["ALL", "HALF", "LITTLE", "REFUSED"]);
const extraEventSchema = z.object({
  kind: z.enum(["MEAL", "NAP", "TOILET"]),
  occurredAt: z.iso.datetime(),
  details: z.string().trim().min(1).max(200),
});

const entrySchema = z.object({
  studentId: z.string().min(1),
  mealAmount: mealAmountSchema.nullish(),
  napStatus: z.enum(["NO_RECORD", "SLEPT", "DID_NOT_SLEEP"]).default("NO_RECORD"),
  napStartAt: z.iso.datetime().nullish(),
  napEndAt: z.iso.datetime().nullish(),
  toilet: z.enum(["NO_RECORD", "DIAPER_WET", "DIAPER_SOILED", "POTTY"]).default("NO_RECORD"),
  toiletOccurredAt: z.iso.datetime().nullish(),
  mood: z.enum(["HAPPY", "CALM", "TIRED", "UPSET", "CRYING", "UNWELL"]).nullish(),
  note: z.string().trim().max(600).nullish(),
  extraEvents: z.array(extraEventSchema).max(12).default([]),
  supplies: z.string().trim().max(150).nullish(),
  health: z.string().trim().max(600).nullish(),
  medication: z.object({
    name: z.string().trim().min(1).max(150),
    dose: z.string().trim().min(1).max(150),
    occurredAt: z.iso.datetime(),
  }).nullish(),
});

const dailyReportSchema = z.object({
  idempotencyKey: z.string().min(16).max(120),
  meal: z.object({
    source: z.enum(["CENTER", "HOME"]),
    name: z.string().trim().max(120).nullish(),
    occurredAt: z.iso.datetime(),
  }),
  entries: z.array(entrySchema).min(1).max(60),
}).superRefine((value, context) => {
  if (value.meal.source === "CENTER" && !value.meal.name) {
    context.addIssue({
      code: "custom",
      path: ["meal", "name"],
      message: "اسم وجبة المركز مطلوب",
    });
  }

  const seen = new Set<string>();
  value.entries.forEach((entry, index) => {
    if (seen.has(entry.studentId)) {
      context.addIssue({
        code: "custom",
        path: ["entries", index, "studentId"],
        message: "الطفل مكرر في التقرير",
      });
    }
    seen.add(entry.studentId);

    if (entry.napStatus === "SLEPT") {
      const start = entry.napStartAt ? new Date(entry.napStartAt) : null;
      const end = entry.napEndAt ? new Date(entry.napEndAt) : null;
      if (!start || !end || end <= start) {
        context.addIssue({
          code: "custom",
          path: ["entries", index, "napEndAt"],
          message: "حددي بداية ونهاية نوم صحيحتين",
        });
      }
    }
  });
});

type DailyPayload = z.infer<typeof dailyReportSchema>;

function requestHash(payload: DailyPayload): string {
  const canonical = {
    meal: payload.meal,
    entries: [...payload.entries].sort((a, b) => a.studentId.localeCompare(b.studentId)),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function replayBatch(schoolId: string, batchId: string, hash: string) {
  const rows = await prisma.careReport.findMany({
    where: { schoolId, dailyBatchId: batchId },
    select: { id: true, studentId: true, dailyBatchHash: true },
  });
  if (rows.length === 0) return null;
  if (rows.some((row) => row.dailyBatchHash !== hash)) {
    return Response.json(
      { error: "استُخدم معرّف الإرسال لمحتوى مختلف", code: "IDEMPOTENCY_CONFLICT" },
      { status: 409 }
    );
  }
  return Response.json({ created: rows.length, replayed: true, reports: rows });
}

export async function POST(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    return sessionErrorResponse(error) ?? Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = dailyReportSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const schoolId = session.user.schoolId;
  const payload = parsed.data;
  const hash = requestHash(payload);
  const replay = await replayBatch(schoolId, payload.idempotencyKey, hash);
  if (replay) return replay;

  const mealOccurredAt = new Date(payload.meal.occurredAt);
  const submittedAt = new Date();
  let created: { id: string; studentId: string }[];

  try {
    created = await prisma.$transaction(async (tx) => {
      const studentIds = payload.entries.map((entry) => entry.studentId);
      const students = await tx.student.findMany({
        where: {
          id: { in: studentIds },
          schoolId,
          deletedAt: null,
          anonymizedAt: null,
          isActive: true,
        },
        select: { id: true, classId: true },
      });
      if (students.length !== studentIds.length) throw new Error("INVALID_STUDENT_SET");

      const studentById = new Map(students.map((student) => [student.id, student]));
      const reports: Prisma.CareReportCreateManyInput[] = [];

      for (const entry of payload.entries) {
        const student = studentById.get(entry.studentId)!;
        const common = {
          schoolId,
          studentId: entry.studentId,
          classId: student.classId,
          teacherId: session.teacherId,
          reportedByName: session.user.name ?? "الطاقم",
          dailyBatchId: payload.idempotencyKey,
          dailyBatchHash: hash,
        };

        if (payload.meal.source === "CENTER" || entry.mealAmount) {
          reports.push({
            ...common,
            dailyItemKey: "meal",
            type: "MEAL",
            occurredAt: mealOccurredAt,
            mealSource: payload.meal.source,
            mealName: payload.meal.source === "CENTER" ? payload.meal.name : null,
            mealAmount: entry.mealAmount ?? null,
          });
        }

        if (entry.napStatus === "SLEPT") {
          const napStartAt = new Date(entry.napStartAt!);
          const napEndAt = new Date(entry.napEndAt!);
          reports.push({
            ...common,
            dailyItemKey: "nap",
            type: "NAP",
            occurredAt: napStartAt,
            napStartAt,
            napEndAt,
            napMinutes: Math.round((napEndAt.getTime() - napStartAt.getTime()) / 60_000),
          });
        } else if (entry.napStatus === "DID_NOT_SLEEP") {
          reports.push({
            ...common,
            dailyItemKey: "nap",
            type: "NAP",
            occurredAt: submittedAt,
            napQuality: "DID_NOT_SLEEP",
          });
        }

        if (entry.toilet !== "NO_RECORD") {
          reports.push({
            ...common,
            dailyItemKey: "toilet",
            type: "TOILET",
            occurredAt: entry.toiletOccurredAt ? new Date(entry.toiletOccurredAt) : submittedAt,
            toiletKind: entry.toilet === "POTTY" ? "POTTY" : "DIAPER",
            toiletState: entry.toilet === "DIAPER_WET"
              ? "WET"
              : entry.toilet === "DIAPER_SOILED"
                ? "SOILED"
                : null,
          });
        }

        if (entry.mood) {
          reports.push({ ...common, dailyItemKey: "mood", type: "MOOD", occurredAt: submittedAt, mood: entry.mood });
        }

        if (entry.note) {
          reports.push({ ...common, dailyItemKey: "note", type: "GENERAL", occurredAt: submittedAt, note: entry.note });
        }

        entry.extraEvents.forEach((event, index) => {
          reports.push({
            ...common,
            dailyItemKey: `event-${index}`,
            type: event.kind,
            occurredAt: new Date(event.occurredAt),
            note: event.details,
          });
        });

        if (entry.supplies) {
          reports.push({
            ...common,
            dailyItemKey: "supplies",
            type: "SUPPLIES",
            occurredAt: submittedAt,
            supplyItem: entry.supplies,
          });
        }

        if (entry.health) {
          reports.push({
            ...common,
            dailyItemKey: "health",
            type: "HEALTH",
            occurredAt: submittedAt,
            symptom: entry.health,
          });
        }

        if (entry.medication) {
          reports.push({
            ...common,
            dailyItemKey: "medication",
            type: "MEDICATION",
            occurredAt: new Date(entry.medication.occurredAt),
            medicationName: entry.medication.name,
            medicationDose: entry.medication.dose,
            givenByName: session.user.name ?? "الطاقم",
          });
        }
      }

      if (reports.length === 0) throw new Error("EMPTY_DAILY_REPORT");

      const saved: { id: string; studentId: string }[] = [];
      for (const report of reports) {
        const row = await tx.careReport.create({ data: report, select: { id: true, studentId: true } });
        saved.push(row);
      }
      return saved;
    });
  } catch (error) {
    if (isUniqueConflict(error)) {
      const concurrentReplay = await replayBatch(schoolId, payload.idempotencyKey, hash);
      if (concurrentReplay) return concurrentReplay;
    }
    if (error instanceof Error && error.message === "INVALID_STUDENT_SET") {
      return Response.json({ error: "تتضمن القائمة طفلاً غير متاح", code: "INVALID_STUDENT_SET" }, { status: 409 });
    }
    if (error instanceof Error && error.message === "EMPTY_DAILY_REPORT") {
      return Response.json({ error: "أدخلي بياناً واحداً على الأقل", code: "EMPTY_DAILY_REPORT" }, { status: 422 });
    }
    throw error;
  }

  void notifyGuardiansOfReport(schoolId, created.map((report) => report.id))
    .catch((error) => logSafeError("daily-care-reports-notify", error));

  await logAction({
    school_id: schoolId,
    action: `إرسال التقرير اليومي الموحّد لـ${payload.entries.length} طفل`,
    entity_type: "care_report_batch",
    entity_id: payload.idempotencyKey,
    performed_by: session.user.name ?? "الطاقم",
    request,
  });

  return Response.json({ created: created.length, replayed: false, reports: created }, { status: 201 });
}
