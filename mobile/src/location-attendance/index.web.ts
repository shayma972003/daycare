export type LocationAttendanceSetupStatus = "active" | "disabled" | "permission-required" | "unavailable";
export type LocationAttendanceSetupResult = {
  status: LocationAttendanceSetupStatus;
  attendanceOpen?: boolean;
  checkedInAt?: string | null;
};

export async function syncLocationAttendance(_options: { requestPermissions?: boolean } = {}): Promise<LocationAttendanceSetupResult> {
  return { status: "unavailable" };
}

export async function stopLocationAttendance() {}
