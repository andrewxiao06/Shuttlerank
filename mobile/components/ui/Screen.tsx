import { ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, spacing } from "../../lib/theme";

/*
 * Screen — the standard page wrapper. Handles the safe area (notch / home
 * indicator) and the background color so individual screens don't repeat it.
 * Set `scroll` for content that may overflow; omit it for fixed layouts
 * (e.g. a screen whose body is its own FlatList).
 */
export function Screen({
  children,
  scroll = false,
  padded = true,
}: {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
}) {
  const pad = padded ? spacing.lg : 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={{ padding: pad, gap: spacing.xl }}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={{ flex: 1, padding: pad }}>{children}</View>
      )}
    </SafeAreaView>
  );
}
