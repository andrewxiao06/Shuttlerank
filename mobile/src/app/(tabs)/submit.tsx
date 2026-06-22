import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { PlayerSearch } from "../../../components/PlayerSearch";
import { Button } from "../../../components/ui/Button";
import { Screen } from "../../../components/ui/Screen";
import { createMatch } from "../../../lib/api/client";
import type { PlayerMe } from "../../../lib/api/types";
import { colors, radius, spacing } from "../../../lib/theme";

type Format = "singles" | "doubles";

function isoToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/*
 * Submit a match. Pick singles/doubles, choose each team's players, enter the
 * score, submit. The match is created as PENDING — the other players approve
 * it in their Inbox (you auto-approve as the submitter).
 *
 * Shows a success state after submitting so you get clear confirmation.
 */
export default function Submit() {
  const qc = useQueryClient();
  const [format, setFormat] = useState<Format>("singles");
  const [teamA, setTeamA] = useState<PlayerMe[]>([]);
  const [teamB, setTeamB] = useState<PlayerMe[]>([]);
  const [scoreA, setScoreA] = useState("");
  const [scoreB, setScoreB] = useState("");

  const teamSize = format === "singles" ? 1 : 2;

  const reset = () => {
    setTeamA([]);
    setTeamB([]);
    setScoreA("");
    setScoreB("");
  };

  const changeFormat = (f: Format) => {
    setFormat(f);
    // Trim teams if switching doubles → singles.
    if (f === "singles") {
      setTeamA((t) => t.slice(0, 1));
      setTeamB((t) => t.slice(0, 1));
    }
  };

  const submit = useMutation({
    mutationFn: () =>
      createMatch({
        played_at: isoToday(),
        team_a_player_ids: teamA.map((p) => p.id),
        team_b_player_ids: teamB.map((p) => p.id),
        team_a_score: Number(scoreA),
        team_b_score: Number(scoreB),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pending"] });
      qc.invalidateQueries({ queryKey: ["leaderboard"] });
    },
  });

  // Validation mirrors the backend rules so the button only enables when valid.
  const sizesOk = teamA.length === teamSize && teamB.length === teamSize;
  const scoresFilled = scoreA !== "" && scoreB !== "";
  const notTied = Number(scoreA) !== Number(scoreB);
  const ready = sizesOk && scoresFilled && notTied;

  // --- Success state ---
  if (submit.isSuccess) {
    return (
      <Screen>
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: spacing.md,
          }}
        >
          <Ionicons name="checkmark-circle" size={64} color={colors.primary} />
          <Text style={{ fontSize: 22, fontWeight: "700", color: colors.text }}>
            Match submitted
          </Text>
          <Text style={{ color: colors.textSecondary, textAlign: "center" }}>
            It&apos;s pending until the other players approve it in their inbox.
          </Text>
          <View style={{ marginTop: spacing.md, alignSelf: "stretch" }}>
            <Button
              label="Submit another"
              onPress={() => {
                reset();
                submit.reset();
              }}
            />
          </View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Text style={{ fontSize: 28, fontWeight: "800", color: colors.text }}>
        Submit a match
      </Text>

        {/* Format toggle */}
        <View style={{ gap: spacing.sm }}>
          <Text style={styles.label}>Format</Text>
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            {(["singles", "doubles"] as const).map((f) => (
              <Pressable
                key={f}
                onPress={() => changeFormat(f)}
                style={{
                  flex: 1,
                  paddingVertical: spacing.md,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  alignItems: "center",
                  borderColor: format === f ? colors.primary : colors.border,
                  backgroundColor:
                    format === f ? colors.accentSoft : colors.surface,
                }}
              >
                <Text
                  style={{
                    color: format === f ? colors.primary : colors.text,
                    fontWeight: "600",
                    textTransform: "capitalize",
                  }}
                >
                  {f}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Teams */}
        <TeamPicker
          label="Team A"
          players={teamA}
          onChange={setTeamA}
          maxSize={teamSize}
          excludeIds={teamB.map((p) => p.id)}
        />
        <TeamPicker
          label="Team B"
          players={teamB}
          onChange={setTeamB}
          maxSize={teamSize}
          excludeIds={teamA.map((p) => p.id)}
        />

        {/* Score */}
        <View style={{ gap: spacing.sm }}>
          <Text style={styles.label}>Score</Text>
          <View style={{ flexDirection: "row", gap: spacing.md }}>
            <ScoreBox label="Team A" value={scoreA} onChange={setScoreA} />
            <ScoreBox label="Team B" value={scoreB} onChange={setScoreB} />
          </View>
          {scoresFilled && !notTied ? (
            <Text style={{ color: colors.danger }}>
              Scores can&apos;t be tied — there must be a winner.
            </Text>
          ) : null}
        </View>

        {submit.isError ? (
          <Text style={{ color: colors.danger }}>
            Couldn&apos;t submit: {(submit.error as Error).message}
          </Text>
        ) : null}

      {/* Submit */}
      <Button
        label={submit.isPending ? "Submitting…" : "Submit match"}
        onPress={() => submit.mutate()}
        disabled={!ready}
        loading={submit.isPending}
      />
    </Screen>
  );
}

// One team's picker: chips for chosen players + a search to add more.
function TeamPicker({
  label,
  players,
  onChange,
  maxSize,
  excludeIds,
}: {
  label: string;
  players: PlayerMe[];
  onChange: (next: PlayerMe[]) => void;
  maxSize: number;
  excludeIds: number[];
}) {
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={styles.label}>
        {label} ({players.length}/{maxSize})
      </Text>

      {players.map((p) => (
        <View
          key={p.id}
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            backgroundColor: colors.surfaceMuted,
            borderRadius: radius.md,
            paddingVertical: spacing.sm,
            paddingHorizontal: spacing.md,
          }}
        >
          <Text style={{ color: colors.text }}>{p.display_name ?? p.name}</Text>
          <Pressable
            onPress={() => onChange(players.filter((x) => x.id !== p.id))}
          >
            <Ionicons name="close-circle" size={22} color={colors.textMuted} />
          </Pressable>
        </View>
      ))}

      {players.length < maxSize ? (
        <PlayerSearch
          onPick={(p) => onChange([...players, p])}
          excludeIds={[...excludeIds, ...players.map((p) => p.id)]}
          placeholder="Add player…"
        />
      ) : null}
    </View>
  );
}

function ScoreBox({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View style={{ flex: 1, gap: spacing.xs }}>
      <Text style={{ color: colors.textMuted, fontSize: 12 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={(t) => onChange(t.replace(/[^0-9]/g, ""))}
        keyboardType="number-pad"
        placeholder="0"
        placeholderTextColor={colors.textMuted}
        style={{
          height: 56,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.md,
          textAlign: "center",
          fontSize: 24,
          fontWeight: "700",
          color: colors.text,
          backgroundColor: colors.surface,
        }}
      />
    </View>
  );
}

const styles = {
  label: {
    fontSize: 13,
    fontWeight: "600" as const,
    color: colors.textSecondary,
    textTransform: "uppercase" as const,
  },
};
