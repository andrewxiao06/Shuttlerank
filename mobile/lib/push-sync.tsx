/*
 * PushSync — side-effect component (renders nothing), mounted under
 * ClerkProvider next to AuthSync.
 *
 *  1. Once the user is signed in (and hasn't opted out), registers this
 *     device's Expo push token with the backend.
 *  2. Routes a tapped notification to the relevant match — both when the app
 *     is already running and when it was cold-started from the notification.
 */

import { useAuth } from "@clerk/clerk-expo";
import { useRouter } from "expo-router";
import * as Notifications from "expo-notifications";
import { useEffect, useRef } from "react";
import { Platform } from "react-native";

import { registerPushToken } from "./api/client";
import { getPushPref, registerForPushNotificationsAsync } from "./push";

export function PushSync() {
  const { isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  const registeredFor = useRef(false);

  // 1) Register the device token on first authenticated load.
  useEffect(() => {
    if (!isLoaded || !isSignedIn || registeredFor.current) return;
    (async () => {
      if (!(await getPushPref())) return; // user turned push off
      const token = await registerForPushNotificationsAsync();
      if (!token) return;
      try {
        await registerPushToken(token, Platform.OS);
        registeredFor.current = true;
      } catch {
        /* best-effort — will retry next launch */
      }
    })();
  }, [isLoaded, isSignedIn]);

  // Reset the guard on sign-out so the next user re-registers.
  useEffect(() => {
    if (isLoaded && !isSignedIn) registeredFor.current = false;
  }, [isLoaded, isSignedIn]);

  // 2) Deep-link on notification tap.
  useEffect(() => {
    const openMatch = (data: unknown) => {
      const id = (data as { matchId?: number | string } | null)?.matchId;
      if (id != null) router.push(`/match/${id}`);
    };

    // Cold start: app launched by tapping a notification.
    Notifications.getLastNotificationResponseAsync().then((resp) => {
      if (resp) openMatch(resp.notification.request.content.data);
    });

    // Warm: app already running/backgrounded when tapped.
    const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
      openMatch(resp.notification.request.content.data);
    });
    return () => sub.remove();
  }, [router]);

  return null;
}
