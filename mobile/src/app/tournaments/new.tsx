import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Button } from "../../../components/ui/Button";
import { Screen } from "../../../components/ui/Screen";
import { createTournament, getMe } from "../../../lib/api/client";
import type { TournamentFormat } from "../../../lib/api/types";
import { colors, radius, spacing } from "../../../lib/theme";

/*
 * Host a tournament (mobile) — mirrors the web "Host a tournament" form so the
 * app has feature parity. Anyone can host a casual event; the Ranked toggle
 * only shows for admins (the backend enforces it regardless). Dates are typed
 * as YYYY-MM-DD to avoid pulling in a native date-picker dependency.
 */
const FORMATS: { value: TournamentFormat; label: string; hint: string }[] = [
  { value: "single_elim", label: "Single elimination", hint: "Lose once, you're out" },
  { value: "round_robin", label: "Round robin", hint: "Everyone plays everyone" },
  { value: "swiss", label: "Swiss", hint: "Paired by record each round" },
];

// "2026-07-20" → Date at local `hour`:`minute`. Returns null if malformed so
// the form can block submission.
function parseDate(s: string, hour: number, minute: number): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const [, y, mo, d] = m.map(Number);
  const dt = new Date(y, mo - 1, d, hour, minute);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export default function NewTournament() {
  const router = useRouter();
  const qc = useQueryClient();
  const meQ = useQuery({ queryKey: ["me"], queryFn: getMe });
  const isAdmin = meQ.data?.is_admin ?? false;

  const [name, setName] = useState("");
  const [format, setFormat] = useState<TournamentFormat | null>(null);
  const [ranked, setRanked] = useState(false);
  const [startsAt, setStartsAt] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [minRating, setMinRating] = useState("");
  const [maxRating, setMaxRating] = useState("");

  const startsDate = parseDate(startsAt, 12, 0);
  const closesDate = closesAt === "" ? null : parseDate(closesAt, 23, 59);
  const closesInvalid = closesAt !== "" && closesDate === null;

  const minNum = minRating === "" ? null : Number(minRating);
  const maxNum = maxRating === "" ? null : Number(maxRating);
  const rangeInvalid = minNum != null && maxNum != null && minNum > maxNum;

  const ready =
    name.trim().length > 0 &&
    format != null &&
    startsDate != null &&
    !closesInvalid &&
    !rangeInvalid;

  const submit = useMutation({
    mutationFn: () =>
      createTournament({
        name: name.trim(),
        format: format!,
        ranked: isAdmin && ranked,
        starts_at: startsDate!.toISOString(),
        registration_closes_at: closesDate ? closesDate.toISOString() : null,
        min_rating: minNum,
        max_rating: maxNum,
      }),
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: ["tournaments"] });
      router.replace(`/tournaments/${t.id}`);
    },
  });

  return (
    <Screen scroll>
      <Text style={{ fontSize: 28, fontWeight: "800", color: colors.text }}>
        Host a tournament
      </Text>
      <Text style={{ color: colors.textSecondary }}>
        Anyone can host a casual tournament.
      </Text>

      <Field label="Name">
        <TextInput
          value={name}
          onChangeText={(v) => setName(v.slice(0, 200))}
          placeholder="e.g. Friday Night Smash"
          placeholderTextColor={colors.textMuted}
          style={inputStyle}
        />
      </Field>

      <Field label="Format">
        <View style={{ gap: spacing.sm }}>
          {FORMATS.map((f) => {
            const active = format === f.value;
            return (
              <Pressable
                key={f.value}
                onPress={() => setFormat(f.value)}
                style={{
                  borderWidth: 1,
                  borderColor: active ? colors.primary : colors.border,
                  backgroundColor: active ? colors.accentSoft : colors.surface,
                  borderRadius: radius.md,
                  padding: spacing.md,
                }}
              >
                <Text style={{ color: colors.text, fontWeight: "600" }}>{f.label}</Text>
                <Text style={{ color: colors.textMuted, fontSize: 12 }}>{f.hint}</Text>
              </Pressable>
            );
          })}
        </View>
      </Field>

      <Field label="Starts (YYYY-MM-DD)">
        <TextInput
          value={startsAt}
          onChangeText={setStartsAt}
          placeholder="2026-07-20"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          style={inputStyle}
        />
      </Field>

      <Field label="Registration closes (YYYY-MM-DD, optional)">
        <TextInput
          value={closesAt}
          onChangeText={setClosesAt}
          placeholder="Leave blank to stay open"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          style={inputStyle}
        />
        {closesInvalid ? (
          <Text style={{ color: colors.danger, fontSize: 12 }}>Use YYYY-MM-DD.</Text>
        ) : (
          <Text style={{ color: colors.textMuted, fontSize: 12 }}>
            Sign-ups auto-close at the end of this day.
          </Text>
        )}
      </Field>

      <Field label="Rating range (1.0–5.0, optional)">
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <TextInput
            value={minRating}
            onChangeText={(v) => setMinRating(v.replace(/[^0-9.]/g, ""))}
            keyboardType="decimal-pad"
            placeholder="Min"
            placeholderTextColor={colors.textMuted}
            style={[inputStyle, { flex: 1, textAlign: "center" }]}
          />
          <Text style={{ color: colors.textMuted }}>to</Text>
          <TextInput
            value={maxRating}
            onChangeText={(v) => setMaxRating(v.replace(/[^0-9.]/g, ""))}
            keyboardType="decimal-pad"
            placeholder="Max"
            placeholderTextColor={colors.textMuted}
            style={[inputStyle, { flex: 1, textAlign: "center" }]}
          />
        </View>
        {rangeInvalid ? (
          <Text style={{ color: colors.danger, fontSize: 12 }}>
            Min can&apos;t be higher than max.
          </Text>
        ) : null}
      </Field>

      {isAdmin ? (
        <Pressable
          onPress={() => setRanked((r) => !r)}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.sm,
            borderWidth: 1,
            borderColor: ranked ? colors.primary : colors.border,
            backgroundColor: ranked ? colors.accentSoft : colors.surface,
            borderRadius: radius.md,
            padding: spacing.md,
          }}
        >
          <View
            style={{
              width: 20,
              height: 20,
              borderRadius: 4,
              borderWidth: 2,
              borderColor: ranked ? colors.primary : colors.border,
              backgroundColor: ranked ? colors.primary : "transparent",
            }}
          />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text }}>Ranked tournament</Text>
            <Text style={{ color: colors.textMuted, fontSize: 12 }}>
              Full rating weight; raises entrants&apos; ceilings. Admin only.
            </Text>
          </View>
        </Pressable>
      ) : (
        <Text style={{ color: colors.textMuted, fontSize: 12 }}>
          This will be a casual tournament. Ranked events are created by admins.
        </Text>
      )}

      {submit.isError ? (
        <Text style={{ color: colors.danger }}>
          Couldn&apos;t create: {(submit.error as Error).message}
        </Text>
      ) : null}

      <Button
        label={submit.isPending ? "Creating…" : "Create tournament"}
        onPress={() => submit.mutate()}
        disabled={!ready}
        loading={submit.isPending}
      />
    </Screen>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={{ color: colors.textSecondary, fontSize: 13, textTransform: "uppercase" }}>
        {label}
      </Text>
      {children}
    </View>
  );
}

const inputStyle = {
  height: 52,
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: radius.md,
  paddingHorizontal: spacing.md,
  fontSize: 16,
  color: colors.text,
  backgroundColor: colors.surface,
} as const;
