"use client";

import { useState } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";

/*
 * Player avatar — shows the profile photo when present and loadable,
 * otherwise a monogram circle. Falls back to the monogram on image *load
 * error* too, so a stale/expired URL (e.g. an old Clerk image URL) degrades
 * to the initial instead of a broken-image icon.
 */
export function Avatar({
  src,
  name,
  size = 40,
  className,
}: {
  src?: string | null;
  name?: string | null;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const initial = (name ?? "?").trim().charAt(0).toUpperCase() || "?";
  const showImage = src && !failed;

  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden rounded-full bg-surface-muted",
        className,
      )}
      style={{ width: size, height: size }}
    >
      {showImage ? (
        <Image
          src={src}
          alt={name ?? "Player"}
          fill
          sizes={`${size}px`}
          unoptimized
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-text-secondary">
          <span style={{ fontSize: size * 0.42 }} className="font-semibold">
            {initial}
          </span>
        </div>
      )}
    </div>
  );
}
