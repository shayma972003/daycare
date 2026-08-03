/**
 * The product's icon set (task 2.40).
 *
 * Inline SVG, not emoji. Emoji are rendered by the operating system, so the same
 * glyph is a different picture on iOS, Android and Windows — and several of the
 * ones this product used (🚼, 💊, 📦) render as flat monochrome boxes on older
 * Android, which is most of the phones a Saudi nursery's staff actually carry.
 * They also cannot take a colour, so a "type" tile could not indicate state.
 *
 * Not an icon library either: this is nineteen glyphs, and a dependency would
 * ship several hundred kilobytes to deliver them plus a tree-shaking
 * configuration to avoid it.
 *
 * Every path is drawn on a 24×24 grid with `currentColor` and a 1.75 stroke, so
 * an icon inherits the text colour around it and sits on the same optical weight
 * as the type beside it.
 */

export type IconName =
  // Daily care report types
  | "meal"
  | "nap"
  | "toilet"
  | "mood"
  | "medication"
  | "health"
  | "supplies"
  | "note"
  // General
  | "calendar"
  | "clock"
  | "users"
  | "user"
  | "book"
  | "chart"
  | "settings"
  | "storage"
  | "bell"
  | "check"
  | "alert";

/**
 * Path data only — the wrapper below supplies size, stroke and colour, so a new
 * icon cannot arrive with its own idea of how thick a line should be.
 */
const PATHS: Record<IconName, React.ReactNode> = {
  meal: (
    <>
      <path d="M4 3v7a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2V3" />
      <path d="M6 12v9" />
      <path d="M4 3v4M8 3v4" />
      <path d="M17 3c-1.5 1.5-2 3.5-2 5.5S15.5 12 17 13v8" />
      <path d="M20 3c1.5 1.5 2 3.5 2 5.5S21.5 12 20 13" />
    </>
  ),
  nap: (
    <>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </>
  ),
  toilet: (
    <>
      <path d="M6 3h8a2 2 0 0 1 2 2v6H6z" />
      <path d="M6 11v3a4 4 0 0 0 4 4h2v3" />
      <path d="M18 5h1a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-1" />
    </>
  ),
  mood: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" />
      <path d="M9 9.5h.01M15 9.5h.01" />
    </>
  ),
  medication: (
    <>
      <rect x="2.5" y="9" width="19" height="6" rx="3" transform="rotate(-45 12 12)" />
      <path d="M8.5 8.5l7 7" />
    </>
  ),
  health: (
    <>
      <path d="M20.8 8.6a5.5 5.5 0 0 0-9.3-3 5.5 5.5 0 0 0-9.3 3c0 5.4 9.3 11.4 9.3 11.4s9.3-6 9.3-11.4z" />
    </>
  ),
  supplies: (
    <>
      <path d="M21 8l-9-5-9 5 9 5 9-5z" />
      <path d="M3 8v8l9 5 9-5V8" />
      <path d="M12 13v8" />
    </>
  ),
  note: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  users: (
    <>
      <path d="M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20" />
      <circle cx="9" cy="7" r="3.5" />
      <path d="M22 20v-1.5a4 4 0 0 0-3-3.9" />
      <path d="M16 3.6a4 4 0 0 1 0 7" />
    </>
  ),
  user: (
    <>
      <path d="M19 20v-1.5a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4V20" />
      <circle cx="12" cy="7" r="3.5" />
    </>
  ),
  book: (
    <>
      <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5A2.5 2.5 0 0 0 4 22z" />
      <path d="M4 17h16" />
    </>
  ),
  chart: (
    <>
      <path d="M3 3v18h18" />
      <path d="M7 15l3.5-4 3 3L20 7" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
    </>
  ),
  storage: (
    <>
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v6c0 1.7 4 3 9 3s9-1.3 9-3V5" />
      <path d="M3 11v6c0 1.7 4 3 9 3s9-1.3 9-3v-6" />
    </>
  ),
  bell: (
    <>
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </>
  ),
  check: <path d="M20 6L9 17l-5-5" />,
  alert: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v6M12 16.5h.01" />
    </>
  ),
};

export interface IconProps {
  name: IconName;
  /** Pixel size. 20 suits inline text, 28–32 a tile. */
  size?: number;
  className?: string;
  /**
   * Accessible label. Omit for decorative icons — an icon beside its own text
   * label read aloud twice is worse than one not read at all.
   */
  title?: string;
}

export function Icon({ name, size = 20, className = "", title }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

/** Care report type → icon, replacing the emoji map. */
export const CARE_TYPE_ICON_NAMES = {
  MEAL: "meal",
  NAP: "nap",
  TOILET: "toilet",
  MOOD: "mood",
  MEDICATION: "medication",
  HEALTH: "health",
  SUPPLIES: "supplies",
  GENERAL: "note",
} as const satisfies Record<string, IconName>;
