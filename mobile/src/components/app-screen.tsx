import type { ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors, radius, shadow, spacing } from "@/theme";

type AppScreenProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
  action?: ReactNode;
};

export function AppScreen({ title, subtitle, children, action }: AppScreenProps) {
  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "right", "left"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View pointerEvents="none" style={styles.headerOrbLarge} />
          <View pointerEvents="none" style={styles.headerOrbSmall} />
          <View style={styles.logo}>
            <Text style={styles.logoText}>ر</Text>
          </View>
          <View style={styles.headerCopy}>
            <Text style={styles.title}>{title}</Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </View>
          {action ? <View style={styles.action}>{action}</View> : null}
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
    minHeight: 156,
    overflow: "hidden",
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: spacing.md,
    marginHorizontal: -spacing.md,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
    backgroundColor: colors.primary,
  },
  headerOrbLarge: {
    position: "absolute",
    width: 190,
    height: 190,
    top: -78,
    left: -38,
    borderRadius: 95,
    backgroundColor: colors.lilac,
    opacity: 0.22,
  },
  headerOrbSmall: {
    position: "absolute",
    width: 88,
    height: 88,
    right: 112,
    bottom: -38,
    borderRadius: 44,
    backgroundColor: colors.accent,
    opacity: 0.13,
  },
  logo: {
    width: 54,
    height: 54,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.55)",
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  logoText: {
    color: colors.surface,
    fontSize: 22,
    fontWeight: "800",
  },
  headerCopy: {
    flex: 1,
    gap: 2,
  },
  title: {
    color: colors.surface,
    fontSize: 27,
    fontWeight: "800",
    textAlign: "right",
    writingDirection: "rtl",
  },
  subtitle: {
    color: "rgba(255,255,255,0.76)",
    fontSize: 14,
    textAlign: "right",
    writingDirection: "rtl",
  },
  action: {
    minWidth: 48,
    alignItems: "flex-start",
  },
});
