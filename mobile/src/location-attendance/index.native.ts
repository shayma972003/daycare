import * as Location from "expo-location";

import {
  loadLocationAttendanceSettings,
  submitLocationAttendance,
  type LocationAttendanceSettings,
} from "@/api/location-attendance";
import { notifyLocalAttendanceRecorded } from "@/notifications/device";
import { LOCATION_ATTENDANCE_TASK } from "@/location-attendance/constants";

export type LocationAttendanceSetupStatus =
  | "active"
  | "disabled"
  | "permission-required"
  | "unavailable";

export type LocationAttendanceSetupResult = {
  status: LocationAttendanceSetupStatus;
};

function regions(settings: LocationAttendanceSettings): Location.LocationRegion[] {
  if (settings.latitude === null || settings.longitude === null) return [];
  return [
    {
      identifier: `${settings.schoolId}:checkin`,
      latitude: settings.latitude,
      longitude: settings.longitude,
      radius: settings.checkinRadiusMeters,
      notifyOnEnter: true,
      notifyOnExit: false,
    },
    {
      identifier: `${settings.schoolId}:checkout`,
      latitude: settings.latitude,
      longitude: settings.longitude,
      radius: settings.checkoutRadiusMeters,
      notifyOnEnter: false,
      notifyOnExit: true,
    },
  ];
}

async function stopIfRunning() {
  if (await Location.hasStartedGeofencingAsync(LOCATION_ATTENDANCE_TASK)) {
    await Location.stopGeofencingAsync(LOCATION_ATTENDANCE_TASK);
  }
}

async function currentFix(maxAccuracyMeters: number) {
  return await Location.getLastKnownPositionAsync({
    maxAge: 120_000,
    requiredAccuracy: maxAccuracyMeters,
  }) ?? Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
}

async function reconcile(settings: LocationAttendanceSettings) {
  const fix = await currentFix(settings.maxAccuracyMeters);
  const accuracyMeters = fix.coords.accuracy ?? 10_000;
  const nowBucket = Math.floor(Date.now() / 60_000);
  if (!settings.attendanceOpen) {
    const result = await submitLocationAttendance({
      eventId: `${settings.schoolId}:reconcile:checkin:${nowBucket}`,
      action: "checkin",
      latitude: fix.coords.latitude,
      longitude: fix.coords.longitude,
      accuracyMeters,
    }).catch(() => null);
    if (result?.recorded) await notifyLocalAttendanceRecorded("checkin");
    return;
  }
  const result = await submitLocationAttendance({
    eventId: `${settings.schoolId}:reconcile:checkout:${nowBucket}`,
    action: "checkout",
    latitude: fix.coords.latitude,
    longitude: fix.coords.longitude,
    accuracyMeters,
  }).catch(() => null);
  if (result?.recorded) await notifyLocalAttendanceRecorded("checkout");
}

export async function syncLocationAttendance(options: { requestPermissions?: boolean } = {}): Promise<LocationAttendanceSetupResult> {
  if (!(await Location.isBackgroundLocationAvailableAsync())) return { status: "unavailable" };

  const settings = await loadLocationAttendanceSettings();
  if (!settings.enabled || regions(settings).length === 0) {
    await stopIfRunning();
    return { status: "disabled" };
  }

  let foreground = await Location.getForegroundPermissionsAsync();
  if (foreground.status !== "granted" && options.requestPermissions) {
    foreground = await Location.requestForegroundPermissionsAsync();
  }
  if (foreground.status !== "granted") return { status: "permission-required" };

  let background = await Location.getBackgroundPermissionsAsync();
  if (background.status !== "granted" && options.requestPermissions) {
    background = await Location.requestBackgroundPermissionsAsync();
  }
  if (background.status !== "granted") return { status: "permission-required" };

  await Location.startGeofencingAsync(LOCATION_ATTENDANCE_TASK, regions(settings));
  await reconcile(settings).catch(() => undefined);
  return { status: "active" };
}

export async function stopLocationAttendance() {
  await stopIfRunning();
}
