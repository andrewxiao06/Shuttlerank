/*
 * Push-notification helpers for the mobile app.
 *
 * - Sets how notifications appear while the app is foregrounded.
 * - Requests permission + fetches this device's Expo push token.
 * - Persists the user's on/off preference (Settings toggle) in secure-store.
 *
 * The token is sent to the backend (POST /v1/push-tokens) by PushSync; the
 * backend uses it to notify this phone when a match needs approval.
 */

import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

// How a notification is shown when the app is open (foreground).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const PREF_KEY = "push_enabled";

/** Whether the user wants push. Default ON (unset = on) — they opt out. */
export async function getPushPref(): Promise<boolean> {
  const v = await SecureStore.getItemAsync(PREF_KEY);
  return v !== "false";
}

export async function setPushPref(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(PREF_KEY, enabled ? "true" : "false");
}

/**
 * Ask for permission (if needed) and return this device's Expo push token,
 * or null when unavailable (simulator, denied, or error). Never throws.
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  // Push tokens are only issued on real devices, not simulators.
  if (!Device.isDevice) return null;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Default",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  let { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== "granted") return null;

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;

  try {
    const { data } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    return data;
  } catch {
    return null;
  }
}
