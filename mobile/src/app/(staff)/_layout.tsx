import { Tabs } from "expo-router";
import { StyleSheet, Text, type ColorValue } from "react-native";

import { colors } from "@/theme";

function TabIcon({ label, color }: { label: string; color: ColorValue }) {
  return <Text style={[styles.icon, { color }]}>{label}</Text>;
}

export default function StaffLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: styles.label,
        tabBarStyle: styles.bar,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "الرئيسية",
          tabBarAccessibilityLabel: "الرئيسية",
          tabBarIcon: ({ color }) => <TabIcon color={color} label="⌂" />,
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: "التقويم",
          tabBarAccessibilityLabel: "التقويم",
          tabBarIcon: ({ color }) => <TabIcon color={color} label="□" />,
        }}
      />
      <Tabs.Screen
        name="care"
        options={{
          title: "الرعاية",
          tabBarAccessibilityLabel: "تقارير الرعاية",
          tabBarIcon: ({ color }) => <TabIcon color={color} label="♡" />,
        }}
      />
      <Tabs.Screen
        name="attendance"
        options={{
          title: "الحضور",
          tabBarAccessibilityLabel: "الحضور",
          tabBarIcon: ({ color }) => <TabIcon color={color} label="✓" />,
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
          title: "حسابي",
          tabBarAccessibilityLabel: "حسابي",
          tabBarIcon: ({ color }) => <TabIcon color={color} label="●" />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: { height: 68, paddingTop: 7, paddingBottom: 9, borderTopColor: colors.border },
  label: { fontSize: 12, fontWeight: "700" },
  icon: { fontSize: 22, fontWeight: "800" },
});
