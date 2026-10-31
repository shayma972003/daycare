import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";

import { submitLocationAttendance } from "@/api/location-attendance";
import { notifyLocalAttendanceRecorded } from "@/notifications/device";
import { LOCATION_ATTENDANCE_TASK } from "@/location-attendance/constants";

type GeofenceTaskData = {
  eventType: Location.GeofencingEventType;
  region: Location.LocationRegion;
};

TaskManager.defineTask<GeofenceTaskData>(LOCATION_ATTENDANCE_TASK, async ({ data, error }) => {
  if (error || !data?.region.identifier) return;

  const checkin = data.region.identifier.endsWith(":checkin") && data.eventType === Location.GeofencingEventType.Enter;
  const checkout = data.region.identifier.endsWith(":checkout") && data.eventType === Location.GeofencingEventType.Exit;
  if (!checkin && !checkout) return;

  const fix = await Location.getLastKnownPositionAsync({ maxAge: 120_000, requiredAccuracy: 500 })
    ?? await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  const action = checkin ? "checkin" : "checkout";
  const eventId = `${data.region.identifier}:${action}:${Math.floor(Date.now() / 60_000)}`;
  const result = await submitLocationAttendance({
    eventId,
    action,
    latitude: fix.coords.latitude,
    longitude: fix.coords.longitude,
    accuracyMeters: fix.coords.accuracy ?? 10_000,
  });

  if (result.recorded) await notifyLocalAttendanceRecorded(action);
});
