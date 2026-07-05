import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { AsyncBoundary } from "../../../components/ui/AsyncBoundary";
import {
  completeTournament,
  enterTournament,
  generatePairings,
  getMe,
  getPlayer,
  getTournament,
  withdrawFromTournament,
} from "../../../lib/api/client";
import type { Tournament } from "../../../lib/api/types";
import { colors, spacing } from "../../../lib/theme";
import { RankedBadge, statusLabel } from "../../../components/tournament/TournamentBadge";

/*
 * Tournament detail — meta, entrants, and actions. Players enter/withdraw
 * while registration is open; the organizer can generate pairings and
 * complete the event.
 */
export default function TournamentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const tid = Number(id);
  const qc = useQueryClient();

  const q = useQuery({ queryKey: ["tournament", tid], queryFn: () => getTournament(tid) });
  const meQ = useQuery({ queryKey: ["me"], queryFn: getMe });

  const ids = Array.from(new Set((q.data?.entries ?? []).map((e) => e.player_id)));
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

  const refresh = () => qc.invalidateQueries({ queryKey: ["tournament", tid] });

  const enter = useMutation({ mutationFn: () => enterTournament(tid), onSuccess: refresh });
  const withdraw = useMutation({ mutationFn: () => withdrawFromTournament(tid), onSuccess: refresh });
  const pair = useMutation({ mutationFn: () => generatePairings(tid), onSuccess: refresh });
  const complete = useMutation({ mutationFn: () => completeTournament(tid), onSuccess: refresh });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={["bottom"]}>
      <AsyncBoundary
        isPending={q.isPending}
        isError={q.isError}
        error={q.error}
        errorPrefix="Couldn't load this tournament."
      >
        {q.data ? (
          <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
            <Body
              t={q.data}
              myId={meQ.data?.id}
              myClerkId={meQ.data?.clerk_user_id ?? null}
              nameOf={nameOf}
              enter={enter}
              withdraw={withdraw}
              pair={pair}
              complete={complete}
            />
          </ScrollView>
        ) : null}
      </AsyncBoundary>
    </SafeAreaView>
  );
}

type Mut = { mutate: () => void; isPending: boolean; error: unknown; isError: boolean };

function Body({
  t,
  myId,
  myClerkId,
  nameOf,
  enter,
  withdraw,
  pair,
  complete,
}: {
  t: Tournament;
  myId?: number;
  myClerkId: string | null;
  nameOf: (id: number) => string;
  enter: Mut;
  withdraw: Mut;
  pair: Mut;
  complete: Mut;
}) {
  const active = t.entries.filter((e) => !e.withdrawn);
  const myEntry = myId != null && active.some((e) => e.player_id === myId);
  const isOrganizer = myClerkId != null && t.organizer_user_id === myClerkId;
  const registrationOpen = t.status === "open" || t.status === "draft";

  const anyError =
    (enter.isError && enter.error) ||
    (withdraw.isError && withdraw.error) ||
    (pair.isError && pair.error) ||
    (complete.isError && complete.error);

  return (
    <>
      {/* Header */}
      <View style={{ gap: spacing.xs }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
            {t.format.replace("_", "-")}
          </Text>
          <RankedBadge ranked={t.ranked} />
        </View>
        <Text style={{ fontSize: 26, fontWeight: "800", color: colors.text }}>{t.name}</Text>
        <Text style={{ color: colors.textSecondary }}>
          {new Date(t.starts_at).toLocaleString()} · {statusLabel(t.status)}
        </Text>
      </View>

      {/* Player actions */}
      {registrationOpen ? (
        <Card style={{ gap: spacing.sm }}>
          <Text style={{ color: colors.text }}>
            {active.length} entrant{active.length === 1 ? "" : "s"}
          </Text>
          {myEntry ? (
            <Button
              label="Withdraw"
              variant="outline"
              onPress={() => withdraw.mutate()}
              loading={withdraw.isPending}
            />
          ) : (
            <Button label="Sign up" onPress={() => enter.mutate()} loading={enter.isPending} />
          )}
        </Card>
      ) : null}

      {/* Organizer controls */}
      {isOrganizer ? (
        <Card style={{ gap: spacing.sm }}>
          <Text style={{ color: colors.text, fontWeight: "700" }}>Organizer controls</Text>
          <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
            {t.ranked
              ? "Completing raises entrants' rating ceilings."
              : "Casual event — completing doesn't change ceilings."}
          </Text>
          <Button
            label="Generate pairings"
            onPress={() => pair.mutate()}
            loading={pair.isPending}
            disabled={t.status === "completed"}
          />
          <Button
            label="Mark complete"
            variant="outline"
            onPress={() => complete.mutate()}
            loading={complete.isPending}
            disabled={t.status === "completed"}
          />
        </Card>
      ) : null}

      {anyError ? (
        <Text style={{ color: colors.danger }}>{(anyError as Error).message}</Text>
      ) : null}

      {/* Entrants */}
      <View style={{ gap: spacing.sm }}>
        <Text style={{ fontSize: 18, fontWeight: "700", color: colors.text }}>Entrants</Text>
        {active.length === 0 ? (
          <Text style={{ color: colors.textMuted }}>No one has signed up yet.</Text>
        ) : (
          active.map((e) => (
            <Card key={e.id} style={{ padding: spacing.md }}>
              <Text style={{ color: colors.text }}>{nameOf(e.player_id)}</Text>
            </Card>
          ))
        )}
      </View>
    </>
  );
}
