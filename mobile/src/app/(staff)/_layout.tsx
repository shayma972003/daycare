import { Tabs } from "expo-router";
import { StyleSheet, View, type ColorValue } from "react-native";

import { Text, useLanguage } from "@/language";
import { useSession } from "@/session";
import { colors } from "@/theme";

function TabIcon({ label, color, focused }: { label: string; color: ColorValue; focused: boolean }) {
  return (
    <View style={[styles.iconShell, focused && styles.iconShellActive]}>
      <Text style={[styles.icon, { color }]}>{label}</Text>
    </View>
  );
}

export default function StaffLayout() {
  const { isRTL, t } = useLanguage();
  const { account } = useSession();
  const permissions = account?.kind === "staff" ? account.permissions : [];
  const can = (permission: string) => permissions.includes("*") || permissions.includes(permission);
  const hasEmployeeProfile = account?.kind === "staff" && Boolean(account.teacherId);
  const canUseStudentAttendance = can("attendance.students");
  const canUseCare = canUseStudentAttendance && hasEmployeeProfile;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: styles.label,
        tabBarStyle: [styles.bar, { direction: isRTL ? "rtl" : "ltr" }],
        tabBarItemStyle: styles.item,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t("الرئيسية"),
          tabBarAccessibilityLabel: t("الرئيسية"),
          tabBarIcon: ({ color, focused }) => <TabIcon color={color} focused={focused} label="⌂" />,
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          href: can("schedule.view") ? undefined : null,
          title: t("التقويم"),
          tabBarAccessibilityLabel: t("التقويم"),
          tabBarIcon: ({ color, focused }) => <TabIcon color={color} focused={focused} label="□" />,
        }}
      />
      <Tabs.Screen
        name="care"
        options={{
          href: canUseCare ? undefined : null,
          title: t("الرعاية"),
          tabBarAccessibilityLabel: t("تقارير الرعاية"),
          tabBarIcon: ({ color, focused }) => <TabIcon color={color} focused={focused} label="♡" />,
        }}
      />
      <Tabs.Screen
        name="attendance"
        options={{
          href: canUseStudentAttendance ? undefined : null,
          title: t("الحضور"),
          tabBarAccessibilityLabel: t("الحضور"),
          tabBarIcon: ({ color, focused }) => <TabIcon color={color} focused={focused} label="✓" />,
        }}
      />
      <Tabs.Screen
        name="children"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: t("حسابي"),
          tabBarAccessibilityLabel: t("حسابي"),
          tabBarIcon: ({ color, focused }) => <TabIcon color={color} focused={focused} label="●" />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: 78,
    paddingTop: 7,
    paddingBottom: 9,
    borderTopWidth: 0,
    backgroundColor: colors.surface,
    elevation: 12,
    shadowColor: colors.primaryDark,
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.07,
    shadowRadius: 18,
  },
  item: { paddingHorizontal: 2 },
  label: { marginTop: 2, fontSize: 11, fontWeight: "800" },
  iconShell: { width: 35, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 14 },
  iconShellActive: { backgroundColor: colors.primarySoft },
  icon: { fontSize: 21, fontWeight: "900" },
});
