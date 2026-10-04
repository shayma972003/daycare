import type { ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors, radius, spacing } from "@/theme";

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
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
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
    padding: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  header: {
    minHeight: 72,
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: spacing.md,
  },
  logo: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    backgroundColor: colors.primary,
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
    color: colors.text,
    fontSize: 25,
    fontWeight: "800",
    textAlign: "right",
    writingDirection: "rtl",
  },
  subtitle: {
    color: colors.muted,
    fontSize: 14,
    textAlign: "right",
    writingDirection: "rtl",
  },
  action: {
    minWidth: 48,
    alignItems: "flex-start",
  },
});
