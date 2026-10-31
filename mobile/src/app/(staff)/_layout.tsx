import { Tabs } from "expo-router";
import { StyleSheet, View, type ColorValue } from "react-native";

import { Text, useLanguage } from "@/language";
import { colors } from "@/theme";

function TabIcon({ label, color, focused }: { label: string; color: ColorValue; focused: boolean }) {
  return (
    <View style={[styles.iconShell, focused && styles.iconShellActive]}>
      <Text style={[styles.icon, { color }]}>{label}</Text>
    </View>
  );
}

export default function StaffLayout() {
  const { t } = useLanguage();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: styles.label,
        tabBarStyle: styles.bar,
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
          title: t("التقويم"),
          tabBarAccessibilityLabel: t("التقويم"),
          tabBarIcon: ({ color, focused }) => <TabIcon color={color} focused={focused} label="□" />,
        }}
      />
      <Tabs.Screen
        name="care"
        options={{
          title: t("الرعاية"),
          tabBarAccessibilityLabel: t("تقارير الرعاية"),
          tabBarIcon: ({ color, focused }) => <TabIcon color={color} focused={focused} label="♡" />,
        }}
      />
      <Tabs.Screen
        name="attendance"
        options={{
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
