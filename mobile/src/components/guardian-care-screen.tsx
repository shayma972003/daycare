import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { loadGuardianCareReports, type GuardianCareReport } from "@/api/care";
import { AppScreen, cardStyles } from "@/components/app-screen";
import { PrimaryButton, TextButton } from "@/components/buttons";
import { useSession } from "@/session";
import { colors, radius, spacing, touchTarget } from "@/theme";

const RIYADH_ZONE = "Asia/Riyadh";

function reportDate(value: string) {
  return new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", {
    timeZone: RIYADH_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function GuardianCareScreen() {
  const { account, signOut } = useSession();
  const [selectedChild, setSelectedChild] = useState<string | null>(null);
  const [reports, setReports] = useState<GuardianCareReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReports(await loadGuardianCareReports(selectedChild ?? undefined));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذّر تحميل التقارير");
    } finally {
      setLoading(false);
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
      action={<TextButton label="تسجيل الخروج" onPress={() => void signOut()} />}
      subtitle={account.schoolName}
      title="تقارير الرعاية"
    >
      {account.children.length > 1 ? (
        <View style={styles.filters}>
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

      <Pressable
        accessibilityLabel="تحديث تقارير الرعاية"
        accessibilityRole="button"
        disabled={loading}
        onPress={() => void refresh()}
        style={({ pressed }) => [styles.refreshButton, pressed && styles.pressed]}
      >
        {loading ? (
          <ActivityIndicator color={colors.primary} size="small" />
        ) : (
          <Text style={styles.refreshIcon}>↻</Text>
        )}
      </Pressable>

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
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                key={report.id}
                onPress={() => setExpandedId(expanded ? null : report.id)}
                style={({ pressed }) => [styles.reportCard, pressed && styles.pressed]}
              >
                <View style={styles.reportHeader}>
                  <View style={styles.reportCopy}>
                    <Text style={styles.reportType}>{report.typeLabel}</Text>
                    <Text style={styles.reportChild}>
                      {childNames.get(report.student.id) ?? report.student.name}
                    </Text>
                  </View>
                  <Text style={styles.chevron}>{expanded ? "⌃" : "⌄"}</Text>
                </View>
                <Text style={styles.summary}>{report.summary}</Text>
                <Text style={styles.meta}>{reportDate(report.occurredAt)}</Text>
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
  refreshButton: {
    width: touchTarget,
    height: touchTarget,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    backgroundColor: colors.surface,
  },
  refreshIcon: { color: colors.primary, fontSize: 25, fontWeight: "800" },
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
