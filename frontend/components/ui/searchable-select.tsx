"use client";

import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface SearchableOption<V extends string> {
  value: V;
  label: string;
  hint?: string;
}

/*
 * SearchableSelect — the app-wide dropdown. A button that opens a panel
 * with a type-to-filter input and the option list; matches the form-field
 * styling used by PlayerSearch. Every dropdown in the app should use this
 * instead of a native <select> so option lists stay filterable as they grow.
 */
export function SearchableSelect<V extends string>({
  value,
  options,
  onChange,
  placeholder = "Select…",
  className,
}: {
  value: V | null;
  options: SearchableOption<V>[];
  onChange: (value: V) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  const selected = options.find((o) => o.value === value) ?? null;
  const q = query.trim().toLowerCase();
  const filtered = options.filter(
    (o) =>
      !q ||
      o.label.toLowerCase().includes(q) ||
      (o.hint ?? "").toLowerCase().includes(q),
  );

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  // Focus the filter input when the panel opens.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const toggleOpen = () => {
    setOpen((o) => {
      if (!o) {
        setQuery("");
        setHighlight(0);
      }
      return !o;
    });
  };

  const pick = (v: V) => {
    onChange(v);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opt = filtered[highlight];
      if (opt) pick(opt.value);
    }
  };

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={toggleOpen}
        className="flex h-12 w-full items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 text-left text-body-md outline-none focus:border-primary"
      >
        <span className={cn("truncate", !selected && "text-text-muted")}>
          {selected?.label ?? placeholder}
        </span>
        <span aria-hidden className="text-text-muted">
          ▾
        </span>
      </button>

      {open ? (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-border bg-surface shadow-elevation-2">
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded
            aria-controls={listboxId}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlight(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Type to filter…"
            className="block h-11 w-full border-b border-border bg-surface px-3 text-body-md outline-none"
          />
          <ul id={listboxId} role="listbox" className="max-h-64 overflow-y-auto">
            {filtered.length === 0 ? (
              <li className="px-3 py-3 text-caption text-text-muted">
                No options match &ldquo;{query}&rdquo;
              </li>
            ) : (
              filtered.map((o, i) => (
                <li key={o.value} role="option" aria-selected={o.value === value}>
                  <button
                    type="button"
                    onClick={() => pick(o.value)}
                    onMouseEnter={() => setHighlight(i)}
                    className={cn(
                      "flex min-h-11 w-full flex-col justify-center px-3 py-2 text-left",
                      i === highlight && "bg-surface-muted",
                      o.value === value && "font-medium",
                    )}
                  >
                    <span className="text-body-md">{o.label}</span>
                    {o.hint ? (
                      <span className="text-caption text-text-muted">
                        {o.hint}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
