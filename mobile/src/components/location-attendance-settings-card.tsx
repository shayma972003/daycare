import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from "react-native";

import {
  syncLocationAttendance,
  type LocationAttendanceSetupStatus,
} from "@/location-attendance";
import { Text } from "@/language";
import { colors, radius, spacing, touchTarget } from "@/theme";

const statusCopy: Record<LocationAttendanceSetupStatus, string> = {
  active: "مفعّل — سيتم تسجيل الدخول والخروج تلقائيًا",
  disabled: "الميزة غير مفعّلة من إدارة المدرسة",
  "permission-required": "يحتاج إذن الموقع الدائم من إعدادات الهاتف",
  unavailable: "الحضور بالموقع غير متاح على هذا الجهاز",
};

export function LocationAttendanceSettingsCard() {
  const [status, setStatus] = useState<LocationAttendanceSetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    syncLocationAttendance()
      .then((result) => { if (active) setStatus(result.status); })
      .catch(() => { if (active) setError("تعذر التحقق من إعدادات الموقع"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const enable = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await syncLocationAttendance({ requestPermissions: true });
      setStatus(result.status);
    } catch {
      setError("تعذر تفعيل الحضور بالموقع. تحققي من اتصال الخادم وإذن الموقع.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>الحضور التلقائي بالموقع</Text>
      <Text style={styles.copy}>يسجل دخولك عند وصولك إلى نطاق المدرسة وخروجك عند مغادرته. لا يحفظ التطبيق مسار حركتك.</Text>
      {loading ? <ActivityIndicator color={colors.primary} /> : (
        <Text style={[styles.status, status === "active" && styles.active]}>
          {error ?? (status ? statusCopy[status] : "غير معروف")}
        </Text>
      )}
      {status !== "disabled" && status !== "unavailable" ? (
        <Pressable accessibilityRole="button" disabled={loading} onPress={() => void enable()} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
          <Text style={styles.buttonText}>{status === "active" ? "تحديث إعداد الموقع" : "تفعيل إذن الموقع"}</Text>
        </Pressable>
      ) : null}
      {status === "permission-required" ? (
        <Pressable accessibilityRole="link" onPress={() => void Linking.openSettings()}>
          <Text style={styles.link}>فتح إعدادات الهاتف</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
  title: { color: colors.text, fontSize: 17, fontWeight: "900", textAlign: "right" },
  copy: { color: colors.muted, fontSize: 13, lineHeight: 21, textAlign: "right" },
  status: { color: colors.danger, fontSize: 13, fontWeight: "800", textAlign: "right" },
  active: { color: colors.success },
  button: { minHeight: touchTarget, alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: colors.primary },
  buttonText: { color: colors.surface, fontSize: 14, fontWeight: "900" },
  link: { color: colors.primary, fontSize: 13, fontWeight: "800", textAlign: "center", textDecorationLine: "underline" },
  pressed: { opacity: 0.75 },
});
