import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  CARE_TYPES,
  MEAL_AMOUNTS,
  MOODS,
  TOILET_KINDS,
  fileCareReport,
  type CareReportInput,
  type CareType,
} from "./api/care";
import { colors, radius, spacing, TOUCH_TARGET } from "./theme";

/**
 * Filing a report, from the bottom of the screen.
 *
 * A sheet rather than a centred dialog because the reader is holding a phone in
 * one hand with a child in the other, and the bottom of the screen is the part
 * of it a thumb reaches.
 *
 * Two steps, not a form: pick the kind, then fill in only what that kind owns.
 * Showing all the fields at once and greying out the irrelevant ones would mean
 * a nap report displaying a temperature box.
 */
export function CareSheet({
  childIds,
  childLabel,
  onClose,
  onFiled,
}: {
  childIds: string[];
  childLabel: string;
  onClose: () => void;
  onFiled: (count: number) => void;
}) {
  const insets = useSafeAreaInsets();
  const [type, setType] = useState<CareType | null>(null);
  const [draft, setDraft] = useState<CareReportInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function choose(next: CareType) {
    setType(next);
    setDraft({ type: next });
    setError(null);
  }

  function set(field: keyof CareReportInput, value: string | number | null) {
    setDraft((current) => (current ? { ...current, [field]: value } : current));
  }

  async function file() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      const count = await fileCareReport(childIds, draft);
      onFiled(count);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذّر حفظ التقرير");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />

        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View
            style={{
              backgroundColor: colors.surface,
              borderTopLeftRadius: radius.xl,
              borderTopRightRadius: radius.xl,
              padding: spacing.lg,
              paddingBottom: insets.bottom + spacing.lg,
              maxHeight: "85%",
            }}
          >
            {/* The grab handle is what says "this pulls down" on a phone. */}
            <View
              style={{
                width: 40,
                height: 4,
                borderRadius: 2,
                backgroundColor: colors.border,
                alignSelf: "center",
                marginBottom: spacing.md,
              }}
            />

            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md }}>
              <Text style={{ fontSize: 17, fontWeight: "700", color: colors.navy }}>{childLabel}</Text>
              <Pressable onPress={onClose} style={{ minHeight: TOUCH_TARGET, justifyContent: "center", paddingHorizontal: spacing.sm }}>
                <Text style={{ color: colors.textMuted, fontSize: 14 }}>إغلاق</Text>
              </Pressable>
            </View>

            {error && (
              <View style={{ backgroundColor: colors.dangerBg, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md }}>
                <Text style={{ color: colors.danger, fontSize: 14 }}>{error}</Text>
              </View>
            )}

            <ScrollView keyboardShouldPersistTaps="handled">
              {/* Step one: the kind. */}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
                {CARE_TYPES.map((option) => (
                  <Pressable
                    key={option.value}
                    onPress={() => choose(option.value)}
                    style={{
                      minHeight: TOUCH_TARGET,
                      paddingHorizontal: spacing.md,
                      justifyContent: "center",
                      borderRadius: radius.md,
                      backgroundColor: type === option.value ? colors.teal : "#F3F4F6",
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 14,
                        fontWeight: type === option.value ? "700" : "400",
                        color: type === option.value ? "#FFFFFF" : colors.navy,
                      }}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {/* Step two: only what this kind owns. */}
              {type && draft && (
                <View style={{ gap: spacing.md, marginTop: spacing.lg }}>
                  {type === "MEAL" && (
                    <>
                      <Field label="الوجبة" onChangeText={(v) => set("mealName", v)} />
                      <Choices
                        label="الكمية"
                        options={MEAL_AMOUNTS}
                        value={draft.mealAmount ?? null}
                        onPick={(v) => set("mealAmount", v)}
                      />
                    </>
                  )}

                  {type === "NAP" && <Field label="جودة النوم" onChangeText={(v) => set("napQuality", v)} />}

                  {type === "TOILET" && (
                    <>
                      <Choices
                        label="النوع"
                        options={TOILET_KINDS}
                        value={draft.toiletKind ?? null}
                        onPick={(v) => set("toiletKind", v)}
                      />
                      <Field label="الحالة" onChangeText={(v) => set("toiletState", v)} />
                    </>
                  )}

                  {type === "MOOD" && (
                    <Choices
                      label="الحالة"
                      options={MOODS}
                      value={draft.mood ?? null}
                      onPick={(v) => set("mood", v)}
                    />
                  )}

                  {type === "MEDICATION" && (
                    <>
                      <Field label="اسم الدواء" onChangeText={(v) => set("medicationName", v)} />
                      <Field label="الجرعة" onChangeText={(v) => set("medicationDose", v)} />
                    </>
                  )}

                  {type === "HEALTH" && (
                    <>
                      <Field
                        label="الحرارة"
                        keyboardType="decimal-pad"
                        onChangeText={(v) => {
                          // Blank clears it rather than sending NaN, which the
                          // server would reject as a malformed number.
                          const parsed = Number(v);
                          set("temperature", v.trim() && Number.isFinite(parsed) ? parsed : null);
                        }}
                      />
                      <Field label="العَرَض" onChangeText={(v) => set("symptom", v)} />
                    </>
                  )}

                  {type === "SUPPLIES" && <Field label="المطلوب" onChangeText={(v) => set("supplyItem", v)} />}

                  <Field label="ملاحظة" multiline onChangeText={(v) => set("note", v)} />

                  <Pressable
                    onPress={file}
                    disabled={busy}
                    style={{
                      minHeight: TOUCH_TARGET + 4,
                      borderRadius: radius.lg,
                      backgroundColor: colors.coral,
                      alignItems: "center",
                      justifyContent: "center",
                      opacity: busy ? 0.6 : 1,
                    }}
                  >
                    {busy ? (
                      <ActivityIndicator color="#FFFFFF" />
                    ) : (
                      <Text style={{ color: "#FFFFFF", fontSize: 16, fontWeight: "700" }}>حفظ</Text>
                    )}
                  </Pressable>
                </View>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function Field({ label, ...props }: { label: string } & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={{ fontSize: 13, color: colors.textMuted }}>{label}</Text>
      <TextInput
        {...props}
        style={{
          minHeight: props.multiline ? TOUCH_TARGET * 1.6 : TOUCH_TARGET,
          backgroundColor: colors.bg,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.md,
          paddingHorizontal: spacing.md,
          paddingTop: props.multiline ? spacing.sm : 0,
          fontSize: 16,
          color: colors.navy,
          textAlign: "right",
          textAlignVertical: props.multiline ? "top" : "center",
        }}
      />
    </View>
  );
}

function Choices({
  label,
  options,
  value,
  onPick,
}: {
  label: string;
  options: readonly { value: string; label: string }[];
  value: string | null;
  onPick: (value: string) => void;
}) {
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={{ fontSize: 13, color: colors.textMuted }}>{label}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
        {options.map((option) => (
          <Pressable
            key={option.value}
            onPress={() => onPick(option.value)}
            style={{
              minHeight: TOUCH_TARGET,
              paddingHorizontal: spacing.md,
              justifyContent: "center",
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: value === option.value ? colors.teal : colors.border,
              backgroundColor: value === option.value ? colors.tealLight : colors.surface,
            }}
          >
            <Text style={{ fontSize: 14, color: value === option.value ? colors.teal : colors.navy }}>
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
