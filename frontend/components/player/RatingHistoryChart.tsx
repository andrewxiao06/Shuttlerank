"use client";

import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CategoryMatch } from "@/lib/api/types";

/*
 * Rating history — derives a point per match from the viewer's
 * `post_r`. Only verified matches contribute; pending ones are noise.
 *
 * PLAN.md debug hook: "Chart shows wrong line → filter by category before
 * charting." That filtering happens in the calling page; this component
 * trusts what it's handed.
 */
export function RatingHistoryChart({
  matches,
  viewerId,
}: {
  matches: CategoryMatch[];
  viewerId: number;
}) {
  const points = matches
    .filter((m) => m.status === "verified")
    .slice()
    .sort((a, b) => a.played_at.localeCompare(b.played_at))
    .slice(-30)
    .map((m) => {
      const me = m.participants.find((p) => p.player_id === viewerId);
      return {
        date: m.played_at,
        rating: me?.post_r ?? null,
      };
    })
    .filter((p): p is { date: string; rating: number } => p.rating != null);

  if (points.length < 2) {
    return (
      <div className="flex h-44 items-center justify-center rounded-lg border border-dashed border-border bg-surface-muted/40 text-caption text-text-muted">
        Play a few more matches to see your trend
      </div>
    );
  }

  const min = Math.min(...points.map((p) => p.rating));
  const max = Math.max(...points.map((p) => p.rating));
  const pad = Math.max(0.05, (max - min) * 0.2);

  return (
    <div className="h-44 w-full">
      <ResponsiveContainer>
        <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <XAxis
            dataKey="date"
            tickFormatter={(d: string) =>
              new Date(d).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })
            }
            tick={{ fontSize: 11, fill: "var(--dubr-text-muted)" }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            domain={[min - pad, max + pad]}
            tick={{ fontSize: 11, fill: "var(--dubr-text-muted)" }}
            tickFormatter={(v: number) => v.toFixed(2)}
            tickLine={false}
            axisLine={false}
            width={42}
          />
          <Tooltip
            contentStyle={{
              border: "1px solid var(--dubr-border)",
              borderRadius: 10,
              fontSize: 12,
              background: "var(--dubr-surface)",
            }}
            labelFormatter={(d) => new Date(String(d)).toDateString()}
            formatter={(v) => [Number(v).toFixed(3), "Rating"]}
          />
          <Line
            type="monotone"
            dataKey="rating"
            stroke="var(--dubr-primary)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: "var(--dubr-primary)" }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
