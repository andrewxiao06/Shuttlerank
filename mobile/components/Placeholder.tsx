import { SafeAreaView, Text, View } from "react-native";
import { colors, spacing } from "../lib/theme";

// Temporary screen scaffold used until each real screen lands. Keeps the
// tab shell navigable while screens are built one by one.
export function Placeholder({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          gap: spacing.sm,
          padding: spacing.xl,
        }}
      >
        <Text style={{ fontSize: 22, fontWeight: "700", color: colors.text }}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={{ color: colors.textSecondary, textAlign: "center" }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </SafeAreaView>
  );
}
