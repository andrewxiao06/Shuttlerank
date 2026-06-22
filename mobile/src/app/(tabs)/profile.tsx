import { useQuery } from "@tanstack/react-query";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getMe } from "../../../lib/api/client";
import { formatRating, tierLabel, isCalibrating } from "../../../lib/format";
import { colors, radius, spacing } from "../../../lib/theme";

/*
 * Profile — your own player card.
 *
 * What's different from Leaderboard:
 *  - Leaderboard rendered an ARRAY (many rows → FlatList).
 *  - Profile renders ONE object (your data → just Views + Text, no list).
 *  - It uses getMe(), which needs auth — that's why this screen waited until
 *    Clerk was wired. The token is attached automatically by the API client.
 *
 * A player has exactly one rating, so we read q.data.ratings[0].
 */
export default function Profile() {
  const q = useQuery({ queryKey: ["me"], queryFn: getMe });

  // Same three-state pattern as Leaderboard.
  if (q.isPending) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <View
          style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
        >
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (q.isError) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            padding: spacing.xl,
          }}
        >
          <Text style={{ color: colors.danger, textAlign: "center" }}>
            Couldn&apos;t load your profile.{"\n"}
            {(q.error as Error).message}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // Success: q.data is your PlayerMe. One rating per player.
  const me = q.data;
  const rating = me.ratings[0];
  const calibrating = rating ? isCalibrating(rating.rd) : false;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
      >
        {/* Name header */}
        <View>
          <Text
            style={{
              fontSize: 13,
              color: colors.textSecondary,
              textTransform: "uppercase",
            }}
          >
            Player
          </Text>
          <Text style={{ fontSize: 28, fontWeight: "800", color: colors.text }}>
            {me.display_name ?? me.name}
          </Text>
        </View>

        {/* Hero rating card */}
        {rating ? (
          <View
            style={{
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: radius.lg,
              padding: spacing.xl,
              alignItems: "center",
              gap: spacing.sm,
            }}
          >
            <Text
              style={{
                fontSize: 13,
                color: colors.textSecondary,
                textTransform: "uppercase",
              }}
            >
              Rating
            </Text>
            <Text
              style={{ fontSize: 56, fontWeight: "800", color: colors.text }}
            >
              {rating.match_count > 0 ? formatRating(rating.display) : "—"}
            </Text>
            <View
              style={{
                backgroundColor: colors.accentSoft,
                paddingHorizontal: spacing.md,
                paddingVertical: 4,
                borderRadius: radius.pill,
              }}
            >
              <Text style={{ color: colors.accent, fontWeight: "600" }}>
                {tierLabel(rating.display)}
              </Text>
            </View>
            <Text style={{ color: colors.textMuted }}>
              {rating.match_count} match{rating.match_count === 1 ? "" : "es"}
            </Text>
            {calibrating ? (
              <Text
                style={{
                  color: colors.warning,
                  textAlign: "center",
                  marginTop: spacing.xs,
                }}
              >
                Still calibrating — play a few matches to lock in your rating.
              </Text>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
