import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Avatar } from "./ui/Avatar";
import { Card } from "./ui/Card";
import { AsyncBoundary } from "./ui/AsyncBoundary";
import { getPlayer, listPlayerMatches } from "../lib/api/client";
import { formatRating, tierLabel, isCalibrating } from "../lib/format";
import type { CategoryMatch, PlayerMe } from "../lib/api/types";
import { colors, radius, spacing } from "../lib/theme";

const RECENT_COUNT = 5;

/*
 * Shared player profile. Used both for "me" (Profile tab passes its own
 * getMe data) and for viewing any other player (the /player/[id] route
 * passes a playerId to fetch). Match history shows the most recent few with
 * a "Show all" toggle to expand to the full list (DUPR-style).
 */
export function PlayerProfile({
  player,
  playerId,
}: {
  player?: PlayerMe; // pass when already loaded (the Profile tab / "me")
  playerId?: number; // pass to fetch a specific player
}) {
  // When given a player object use it; otherwise fetch by id.
  const playerQ = useQuery({
    queryKey: ["player", playerId],
    queryFn: () => getPlayer(playerId!),
    enabled: player == null && playerId != null,
  });
  const resolved = player ?? playerQ.data;
  const id = resolved?.id;

  const matchesQ = useQuery({
    queryKey: ["matches", id],
    queryFn: () => listPlayerMatches(id!),
    enabled: id != null,
  });

  return (
    <AsyncBoundary
      isPending={player == null && playerQ.isPending}
      isError={playerQ.isError}
      error={playerQ.error}
      errorPrefix="Couldn't load this profile."
    >
      {resolved ? (
        <Body
          player={resolved}
          matches={matchesQ.data ?? []}
          matchesLoading={matchesQ.isPending}
        />
      ) : null}
    </AsyncBoundary>
  );
}

function Body({
  player,
  matches,
  matchesLoading,
}: {
  player: PlayerMe;
  matches: CategoryMatch[];
  matchesLoading: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const rating = player.ratings[0];
  const calibrating = rating ? isCalibrating(rating.rd) : false;

  const sorted = [...matches].sort((a, b) =>
    b.played_at.localeCompare(a.played_at),
  );
  const shown = showAll ? sorted : sorted.slice(0, RECENT_COUNT);
  const hasMore = sorted.length > RECENT_COUNT;

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
      {/* Name + avatar */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
        <Avatar src={player.avatar_url} name={player.display_name ?? player.name} size={64} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.textSecondary, fontSize: 13, textTransform: "uppercase" }}>
            Player
          </Text>
          <Text style={{ fontSize: 26, fontWeight: "800", color: colors.text }}>
            {player.display_name ?? player.name}
          </Text>
          {player.age != null || player.location ? (
            <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
              {[player.age != null ? `${player.age}` : null, player.location]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          ) : null}
        </View>
      </View>

      {/* Hero rating */}
      {rating ? (
        <Card style={{ alignItems: "center", gap: spacing.sm }}>
          <Text style={{ color: colors.textSecondary, fontSize: 13, textTransform: "uppercase" }}>
            Rating
          </Text>
          <Text style={{ fontSize: 56, fontWeight: "800", color: colors.text }}>
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
            <Text style={{ color: colors.warning, textAlign: "center" }}>
              Still calibrating — more matches will firm up this rating.
            </Text>
          ) : null}
        </Card>
      ) : null}

      {/* Match history */}
      <View style={{ gap: spacing.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ fontSize: 18, fontWeight: "700", color: colors.text }}>
            {showAll ? "Match history" : "Recent matches"}
          </Text>
          {hasMore ? (
            <Pressable onPress={() => setShowAll((v) => !v)}>
              <Text style={{ color: colors.primary, fontWeight: "600" }}>
                {showAll ? "Show recent" : `Show all (${sorted.length})`}
              </Text>
            </Pressable>
          ) : null}
        </View>

        {matchesLoading ? (
          <Text style={{ color: colors.textMuted }}>Loading…</Text>
        ) : sorted.length === 0 ? (
          <Text style={{ color: colors.textMuted }}>No matches yet.</Text>
        ) : (
          shown.map((m) => (
            <MatchRow key={m.id} match={m} viewerId={player.id} />
          ))
        )}
      </View>
    </ScrollView>
  );
}

function MatchRow({ match, viewerId }: { match: CategoryMatch; viewerId: number }) {
  const router = useRouter();
  const me = match.participants.find((p) => p.player_id === viewerId);
  const youWon = me?.team === match.winner_team;
  const verified = match.status === "verified";
  const delta = me?.delta_display ?? 0;

  return (
    <Pressable onPress={() => router.push(`/match/${match.id}`)}>
      <Card style={{ flexDirection: "row", alignItems: "center", padding: spacing.md }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontWeight: "600" }}>
            {match.participants.length > 2 ? "Doubles" : "Singles"} · {match.played_at}
          </Text>
          <Text
            style={{
              fontSize: 12,
              color: verified ? (youWon ? colors.accent : colors.danger) : colors.warning,
            }}
          >
            {verified ? (youWon ? "Won" : "Lost") : "Pending"}
          </Text>
        </View>
        <Text style={{ color: colors.text, fontWeight: "700" }}>
          {match.team_a_score}–{match.team_b_score}
        </Text>
        {verified ? (
          <Text
            style={{
              marginLeft: spacing.md,
              color: delta > 0 ? colors.accent : delta < 0 ? colors.danger : colors.textMuted,
              fontWeight: "700",
            }}
          >
            {delta > 0 ? "+" : delta < 0 ? "−" : "±"}
            {Math.abs(delta).toFixed(1)}
          </Text>
        ) : null}
      </Card>
    </Pressable>
  );
}
