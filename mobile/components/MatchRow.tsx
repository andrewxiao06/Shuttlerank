import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { Avatar } from "./ui/Avatar";
import { Card } from "./ui/Card";
import type { CategoryMatch, MatchParticipant } from "../lib/api/types";
import { colors, spacing } from "../lib/theme";

// "2026-06-15" → "6/15/26". Parse parts directly to avoid the UTC-midnight
// off-by-one on date-only strings.
function formatMatchDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${m}/${d}/${String(y).slice(-2)}`;
}

/*
 * Match row — shows both sides at a glance: each team's players (avatar +
 * name), the score, and the viewer's rating delta. Names/avatars come off
 * the participants directly (the API includes them). Tap → match detail.
 *
 * The viewer's team renders on the left so "you vs them" reads naturally.
 */
export function MatchRow({
  match,
  viewerId,
}: {
  match: CategoryMatch;
  viewerId: number;
}) {
  const router = useRouter();
  const viewer = match.participants.find((p) => p.player_id === viewerId);
  const mySide = viewer?.team ?? "A";
  const mine = match.participants.filter((p) => p.team === mySide);
  const theirs = match.participants.filter((p) => p.team !== mySide);
  const myScore = mySide === "A" ? match.team_a_score : match.team_b_score;
  const theirScore = mySide === "A" ? match.team_b_score : match.team_a_score;
  const youWon = viewer?.team === match.winner_team;
  const verified = match.status === "verified";
  const delta = viewer?.delta_display ?? 0;

  return (
    <Pressable onPress={() => router.push(`/match/${match.id}`)}>
      <Card style={{ gap: spacing.sm }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={{ color: colors.textMuted, fontSize: 12 }}>
            {match.participants.length > 2 ? "Doubles" : "Singles"} · {formatMatchDate(match.played_at)}
          </Text>
          <Text
            style={{
              fontSize: 12,
              fontWeight: "600",
              color: verified ? (youWon ? colors.accent : colors.danger) : colors.warning,
            }}
          >
            {verified ? (youWon ? "Won" : "Lost") : "Pending"}
          </Text>
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Side players={mine} />
          <View style={{ alignItems: "center", minWidth: 56 }}>
            <Text style={{ fontSize: 18, fontWeight: "800", color: colors.text }}>
              {myScore}–{theirScore}
            </Text>
            {verified ? (
              <Text
                style={{
                  fontSize: 12,
                  fontWeight: "700",
                  color: delta > 0 ? colors.accent : delta < 0 ? colors.danger : colors.textMuted,
                }}
              >
                {delta > 0 ? "+" : delta < 0 ? "−" : "±"}
                {Math.abs(delta).toFixed(1)}
              </Text>
            ) : null}
          </View>
          <Side players={theirs} align="right" />
        </View>
      </Card>
    </Pressable>
  );
}

function Side({
  players,
  align = "left",
}: {
  players: MatchParticipant[];
  align?: "left" | "right";
}) {
  return (
    <View style={{ flex: 1, gap: 4 }}>
      {players.map((p) => (
        <View
          key={p.player_id}
          style={{
            flexDirection: align === "right" ? "row-reverse" : "row",
            alignItems: "center",
            gap: spacing.xs,
          }}
        >
          <Avatar src={p.avatar_url} name={p.name} size={26} />
          <Text
            numberOfLines={1}
            style={{ flexShrink: 1, color: colors.text, fontSize: 14 }}
          >
            {p.name}
          </Text>
        </View>
      ))}
    </View>
  );
}
