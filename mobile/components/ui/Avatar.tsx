import { useState } from "react";
import { Image, Text, View } from "react-native";
import { colors } from "../../lib/theme";

/*
 * Player avatar — the profile photo when present and loadable, else a
 * monogram circle. Falls back to the monogram on image load error too, so a
 * stale/expired URL degrades gracefully instead of showing nothing.
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
  const [failed, setFailed] = useState(false);
  const initial = (name ?? "?").trim().charAt(0).toUpperCase() || "?";
  const radius = size / 2;

  if (src && !failed) {
    return (
      <Image
        source={{ uri: src }}
        onError={() => setFailed(true)}
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: colors.surfaceMuted,
        }}
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
