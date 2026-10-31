import { z } from "zod";

import { logAction } from "@/lib/activity-logger";
import { withNoStore } from "@/lib/auth-response";
import { prisma } from "@/lib/prisma";
import { requireSession, sessionErrorResponse } from "@/lib/session";

const settingsSchema = z.object({
  enabled: z.boolean(),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  checkinRadiusMeters: z.number().int().min(30).max(1_000),
  checkoutRadiusMeters: z.number().int().min(50).max(2_000),
  maxAccuracyMeters: z.number().int().min(20).max(500),
}).strict().superRefine((value, context) => {
  if (value.enabled && (value.latitude === null || value.longitude === null)) {
    context.addIssue({ code: "custom", path: ["latitude"], message: "LOCATION_REQUIRED" });
  }
  if (value.checkoutRadiusMeters <= value.checkinRadiusMeters) {
    context.addIssue({ code: "custom", path: ["checkoutRadiusMeters"], message: "EXIT_RADIUS_MUST_BE_LARGER" });
  }
});

function sessionFailure(error: unknown) {
  return sessionErrorResponse(error) ?? Response.json({ error: "Unauthorized" }, { status: 401 });
}

async function managerSession() {
  const session = await requireSession();
  if (!session.can("settings.manage")) return null;
  return session;
}

export async function GET() {
  let session;
  try {
    session = await managerSession();
  } catch (error) {
    return sessionFailure(error);
  }
  if (!session) return Response.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403 });

  const school = await prisma.school.findUnique({
    where: { id: session.user.schoolId },
    select: {
      locationAttendanceEnabled: true,
      locationLatitude: true,
      locationLongitude: true,
      locationCheckinRadiusMeters: true,
      locationCheckoutRadiusMeters: true,
      locationMaxAccuracyMeters: true,
    },
  });
  if (!school) return Response.json({ error: "School not found" }, { status: 404 });

  return withNoStore(Response.json({
    enabled: school.locationAttendanceEnabled,
    latitude: school.locationLatitude,
    longitude: school.locationLongitude,
    checkinRadiusMeters: school.locationCheckinRadiusMeters,
    checkoutRadiusMeters: school.locationCheckoutRadiusMeters,
    maxAccuracyMeters: school.locationMaxAccuracyMeters,
  }));
}

export async function PUT(request: Request) {
  let session;
  try {
    session = await managerSession();
  } catch (error) {
    return sessionFailure(error);
  }
  if (!session) return Response.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten(), code: "INVALID_LOCATION_SETTINGS" }, { status: 422 });
  }

  const saved = await prisma.school.update({
    where: { id: session.user.schoolId },
    data: {
      locationAttendanceEnabled: parsed.data.enabled,
      locationLatitude: parsed.data.latitude,
      locationLongitude: parsed.data.longitude,
      locationCheckinRadiusMeters: parsed.data.checkinRadiusMeters,
      locationCheckoutRadiusMeters: parsed.data.checkoutRadiusMeters,
      locationMaxAccuracyMeters: parsed.data.maxAccuracyMeters,
    },
    select: {
      locationAttendanceEnabled: true,
      locationLatitude: true,
      locationLongitude: true,
      locationCheckinRadiusMeters: true,
      locationCheckoutRadiusMeters: true,
      locationMaxAccuracyMeters: true,
    },
  });

  await logAction({
    school_id: session.user.schoolId,
    action: saved.locationAttendanceEnabled
      ? "تم تفعيل الحضور التلقائي بالموقع وتحديث نطاق المنشأة"
      : "تم إيقاف الحضور التلقائي بالموقع",
    entity_type: "settings",
    performed_by: session.user.name ?? "المدير",
    request,
  });

  return withNoStore(Response.json({
    enabled: saved.locationAttendanceEnabled,
    latitude: saved.locationLatitude,
    longitude: saved.locationLongitude,
    checkinRadiusMeters: saved.locationCheckinRadiusMeters,
    checkoutRadiusMeters: saved.locationCheckoutRadiusMeters,
    maxAccuracyMeters: saved.locationMaxAccuracyMeters,
  }));
}
