import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Avatar } from "./ui/Avatar";
import { Card } from "./ui/Card";
import { AsyncBoundary } from "./ui/AsyncBoundary";
import { MatchRow } from "./MatchRow";
import { getPlayer, listPlayerMatches } from "../lib/api/client";
import { FormatRatings } from "./FormatRatings";
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
  onEdit,
}: {
  player?: PlayerMe; // pass when already loaded (the Profile tab / "me")
  playerId?: number; // pass to fetch a specific player
  onEdit?: () => void; // when set, shows an "Edit" button (your own profile)
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
          onEdit={onEdit}
        />
      ) : null}
    </AsyncBoundary>
  );
}

function Body({
  player,
  matches,
  matchesLoading,
  onEdit,
}: {
  player: PlayerMe;
  matches: CategoryMatch[];
  matchesLoading: boolean;
  onEdit?: () => void;
}) {
  const [showAll, setShowAll] = useState(false);

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
        {onEdit ? (
          <Pressable
            onPress={onEdit}
            style={{
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: radius.md,
              paddingVertical: spacing.sm,
              paddingHorizontal: spacing.md,
            }}
          >
            <Text style={{ color: colors.text, fontWeight: "600" }}>Edit</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Hero ratings — most-played format leads, the other tucked below */}
      <Card>
        <FormatRatings ratings={player.ratings} />
      </Card>

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

