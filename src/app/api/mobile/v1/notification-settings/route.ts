import { z } from "zod";

import { withNoStore } from "@/lib/auth-response";
import { mobileAuthResponse, requireMobileAuth } from "@/lib/mobile-guard";
import { prisma } from "@/lib/prisma";

const guardianSchema = z.object({
  activity: z.boolean().optional(),
  calendar: z.boolean().optional(),
  absence: z.boolean().optional(),
  attendance: z.boolean().optional(),
  careReport: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0);

const staffSchema = z.object({
  activity: z.boolean().optional(),
  calendar: z.boolean().optional(),
  arrival: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0);

function guardianPreferences(account: {
  notifyActivity: boolean;
  notifyCalendar: boolean;
  notifyAbsence: boolean;
  notifyAttendance: boolean;
  notifyCareReport: boolean;
}) {
  return {
    activity: account.notifyActivity,
    calendar: account.notifyCalendar,
    absence: account.notifyAbsence,
    attendance: account.notifyAttendance,
    careReport: account.notifyCareReport,
  };
}

function staffPreferences(user: {
  notifyActivity: boolean;
  notifyCalendar: boolean;
  notifyArrival: boolean;
}) {
  return {
    activity: user.notifyActivity,
    calendar: user.notifyCalendar,
    arrival: user.notifyArrival,
  };
}

export async function GET(request: Request) {
  let context;
  try {
    context = await requireMobileAuth(request);
  } catch (error) {
    return mobileAuthResponse(error) ?? Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (context.claims.kind === "guardian") {
    const account = await prisma.guardianAccount.findFirst({
      where: { id: context.claims.sub, schoolId: context.schoolId },
      select: {
        notifyActivity: true,
        notifyCalendar: true,
        notifyAbsence: true,
        notifyAttendance: true,
        notifyCareReport: true,
      },
    });
    if (!account) return Response.json({ error: "الحساب لم يعد موجوداً" }, { status: 401 });
    return withNoStore(Response.json({ kind: "guardian", preferences: guardianPreferences(account) }));
  }

  const user = await prisma.user.findFirst({
    where: { id: context.claims.sub, schoolId: context.schoolId },
    select: { notifyActivity: true, notifyCalendar: true, notifyArrival: true },
  });
  if (!user) return Response.json({ error: "الحساب لم يعد موجوداً" }, { status: 401 });
  return withNoStore(Response.json({ kind: "staff", preferences: staffPreferences(user) }));
}

export async function PATCH(request: Request) {
  let context;
  try {
    context = await requireMobileAuth(request);
  } catch (error) {
    return mobileAuthResponse(error) ?? Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (context.claims.kind === "guardian") {
    const parsed = guardianSchema.safeParse(body);
    if (!parsed.success) return Response.json({ error: "بيانات غير صحيحة" }, { status: 422 });
    const result = await prisma.guardianAccount.updateMany({
      where: { id: context.claims.sub, schoolId: context.schoolId },
      data: {
        ...(parsed.data.activity === undefined ? {} : { notifyActivity: parsed.data.activity }),
        ...(parsed.data.calendar === undefined ? {} : { notifyCalendar: parsed.data.calendar }),
        ...(parsed.data.absence === undefined ? {} : { notifyAbsence: parsed.data.absence }),
        ...(parsed.data.attendance === undefined ? {} : { notifyAttendance: parsed.data.attendance }),
        ...(parsed.data.careReport === undefined ? {} : { notifyCareReport: parsed.data.careReport }),
      },
    });
    if (result.count !== 1) return Response.json({ error: "الحساب لم يعد موجوداً" }, { status: 401 });
    const account = await prisma.guardianAccount.findFirstOrThrow({
      where: { id: context.claims.sub, schoolId: context.schoolId },
      select: {
        notifyActivity: true,
        notifyCalendar: true,
        notifyAbsence: true,
        notifyAttendance: true,
        notifyCareReport: true,
      },
    });
    return withNoStore(Response.json({ kind: "guardian", preferences: guardianPreferences(account) }));
  }

  const parsed = staffSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "بيانات غير صحيحة" }, { status: 422 });
  const result = await prisma.user.updateMany({
    where: { id: context.claims.sub, schoolId: context.schoolId },
    data: {
      ...(parsed.data.activity === undefined ? {} : { notifyActivity: parsed.data.activity }),
      ...(parsed.data.calendar === undefined ? {} : { notifyCalendar: parsed.data.calendar }),
      ...(parsed.data.arrival === undefined ? {} : { notifyArrival: parsed.data.arrival }),
    },
  });
  if (result.count !== 1) return Response.json({ error: "الحساب لم يعد موجوداً" }, { status: 401 });
  const user = await prisma.user.findFirstOrThrow({
    where: { id: context.claims.sub, schoolId: context.schoolId },
    select: { notifyActivity: true, notifyCalendar: true, notifyArrival: true },
  });
  return withNoStore(Response.json({ kind: "staff", preferences: staffPreferences(user) }));
}
