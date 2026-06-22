import { useAuth, useSSO } from "@clerk/clerk-expo";
import { Redirect } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import * as AuthSession from "expo-auth-session";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../../lib/theme";

// Warms up the in-app browser so the OAuth sheet opens instantly, and
// dismisses it on unmount. Recommended by Clerk's Expo guide.
function useWarmUpBrowser() {
  useEffect(() => {
    void WebBrowser.warmUpAsync();
    return () => {
      void WebBrowser.coolDownAsync();
    };
  }, []);
}

// Required on native so the auth session can complete.
WebBrowser.maybeCompleteAuthSession();

/*
 * Sign-in screen. Google OAuth (matches how the web accounts were created).
 * On success, Clerk sets the active session and the (tabs) gate lets the
 * user through; AuthSync then bootstraps their Player row.
 */
export default function SignIn() {
  useWarmUpBrowser();
  const { isLoaded, isSignedIn } = useAuth();
  const { startSSOFlow } = useSSO();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Once authenticated, leave the sign-in screen for the app. Handles both
  // a fresh sign-in and the "already signed in" case.
  if (isLoaded && isSignedIn) return <Redirect href="/" />;

  const onGoogle = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const { createdSessionId, setActive } = await startSSOFlow({
        strategy: "oauth_google",
        redirectUrl: AuthSession.makeRedirectUri(),
      });
      if (createdSessionId && setActive) {
        await setActive({ session: createdSessionId });
        // The (tabs) gate now sees isSignedIn === true and renders the app.
      }
    } catch (e) {
      setError((e as Error)?.message ?? "Sign-in failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }, [startSSOFlow]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          padding: spacing.xl,
          gap: spacing.lg,
        }}
      >
        <Text style={{ fontSize: 40 }}>🏸</Text>
        <Text style={{ fontSize: 30, fontWeight: "800", color: colors.text }}>
          DUBR
        </Text>
        <Text
          style={{
            color: colors.textSecondary,
            textAlign: "center",
            marginBottom: spacing.lg,
          }}
        >
          Badminton, rated. Sign in to track your rating and submit matches.
        </Text>

        <Pressable
          onPress={onGoogle}
          disabled={busy}
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: spacing.sm,
            backgroundColor: colors.primary,
            paddingVertical: spacing.md,
            paddingHorizontal: spacing.xl,
            borderRadius: radius.md,
            width: "100%",
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <>
              <Ionicons name="logo-google" size={20} color={colors.onPrimary} />
              <Text
                style={{
                  color: colors.onPrimary,
                  fontSize: 16,
                  fontWeight: "600",
                }}
              >
                Continue with Google
              </Text>
            </>
          )}
        </Pressable>

        {error ? (
          <Text style={{ color: colors.danger, textAlign: "center" }}>
            {error}
          </Text>
        ) : null}
      </View>
    </SafeAreaView>
  );
}
