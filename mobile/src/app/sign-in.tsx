import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { signIn } from "@/api/auth";
import { ApiError, type AccountKind } from "@/api/client";
import { PrimaryButton } from "@/components/buttons";
import { useSession } from "@/session";
import { colors, radius, spacing, touchTarget } from "@/theme";

const kinds: { value: AccountKind; label: string }[] = [
  { value: "guardian", label: "ولي الأمر" },
  { value: "staff", label: "المعلم" },
];

export default function SignInScreen() {
  const { setAccount } = useSession();
  const [kind, setKind] = useState<AccountKind>("guardian");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!email.trim() || !password) {
      setError("أدخلي البريد الإلكتروني وكلمة المرور");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const account = await signIn(kind, email, password);
      setAccount(account);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "تعذّر تسجيل الدخول، حاولي مرة أخرى");
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.keyboard}
      >
        <View style={styles.page}>
          <View style={styles.brand}>
            <View style={styles.logo}>
              <Text style={styles.logoText}>ر</Text>
            </View>
            <Text style={styles.title}>تسجيل الدخول</Text>
            <Text style={styles.subtitle}>تطبيق المدرسة لولي الأمر والمعلم</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>نوع الحساب</Text>
            <View style={styles.segmented}>
              {kinds.map((item) => {
                const selected = kind === item.value;
                return (
                  <Pressable
                    key={item.value}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    onPress={() => {
                      setKind(item.value);
                      setError(null);
                    }}
                    style={[styles.segment, selected && styles.segmentSelected]}
                  >
                    <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>
                      {item.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>البريد الإلكتروني</Text>
              <TextInput
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                onChangeText={setEmail}
                placeholder="name@example.com"
                placeholderTextColor={colors.muted}
                returnKeyType="next"
                style={styles.input}
                textAlign="right"
                value={email}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>كلمة المرور</Text>
              <TextInput
                autoCapitalize="none"
                autoComplete="current-password"
                onChangeText={setPassword}
                onSubmitEditing={submit}
                placeholder="••••••••"
                placeholderTextColor={colors.muted}
                returnKeyType="done"
                secureTextEntry
                style={styles.input}
                textAlign="right"
                value={password}
              />
            </View>

            {error ? (
              <View accessibilityRole="alert" style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <PrimaryButton label="دخول" loading={loading} onPress={submit} />
            <Text style={styles.help}>
              الدخول بعد تفعيل الدعوة وإنشاء كلمة المرور.
            </Text>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  keyboard: { flex: 1 },
  page: {
    flex: 1,
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
    justifyContent: "center",
    padding: spacing.lg,
    gap: spacing.xl,
  },
  brand: { alignItems: "center", gap: spacing.sm },
  logo: {
    width: 72,
    height: 72,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  logoText: { color: colors.surface, fontSize: 32, fontWeight: "800" },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: "800",
    writingDirection: "rtl",
  },
  subtitle: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 22,
    textAlign: "center",
    writingDirection: "rtl",
  },
  card: {
    padding: spacing.lg,
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
    textAlign: "right",
    writingDirection: "rtl",
  },
  segmented: {
    flexDirection: "row-reverse",
    gap: spacing.sm,
    padding: spacing.xs,
    backgroundColor: colors.background,
    borderRadius: radius.md,
  },
  segment: {
    flex: 1,
    minHeight: touchTarget,
    paddingHorizontal: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
  },
  segmentSelected: { backgroundColor: colors.primary },
  segmentText: { color: colors.muted, fontSize: 14, fontWeight: "700" },
  segmentTextSelected: { color: colors.surface },
  fieldGroup: { gap: spacing.sm },
  label: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "600",
    textAlign: "right",
    writingDirection: "rtl",
  },
  input: {
    minHeight: touchTarget,
    paddingHorizontal: spacing.md,
    color: colors.text,
    fontSize: 16,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  errorBox: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
  },
  errorText: {
    color: colors.danger,
    fontSize: 14,
    lineHeight: 22,
    textAlign: "right",
    writingDirection: "rtl",
  },
  help: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 21,
    textAlign: "center",
    writingDirection: "rtl",
  },
});
