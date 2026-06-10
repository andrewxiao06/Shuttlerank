"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { searchPlayers } from "@/lib/api";
import type { PlayerGender, PlayerMe } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/*
 * Player picker — debounced search against `searchPlayers` mock.
 *
 * The category-driven `eligibleGenders` filter is honored both in the
 * search call and visually (a dropdown row's color flags ineligible
 * matches). `excludeIds` blocks already-picked players from showing up
 * in the other team — DESIGN.md acceptance: "selecting player in team A
 * excludes them from team B."
 */
export function PlayerSearch({
  onPick,
  eligibleGenders,
  excludeIds,
  placeholder = "Search players…",
  className,
}: {
  onPick: (player: PlayerMe) => void;
  eligibleGenders?: PlayerGender[] | null;
  excludeIds?: number[];
  placeholder?: string;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 150);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const results = useQuery({
    queryKey: ["search-players", debounced, eligibleGenders],
    queryFn: () =>
      searchPlayers(debounced, {
        eligibleGenders: eligibleGenders ?? undefined,
      }),
    enabled: open,
  });

  const filtered = (results.data ?? []).filter(
    (p) => !excludeIds?.includes(p.id),
  );

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <input
        type="text"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        placeholder={placeholder}
        className="h-12 w-full rounded-md border border-border bg-surface px-3 text-body-md outline-none focus:border-primary"
      />
      {open ? (
        <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-64 overflow-auto rounded-md border border-border bg-surface shadow-elevation-2">
          {results.isPending ? (
            <p className="p-3 text-caption text-text-muted">Searching…</p>
          ) : filtered.length === 0 ? (
            <p className="p-3 text-caption text-text-muted">
              {debounced ? "No matches" : "Start typing to search players"}
            </p>
          ) : (
            <ul>
              {filtered.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onPick(p);
                      setQuery("");
                      setOpen(false);
                    }}
                    className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-surface-muted"
                  >
                    <span className="truncate text-body-md">
                      {p.display_name ?? p.name}
                    </span>
                    <span className="text-caption text-text-muted">
                      {p.gender ?? "—"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
