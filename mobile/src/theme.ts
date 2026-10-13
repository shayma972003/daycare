export const colors = {
  background: "#F7F5FC",
  surface: "#FFFFFF",
  primary: "#5B21D0",
  primaryDark: "#351078",
  primaryMuted: "#7950D7",
  primarySoft: "#F0E9FF",
  lavender: "#E1D4FF",
  lilac: "#A987F4",
  accent: "#2CC6B7",
  accentSoft: "#E6FAF7",
  text: "#211936",
  muted: "#7B748A",
  border: "#E9E4F2",
  borderStrong: "#D8CDEB",
  danger: "#B42318",
  dangerSoft: "#FEF3F2",
  warning: "#9A6700",
  warningSoft: "#FFF8E1",
  success: "#067647",
  successSoft: "#ECFDF3",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radius = {
  sm: 10,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const shadow = {
  card: {
    shadowColor: "#2F1B5B",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 3,
  },
} as const;

export const touchTarget = 48;
