import { useAuth } from "@clerk/clerk-expo";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Avatar } from "../../../components/ui/Avatar";
import { Card } from "../../../components/ui/Card";
import { Screen } from "../../../components/ui/Screen";
import { AsyncBoundary } from "../../../components/ui/AsyncBoundary";
import { MatchRow } from "../../../components/MatchRow";
import { getMe, listPlayerMatches } from "../../../lib/api/client";
import { formatRating, tierLabel, isCalibrating } from "../../../lib/format";
import { pickRatings } from "../../../lib/ratings";
import type { CategoryMatch, CategoryRating, PlayerMe } from "../../../lib/api/types";
import { colors, radius, spacing } from "../../../lib/theme";

/*
 * Home dashboard — your rating hero, quick actions, and recent matches.
 * Mirrors the web home view, built on the shared primitives.
 */
export default function Home() {
  const { signOut } = useAuth();
  const router = useRouter();

  const meQ = useQuery({ queryKey: ["me"], queryFn: getMe });
  const playerId = meQ.data?.id;

  const matchesQ = useQuery({
    queryKey: ["matches", playerId],
    queryFn: () => listPlayerMatches(playerId!),
    enabled: playerId != null,
  });

  return (
    <Screen scroll>
      <AsyncBoundary
        isPending={meQ.isPending}
        isError={meQ.isError}
        error={meQ.error}
        errorPrefix="Couldn't load your profile."
      >
        {meQ.data ? (
          <HomeBody
            me={meQ.data}
            matches={matchesQ.data ?? []}
            onSubmit={() => router.push("/submit")}
            onLeaderboard={() => router.push("/leaderboard")}
            onForecast={() => router.push("/forecast")}
            onTournaments={() => router.push("/tournaments")}
            onSignOut={() => signOut()}
          />
        ) : null}
      </AsyncBoundary>
    </Screen>
  );
}

function HomeBody({
  me,
  matches,
  onSubmit,
  onLeaderboard,
  onForecast,
  onTournaments,
  onSignOut,
}: {
  me: PlayerMe;
  matches: CategoryMatch[];
  onSubmit: () => void;
  onLeaderboard: () => void;
  onForecast: () => void;
  onTournaments: () => void;
  onSignOut: () => void;
}) {
  const { singles, doubles } = pickRatings(me.ratings);
  const recent = [...matches]
    .sort((a, b) => b.played_at.localeCompare(a.played_at))
    .slice(0, 3);

  return (
    <>
      {/* Hero */}
      <Card style={{ gap: spacing.md }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Avatar src={me.avatar_url} name={me.display_name ?? me.name} size={40} />
          <Text
            style={{ color: colors.textSecondary, fontSize: 13, textTransform: "uppercase" }}
          >
            {me.display_name ?? me.name}
          </Text>
        </View>
        <View style={{ flexDirection: "row", gap: spacing.md }}>
          <HeroRating label="Singles" rating={singles} />
          <HeroRating label="Doubles" rating={doubles} />
        </View>
      </Card>

      {/* Quick actions */}
      <View style={{ flexDirection: "row", gap: spacing.md }}>
        <QuickAction icon="add-circle-outline" label="Submit" onPress={onSubmit} />
        <QuickAction icon="podium-outline" label="Board" onPress={onLeaderboard} />
        <QuickAction icon="stats-chart-outline" label="Forecast" onPress={onForecast} />
        <QuickAction icon="trophy-outline" label="Events" onPress={onTournaments} />
      </View>

      {/* Recent matches */}
      <View style={{ gap: spacing.sm }}>
        <Text style={{ fontSize: 18, fontWeight: "700", color: colors.text }}>
          Recent matches
        </Text>
        {recent.length === 0 ? (
          <Text style={{ color: colors.textMuted }}>
            No matches yet — submit your first one.
          </Text>
        ) : (
          recent.map((m) => (
            <MatchRow key={m.id} match={m} viewerId={me.id} />
          ))
        )}
      </View>

      {/* Sign out */}
      <Pressable onPress={onSignOut} style={{ alignItems: "center", paddingVertical: spacing.md }}>
        <Text style={{ color: colors.textMuted }}>Sign out</Text>
      </Pressable>
    </>
  );
}

function HeroRating({ label, rating }: { label: string; rating: CategoryRating | null }) {
  const played = (rating?.match_count ?? 0) > 0;
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={{ color: colors.textSecondary, fontSize: 12, textTransform: "uppercase" }}>
        {label}
      </Text>
      <Text style={{ fontSize: 36, fontWeight: "800", color: colors.text }}>
        {rating && played ? formatRating(rating.display) : "—"}
      </Text>
      {rating ? (
        <Text style={{ color: colors.accent, fontWeight: "600", fontSize: 13 }}>
          {tierLabel(rating.display)}
        </Text>
      ) : null}
      <Text style={{ color: colors.textMuted, fontSize: 12 }}>
        {played
          ? `${rating!.match_count} match${rating!.match_count === 1 ? "" : "es"}`
          : rating && isCalibrating(rating.rd)
            ? "Calibrating"
            : "Not yet played"}
      </Text>
    </View>
  );
}

function QuickAction({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.md,
        paddingVertical: spacing.lg,
        alignItems: "center",
        gap: spacing.xs,
      }}
    >
      <Ionicons name={icon} size={24} color={colors.primary} />
      <Text style={{ color: colors.text, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

