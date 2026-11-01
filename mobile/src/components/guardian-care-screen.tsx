import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";

import { loadGuardianCareReports, type GuardianCareReport } from "@/api/care";
import { AppScreen, cardStyles } from "@/components/app-screen";
import { PrimaryButton } from "@/components/buttons";
import { careReportSummary, careReportTypeLabel } from "@/care-report-display";
import { Text, useLanguage } from "@/language";
import { useSession } from "@/session";
import { colors, radius, spacing, touchTarget } from "@/theme";

const RIYADH_ZONE = "Asia/Riyadh";

function reportDate(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: RIYADH_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function GuardianCareScreen() {
  const { account } = useSession();
  const { isRTL, language, locale } = useLanguage();
  const [selectedChild, setSelectedChild] = useState<string | null>(null);
  const [reports, setReports] = useState<GuardianCareReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      setReports(await loadGuardianCareReports(selectedChild ?? undefined));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذّر تحميل التقارير");
    } finally {
      setRefreshing(false);
    }
  }, [selectedChild]);

  useEffect(() => {
    let active = true;
    loadGuardianCareReports(selectedChild ?? undefined)
      .then((result) => {
        if (active) setReports(result);
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : "تعذّر تحميل التقارير");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedChild]);

  const selectChild = (childId: string | null) => {
    setLoading(true);
    setError(null);
    setExpandedId(null);
    setSelectedChild(childId);
  };

  const childNames = useMemo(
    () => new Map(account?.kind === "guardian" ? account.children.map((child) => [child.id, child.name]) : []),
    [account]
  );

  if (!account || account.kind !== "guardian") return null;

  return (
    <AppScreen
      onRefresh={() => void refresh()}
      refreshing={refreshing}
      subtitle={account.schoolName}
      title="تقارير الرعاية"
    >
      {account.children.length > 1 ? (
        <View style={[styles.filters, { flexDirection: isRTL ? "row-reverse" : "row" }]}>
          <FilterChip
            active={selectedChild === null}
            label="الكل"
            onPress={() => selectChild(null)}
          />
          {account.children.map((child) => (
            <FilterChip
              active={selectedChild === child.id}
              key={child.id}
              label={child.name}
              onPress={() => selectChild(child.id)}
            />
          ))}
        </View>
      ) : null}

      {loading ? (
        <View style={styles.stateCard}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={cardStyles.body}>جارٍ تحميل التقارير…</Text>
        </View>
      ) : error ? (
        <View style={[styles.stateCard, styles.errorCard]}>
          <Text style={styles.errorTitle}>تعذّر تحميل التقارير</Text>
          <Text style={cardStyles.body}>{error}</Text>
          <PrimaryButton label="إعادة المحاولة" onPress={() => void refresh()} />
        </View>
      ) : reports.length === 0 ? (
        <View style={styles.stateCard}>
          <Text style={styles.emptyIcon}>♡</Text>
          <Text style={styles.emptyTitle}>لا توجد تقارير معتمدة بعد</Text>
        </View>
      ) : (
        <View style={styles.reportList}>
          {reports.map((report) => {
            const expanded = expandedId === report.id;
            const localizedSummary = careReportSummary(report, language);
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                key={report.id}
                onPress={() => setExpandedId(expanded ? null : report.id)}
                style={({ pressed }) => [styles.reportCard, pressed && styles.pressed]}
              >
                <View style={[styles.reportHeader, { flexDirection: isRTL ? "row-reverse" : "row" }]}>
                  <View style={styles.reportCopy}>
                    <Text style={styles.reportType}>{careReportTypeLabel(report, language)}</Text>
                    <Text style={styles.reportChild}>
                      {childNames.get(report.student.id) ?? report.student.name}
                    </Text>
                  </View>
                  <Text style={styles.chevron}>{expanded ? "⌃" : "⌄"}</Text>
                </View>
                <Text style={styles.summary}>{localizedSummary}</Text>
                <Text style={styles.meta}>{reportDate(report.occurredAt, locale)}</Text>
                {expanded ? (
                  <View style={styles.details}>
                    {report.note && report.note !== report.summary ? (
                      <Text style={styles.detailsText}>{report.note}</Text>
                    ) : null}
                    <Text style={styles.meta}>
                      أعدّه: {report.reportedByName || "المعلم"}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      )}
    </AppScreen>
  );
}

function FilterChip({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.filterChip, active && styles.filterChipActive]}
    >
      <Text style={[styles.filterText, active && styles.filterTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: "row-reverse", flexWrap: "wrap", gap: spacing.sm },
  filterChip: {
    minHeight: touchTarget,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    backgroundColor: colors.surface,
  },
  filterChipActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  filterText: { color: colors.text, fontSize: 14, fontWeight: "700" },
  filterTextActive: { color: colors.surface },
  stateCard: {
    minHeight: 220,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  errorCard: { borderColor: "#F8B4B4", backgroundColor: colors.dangerSoft },
  errorTitle: { color: colors.danger, fontSize: 17, fontWeight: "800" },
  emptyIcon: { color: colors.primary, fontSize: 42, fontWeight: "700" },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: "800" },
  reportList: { gap: spacing.sm },
  reportCard: {
    gap: spacing.sm,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  reportHeader: { flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm },
  reportCopy: { flex: 1, gap: 2 },
  reportType: { color: colors.text, fontSize: 17, fontWeight: "800", textAlign: "right" },
  reportChild: { color: colors.primary, fontSize: 14, fontWeight: "700", textAlign: "right" },
  chevron: { width: 24, color: colors.muted, fontSize: 20, textAlign: "center" },
  summary: { color: colors.text, fontSize: 15, lineHeight: 24, textAlign: "right", writingDirection: "rtl" },
  meta: { color: colors.muted, fontSize: 12, textAlign: "right", writingDirection: "rtl" },
  details: { gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  detailsText: { color: colors.text, fontSize: 14, lineHeight: 22, textAlign: "right", writingDirection: "rtl" },
  pressed: { opacity: 0.75 },
});
