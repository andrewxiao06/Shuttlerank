import { ReactNode } from "react";
import { View, ViewStyle } from "react-native";
import { colors, radius, spacing } from "../../lib/theme";

// Card — a bordered surface container. The default "panel" look for rows,
// hero blocks, and grouped content.
export function Card({
  children,
  style,
}: {
  children: ReactNode;
  style?: ViewStyle;
}) {
  return (
    <View
      style={[
        {
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.lg,
          padding: spacing.lg,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
