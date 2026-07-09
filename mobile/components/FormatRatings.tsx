import { Text, View } from "react-native";
import { formatRating, tierLabel, isCalibrating } from "../lib/format";
import { orderedByPlay } from "../lib/ratings";
import type { CategoryRating } from "../lib/api/types";
import { colors, radius, spacing } from "../lib/theme";

/*
 * Stacked ratings — the format the player plays most leads (big number), with
 * the other tucked underneath as a compact line. Used on Home and Profile.
 */
export function FormatRatings({ ratings }: { ratings: CategoryRating[] }) {
  const [primary, secondary] = orderedByPlay(ratings);
  const p = primary.rating;
  const pPlayed = (p?.match_count ?? 0) > 0;

  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={{ color: colors.textSecondary, fontSize: 12, textTransform: "uppercase" }}>
        {primary.label}
      </Text>
      <Text style={{ fontSize: 52, fontWeight: "800", color: colors.text }}>
        {p && pPlayed ? formatRating(p.display) : "—"}
      </Text>
      {p ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Text style={{ color: colors.accent, fontWeight: "600" }}>
            {tierLabel(p.display)}
          </Text>
          <Text style={{ color: colors.textMuted }}>
            ·{" "}
            {pPlayed
              ? `${p.match_count} match${p.match_count === 1 ? "" : "es"}${
                  isCalibrating(p.rd) ? " · calibrating" : ""
                }`
              : "not yet played"}
          </Text>
        </View>
      ) : null}

      <SecondaryLine label={secondary.label} rating={secondary.rating} />
    </View>
  );
}

function SecondaryLine({
  label,
  rating,
}: {
  label: string;
  rating: CategoryRating | null;
}) {
  const played = (rating?.match_count ?? 0) > 0;
  return (
    <View
      style={{
        marginTop: spacing.xs,
        paddingTop: spacing.sm,
        borderTopWidth: 1,
        borderTopColor: colors.border,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Text style={{ color: colors.textSecondary, fontSize: 12, textTransform: "uppercase" }}>
          {label}
        </Text>
        {rating ? (
          <View
            style={{
              backgroundColor: colors.accentSoft,
              paddingHorizontal: spacing.sm,
              paddingVertical: 1,
              borderRadius: radius.pill,
            }}
          >
            <Text style={{ color: colors.accent, fontWeight: "600", fontSize: 11 }}>
              {tierLabel(rating.display)}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: spacing.sm }}>
        <Text style={{ fontSize: 18, fontWeight: "700", color: colors.text }}>
          {rating && played ? formatRating(rating.display) : "—"}
        </Text>
        <Text style={{ color: colors.textMuted, fontSize: 12 }}>
          {played
            ? `${rating!.match_count} match${rating!.match_count === 1 ? "" : "es"}`
            : "not yet played"}
        </Text>
      </View>
    </View>
  );
}
