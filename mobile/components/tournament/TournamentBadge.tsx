import { Text, View } from "react-native";
import { colors, radius, spacing } from "../../lib/theme";

// Shared tournament helpers used by the Tournaments tab and the detail screen.

export function RankedBadge({ ranked }: { ranked: boolean }) {
  return (
    <View
      style={{
        borderRadius: radius.pill,
        paddingHorizontal: spacing.sm,
        paddingVertical: 2,
        backgroundColor: ranked ? colors.accentSoft : colors.surfaceMuted,
      }}
    >
      <Text
        style={{
          fontSize: 10,
          fontWeight: "700",
          color: ranked ? colors.accent : colors.textSecondary,
        }}
      >
        {ranked ? "RANKED" : "CASUAL"}
      </Text>
    </View>
  );
}

export function statusLabel(s: string): string {
  return (
    { draft: "Draft", open: "Open", in_progress: "In progress", completed: "Completed" }[
      s
    ] ?? s
  );
}
