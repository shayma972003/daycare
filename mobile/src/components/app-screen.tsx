import type { ReactNode } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Text, useLanguage } from "@/language";
import { colors, radius, shadow, spacing } from "@/theme";

type AppScreenProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
};

export function AppScreen({ title, subtitle, children, refreshing = false, onRefresh }: AppScreenProps) {
  const { isRTL } = useLanguage();
  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "right", "left"]}>
      <ScrollView
        contentContainerStyle={[styles.content, { direction: isRTL ? "rtl" : "ltr" }]}
        keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? (
          <RefreshControl
            colors={[colors.primary]}
            onRefresh={onRefresh}
            progressBackgroundColor={colors.surface}
            refreshing={refreshing}
            tintColor={colors.primary}
          />
        ) : undefined}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.header, { flexDirection: isRTL ? "row-reverse" : "row" }]}>
          <View pointerEvents="none" style={styles.headerOrbLarge} />
          <View pointerEvents="none" style={styles.headerOrbSmall} />
          <View style={styles.logo}>
            <Text style={styles.logoText}>ر</Text>
          </View>
          <View style={[styles.headerCopy, { alignItems: isRTL ? "flex-end" : "flex-start" }]}>
            <Text style={styles.title}>{title}</Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </View>
        </View>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export const cardStyles = StyleSheet.create({
  card: {
    ...shadow.card,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.md,
  },
  heading: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "700",
    textAlign: "right",
    writingDirection: "rtl",
  },
  body: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 24,
    textAlign: "right",
    writingDirection: "rtl",
  },
});

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  header: {
    minHeight: 116,
    overflow: "hidden",
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: spacing.md,
    marginHorizontal: -spacing.md,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
    backgroundColor: colors.primary,
  },
  headerOrbLarge: {
    position: "absolute",
    width: 150,
    height: 150,
    top: -72,
    left: -34,
    borderRadius: 75,
    backgroundColor: colors.lilac,
    opacity: 0.22,
  },
  headerOrbSmall: {
    position: "absolute",
    width: 68,
    height: 68,
    right: 92,
    bottom: -32,
    borderRadius: 34,
    backgroundColor: colors.accent,
    opacity: 0.13,
  },
  logo: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 15,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.55)",
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  logoText: {
    color: colors.surface,
    fontSize: 19,
    fontWeight: "800",
  },
  headerCopy: {
    flex: 1,
    gap: 2,
  },
  title: {
    color: colors.surface,
    fontSize: 22,
    fontWeight: "800",
    textAlign: "right",
    writingDirection: "rtl",
  },
  subtitle: {
    color: "rgba(255,255,255,0.76)",
    fontSize: 12,
    textAlign: "right",
    writingDirection: "rtl",
  },
});
