import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SymbolView } from "expo-symbols";

import { signIn } from "@/api/auth";
import { ApiError, type AccountKind } from "@/api/client";
import { PrimaryButton } from "@/components/buttons";
import { IllustrationPlaceholder } from "@/components/illustration-placeholder";
import { Text, useLanguage } from "@/language";
import { useSession } from "@/session";
import { colors, radius, spacing, touchTarget } from "@/theme";

const kinds: { value: AccountKind; label: string }[] = [
  { value: "guardian", label: "ولي الأمر" },
  { value: "staff", label: "المعلم" },
];

export default function SignInScreen() {
  const { setAccount } = useSession();
  const { isRTL, language, setLanguage } = useLanguage();
  const [kind, setKind] = useState<AccountKind>("guardian");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
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
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboard}
      >
        <ScrollView
          automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
          contentContainerStyle={styles.page}
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.intro}>
            <View style={[styles.brandRow, { flexDirection: isRTL ? "row-reverse" : "row" }]}>
              <View style={styles.logo}>
                <Text style={styles.logoText}>ر</Text>
              </View>
              <View style={[styles.brandCopy, { alignItems: isRTL ? "flex-end" : "flex-start" }]}>
                <Text style={styles.brandName}>طفولة تيك</Text>
                <Text style={styles.brandTagline}>مدرستك أقرب إليك</Text>
              </View>
            </View>
            <IllustrationPlaceholder label="مكان صورة ترحيبية" />
            <Text style={styles.title}>تسجيل الدخول</Text>
            <Text style={styles.subtitle}>تطبيق المدرسة لولي الأمر والمعلم</Text>
          </View>

          <View style={styles.card}>
            <View style={[styles.languageRow, { alignItems: isRTL ? "flex-start" : "flex-end" }]}>
              <Pressable
                accessibilityLabel={language === "ar" ? "English" : "العربية"}
                accessibilityRole="button"
                onPress={() => void setLanguage(language === "ar" ? "en" : "ar")}
                style={({ pressed }) => [styles.languageButton, pressed && styles.pressed]}
              >
                <Text style={styles.languageIcon}>◎</Text>
                <Text style={styles.languageText}>{language === "ar" ? "English" : "العربية"}</Text>
              </Pressable>
            </View>

            <Text style={styles.sectionTitle}>نوع الحساب</Text>
            <View style={[styles.segmented, { flexDirection: isRTL ? "row-reverse" : "row" }]}>
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
                style={[styles.input, { writingDirection: isRTL ? "rtl" : "ltr" }]}
                textAlign={isRTL ? "right" : "left"}
                value={email}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>كلمة المرور</Text>
              <View style={styles.passwordField}>
                <TextInput
                  autoCapitalize="none"
                  autoComplete="current-password"
                  onChangeText={setPassword}
                  onSubmitEditing={submit}
                  placeholder="••••••••"
                  placeholderTextColor={colors.muted}
                  returnKeyType="done"
                  secureTextEntry={!passwordVisible}
                  style={[
                    styles.input,
                    styles.passwordInput,
                    isRTL ? styles.passwordInputRtl : styles.passwordInputLtr,
                    { writingDirection: isRTL ? "rtl" : "ltr" },
                  ]}
                  textAlign={isRTL ? "right" : "left"}
                  value={password}
                />
                <Pressable
                  accessibilityLabel={passwordVisible ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: passwordVisible }}
                  hitSlop={8}
                  onPress={() => setPasswordVisible((visible) => !visible)}
                  style={({ pressed }) => [
                    styles.passwordToggle,
                    isRTL ? styles.passwordToggleRtl : styles.passwordToggleLtr,
                    pressed && styles.pressed,
                  ]}
                >
                  <SymbolView
                    name={{
                      ios: passwordVisible ? "eye.slash" : "eye",
                      android: passwordVisible ? "visibility_off" : "visibility",
                      web: passwordVisible ? "visibility_off" : "visibility",
                    }}
                    size={22}
                    tintColor={colors.primary}
                  />
                </Pressable>
              </View>
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
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  keyboard: { flex: 1 },
  page: {
    flexGrow: 1,
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
    justifyContent: "flex-start",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl * 2,
    gap: spacing.lg,
  },
  intro: { alignItems: "stretch", gap: spacing.sm },
  languageRow: {
    width: "100%",
  },
  languageButton: {
    minHeight: touchTarget,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 999,
    backgroundColor: colors.surface,
  },
  languageIcon: { color: colors.primary, fontSize: 18, fontWeight: "900" },
  languageText: { color: colors.primary, fontSize: 13, fontWeight: "900" },
  pressed: { opacity: 0.72 },
  brandRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  brandCopy: { gap: 1 },
  brandName: { color: colors.primary, fontSize: 20, fontWeight: "900", textAlign: "right" },
  brandTagline: { color: colors.muted, fontSize: 11, fontWeight: "700", textAlign: "right" },
  logo: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  logoText: { color: colors.surface, fontSize: 25, fontWeight: "900" },
  title: {
    color: colors.text,
    marginTop: spacing.sm,
    fontSize: 29,
    fontWeight: "900",
    textAlign: "center",
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
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: colors.primaryDark,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 3,
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
    backgroundColor: colors.primarySoft,
    borderRadius: 999,
  },
  segment: {
    flex: 1,
    minHeight: touchTarget,
    paddingHorizontal: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
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
    minHeight: touchTarget + 6,
    paddingHorizontal: spacing.md,
    color: colors.text,
    fontSize: 16,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  passwordField: {
    position: "relative",
  },
  passwordInput: {
    width: "100%",
  },
  passwordInputRtl: {
    paddingLeft: touchTarget + spacing.sm,
  },
  passwordInputLtr: {
    paddingRight: touchTarget + spacing.sm,
  },
  passwordToggle: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: touchTarget,
    alignItems: "center",
    justifyContent: "center",
  },
  passwordToggleRtl: { left: spacing.xs },
  passwordToggleLtr: { right: spacing.xs },
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
