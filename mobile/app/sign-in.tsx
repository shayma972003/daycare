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
import { signInStaff, requestGuardianCode, verifyGuardianCode } from "../src/api/auth";
import { colors, radius, spacing, TOUCH_TARGET } from "../src/theme";

/**
 * One app, two doors.
 *
 * Staff sign in with the email and password they already have. Guardians sign
 * in with a phone number and a code, because a parent has never had an account
 * here and should not have to invent a password to find out whether their child
 * ate lunch.
 *
 * The tab a person picks decides which *form* they see — not which role they
 * get. The role is stamped into the token by the server, so choosing "staff"
 * and typing a guardian's details signs you in as a guardian.
 */
type Door = "staff" | "guardian";

export default function SignIn() {
  const insets = useSafeAreaInsets();
  const { setAccount } = useSession();

  const [door, setDoor] = useState<Door>("staff");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);

  function switchDoor(next: Door) {
    setDoor(next);
    // A message about the other form is noise once it is off screen.
    setError(null);
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "حدث خطأ، حاولي مجدداً");
    } finally {
      setBusy(false);
    }
  }

  const staffReady = email.trim().length > 0 && password.length > 0;
  const phoneReady = phone.trim().length >= 9;
  const codeReady = code.trim().length >= 4;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          paddingTop: insets.top + spacing.xl,
          gap: spacing.md,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ alignItems: "center", gap: spacing.xs, marginBottom: spacing.lg }}>
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: radius.xl,
              backgroundColor: colors.navy,
            }}
          />
          <Text style={{ fontSize: 22, fontWeight: "700", color: colors.navy, marginTop: spacing.sm }}>
            الروضة
          </Text>
          <Text style={{ fontSize: 13, color: colors.textMuted }}>نظام إدارة الروضة</Text>
        </View>

        {/* The two doors */}
        <View
          style={{
            flexDirection: "row",
            backgroundColor: "#EFEFEF",
            borderRadius: radius.lg,
            padding: 4,
          }}
        >
          {(["staff", "guardian"] as Door[]).map((option) => (
            <Pressable
              key={option}
              onPress={() => switchDoor(option)}
              style={{
                flex: 1,
                minHeight: TOUCH_TARGET,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: radius.md,
                backgroundColor: door === option ? colors.surface : "transparent",
              }}
            >
              <Text
                style={{
                  fontSize: 15,
                  fontWeight: door === option ? "700" : "400",
                  color: door === option ? colors.navy : colors.textMuted,
                }}
              >
                {option === "staff" ? "معلمة أو إدارة" : "ولي أمر"}
              </Text>
            </Pressable>
          ))}
        </View>

        {error && (
          <View
            style={{
              backgroundColor: colors.dangerBg,
              borderRadius: radius.md,
              padding: spacing.md,
            }}
          >
            <Text style={{ color: colors.danger, fontSize: 14 }}>{error}</Text>
          </View>
        )}

        {door === "staff" ? (
          <View style={{ gap: spacing.md }}>
            <Field
              label="البريد الإلكتروني"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <Field label="كلمة المرور" value={password} onChangeText={setPassword} secureTextEntry />
            <PrimaryButton
              label="تسجيل الدخول"
              busy={busy}
              disabled={!staffReady}
              onPress={() =>
                run(async () => setAccount(await signInStaff(email, password)))
              }
            />
          </View>
        ) : (
          <View style={{ gap: spacing.md }}>
            <Field
              label="رقم الجوال"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              editable={!codeSent}
            />

            {codeSent && (
              <>
                <Field
                  label="رمز التحقق"
                  value={code}
                  onChangeText={setCode}
                  keyboardType="number-pad"
                />
                <Text style={{ fontSize: 12, color: colors.textMuted }}>
                  أُرسل الرمز إلى العنوان المسجّل لدى الروضة. صالح ١٠ دقائق.
                </Text>
              </>
            )}

            <PrimaryButton
              label={codeSent ? "دخول" : "إرسال رمز التحقق"}
              busy={busy}
              disabled={codeSent ? !codeReady : !phoneReady}
              onPress={() =>
                run(async () => {
                  if (!codeSent) {
                    await requestGuardianCode(phone);
                    setCodeSent(true);
                    return;
                  }
                  setAccount(await verifyGuardianCode(phone, code));
                })
              }
            />

            {codeSent && (
              <Pressable
                onPress={() => {
                  setCodeSent(false);
                  setCode("");
                  setError(null);
                }}
                style={{ minHeight: TOUCH_TARGET, justifyContent: "center" }}
              >
                <Text style={{ color: colors.teal, fontSize: 14, textAlign: "center" }}>
                  تغيير رقم الجوال
                </Text>
              </Pressable>
            )}
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({
  label,
  ...props
}: { label: string } & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={{ fontSize: 13, color: colors.textMuted }}>{label}</Text>
      <TextInput
        {...props}
        style={{
          minHeight: TOUCH_TARGET,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.md,
          paddingHorizontal: spacing.md,
          fontSize: 16,
          color: colors.navy,
          textAlign: "right",
        }}
      />
    </View>
  );
}

function PrimaryButton({
  label,
  onPress,
  busy,
  disabled,
}: {
  label: string;
  onPress: () => void;
  busy: boolean;
  disabled: boolean;
}) {
  const off = busy || disabled;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      style={{
        minHeight: TOUCH_TARGET + 4,
        borderRadius: radius.lg,
        backgroundColor: colors.coral,
        alignItems: "center",
        justifyContent: "center",
        opacity: off ? 0.5 : 1,
      }}
    >
      {busy ? (
        <ActivityIndicator color="#FFFFFF" />
      ) : (
        <Text style={{ color: "#FFFFFF", fontSize: 16, fontWeight: "700" }}>{label}</Text>
      )}
    </Pressable>
  );
}
