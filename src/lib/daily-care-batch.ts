import { createHash } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";

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
    name: z.string().trim().max(150).nullish(),
    dose: z.string().trim().max(150).nullish(),
    occurredAt: z.iso.datetime().nullish(),
  }).nullish(),
});

export const dailyReportSchema = z.object({
  idempotencyKey: z.string().min(16).max(120),
  meal: z.object({
    source: z.enum(["CENTER", "HOME"]),
    name: z.string().trim().max(120).nullish(),
    occurredAt: z.iso.datetime(),
  }),
  entries: z.array(entrySchema).min(1).max(60),
}).superRefine((value, context) => {
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
      if (start && end && end <= start) {
        context.addIssue({
          code: "custom",
          path: ["entries", index, "napEndAt"],
          message: "نهاية النوم يجب أن تكون بعد بدايته",
        });
      }
    }
  });
});

export type DailyCarePayload = z.infer<typeof dailyReportSchema>;

export function dailyCareRequestHash(payload: DailyCarePayload): string {
  const canonical = {
    meal: payload.meal,
    entries: [...payload.entries].sort((a, b) => a.studentId.localeCompare(b.studentId)),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export interface DailyCareBatchStudent {
  id: string;
  classId: string | null;
}

export interface DailyCareBatchAuthor {
  teacherId: string | null;
  name: string;
}

export function buildDailyCareRows(
  payload: DailyCarePayload,
  schoolId: string,
  students: DailyCareBatchStudent[],
  author: DailyCareBatchAuthor,
  submittedAt = new Date()
): Prisma.CareReportCreateManyInput[] {
  const hash = dailyCareRequestHash(payload);
  const mealOccurredAt = new Date(payload.meal.occurredAt);
  const studentById = new Map(students.map((student) => [student.id, student]));
  const reports: Prisma.CareReportCreateManyInput[] = [];

  for (const entry of payload.entries) {
    const student = studentById.get(entry.studentId);
    if (!student) throw new Error("INVALID_STUDENT_SET");
    const common = {
      schoolId,
      studentId: entry.studentId,
      classId: student.classId,
      teacherId: author.teacherId,
      reportedByName: author.name,
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
      const napStartAt = entry.napStartAt ? new Date(entry.napStartAt) : null;
      const napEndAt = entry.napEndAt ? new Date(entry.napEndAt) : null;
      const napMinutes = napStartAt && napEndAt
        ? Math.round((napEndAt.getTime() - napStartAt.getTime()) / 60_000)
        : null;
      reports.push({
        ...common,
        dailyItemKey: "nap",
        type: "NAP",
        occurredAt: napStartAt ?? submittedAt,
        napStartAt,
        napEndAt,
        napMinutes,
        napQuality: "SLEPT",
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
        occurredAt: entry.medication.occurredAt
          ? new Date(entry.medication.occurredAt)
          : submittedAt,
        medicationName: entry.medication.name || null,
        medicationDose: entry.medication.dose || null,
        givenByName: author.name,
      });
    }
  }

  return reports;
}

export const clearedDailyCareFields: Prisma.CareReportUpdateManyMutationInput = {
  mealSource: null,
  mealName: null,
  mealAmount: null,
  napStartAt: null,
  napEndAt: null,
  napMinutes: null,
  napQuality: null,
  toiletKind: null,
  toiletState: null,
  mood: null,
  medicationName: null,
  medicationDose: null,
  givenByName: null,
  temperature: null,
  symptom: null,
  actionTaken: null,
  supplyItem: null,
  supplyQuantity: null,
  supplyUrgency: null,
  note: null,
  photoUrl: null,
};
