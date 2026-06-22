import { ActivityIndicator, Pressable, Text } from "react-native";
import { colors, radius, spacing } from "../../lib/theme";

type Variant = "primary" | "outline" | "danger";

/*
 * Button — one styled pressable used everywhere. Variants keep the look
 * consistent; restyling buttons app-wide means editing only this file.
 */
export function Button({
  label,
  onPress,
  variant = "primary",
  disabled = false,
  loading = false,
}: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
}) {
  const isDisabled = disabled || loading;

  const bg =
    variant === "primary"
      ? colors.primary
      : variant === "danger"
        ? colors.danger
        : colors.surface;
  const border = variant === "outline" ? colors.border : bg;
  const fg =
    variant === "outline" ? colors.text : colors.onPrimary;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={{
        backgroundColor: bg,
        borderWidth: 1,
        borderColor: border,
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.lg,
        borderRadius: radius.md,
        alignItems: "center",
        justifyContent: "center",
        opacity: isDisabled ? 0.4 : 1,
      }}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={{ color: fg, fontSize: 16, fontWeight: "700" }}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}
