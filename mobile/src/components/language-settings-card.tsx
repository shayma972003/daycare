import { Pressable, StyleSheet, View } from "react-native";

import { Text, useLanguage, type AppLanguage } from "@/language";
import { colors, radius, spacing, touchTarget } from "@/theme";

const options: { value: AppLanguage; label: string; nativeLabel: string }[] = [
  { value: "ar", label: "Arabic", nativeLabel: "العربية" },
  { value: "en", label: "English", nativeLabel: "English" },
];

export function LanguageSettingsCard() {
  const { language, isRTL, setLanguage } = useLanguage();

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>اللغة</Text>
      <Text style={styles.hint}>اختاري لغة واجهة التطبيق.</Text>
      <View style={[styles.options, { flexDirection: isRTL ? "row-reverse" : "row" }]}>
        {options.map((option) => {
          const selected = language === option.value;
          return (
            <Pressable
              accessibilityLabel={option.label}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              key={option.value}
              onPress={() => void setLanguage(option.value)}
              style={({ pressed }) => [
                styles.option,
                selected && styles.optionSelected,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                {option.nativeLabel}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  heading: { color: colors.text, fontSize: 18, fontWeight: "900" },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 19 },
  options: {
    gap: spacing.sm,
    padding: 5,
    borderRadius: 999,
    backgroundColor: colors.primarySoft,
  },
  option: {
    minHeight: touchTarget,
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
  },
  optionSelected: { backgroundColor: colors.primary },
  optionText: { color: colors.muted, fontSize: 14, fontWeight: "800" },
  optionTextSelected: { color: colors.surface },
  pressed: { opacity: 0.72 },
});
