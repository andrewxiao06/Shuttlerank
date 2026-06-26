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
            {/* Detail routes get a native header with a back button. */}
            <Stack.Screen name="edit-profile" options={{ headerShown: true, title: "Edit profile" }} />
            <Stack.Screen name="player/[id]" options={{ headerShown: true, title: "Player" }} />
            <Stack.Screen name="match/[id]" options={{ headerShown: true, title: "Match" }} />
            <Stack.Screen name="tournaments/index" options={{ headerShown: true, title: "Tournaments" }} />
            <Stack.Screen name="tournaments/[id]" options={{ headerShown: true, title: "Tournament" }} />
          </Stack>
        </SafeAreaProvider>
      </QueryProvider>
    </ClerkProvider>
  );
}
