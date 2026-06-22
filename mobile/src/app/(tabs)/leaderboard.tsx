import { useQuery } from "@tanstack/react-query";
import { ActivityIndicator, FlatList, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getLeaderboard } from "../../../lib/api/client";
import { formatRating, tierLabel, isCalibrating } from "../../../lib/format";
import { colors, spacing } from "../../../lib/theme";

/*
 * Leaderboard — fetches the live board and renders it in a FlatList.
 *
 * Key React Native concepts in here:
 *  - useQuery: same as the web app. It hands back { data, isPending, isError }.
 *    We render a different UI for each of those three states.
 *  - FlatList: RN's efficient scrolling list. Instead of mapping over an
 *    array (which renders everything at once), FlatList only renders the
 *    rows on screen. You give it `data`, a `renderItem` for one row, and a
 *    `keyExtractor` so React can track rows.
 *  - There's no <div>/<p>: <View> is a box, <Text> holds text. ALL text
 *    must be inside a <Text> or RN throws.
 */
export default function Leaderboard() {
  const q = useQuery({
    queryKey: ["leaderboard"],
    queryFn: () => getLeaderboard(),
  });

  // --- Loading state ---
  if (q.isPending) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  // --- Error state ---
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
            Couldn&apos;t load the leaderboard.{"\n"}
            {(q.error as Error).message}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // --- Success: q.data is the Leaderboard object; .entries is the row array ---
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ padding: spacing.lg }}>
        <Text style={{ fontSize: 28, fontWeight: "800", color: colors.text }}>
          Leaderboard
        </Text>
        <Text style={{ color: colors.textSecondary }}>
          {q.data.total} player{q.data.total === 1 ? "" : "s"}
        </Text>
      </View>

      <FlatList
        data={q.data.entries}
        keyExtractor={(item) => String(item.player_id)}
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingBottom: spacing.xl,
        }}
        ListEmptyComponent={
          <Text
            style={{
              color: colors.textMuted,
              textAlign: "center",
              marginTop: spacing.xl,
            }}
          >
            No players ranked yet.
          </Text>
        }
        renderItem={({ item }) => (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 12,
              padding: spacing.md,
              marginBottom: spacing.sm,
              // Calibrating players are still finding their level — dim them.
              opacity: isCalibrating(item.rd) ? 0.55 : 1,
            }}
          >
            {/* Rank */}
            <Text
              style={{ width: 32, color: colors.textSecondary, fontWeight: "600" }}
            >
              {item.rank}
            </Text>

            {/* Name + tier (flex: 1 takes the remaining width) */}
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 16, fontWeight: "600", color: colors.text }}>
                {item.name}
              </Text>
              <Text style={{ fontSize: 12, color: colors.textMuted }}>
                {tierLabel(item.display)}
              </Text>
            </View>

            {/* Rating number */}
            <Text style={{ fontSize: 20, fontWeight: "700", color: colors.text }}>
              {formatRating(item.display)}
            </Text>
          </View>
        )}
      />
    </SafeAreaView>
  );
}
