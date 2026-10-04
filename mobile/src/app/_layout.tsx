import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { SessionProvider, useSession } from "@/session";
import { colors } from "@/theme";

function SessionGate() {
  const { account, loading } = useSession();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    const root = segments[0];
    if (!account) {
      if (root !== "sign-in") router.replace("/sign-in");
      return;
    }

    const expectedRoot = account.kind === "guardian" ? "(guardian)" : "(staff)";
    if (root !== expectedRoot) {
      router.replace(account.kind === "guardian" ? "/(guardian)" : "/(staff)");
    }
  }, [account, loading, router, segments]);

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="dark" />
        <SessionGate />
      </SessionProvider>
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
