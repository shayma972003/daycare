export type LocationAttendanceSetupStatus = "active" | "disabled" | "permission-required" | "services-disabled" | "unavailable";
export type LocationAttendanceSetupResult = {
  status: LocationAttendanceSetupStatus;
  attendanceOpen?: boolean;
  checkedInAt?: string | null;
  foregroundPermissionGranted?: boolean;
  backgroundPermissionGranted?: boolean;
  locationServicesEnabled?: boolean;
  canAskPermissionAgain?: boolean;
};

export async function syncLocationAttendance(_options: { requestPermissions?: boolean; requestServices?: boolean } = {}): Promise<LocationAttendanceSetupResult> {
  return { status: "unavailable" };
}

export async function stopLocationAttendance() {}
