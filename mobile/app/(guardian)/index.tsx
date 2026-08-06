import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing } from "../../src/theme";

/** Placeholder home for guardians — children and the care feed land here (M4). */
export default function GuardianHome() {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top + spacing.lg, padding: spacing.lg }}>
      <Text style={{ fontSize: 20, fontWeight: "700", color: colors.navy }}>أطفالي</Text>
    </View>
  );
}
