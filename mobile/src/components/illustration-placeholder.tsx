import { StyleSheet, View } from "react-native";

import { Text, useLanguage } from "@/language";
import { colors, radius, spacing } from "@/theme";

export function IllustrationPlaceholder({ compact = false, label = "مكان رسم توضيحي" }: {
  compact?: boolean;
  label?: string;
}) {
  const { t } = useLanguage();
  return (
    <View
      accessibilityLabel={t(label)}
      style={[styles.frame, compact && styles.frameCompact]}
    >
      <View pointerEvents="none" style={styles.orbOne} />
      <View pointerEvents="none" style={styles.orbTwo} />
      <View pointerEvents="none" style={styles.orbThree} />
      <View style={[styles.picture, compact && styles.pictureCompact]}>
        <Text style={[styles.pictureIcon, compact && styles.pictureIconCompact]}>◇</Text>
      </View>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    minHeight: 210,
    alignSelf: "stretch",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderRadius: radius.xl,
    backgroundColor: colors.primarySoft,
  },
  frameCompact: { minHeight: 128 },
  orbOne: {
    position: "absolute",
    width: 154,
    height: 154,
    top: -60,
    right: -24,
    borderRadius: 77,
    backgroundColor: colors.lavender,
  },
  orbTwo: {
    position: "absolute",
    width: 126,
    height: 126,
    bottom: -55,
    left: -20,
    borderRadius: 63,
    backgroundColor: colors.accentSoft,
  },
  orbThree: {
    position: "absolute",
    width: 24,
    height: 24,
    top: 36,
    left: "24%",
    borderRadius: 12,
    backgroundColor: colors.accent,
    opacity: 0.55,
  },
  picture: {
    width: 86,
    height: 86,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 28,
    borderWidth: 2,
    borderColor: colors.lilac,
    borderStyle: "dashed",
    backgroundColor: "rgba(255,255,255,0.72)",
  },
  pictureCompact: { width: 64, height: 64, borderRadius: 22 },
  pictureIcon: { color: colors.primary, fontSize: 42, fontWeight: "900" },
  pictureIconCompact: { fontSize: 30 },
  label: { color: colors.primaryMuted, fontSize: 12, fontWeight: "700" },
});
