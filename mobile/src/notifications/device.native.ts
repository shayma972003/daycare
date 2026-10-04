import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { request } from "@/api/client";

let registeredToken: string | null = null;

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
    await Notifications.setNotificationChannelAsync("default", {
      name: "الإشعارات",
      importance: Notifications.AndroidImportance.HIGH,
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
