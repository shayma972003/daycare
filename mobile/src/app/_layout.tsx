import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { LanguageProvider, useLanguage } from "@/language";
import { SessionProvider, useSession } from "@/session";
import { colors } from "@/theme";
import "@/location-attendance/task";

function SessionGate() {
  const { account, loading } = useSession();
  const { isRTL, loading: languageLoading } = useLanguage();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading || languageLoading) return;

    const root = segments[0];
    if (!account) {
      if (root !== "sign-in") router.replace("/sign-in");
      return;
    }

    const expectedRoot = account.kind === "guardian" ? "(guardian)" : "(staff)";
    if (root !== expectedRoot) {
      router.replace(account.kind === "guardian" ? "/(guardian)" : "/(staff)");
    }
  }, [account, languageLoading, loading, router, segments]);

  if (loading || languageLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background, direction: isRTL ? "rtl" : "ltr" },
      }}
    />
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <LanguageProvider>
        <SessionProvider>
          <StatusBar style="dark" />
          <SessionGate />
        </SessionProvider>
      </LanguageProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
});
