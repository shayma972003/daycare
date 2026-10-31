import { prisma } from "@/lib/prisma";
import { logSafeError } from "@/lib/safe-logger";

export const SYSTEM_JOB_KEYS = [
  "purge_trash",
  "anonymize",
  "push_queue",
  "subscription_alerts",
  "care_digest",
] as const;

export type SystemJobKey = (typeof SYSTEM_JOB_KEYS)[number];

async function updateRun(
  id: string | null,
  data: {
    status: "SUCCEEDED" | "FAILED";
    finishedAt: Date;
    durationMs: number;
    errorCode?: string;
  }
) {
  if (!id) return;
  try {
    await prisma.systemJobRun.update({ where: { id }, data });
  } catch (error) {
    // Tracking must never stop the maintenance work it is observing. This also
    // lets a deployment containing the code run safely during a rolling
    // migration, before every instance sees the new table.
    logSafeError("system-job-run-finish", error);
  }
}

/** Runs one scheduled job and records a PII-free operational heartbeat. */
export async function withSystemJobRun<T>(
  jobKey: SystemJobKey,
  run: () => Promise<T>
): Promise<T> {
  const startedAt = new Date();
  let id: string | null = null;

  try {
    const row = await prisma.systemJobRun.create({
      data: { jobKey, status: "RUNNING", startedAt },
      select: { id: true },
    });
    id = row.id;
  } catch (error) {
    logSafeError("system-job-run-start", error);
  }

  try {
    const result = await run();
    const finishedAt = new Date();
    await updateRun(id, {
      status: "SUCCEEDED",
      finishedAt,
      durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
    });
    return result;
  } catch (error) {
    const finishedAt = new Date();
    await updateRun(id, {
      status: "FAILED",
      finishedAt,
      durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
      // Deliberately generic: provider messages can contain identifiers.
      errorCode: "JOB_FAILED",
    });
    throw error;
  }
}
