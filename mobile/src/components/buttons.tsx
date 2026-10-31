import { ActivityIndicator, Pressable, StyleSheet } from "react-native";

import { Text, useLanguage } from "@/language";
import { colors, shadow, spacing, touchTarget } from "@/theme";

type PrimaryButtonProps = {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
};

export function PrimaryButton({ label, onPress, loading = false, disabled = false }: PrimaryButtonProps) {
  const { t } = useLanguage();
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(label)}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [styles.primary, inactive && styles.disabled, pressed && styles.pressed]}
    >
      {loading ? <ActivityIndicator color={colors.surface} /> : <Text style={styles.primaryText}>{label}</Text>}
    </Pressable>
  );
}

export function TextButton({ label, onPress }: { label: string; onPress: () => void }) {
  const { t } = useLanguage();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(label)}
      onPress={onPress}
      style={({ pressed }) => [styles.textButton, pressed && styles.pressed]}
    >
      <Text style={styles.textButtonLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  primary: {
    ...shadow.card,
    minHeight: touchTarget + 8,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  primaryText: {
    color: colors.surface,
    fontSize: 16,
    fontWeight: "800",
  },
  textButton: {
    minHeight: touchTarget,
    minWidth: touchTarget,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    backgroundColor: colors.primarySoft,
  },
  textButtonLabel: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: "700",
  },
  disabled: {
    opacity: 0.55,
  },
  pressed: {
    opacity: 0.75,
  },
});
