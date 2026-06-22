import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { FlatList, Text, View } from "react-native";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { Screen } from "../../../components/ui/Screen";
import { AsyncBoundary } from "../../../components/ui/AsyncBoundary";
import {
  getPlayer,
  listPendingForMe,
  validateMatch,
} from "../../../lib/api/client";
import type { CategoryMatch } from "../../../lib/api/types";
import { colors, spacing } from "../../../lib/theme";

/*
 * Inbox — pending matches awaiting your approval. Approve moves the match
 * toward verified (ratings apply once everyone approves); dispute marks it
 * disputed. Both call validateMatch then refresh the list.
 */
export default function Inbox() {
  const q = useQuery({ queryKey: ["pending"], queryFn: listPendingForMe });

  // Collect every participant id across all pending matches, then look up
  // their names once (in parallel) so cards can show real names, not #ids.
  const pending = q.data ?? [];
  const ids = Array.from(
    new Set(pending.flatMap((m) => m.participants.map((p) => p.player_id))),
  );
  const playerQueries = useQueries({
    queries: ids.map((id) => ({
      queryKey: ["player", id],
      queryFn: () => getPlayer(id),
      enabled: q.isSuccess,
    })),
  });
  const nameOf = (id: number) => {
    const p = playerQueries.find((pq) => pq.data?.id === id)?.data;
    return p?.display_name ?? p?.name ?? `Player #${id}`;
  };

  return (
    <Screen padded={false}>
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}>
        <Text style={{ fontSize: 28, fontWeight: "800", color: colors.text }}>
          Inbox
        </Text>
        <Text style={{ color: colors.textSecondary }}>
          Matches waiting for your approval
        </Text>
      </View>

      <AsyncBoundary
        isPending={q.isPending}
        isError={q.isError}
        error={q.error}
        errorPrefix="Couldn't load your inbox."
      >
        <FlatList
          data={pending}
          keyExtractor={(m) => String(m.id)}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
          ListEmptyComponent={
            <Text
              style={{
                color: colors.textMuted,
                textAlign: "center",
                marginTop: spacing.xl,
              }}
            >
              All caught up — nothing to approve.
            </Text>
          }
          renderItem={({ item }) => (
            <PendingCard match={item} nameOf={nameOf} />
          )}
        />
      </AsyncBoundary>
    </Screen>
  );
}

function PendingCard({
  match,
  nameOf,
}: {
  match: CategoryMatch;
  nameOf: (id: number) => string;
}) {
  const qc = useQueryClient();

  const act = useMutation({
    mutationFn: (action: "approved" | "disputed") =>
      validateMatch(match.id, { action }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pending"] });
      qc.invalidateQueries({ queryKey: ["leaderboard"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });

  const teamA = match.participants.filter((p) => p.team === "A");
  const teamB = match.participants.filter((p) => p.team === "B");
  const isDoubles = match.participants.length > 2;

  return (
    <Card style={{ gap: spacing.md }}>
      <Text style={{ color: colors.textMuted, fontSize: 12 }}>
        {isDoubles ? "Doubles" : "Singles"} · {match.played_at}
      </Text>

      {/* Scoreboard */}
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Text style={{ flex: 1, color: colors.text }}>
          {teamA.map((p) => nameOf(p.player_id)).join(" & ")}
        </Text>
        <Text style={{ fontSize: 22, fontWeight: "800", color: colors.text }}>
          {match.team_a_score} – {match.team_b_score}
        </Text>
        <Text style={{ flex: 1, textAlign: "right", color: colors.text }}>
          {teamB.map((p) => nameOf(p.player_id)).join(" & ")}
        </Text>
      </View>

      {act.isError ? (
        <Text style={{ color: colors.danger }}>
          {(act.error as Error).message}
        </Text>
      ) : null}

      {/* Actions */}
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Button
            label="Dispute"
            variant="danger"
            onPress={() => act.mutate("disputed")}
            loading={act.isPending && act.variables === "disputed"}
            disabled={act.isPending}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            label="Approve"
            onPress={() => act.mutate("approved")}
            loading={act.isPending && act.variables === "approved"}
            disabled={act.isPending}
          />
        </View>
      </View>
    </Card>
  );
}
