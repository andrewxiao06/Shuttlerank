import { Image, Text, View } from "react-native";
import { colors } from "../../lib/theme";

/*
 * Player avatar — the profile photo when present, else a monogram circle
 * (the profile picture is optional, like DUPR).
 */
export function Avatar({
  src,
  name,
  size = 40,
}: {
  src?: string | null;
  name?: string | null;
  size?: number;
}) {
  const initial = (name ?? "?").trim().charAt(0).toUpperCase() || "?";
  const radius = size / 2;

  if (src) {
    return (
      <Image
        source={{ uri: src }}
        style={{ width: size, height: size, borderRadius: radius, backgroundColor: colors.surfaceMuted }}
      />
    );
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundColor: colors.surfaceMuted,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ fontSize: size * 0.42, fontWeight: "600", color: colors.textSecondary }}>
        {initial}
      </Text>
    </View>
  );
}
