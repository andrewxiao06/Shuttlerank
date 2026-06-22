import { useAuth, useUser } from "@clerk/clerk-expo";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, radius, spacing } from "../../../lib/theme";

// Home / dashboard. Minimal for now — shows who's signed in and a sign-out
// button so the auth loop is testable. Full dashboard lands in Phase 3.
export default function Home() {
  const { signOut } = useAuth();
  const { user } = useUser();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          gap: spacing.md,
          padding: spacing.xl,
        }}
      >
        <Text style={{ fontSize: 26, fontWeight: "700", color: colors.text }}>
          Hello DUBR 🏸
        </Text>
        <Text style={{ color: colors.textSecondary, textAlign: "center" }}>
          Signed in as{" "}
          {user?.primaryEmailAddress?.emailAddress ?? user?.firstName ?? "you"}.
          {"\n"}Dashboard, screens & more land in Phase 3.
        </Text>
        <Pressable
          onPress={() => signOut()}
          style={{
            marginTop: spacing.lg,
            borderWidth: 1,
            borderColor: colors.border,
            paddingVertical: spacing.sm,
            paddingHorizontal: spacing.lg,
            borderRadius: radius.md,
          }}
        >
          <Text style={{ color: colors.text }}>Sign out</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
