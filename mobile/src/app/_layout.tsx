import { ClerkProvider } from "@clerk/clerk-expo";
import { tokenCache } from "@clerk/clerk-expo/token-cache";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryProvider } from "../../lib/query";
import { AuthSync } from "../../lib/auth-sync";

// Root layout. Order matters: ClerkProvider (auth) → QueryProvider (data) →
// AuthSync (bridges Clerk into the API client + bootstraps the player) →
// the navigator. Tokens are stored encrypted via expo-secure-store (tokenCache).
const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!;

export default function RootLayout() {
  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <QueryProvider>
        <SafeAreaProvider>
          <AuthSync />
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="sign-in" />
          </Stack>
        </SafeAreaProvider>
      </QueryProvider>
    </ClerkProvider>
  );
}
