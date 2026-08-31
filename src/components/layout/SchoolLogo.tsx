"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => Array.from(part)[0]).join("").toLocaleUpperCase() || "•";
}

export function SchoolLogo({
  src,
  name,
  className,
}: {
  src?: string | null;
  name: string;
  className?: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = Boolean(src && failedSrc !== src);

  return (
    <div
      data-school-logo-state={showImage ? "image" : "fallback"}
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden bg-gray-100 text-sm font-bold text-gray-600 dark:bg-white/10 dark:text-white/80",
        className
      )}
    >
      {showImage ? (
        <img
          src={src!}
          alt={name}
          className="h-full w-full object-contain"
          onError={() => setFailedSrc(src!)}
        />
      ) : (
        <span aria-label={name} role="img">{initials(name)}</span>
      )}
    </div>
  );
}
