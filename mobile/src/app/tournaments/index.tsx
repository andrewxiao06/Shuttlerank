import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { FlatList, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Card } from "../../../components/ui/Card";
import { AsyncBoundary } from "../../../components/ui/AsyncBoundary";
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
 * Tournaments — browse all events. Tap one for detail (enter / withdraw,
 * organizer controls). Hosting a new tournament stays on the web for now.
 */
export default function Tournaments() {
  const router = useRouter();
  const q = useQuery({ queryKey: ["tournaments"], queryFn: listTournaments });

  const sorted = [...(q.data ?? [])].sort(
    (a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9),
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={["bottom"]}>
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
    </SafeAreaView>
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

export function RankedBadge({ ranked }: { ranked: boolean }) {
  return (
    <View
      style={{
        borderRadius: radius.pill,
        paddingHorizontal: spacing.sm,
        paddingVertical: 2,
        backgroundColor: ranked ? colors.accentSoft : colors.surfaceMuted,
      }}
    >
      <Text style={{ fontSize: 10, fontWeight: "700", color: ranked ? colors.accent : colors.textSecondary }}>
        {ranked ? "RANKED" : "CASUAL"}
      </Text>
    </View>
  );
}

export function statusLabel(s: string): string {
  return (
    { draft: "Draft", open: "Open", in_progress: "In progress", completed: "Completed" }[s] ?? s
  );
}
