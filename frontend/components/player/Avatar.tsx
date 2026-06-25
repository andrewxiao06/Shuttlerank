import Image from "next/image";
import { cn } from "@/lib/utils";

/*
 * Player avatar — shows the profile photo when present, otherwise a default
 * monogram/icon circle (the profile picture is optional, like DUPR).
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
  const initial = (name ?? "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden rounded-full bg-surface-muted",
        className,
      )}
      style={{ width: size, height: size }}
    >
      {src ? (
        // Remote avatars (Google/Clerk) — unoptimized to skip the Next image
        // allowlist; these are small and already CDN-hosted.
        <Image src={src} alt={name ?? "Player"} fill sizes={`${size}px`} unoptimized />
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
