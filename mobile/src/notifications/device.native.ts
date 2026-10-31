import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { request } from "@/api/client";

let registeredToken: string | null = null;
const ANDROID_ALERT_CHANNEL_ID = "daycare-alerts-v2";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

function projectId(): string | null {
  return Constants.easConfig?.projectId ??
    (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId ??
    null;
}

export async function registerDeviceForPush(): Promise<void> {
  if (!Device.isDevice) return;
  const id = projectId();
  if (!id) return;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(ANDROID_ALERT_CHANNEL_ID, {
      name: "الإشعارات",
      importance: Notifications.AndroidImportance.MAX,
      sound: "default",
      enableVibrate: true,
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  let permission = await Notifications.getPermissionsAsync();
  if (permission.status !== "granted") permission = await Notifications.requestPermissionsAsync();
  if (permission.status !== "granted") return;

  const token = (await Notifications.getExpoPushTokenAsync({ projectId: id })).data;
  await request("/api/mobile/v1/devices", {
    method: "POST",
    body: { token, platform: "EXPO" },
  });
  registeredToken = token;
}

export async function unregisterDeviceForPush(): Promise<void> {
  if (!registeredToken) return;
  await request("/api/mobile/v1/devices", {
    method: "DELETE",
    body: { token: registeredToken },
  }).catch(() => undefined);
  registeredToken = null;
}

export async function notifyLocalAttendanceRecorded(action: "checkin" | "checkout") {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(ANDROID_ALERT_CHANNEL_ID, {
      name: "الإشعارات",
      importance: Notifications.AndroidImportance.MAX,
      sound: "default",
      enableVibrate: true,
      vibrationPattern: [0, 250, 250, 250],
    });
  }
  const permission = await Notifications.getPermissionsAsync();
  if (permission.status !== "granted") return;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: action === "checkin" ? "تم تسجيل الدخول" : "تم تسجيل الخروج",
      body: action === "checkin"
        ? "تم تسجيل دخولك تلقائيًا عند وصولك إلى المدرسة."
        : "تم تسجيل خروجك تلقائيًا بعد مغادرة نطاق المدرسة.",
      sound: "default",
      data: { kind: "teacher-location-attendance", action },
    },
    trigger: null,
  });
}
