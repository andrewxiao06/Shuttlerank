import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryProvider } from "../../lib/query";

// Root layout. Wraps the whole app in the TanStack Query provider, then
// renders a stack whose only child is the (tabs) group. Clerk auth will
// wrap this in Phase 2.
export default function RootLayout() {
  return (
    <QueryProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
      </Stack>
    </QueryProvider>
  );
}
