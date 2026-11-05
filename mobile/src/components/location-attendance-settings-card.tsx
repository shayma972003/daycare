import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, AppState, Linking, Pressable, StyleSheet, View } from "react-native";

import {
  syncLocationAttendance,
  type LocationAttendanceSetupResult,
  type LocationAttendanceSetupStatus,
} from "@/location-attendance";
import { Text, useLanguage } from "@/language";
import { colors, radius, spacing, touchTarget } from "@/theme";

const statusCopy: Record<LocationAttendanceSetupStatus, string> = {
  active: "مفعّل — سيتم تسجيل الدخول والخروج تلقائيًا",
  disabled: "الميزة غير مفعّلة من إدارة المدرسة",
  "permission-required": "يحتاج إذن الموقع الدائم من إعدادات الهاتف",
  "services-disabled": "موقع الجهاز متوقف — شغّليه لإكمال الحضور التلقائي",
  unavailable: "الحضور بالموقع غير متاح على هذا الجهاز",
};

export function LocationAttendanceSettingsCard({ linked }: { linked: boolean }) {
  const { isRTL } = useLanguage();
  const [setup, setSetup] = useState<LocationAttendanceSetupResult | null>(null);
  const [loading, setLoading] = useState(linked);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    if (!linked) return;
    try {
      const nextSetup = await syncLocationAttendance();
      setError(null);
      setSetup(nextSetup);
    } catch {
      setError("تعذر التحقق من إعدادات الموقع");
    } finally {
      setLoading(false);
    }
  }, [linked]);

  useEffect(() => {
    if (!linked) return;
    let active = true;
    syncLocationAttendance()
      .then((nextSetup) => {
        if (!active) return;
        setError(null);
        setSetup(nextSetup);
      })
      .catch(() => {
        if (active) setError("تعذر التحقق من إعدادات الموقع");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") void refreshStatus();
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [linked, refreshStatus]);

  const enable = async () => {
    setLoading(true);
    setError(null);
    try {
      setSetup(await syncLocationAttendance({
        requestPermissions: true,
        requestServices: true,
      }));
    } catch {
      setError("تعذر تفعيل الحضور بالموقع. تحققي من اتصال الخادم، وتشغيل موقع الجهاز، وإذن التطبيق.");
    } finally {
      setLoading(false);
    }
  };

  const status = setup?.status ?? null;
  const permissionGranted = setup?.foregroundPermissionGranted === true
    && setup?.backgroundPermissionGranted === true;
  const showRequirements = linked && status !== "disabled" && status !== "unavailable";

  return (
    <View style={styles.card}>
      <Text style={styles.title}>الحضور التلقائي بالموقع</Text>
      <Text style={styles.copy}>يسجل دخولك عند وصولك إلى نطاق المدرسة وخروجك عند مغادرته. لا يحفظ التطبيق مسار حركتك.</Text>
      <Text style={styles.instructions}>لعمل الحضور التلقائي: شغّلي موقع الجهاز، ثم امنحي تطبيق طفولة تيك إذن الموقع «طوال الوقت».</Text>
      {!linked ? (
        <Text style={styles.status}>اربط حساب التطبيق بملف الموظف من حسابات الموظفين في النظام أولًا.</Text>
      ) : loading ? <ActivityIndicator color={colors.primary} /> : (
        <>
          <Text style={[styles.status, status === "active" && styles.active]}>
            {error ?? (status ? statusCopy[status] : "غير معروف")}
          </Text>
          {showRequirements ? (
            <View style={styles.requirements}>
              <RequirementRow
                isRTL={isRTL}
                label="إذن التطبيق"
                ok={permissionGranted}
                value={permissionGranted ? "مسموح طوال الوقت" : "غير مكتمل"}
              />
              <RequirementRow
                isRTL={isRTL}
                label="موقع الجهاز"
                ok={setup?.locationServicesEnabled === true}
                value={setup?.locationServicesEnabled ? "يعمل" : "متوقف"}
              />
            </View>
          ) : null}
          {setup?.attendanceOpen !== undefined ? (
            <View style={[styles.attendanceState, { flexDirection: isRTL ? "row-reverse" : "row" }]}>
              <Text style={styles.stateLabel}>حالتك الآن</Text>
              <Text style={[styles.stateValue, setup.attendanceOpen ? styles.checkedIn : styles.checkedOut]}>
                {setup.attendanceOpen ? "مسجلة دخول" : "مسجلة خروج"}
              </Text>
            </View>
          ) : null}
          {status === "active" ? (
            <Text style={styles.noticeHint}>سيصلك إشعار عند تسجيل دخولك أو خروجك تلقائيًا.</Text>
          ) : null}
        </>
      )}
      {linked && status !== "active" && status !== "disabled" && status !== "unavailable" ? (
        <Pressable accessibilityRole="button" disabled={loading} onPress={() => void enable()} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
          <Text style={styles.buttonText}>تشغيل الموقع ومنح الإذن</Text>
        </Pressable>
      ) : null}
      {linked && (status === "permission-required" || status === "services-disabled") ? (
        <Pressable accessibilityRole="link" onPress={() => void Linking.openSettings()}>
          <Text style={styles.link}>
            {status === "services-disabled" ? "فتح إعدادات الهاتف" : "فتح إعدادات التطبيق"}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function RequirementRow({ isRTL, label, ok, value }: {
  isRTL: boolean;
  label: string;
  ok: boolean;
  value: string;
}) {
  return (
    <View style={[styles.requirementRow, { flexDirection: isRTL ? "row-reverse" : "row" }]}>
      <Text style={styles.requirementLabel}>{label}</Text>
      <Text style={[styles.requirementValue, ok ? styles.active : styles.inactive]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
  title: { color: colors.text, fontSize: 17, fontWeight: "900", textAlign: "right" },
  copy: { color: colors.muted, fontSize: 13, lineHeight: 21, textAlign: "right" },
  instructions: { padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.primarySoft, color: colors.text, fontSize: 12, lineHeight: 20, textAlign: "right" },
  status: { color: colors.danger, fontSize: 13, fontWeight: "800", textAlign: "right" },
  active: { color: colors.success },
  inactive: { color: colors.danger },
  requirements: { overflow: "hidden", borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  requirementRow: { alignItems: "center", justifyContent: "space-between", gap: spacing.sm, padding: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  requirementLabel: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  requirementValue: { fontSize: 12, fontWeight: "900" },
  attendanceState: { alignItems: "center", justifyContent: "space-between", padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.background },
  stateLabel: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  stateValue: { fontSize: 14, fontWeight: "900" },
  checkedIn: { color: colors.success },
  checkedOut: { color: colors.muted },
  noticeHint: { color: colors.muted, fontSize: 12, lineHeight: 19 },
  button: { minHeight: touchTarget, alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: colors.primary },
  buttonText: { color: colors.surface, fontSize: 14, fontWeight: "900" },
  link: { color: colors.primary, fontSize: 13, fontWeight: "800", textAlign: "center", textDecorationLine: "underline" },
  pressed: { opacity: 0.75 },
});
