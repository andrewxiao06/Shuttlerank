import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { PlayerSearch } from "../../../components/PlayerSearch";
import { Card } from "../../../components/ui/Card";
import { Screen } from "../../../components/ui/Screen";
import { getForecast } from "../../../lib/api/client";
import { formatPercent, formatRating, tierLabel } from "../../../lib/format";
import type { PlayerMe } from "../../../lib/api/types";
import { colors, radius, spacing } from "../../../lib/theme";

/*
 * Forecast — pick two players, see the win probability. Any two players can
 * be compared (one universal rating). The big % uses the "info" blue, the
 * locked semantic for a forecast (not a win/positive color).
 */
export default function Forecast() {
  const [you, setYou] = useState<PlayerMe | null>(null);
  const [opp, setOpp] = useState<PlayerMe | null>(null);
  const [category, setCategory] = useState<"singles" | "doubles">("singles");

  const ready = you != null && opp != null && you.id !== opp.id;
  const q = useQuery({
    queryKey: ["forecast", you?.id, opp?.id, category],
    queryFn: () => getForecast(you!.id, opp!.id, category),
    enabled: ready,
  });

  return (
    <Screen scroll>
      <Text style={{ fontSize: 28, fontWeight: "800", color: colors.text }}>
        Who wins?
      </Text>

      {/* Singles / Doubles — uses each player's rating for that format */}
      <View
        style={{
          flexDirection: "row",
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.md,
          padding: 3,
        }}
      >
        {(["singles", "doubles"] as const).map((c) => (
          <Pressable
            key={c}
            onPress={() => setCategory(c)}
            style={{
              flex: 1,
              alignItems: "center",
              paddingVertical: spacing.sm,
              borderRadius: radius.sm,
              backgroundColor: category === c ? colors.primary : "transparent",
            }}
          >
            <Text
              style={{
                color: category === c ? colors.onPrimary : colors.textSecondary,
                fontWeight: "700",
                textTransform: "capitalize",
              }}
            >
              {c}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Pickers */}
      <View style={{ gap: spacing.md }}>
        <PlayerSlot
          label="You"
          player={you}
          onPick={setYou}
          onClear={() => setYou(null)}
          excludeIds={opp ? [opp.id] : []}
        />
        <PlayerSlot
          label="Opponent"
          player={opp}
          onPick={setOpp}
          onClear={() => setOpp(null)}
          excludeIds={you ? [you.id] : []}
        />
      </View>

      {/* Result */}
      {!ready ? (
        <Text style={{ color: colors.textMuted, textAlign: "center" }}>
          Pick two players to see the forecast.
        </Text>
      ) : q.isPending ? (
        <Card>
          <Text style={{ color: colors.textMuted, textAlign: "center" }}>
            Calculating…
          </Text>
        </Card>
      ) : q.isError ? (
        <Card>
          <Text style={{ color: colors.danger, textAlign: "center" }}>
            {(q.error as Error).message}
          </Text>
        </Card>
      ) : (
        <>
          <Card style={{ alignItems: "center", gap: spacing.xs }}>
            <Text style={{ color: colors.textSecondary, fontSize: 13, textTransform: "uppercase" }}>
              {you!.display_name ?? you!.name} wins
            </Text>
            <Text style={{ fontSize: 56, fontWeight: "800", color: colors.info }}>
              {formatPercent(q.data.win_probability)}
            </Text>
            {q.data.player_calibrating || q.data.opponent_calibrating ? (
              <Text style={{ color: colors.warning, textAlign: "center" }}>
                One or both players are still calibrating — treat this as a rough guess.
              </Text>
            ) : null}
          </Card>

          <ProjectedScore
            youName={you!.display_name ?? you!.name}
            oppName={opp!.display_name ?? opp!.name}
            winProbability={q.data.win_probability}
          />

          <View style={{ flexDirection: "row", gap: spacing.md }}>
            <RatingMini label={you!.display_name ?? you!.name} display={q.data.player_display} />
            <RatingMini label={opp!.display_name ?? opp!.name} display={q.data.opponent_display} />
          </View>
        </>
      )}
    </Screen>
  );
}

function PlayerSlot({
  label,
  player,
  onPick,
  onClear,
  excludeIds,
}: {
  label: string;
  player: PlayerMe | null;
  onPick: (p: PlayerMe) => void;
  onClear: () => void;
  excludeIds: number[];
}) {
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={{ color: colors.textSecondary, fontSize: 13, textTransform: "uppercase" }}>
        {label}
      </Text>
      {player ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            backgroundColor: colors.surfaceMuted,
            borderRadius: radius.md,
            paddingVertical: spacing.md,
            paddingHorizontal: spacing.md,
          }}
        >
          <Text style={{ color: colors.text, fontSize: 16 }}>
            {player.display_name ?? player.name}
          </Text>
          <Pressable onPress={onClear}>
            <Ionicons name="close-circle" size={22} color={colors.textMuted} />
          </Pressable>
        </View>
      ) : (
        <PlayerSearch onPick={onPick} excludeIds={excludeIds} />
      )}
    </View>
  );
}

// Rough scoreline from the win probability. Badminton games go to 21; the
// favorite takes 21 and the underdog's total falls as the matchup gets more
// lopsided (even ≈ 21–19, near-certain ≈ 21–5). Illustrative, not a promise.
function projectedScore(winProbability: number): { you: number; opp: number } {
  const youFavored = winProbability >= 0.5;
  const pf = youFavored ? winProbability : 1 - winProbability;
  const m = (pf - 0.5) / 0.5; // 0 = even, 1 = near-certain
  const loser = Math.max(3, Math.min(20, Math.round(19 - m * 14)));
  return youFavored ? { you: 21, opp: loser } : { you: loser, opp: 21 };
}

function ProjectedScore({
  youName,
  oppName,
  winProbability,
}: {
  youName: string;
  oppName: string;
  winProbability: number;
}) {
  const s = projectedScore(winProbability);
  return (
    <Card style={{ alignItems: "center", gap: spacing.sm }}>
      <Text style={{ color: colors.textSecondary, fontSize: 13, textTransform: "uppercase" }}>
        Projected score
      </Text>
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: spacing.md }}>
        <ScoreCol name={youName} score={s.you} win={s.you > s.opp} />
        <Text style={{ fontSize: 28, fontWeight: "800", color: colors.textMuted }}>–</Text>
        <ScoreCol name={oppName} score={s.opp} win={s.opp > s.you} />
      </View>
    </Card>
  );
}

function ScoreCol({ name, score, win }: { name: string; score: number; win: boolean }) {
  return (
    <View style={{ alignItems: "center", maxWidth: 120 }}>
      <Text style={{ fontSize: 40, fontWeight: "800", color: win ? colors.info : colors.text }}>
        {score}
      </Text>
      <Text numberOfLines={1} style={{ color: colors.textMuted, fontSize: 12 }}>
        {name}
      </Text>
    </View>
  );
}

function RatingMini({ label, display }: { label: string; display: number }) {
  return (
    <Card style={{ flex: 1, gap: spacing.xs }}>
      <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 12 }}>
        {label}
      </Text>
      <Text style={{ fontSize: 24, fontWeight: "700", color: colors.text }}>
        {formatRating(display)}
      </Text>
      <Text style={{ color: colors.textMuted, fontSize: 12 }}>
        {tierLabel(display)}
      </Text>
    </Card>
  );
}
