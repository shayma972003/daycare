import { z } from "zod";

import {
  AttendanceOperationError,
  checkInTeacher,
  checkoutTeacher,
} from "@/lib/attendance-operations";
import { logAction } from "@/lib/activity-logger";
import { withNoStore } from "@/lib/auth-response";
import { calendarToday, requestTimeZone } from "@/lib/device-date";
import { mobileAuthResponse, requireMobileAuth } from "@/lib/mobile-guard";
import { prisma } from "@/lib/prisma";
import { roundedDistanceMeters } from "@/lib/teacher-location-attendance";

const eventSchema = z.object({
  eventId: z.string().min(8).max(160),
  action: z.enum(["checkin", "checkout"]),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyMeters: z.number().min(0).max(10_000),
}).strict();

function authFailure(error: unknown) {
  return mobileAuthResponse(error) ?? Response.json({ error: "Unauthorized" }, { status: 401 });
}

async function staffContext(request: Request) {
  const context = await requireMobileAuth(request, { kind: "staff" });
  if (!context.teacherId) return null;
  return { ...context, teacherId: context.teacherId };
}

const schoolLocationSelect = {
  locationAttendanceEnabled: true,
  locationLatitude: true,
  locationLongitude: true,
  locationCheckinRadiusMeters: true,
  locationCheckoutRadiusMeters: true,
  locationMaxAccuracyMeters: true,
} as const;

export async function GET(request: Request) {
  let context;
  try {
    context = await staffContext(request);
  } catch (error) {
    return authFailure(error);
  }
  if (!context) {
    return Response.json({ error: "حساب التطبيق غير مرتبط بملف موظف", code: "EMPLOYEE_NOT_LINKED" }, { status: 409 });
  }

  const [school, openAttendance] = await Promise.all([
    prisma.school.findUnique({ where: { id: context.schoolId }, select: schoolLocationSelect }),
    prisma.teacherAttendance.findFirst({
      where: {
        schoolId: context.schoolId,
        teacherId: context.teacherId,
        checkinAt: { not: null },
        checkoutAt: null,
      },
      orderBy: { checkinAt: "desc" },
      select: { id: true, checkinAt: true },
    }),
  ]);
  if (!school) return Response.json({ error: "School not found" }, { status: 404 });

  return withNoStore(Response.json({
    enabled: school.locationAttendanceEnabled && school.locationLatitude !== null && school.locationLongitude !== null,
    schoolId: context.schoolId,
    latitude: school.locationLatitude,
    longitude: school.locationLongitude,
    checkinRadiusMeters: school.locationCheckinRadiusMeters,
    checkoutRadiusMeters: school.locationCheckoutRadiusMeters,
    maxAccuracyMeters: school.locationMaxAccuracyMeters,
    attendanceOpen: Boolean(openAttendance),
    checkedInAt: openAttendance?.checkinAt?.toISOString() ?? null,
  }));
}

export async function POST(request: Request) {
  let context;
  try {
    context = await staffContext(request);
  } catch (error) {
    return authFailure(error);
  }
  if (!context) {
    return Response.json({ error: "حساب التطبيق غير مرتبط بملف موظف", code: "EMPLOYEE_NOT_LINKED" }, { status: 409 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = eventSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "بيانات الموقع غير صحيحة", code: "INVALID_LOCATION" }, { status: 422 });

  const previous = await prisma.teacherAttendance.findFirst({
    where: {
      schoolId: context.schoolId,
      teacherId: context.teacherId,
      OR: [
        { checkinEventId: parsed.data.eventId },
        { checkoutEventId: parsed.data.eventId },
      ],
    },
    select: { id: true, checkinAt: true, checkoutAt: true },
  });
  if (previous) {
    return withNoStore(Response.json({
      recorded: false,
      duplicate: true,
      action: parsed.data.action,
      checkedInAt: previous.checkinAt?.toISOString() ?? null,
      checkedOutAt: previous.checkoutAt?.toISOString() ?? null,
    }));
  }

  const school = await prisma.school.findUnique({
    where: { id: context.schoolId },
    select: schoolLocationSelect,
  });
  if (!school?.locationAttendanceEnabled || school.locationLatitude === null || school.locationLongitude === null) {
    return Response.json({ error: "الحضور التلقائي بالموقع غير مفعّل", code: "LOCATION_ATTENDANCE_DISABLED" }, { status: 409 });
  }
  if (parsed.data.accuracyMeters > school.locationMaxAccuracyMeters) {
    return Response.json({ error: "دقة الموقع غير كافية، سيحاول التطبيق مجددًا", code: "LOCATION_ACCURACY_LOW" }, { status: 422 });
  }

  const distanceMeters = roundedDistanceMeters(
    { latitude: school.locationLatitude, longitude: school.locationLongitude },
    { latitude: parsed.data.latitude, longitude: parsed.data.longitude }
  );
  if (parsed.data.action === "checkin" && distanceMeters > school.locationCheckinRadiusMeters) {
    return Response.json({ error: "أنت خارج نطاق تسجيل الدخول", code: "OUTSIDE_CHECKIN_RANGE", distanceMeters }, { status: 422 });
  }
  if (parsed.data.action === "checkout" && distanceMeters < school.locationCheckoutRadiusMeters) {
    return Response.json({ error: "ما زلت داخل نطاق المنشأة", code: "INSIDE_CHECKOUT_RANGE", distanceMeters }, { status: 422 });
  }

  let timeZone: string;
  try {
    timeZone = requestTimeZone(request);
  } catch {
    return Response.json({ error: "Invalid time zone" }, { status: 422 });
  }
  const now = new Date();
  const location = {
    eventId: parsed.data.eventId,
    distanceMeters,
    accuracyMeters: Math.round(parsed.data.accuracyMeters),
  };

  try {
    if (parsed.data.action === "checkin") {
      const attendance = await checkInTeacher({
        teacherId: context.teacherId,
        schoolId: context.schoolId,
        date: calendarToday(now, timeZone),
        now,
        timeZone,
        location,
      });
      await logAction({
        school_id: context.schoolId,
        action: `تسجيل دخول الموظف تلقائيًا بالموقع: ${attendance.personName}`,
        entity_type: "teacher_attendance",
        entity_id: attendance.id,
        entity_name: attendance.personName,
        performed_by: `mobile:${context.claims.sub}`,
        request,
      });
      return withNoStore(Response.json({
        recorded: true,
        duplicate: false,
        action: "checkin",
        checkedInAt: attendance.checkinAt?.toISOString() ?? now.toISOString(),
        checkedOutAt: null,
        distanceMeters,
      }));
    }

    const attendance = await checkoutTeacher({
      teacherId: context.teacherId,
      schoolId: context.schoolId,
      now,
      timeZone,
      location,
    });
    await logAction({
      school_id: context.schoolId,
      action: `تسجيل خروج الموظف تلقائيًا بالموقع: ${attendance.personName}`,
      entity_type: "teacher_attendance",
      entity_id: attendance.attendanceId,
      entity_name: attendance.personName,
      performed_by: `mobile:${context.claims.sub}`,
      request,
    });
    return withNoStore(Response.json({
      recorded: true,
      duplicate: false,
      action: "checkout",
      checkedOutAt: attendance.checkoutAt.toISOString(),
      distanceMeters,
    }));
  } catch (error) {
    if (error instanceof AttendanceOperationError) {
      if (["ALREADY_CHECKED_IN", "ALREADY_CHECKED_OUT", "NO_ACTIVE_ATTENDANCE"].includes(error.code)) {
        return withNoStore(Response.json({
          recorded: false,
          duplicate: true,
          action: parsed.data.action,
          code: error.code,
        }));
      }
      return Response.json({ error: "تعذر تسجيل الحضور تلقائيًا", code: error.code }, { status: error.status });
    }
    throw error;
  }
}
