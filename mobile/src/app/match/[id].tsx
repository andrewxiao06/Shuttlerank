import { useQueries, useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Card } from "../../../components/ui/Card";
import { AsyncBoundary } from "../../../components/ui/AsyncBoundary";
import { getMatch, getPlayer } from "../../../lib/api/client";
import { formatRating } from "../../../lib/format";
import type { CategoryMatch, MatchParticipant } from "../../../lib/api/types";
import { colors, radius, spacing } from "../../../lib/theme";

const STATUS_LABEL: Record<string, { text: string; color: string }> = {
  verified: { text: "Verified — ratings updated", color: colors.accent },
  pending: { text: "Pending approval", color: colors.warning },
  disputed: { text: "Disputed", color: colors.danger },
  expired: { text: "Expired", color: colors.textMuted },
};

/*
 * Match detail — full breakdown of one match. Scoreboard, status, and the
 * per-player rating change (pre → post, with the delta). Reached by tapping
 * a match on Home or in the Inbox. `useLocalSearchParams` reads the [id]
 * from the route, the file-based-routing way to get a URL param.
 */
export default function MatchDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const matchId = Number(id);

  const q = useQuery({
    queryKey: ["match", matchId],
    queryFn: () => getMatch(matchId),
  });

  const ids = Array.from(
    new Set((q.data?.participants ?? []).map((p) => p.player_id)),
  );
  const playerQueries = useQueries({
    queries: ids.map((pid) => ({
      queryKey: ["player", pid],
      queryFn: () => getPlayer(pid),
      enabled: q.isSuccess,
    })),
  });
  const nameOf = (pid: number) => {
    const p = playerQueries.find((pq) => pq.data?.id === pid)?.data;
    return p?.display_name ?? p?.name ?? `Player #${pid}`;
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={["bottom"]}>
      <AsyncBoundary
        isPending={q.isPending}
        isError={q.isError}
        error={q.error}
        errorPrefix="Couldn't load this match."
      >
        {q.data ? <Body match={q.data} nameOf={nameOf} /> : null}
      </AsyncBoundary>
    </SafeAreaView>
  );
}

function Body({
  match,
  nameOf,
}: {
  match: CategoryMatch;
  nameOf: (id: number) => string;
}) {
  const teamA = match.participants.filter((p) => p.team === "A");
  const teamB = match.participants.filter((p) => p.team === "B");
  const status = STATUS_LABEL[match.status ?? ""] ?? STATUS_LABEL.pending;
  const isDoubles = match.participants.length > 2;

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
      <Text style={{ color: colors.textMuted, fontSize: 12 }}>
        {isDoubles ? "Doubles" : "Singles"} · {match.played_at}
      </Text>

      {/* Scoreboard */}
      <Card>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Side names={teamA.map((p) => nameOf(p.player_id))} won={match.winner_team === "A"} />
          <Text style={{ fontSize: 28, fontWeight: "800", color: colors.text, paddingHorizontal: spacing.md }}>
            {match.team_a_score}–{match.team_b_score}
          </Text>
          <Side names={teamB.map((p) => nameOf(p.player_id))} won={match.winner_team === "B"} alignRight />
        </View>
      </Card>

      {/* Status */}
      <View
        style={{
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.md,
          padding: spacing.md,
        }}
      >
        <Text style={{ color: status.color, fontWeight: "600" }}>{status.text}</Text>
      </View>

      {/* Rating changes */}
      <View style={{ gap: spacing.sm }}>
        <Text style={{ fontSize: 18, fontWeight: "700", color: colors.text }}>
          Rating changes
        </Text>
        {match.participants.map((p) => (
          <RatingRow
            key={`${p.team}-${p.player_id}`}
            name={nameOf(p.player_id)}
            participant={p}
            verified={match.status === "verified"}
          />
        ))}
        {match.status === "pending" ? (
          <Text style={{ color: colors.textMuted, fontSize: 12 }}>
            Rating changes are calculated once the match is verified.
          </Text>
        ) : null}
      </View>
    </ScrollView>
  );
}

function Side({ names, won, alignRight }: { names: string[]; won: boolean; alignRight?: boolean }) {
  return (
    <View style={{ flex: 1, alignItems: alignRight ? "flex-end" : "flex-start" }}>
      <Text style={{ color: won ? colors.accent : colors.textSecondary, fontSize: 12, fontWeight: "700" }}>
        {won ? "WON" : ""}
      </Text>
      {names.map((n) => (
        <Text key={n} style={{ color: colors.text }}>
          {n}
        </Text>
      ))}
    </View>
  );
}

function RatingRow({
  name,
  participant,
  verified,
}: {
  name: string;
  participant: MatchParticipant;
  verified: boolean;
}) {
  const delta = participant.delta_display;
  return (
    <Card style={{ flexDirection: "row", alignItems: "center", padding: spacing.md }}>
      <Text style={{ flex: 1, color: colors.text, fontWeight: "600" }}>{name}</Text>
      {verified ? (
        <>
          <Text style={{ color: colors.textSecondary, marginRight: spacing.md }}>
            {formatRating(participant.pre_display)} → {formatRating(participant.post_display)}
          </Text>
          <Text
            style={{
              color: delta > 0 ? colors.accent : delta < 0 ? colors.danger : colors.textMuted,
              fontWeight: "700",
            }}
          >
            {delta > 0 ? "+" : delta < 0 ? "−" : "±"}
            {Math.abs(delta).toFixed(1)}
          </Text>
        </>
      ) : (
        <Text style={{ color: colors.textMuted }}>—</Text>
      )}
    </Card>
  );
}
