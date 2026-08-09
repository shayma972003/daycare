import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "../src/session";
import { signIn, type Account } from "../src/api/auth";
import { colors, radius, spacing, TOUCH_TARGET } from "../src/theme";

/**
 * Signing in: pick who you are, then email and password.
 *
 * Two screens rather than one form with a toggle. The role is not a setting on
 * the sign-in form — it decides which register the address is looked up in, and
 * a person who is both a teacher and a parent here has to answer it before the
 * rest of the screen means anything.
 *
 * What is picked is a *request*, not a grant. The server searches the register
 * that was named and stamps the real role into the token from the row it found,
 * so picking wrong fails to sign in rather than signing in as the wrong person.
 *
 * Both roles use email and password now. Guardians used to use a phone and a
 * code, but the phone only ever named the account — the code went to the email
 * regardless, for want of an SMS gateway — and the invitation they redeem to
 * join is what proves the mailbox instead.
 */
type Role = "staff" | "guardian";

export default function SignIn() {
  const insets = useSafeAreaInsets();
  const { setAccount } = useSession();

  const [role, setRole] = useState<Role | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!role || !email.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      const account: Account = await signIn(role, email, password);
      setAccount(account);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذّر تسجيل الدخول");
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: colors.bg }}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          padding: spacing.lg,
          paddingTop: insets.top + spacing.xl,
          paddingBottom: insets.bottom + spacing.xl,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ alignItems: "center", marginBottom: spacing.xl }}>
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: radius.lg,
              backgroundColor: colors.tealLight,
              borderWidth: 1,
              borderColor: colors.teal,
            }}
          />
          <Text
            style={{
              fontSize: 20,
              fontWeight: "700",
              color: colors.navy,
              marginTop: spacing.md,
            }}
          >
            نظام إدارة الحضانة
          </Text>
        </View>

        {role === null ? (
          <RolePicker onPick={setRole} />
        ) : (
          <View style={{ gap: spacing.md }}>
            <View>
              <Text style={{ fontSize: 17, fontWeight: "700", color: colors.navy }}>
                تسجيل الدخول
              </Text>
              <Text style={{ fontSize: 13, color: colors.textMuted, marginTop: 4 }}>
                {role === "staff" ? "حساب معلّمة أو إدارة" : "حساب ولي أمر"}
              </Text>
            </View>

            <Field
              label="البريد الإلكتروني"
              value={email}
              onChangeText={setEmail}
              placeholder="name@example.com"
              keyboardType="email-address"
            />

            <Field
              label="كلمة المرور"
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              secureTextEntry
              onSubmitEditing={submit}
            />

            {error && (
              <View
                style={{
                  backgroundColor: colors.dangerBg,
                  padding: spacing.md,
                  borderRadius: radius.md,
                }}
              >
                <Text style={{ color: colors.danger, fontSize: 14 }}>{error}</Text>
              </View>
            )}

            <Pressable
              onPress={submit}
              disabled={busy || !email.trim() || !password}
              style={{
                minHeight: TOUCH_TARGET,
                borderRadius: radius.md,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: colors.teal,
                opacity: busy || !email.trim() || !password ? 0.6 : 1,
              }}
            >
              {busy ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={{ color: "#FFFFFF", fontSize: 15, fontWeight: "700" }}>دخول</Text>
              )}
            </Pressable>

            {/* Explains the only state a correct password can still fail in:
                an account that was never activated has no password at all. */}
            <Text
              style={{
                fontSize: 12,
                color: colors.textMuted,
                textAlign: "center",
                lineHeight: 18,
              }}
            >
              إن لم يكن لديك حساب بعد، ستصلك دعوة من الحضانة على بريدك لتعيين كلمة المرور.
            </Text>

            <Pressable
              onPress={() => {
                setRole(null);
                setError(null);
                setPassword("");
              }}
              style={{
                minHeight: TOUCH_TARGET,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ color: colors.textMuted, fontSize: 13 }}>تغيير نوع الحساب</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function RolePicker({ onPick }: { onPick: (role: Role) => void }) {
  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ alignItems: "center" }}>
        <Text style={{ fontSize: 17, fontWeight: "700", color: colors.navy }}>نوع الحساب</Text>
        <Text
          style={{
            fontSize: 13,
            color: colors.textMuted,
            marginTop: 4,
            textAlign: "center",
          }}
        >
          حدّدي نوع حسابك لإتمام تسجيل الدخول
        </Text>
      </View>

      <View style={{ flexDirection: "row", gap: spacing.md }}>
        {(
          [
            { role: "staff", label: "معلّمة أو إدارة" },
            { role: "guardian", label: "ولي أمر" },
          ] as { role: Role; label: string }[]
        ).map((option) => (
          <Pressable
            key={option.role}
            onPress={() => onPick(option.role)}
            style={{
              flex: 1,
              // Tall enough to be a target rather than a line of text — this is
              // the whole content of the screen, not a control on a form.
              minHeight: 132,
              borderRadius: radius.lg,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
              alignItems: "center",
              justifyContent: "center",
              gap: spacing.sm,
              padding: spacing.md,
            }}
          >
            <View
              style={{
                width: 52,
                height: 52,
                borderRadius: radius.md,
                backgroundColor: colors.tealLight,
              }}
            />
            <Text
              style={{
                fontSize: 15,
                fontWeight: "600",
                color: colors.navy,
                textAlign: "center",
              }}
            >
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  secureTextEntry,
  onSubmitEditing,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  keyboardType?: "email-address";
  secureTextEntry?: boolean;
  onSubmitEditing?: () => void;
}) {
  return (
    <View>
      <Text style={{ fontSize: 13, color: colors.textMuted, marginBottom: 6 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        keyboardType={keyboardType}
        secureTextEntry={secureTextEntry}
        onSubmitEditing={onSubmitEditing}
        autoCapitalize="none"
        autoCorrect={false}
        // Latin script in an otherwise RTL screen: an address or a password
        // reads left to right whatever surrounds it.
        style={{
          minHeight: TOUCH_TARGET,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
          paddingHorizontal: spacing.md,
          fontSize: 15,
          color: colors.navy,
          textAlign: "left",
          writingDirection: "ltr",
        }}
      />
    </View>
  );
}
