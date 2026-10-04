import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { AppScreen, cardStyles } from "@/components/app-screen";
import { NotificationSettingsCard } from "@/components/notification-settings-card";
import { useSession } from "@/session";
import { colors, radius, spacing, touchTarget } from "@/theme";

function periodLabel(period: "MORNING" | "EVENING" | null) {
  if (period === "MORNING") return "صباحي";
  if (period === "EVENING") return "مسائي";
  return "غير محدد";
}

export function GuardianAccountScreen() {
  const { account, signOut } = useSession();
  const [signingOut, setSigningOut] = useState(false);
  if (!account || account.kind !== "guardian") return null;

  const logout = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <AppScreen subtitle={account.schoolName} title="حسابي">
      <View style={cardStyles.card}>
        <Text style={cardStyles.heading}>{account.name}</Text>
        <AccountRow label="البريد" value={account.email} />
        <View style={styles.divider} />
        <AccountRow label="الجوال" value={account.phone || "غير مسجل"} />
      </View>

      <View style={styles.childrenCard}>
        <Text style={styles.sectionTitle}>أطفالي</Text>
        {account.children.length === 0 ? (
          <Text style={styles.emptyText}>لا يوجد أطفال مرتبطون بالحساب</Text>
        ) : (
          <View style={styles.list}>
            {account.children.map((child) => (
              <View key={child.id} style={styles.childRow}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{child.name.trim().slice(0, 1) || "ط"}</Text>
                </View>
                <View style={styles.childCopy}>
                  <Text style={styles.childName}>{child.name}</Text>
                  <Text style={styles.childMeta}>{child.class?.name ?? "بدون فصل"} · {periodLabel(child.period)}</Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </View>

      <NotificationSettingsCard kind="guardian" />

      <Pressable
        accessibilityRole="button"
        disabled={signingOut}
        onPress={() => void logout()}
        style={({ pressed }) => [styles.logoutButton, pressed && styles.pressed]}
      >
        {signingOut
          ? <ActivityIndicator color={colors.danger} />
          : <Text style={styles.logoutText}>تسجيل الخروج</Text>}
      </Pressable>
    </AppScreen>
  );
}

function AccountRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.accountRow}>
      <Text style={styles.accountValue}>{value}</Text>
      <Text style={styles.accountLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  accountRow: { minHeight: 42, flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  accountLabel: { color: colors.muted, fontSize: 13, textAlign: "right" },
  accountValue: { flex: 1, color: colors.text, fontSize: 14, fontWeight: "700", textAlign: "left" },
  divider: { height: 1, backgroundColor: colors.border },
  childrenCard: { gap: spacing.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: "900", textAlign: "right", writingDirection: "rtl" },
  list: { gap: spacing.sm },
  childRow: { minHeight: 68, flexDirection: "row-reverse", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  avatar: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 22, backgroundColor: colors.primarySoft },
  avatarText: { color: colors.primary, fontSize: 18, fontWeight: "900" },
  childCopy: { flex: 1, gap: 3 },
  childName: { color: colors.text, fontSize: 16, fontWeight: "900", textAlign: "right", writingDirection: "rtl" },
  childMeta: { color: colors.muted, fontSize: 13, textAlign: "right", writingDirection: "rtl" },
  emptyText: { minHeight: 80, color: colors.muted, fontSize: 14, textAlign: "center", textAlignVertical: "center" },
  logoutButton: { minHeight: touchTarget, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.danger, borderRadius: radius.md, backgroundColor: colors.surface },
  logoutText: { color: colors.danger, fontSize: 15, fontWeight: "900" },
  pressed: { opacity: 0.72 },
});
