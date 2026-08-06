import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "../../src/session";
import { colors, spacing } from "../../src/theme";

/** Placeholder home for staff — the roster lands here next (M3). */
export default function StaffHome() {
  const insets = useSafeAreaInsets();
  const { account } = useSession();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top + spacing.lg, padding: spacing.lg }}>
      <Text style={{ fontSize: 20, fontWeight: "700", color: colors.navy }}>
        {account?.name ?? "مرحباً"}
      </Text>
      <Text style={{ fontSize: 14, color: colors.textMuted, marginTop: spacing.xs }}>
        {account?.schoolName ?? ""}
      </Text>
    </View>
  );
}
