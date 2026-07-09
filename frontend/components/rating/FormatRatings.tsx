import { type CategoryRating } from "@/lib/api/types";
import { orderedByPlay } from "@/lib/ratings";
import { TierChip } from "./TierChip";
import { CalibrationDot } from "./CalibrationDot";
import { CeilingBar } from "./CeilingBar";
import { formatRating } from "@/lib/format";
import { isCalibrating } from "@/lib/tier";

/*
 * Stacked ratings — the format the player plays most leads (big), with the
 * other tucked underneath as a compact line. `ceiling` shows the cap bar on
 * the primary (profile/me); Home omits it for a tighter hero.
 */
export function FormatRatings({
  ratings,
  ceiling = false,
}: {
  ratings: CategoryRating[];
  ceiling?: boolean;
}) {
  const [primary, secondary] = orderedByPlay(ratings);
  const p = primary.rating;
  const pPlayed = (p?.match_count ?? 0) > 0;

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-label uppercase text-text-secondary">{primary.label}</p>
        {p && isCalibrating(p.rd) ? (
          <span
            className="flex items-center gap-1.5 text-caption text-warning"
            title="This rating is still settling — it can move a lot until you've played more."
          >
            <CalibrationDot show />
            Calibrating
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-display-lg sm:text-display-xl">
        {p && pPlayed ? formatRating(p.display) : "—"}
      </p>
      {p ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <TierChip rating={p.display} />
          <span className="text-caption text-text-muted">
            {pPlayed
              ? `${p.match_count} match${p.match_count === 1 ? "" : "es"}`
              : "Not yet played"}
          </span>
        </div>
      ) : null}
      {ceiling && p ? (
        <div className="mt-3">
          <CeilingBar display={p.display} ceiling={p.ceiling} />
          <p className="mt-1 text-caption text-text-muted">
            Rating cap {formatRating(p.ceiling)}
          </p>
        </div>
      ) : null}

      <SecondaryLine label={secondary.label} rating={secondary.rating} />
    </div>
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
    <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
      <div className="flex items-center gap-2">
        <span className="text-label uppercase text-text-secondary">{label}</span>
        {rating ? <TierChip rating={rating.display} /> : null}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-numeral-md">
          {rating && played ? formatRating(rating.display) : "—"}
        </span>
        <span className="text-caption text-text-muted">
          {played
            ? `${rating!.match_count} match${rating!.match_count === 1 ? "" : "es"}`
            : "Not yet played"}
        </span>
      </div>
    </div>
  );
}
