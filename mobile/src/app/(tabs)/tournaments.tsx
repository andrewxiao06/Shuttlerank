import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { FlatList, Pressable, Text, View } from "react-native";
import { Card } from "../../../components/ui/Card";
import { Screen } from "../../../components/ui/Screen";
import { AsyncBoundary } from "../../../components/ui/AsyncBoundary";
import { RankedBadge, statusLabel } from "../../../components/tournament/TournamentBadge";
import { listTournaments } from "../../../lib/api/client";
import type { Tournament } from "../../../lib/api/types";
import { colors, radius, spacing } from "../../../lib/theme";

const STATUS_ORDER: Record<string, number> = {
  in_progress: 0,
  open: 1,
  draft: 2,
  completed: 3,
};

/*
 * Tournaments tab — browse all events. Tap one for detail (enter / withdraw,
 * organizer controls). Hosting a new tournament stays on the web for now.
 */
export default function Tournaments() {
  const router = useRouter();
  const q = useQuery({ queryKey: ["tournaments"], queryFn: listTournaments });

  const sorted = [...(q.data ?? [])].sort(
    (a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9),
  );

  return (
    <Screen padded={false}>
      <View
        style={{
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.lg,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <View>
          <Text style={{ fontSize: 28, fontWeight: "800", color: colors.text }}>
            Tournaments
          </Text>
          <Text style={{ color: colors.textSecondary }}>Browse and enter events</Text>
        </View>
        <Pressable
          onPress={() => router.push("/tournaments/new")}
          style={{
            backgroundColor: colors.primary,
            borderRadius: radius.md,
            paddingVertical: spacing.sm,
            paddingHorizontal: spacing.md,
          }}
        >
          <Text style={{ color: colors.onPrimary, fontWeight: "700" }}>Host</Text>
        </Pressable>
      </View>

      <AsyncBoundary
        isPending={q.isPending}
        isError={q.isError}
        error={q.error}
        errorPrefix="Couldn't load tournaments."
      >
        <FlatList
          data={sorted}
          keyExtractor={(t) => String(t.id)}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
          ListEmptyComponent={
            <Text style={{ color: colors.textMuted, textAlign: "center", marginTop: spacing.xl }}>
              No tournaments yet.
            </Text>
          }
          renderItem={({ item }) => (
            <Pressable onPress={() => router.push(`/tournaments/${item.id}`)}>
              <Row t={item} />
            </Pressable>
          )}
        />
      </AsyncBoundary>
    </Screen>
  );
}

function Row({ t }: { t: Tournament }) {
  const entrants = t.entries.filter((e) => !e.withdrawn).length;
  return (
    <Card style={{ flexDirection: "row", alignItems: "center" }}>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Text style={{ fontSize: 16, fontWeight: "700", color: colors.text }}>
            {t.name}
          </Text>
          <RankedBadge ranked={t.ranked} />
        </View>
        <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
          {t.format.replace("_", "-")} · {new Date(t.starts_at).toLocaleDateString()} ·{" "}
          {statusLabel(t.status)}
        </Text>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={{ fontSize: 18, fontWeight: "700", color: colors.text }}>
          {entrants}
        </Text>
        <Text style={{ color: colors.textMuted, fontSize: 11 }}>entrants</Text>
      </View>
    </Card>
  );
}
