import { request } from "@/api/client";

export type LocationAttendanceSettings = {
  enabled: boolean;
  schoolId: string;
  latitude: number | null;
  longitude: number | null;
  checkinRadiusMeters: number;
  checkoutRadiusMeters: number;
  maxAccuracyMeters: number;
  attendanceOpen: boolean;
  checkedInAt: string | null;
};

export type LocationAttendanceAction = "checkin" | "checkout";

export type LocationAttendanceResult = {
  recorded: boolean;
  duplicate: boolean;
  action: LocationAttendanceAction;
  checkedInAt?: string | null;
  checkedOutAt?: string | null;
  distanceMeters?: number;
  code?: string;
};

export function loadLocationAttendanceSettings() {
  return request<LocationAttendanceSettings>("/api/mobile/v1/teacher-attendance/location");
}

export function submitLocationAttendance(input: {
  eventId: string;
  action: LocationAttendanceAction;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
}) {
  return request<LocationAttendanceResult>("/api/mobile/v1/teacher-attendance/location", {
    method: "POST",
    body: input,
  });
}
