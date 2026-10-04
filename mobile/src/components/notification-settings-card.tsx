import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import {
  loadNotificationSettings,
  updateNotificationSettings,
  type GuardianNotificationPreferences,
  type StaffNotificationPreferences,
} from "@/api/notification-settings";
import { colors, radius, spacing, touchTarget } from "@/theme";

type Kind = "guardian" | "staff";
type Preferences = GuardianNotificationPreferences | StaffNotificationPreferences;

const guardianRows: {
  key: keyof GuardianNotificationPreferences;
  title: string;
  subtitle: string;
}[] = [
  { key: "activity", title: "الإعلانات", subtitle: "رسائل المدرسة والأنشطة" },
  { key: "calendar", title: "التقويم", subtitle: "الأحداث والإعلانات المرتبطة بالتقويم" },
  { key: "absence", title: "الغياب", subtitle: "عند تسجيل غياب أحد أطفالك" },
  { key: "attendance", title: "الحضور والانصراف", subtitle: "عند تسجيل دخول أو خروج طفلك" },
  { key: "careReport", title: "تقارير الرعاية", subtitle: "عند وصول تقرير رعاية جديد" },
];

const staffRows: {
  key: keyof StaffNotificationPreferences;
  title: string;
  subtitle: string;
}[] = [
  { key: "activity", title: "الإعلانات", subtitle: "رسائل المدرسة والأنشطة المرسلة لك" },
  { key: "calendar", title: "التقويم", subtitle: "الأحداث المرتبطة بك أو بفصولك" },
  { key: "arrival", title: "وصول أولياء الأمور", subtitle: "إشعار «سيصل خلال 5 دقائق»" },
];

export function NotificationSettingsCard({ kind }: { kind: Kind }) {
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await loadNotificationSettings();
      if (result.kind !== kind) throw new Error("نوع الحساب غير متوافق");
      setPreferences(result.preferences);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذّر تحميل إعدادات الإشعارات");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    void loadNotificationSettings()
      .then((result) => {
        if (!active) return;
        if (result.kind !== kind) throw new Error("نوع الحساب غير متوافق");
        setPreferences(result.preferences);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : "تعذّر تحميل إعدادات الإشعارات");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [kind]);

  const toggle = async (key: string, current: boolean) => {
    if (savingKey) return;
    setSavingKey(key);
    setError(null);
    try {
      const result = await updateNotificationSettings({ [key]: !current });
      if (result.kind !== kind) throw new Error("نوع الحساب غير متوافق");
      setPreferences(result.preferences);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذّر حفظ الإعداد");
    } finally {
      setSavingKey(null);
    }
  };

  const rows = kind === "guardian" ? guardianRows : staffRows;

  return (
    <View style={styles.card}>
      <View style={styles.headingCopy}>
        <Text style={styles.heading}>إعدادات الإشعارات</Text>
        <Text style={styles.hint}>تُطبق التغييرات على الإشعارات الجديدة.</Text>
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.loadingText}>جارٍ تحميل الإعدادات…</Text>
        </View>
      ) : preferences ? (
        <View>
          {rows.map((row, index) => {
            const enabled = Boolean((preferences as Record<string, boolean>)[row.key]);
            const saving = savingKey === row.key;
            return (
              <View key={row.key} style={[styles.row, index > 0 && styles.rowBorder]}>
                <Pressable
                  accessibilityLabel={`${row.title}: ${enabled ? "مفعّل" : "متوقف"}`}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: enabled, disabled: Boolean(savingKey) }}
                  disabled={Boolean(savingKey)}
                  onPress={() => void toggle(row.key, enabled)}
                  style={[styles.switchTrack, enabled && styles.switchTrackEnabled]}
                >
                  {saving ? (
                    <ActivityIndicator color={enabled ? colors.surface : colors.primary} size="small" />
                  ) : (
                    <View style={[styles.switchThumb, enabled && styles.switchThumbEnabled]} />
                  )}
                </Pressable>
                <View style={styles.rowCopy}>
                  <Text style={styles.title}>{row.title}</Text>
                  <Text style={styles.subtitle}>{row.subtitle}</Text>
                </View>
              </View>
            );
          })}
        </View>
      ) : null}

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.error}>{error}</Text>
          {!preferences ? (
            <Pressable accessibilityRole="button" onPress={() => void reload()} style={styles.retry}>
              <Text style={styles.retryText}>إعادة المحاولة</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
  headingCopy: { gap: 4 },
  heading: { color: colors.text, fontSize: 18, fontWeight: "900", textAlign: "right", writingDirection: "rtl" },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 19, textAlign: "right", writingDirection: "rtl" },
  loading: { minHeight: 96, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  loadingText: { color: colors.muted, fontSize: 13 },
  row: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  rowCopy: { flex: 1, gap: 3 },
  title: { color: colors.text, fontSize: 15, fontWeight: "900", textAlign: "right", writingDirection: "rtl" },
  subtitle: { color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: "right", writingDirection: "rtl" },
  switchTrack: { width: 52, height: 30, alignItems: "flex-start", justifyContent: "center", padding: 3, borderRadius: 15, backgroundColor: colors.border },
  switchTrackEnabled: { alignItems: "flex-end", backgroundColor: colors.primary },
  switchThumb: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.surface },
  switchThumbEnabled: { backgroundColor: colors.surface },
  errorBox: { alignItems: "flex-end", gap: spacing.xs, paddingTop: spacing.sm },
  error: { color: colors.danger, fontSize: 12, fontWeight: "700", textAlign: "right" },
  retry: { minHeight: touchTarget, justifyContent: "center", paddingHorizontal: spacing.sm },
  retryText: { color: colors.primary, fontSize: 13, fontWeight: "900" },
});
