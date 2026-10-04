import { request } from "@/api/client";

export type GuardianNotificationPreferences = {
  activity: boolean;
  calendar: boolean;
  absence: boolean;
  attendance: boolean;
  careReport: boolean;
};

export type StaffNotificationPreferences = {
  activity: boolean;
  calendar: boolean;
  arrival: boolean;
};

export type NotificationSettingsResponse =
  | { kind: "guardian"; preferences: GuardianNotificationPreferences }
  | { kind: "staff"; preferences: StaffNotificationPreferences };

export function loadNotificationSettings() {
  return request<NotificationSettingsResponse>("/api/mobile/v1/notification-settings");
}

export function updateNotificationSettings(
  changes: Partial<GuardianNotificationPreferences & StaffNotificationPreferences>
) {
  return request<NotificationSettingsResponse>("/api/mobile/v1/notification-settings", {
    method: "PATCH",
    body: changes,
  });
}
