import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SessionProvider, useSession } from "../src/session";
import { colors, enforceRtl } from "../src/theme";

/**
 * Direction is set before the first render, not inside a component.
 *
 * React Native reads the device language to decide layout direction, so an
 * Arabic interface on a phone set to English would lay out left-to-right. This
 * product is Arabic-first, so the direction is stated rather than inherited.
 */
enforceRtl();

/**
 * The gate.
 *
 * Redirects live here rather than in each screen: a screen that forgets to
 * check renders a moment of somebody else's data before it corrects itself, and
 * that moment is the whole failure.
 */
function Gate() {
  const { account, loading } = useSession();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const inAuthFlow = segments[0] === "sign-in";

    if (!account && !inAuthFlow) {
      router.replace("/sign-in");
      return;
    }
    if (account && inAuthFlow) {
      // The token decides the home screen — see src/session.tsx.
      router.replace(account.kind === "staff" ? "/(staff)" : "/(guardian)");
    }
  }, [account, loading, segments, router]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.teal} size="large" />
      </View>
    );
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="dark" />
        <Gate />
      </SessionProvider>
    </SafeAreaProvider>
  );
}
