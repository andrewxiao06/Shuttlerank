import { useAuth, useSignIn, useSignUp, useSSO } from "@clerk/clerk-expo";
import { Redirect } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import * as AuthSession from "expo-auth-session";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
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

type Mode = "signIn" | "signUp";

/*
 * Sign-in / sign-up screen. Two ways in, mirroring the web:
 *   1. Google OAuth (how the original accounts were made)
 *   2. Email + password — sign in, or sign up with an emailed 6-digit code
 * On success Clerk sets the active session and the (tabs) gate lets the user
 * through; AuthSync then bootstraps their Player row.
 */
export default function SignIn() {
  useWarmUpBrowser();
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const { startSSOFlow } = useSSO();
  const { isLoaded: siLoaded, signIn, setActive: setActiveSignIn } = useSignIn();
  const { isLoaded: suLoaded, signUp, setActive: setActiveSignUp } = useSignUp();

  const [mode, setMode] = useState<Mode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [pendingVerification, setPendingVerification] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clerkError = (e: unknown) =>
    (e as { errors?: { message?: string; longMessage?: string }[] })?.errors?.[0]
      ?.longMessage ??
    (e as { errors?: { message?: string }[] })?.errors?.[0]?.message ??
    (e as Error)?.message ??
    "Something went wrong. Please try again.";

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
      }
    } catch (e) {
      setError(clerkError(e));
    } finally {
      setBusy(false);
    }
  }, [startSSOFlow]);

  const onEmailSignIn = useCallback(async () => {
    if (!siLoaded || !signIn) return;
    setBusy(true);
    setError(null);
    try {
      const attempt = await signIn.create({ identifier: email.trim(), password });
      if (attempt.status === "complete") {
        await setActiveSignIn({ session: attempt.createdSessionId });
      } else {
        setError("Additional verification is required. Try Google sign-in.");
      }
    } catch (e) {
      setError(clerkError(e));
    } finally {
      setBusy(false);
    }
  }, [siLoaded, signIn, email, password, setActiveSignIn]);

  const onEmailSignUp = useCallback(async () => {
    if (!suLoaded || !signUp) return;
    setBusy(true);
    setError(null);
    try {
      await signUp.create({ emailAddress: email.trim(), password });
      await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
      setPendingVerification(true);
    } catch (e) {
      setError(clerkError(e));
    } finally {
      setBusy(false);
    }
  }, [suLoaded, signUp, email, password]);

  const onVerify = useCallback(async () => {
    if (!suLoaded || !signUp) return;
    setBusy(true);
    setError(null);
    try {
      const attempt = await signUp.attemptEmailAddressVerification({ code: code.trim() });
      if (attempt.status === "complete") {
        await setActiveSignUp({ session: attempt.createdSessionId });
      } else {
        setError("That code didn't verify. Check your email and try again.");
      }
    } catch (e) {
      setError(clerkError(e));
    } finally {
      setBusy(false);
    }
  }, [suLoaded, signUp, code, setActiveSignUp]);

  // Once authenticated, leave for the app. MUST come after every hook above.
  if (authLoaded && isSignedIn) return <Redirect href="/" />;

  const canSubmit = email.trim().length > 3 && password.length >= 8 && !busy;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: "center",
            padding: spacing.xl,
            gap: spacing.lg,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <Image
            source={require("../../assets/images/wordmark.png")}
            style={{ width: 220, height: 220 * (183 / 1123), alignSelf: "center" }}
            resizeMode="contain"
            accessibilityLabel="ShuttleRank"
          />

          {pendingVerification ? (
            <>
              <Text style={{ color: colors.textSecondary, textAlign: "center" }}>
                We emailed a 6-digit code to {email.trim()}. Enter it below.
              </Text>
              <TextInput
                value={code}
                onChangeText={setCode}
                placeholder="123456"
                placeholderTextColor={colors.textMuted}
                keyboardType="number-pad"
                autoFocus
                style={inputStyle}
              />
              <PrimaryButton
                label="Verify email"
                busy={busy}
                disabled={code.trim().length < 6 || busy}
                onPress={onVerify}
              />
              <Pressable
                onPress={() => {
                  setPendingVerification(false);
                  setCode("");
                  setError(null);
                }}
                style={{ alignItems: "center", paddingVertical: spacing.sm }}
              >
                <Text style={{ color: colors.textMuted }}>Back</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={{ color: colors.textSecondary, textAlign: "center" }}>
                Badminton, rated. Sign in to track your rating and submit matches.
              </Text>

              {/* Google */}
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
                  opacity: busy ? 0.6 : 1,
                }}
              >
                {busy ? (
                  <ActivityIndicator color={colors.onPrimary} />
                ) : (
                  <>
                    <Ionicons name="logo-google" size={20} color={colors.onPrimary} />
                    <Text style={{ color: colors.onPrimary, fontSize: 16, fontWeight: "600" }}>
                      Continue with Google
                    </Text>
                  </>
                )}
              </Pressable>

              {/* Divider */}
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
                <Text style={{ color: colors.textMuted, fontSize: 12 }}>OR</Text>
                <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
              </View>

              {/* Email + password */}
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="Email"
                placeholderTextColor={colors.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                textContentType="emailAddress"
                style={inputStyle}
              />
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="Password (8+ characters)"
                placeholderTextColor={colors.textMuted}
                secureTextEntry
                autoCapitalize="none"
                textContentType={mode === "signUp" ? "newPassword" : "password"}
                style={inputStyle}
              />

              <PrimaryButton
                label={mode === "signIn" ? "Sign in" : "Create account"}
                busy={busy}
                disabled={!canSubmit}
                onPress={mode === "signIn" ? onEmailSignIn : onEmailSignUp}
              />

              <Pressable
                onPress={() => {
                  setMode((m) => (m === "signIn" ? "signUp" : "signIn"));
                  setError(null);
                }}
                style={{ alignItems: "center", paddingVertical: spacing.sm }}
              >
                <Text style={{ color: colors.primary, fontWeight: "600" }}>
                  {mode === "signIn"
                    ? "New here? Create an account"
                    : "Already have an account? Sign in"}
                </Text>
              </Pressable>
            </>
          )}

          {error ? (
            <Text style={{ color: colors.danger, textAlign: "center" }}>{error}</Text>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const inputStyle = {
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: radius.md,
  paddingVertical: spacing.md,
  paddingHorizontal: spacing.md,
  fontSize: 16,
  color: colors.text,
  backgroundColor: colors.surface,
} as const;

function PrimaryButton({
  label,
  busy,
  disabled,
  onPress,
}: {
  label: string;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{
        backgroundColor: colors.primary,
        paddingVertical: spacing.md,
        borderRadius: radius.md,
        alignItems: "center",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {busy ? (
        <ActivityIndicator color={colors.onPrimary} />
      ) : (
        <Text style={{ color: colors.onPrimary, fontSize: 16, fontWeight: "600" }}>{label}</Text>
      )}
    </Pressable>
  );
}
