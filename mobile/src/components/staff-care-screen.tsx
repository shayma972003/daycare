import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  createDailyCareReports,
  loadCareReportPolicy,
  loadCareStudents,
  loadReturnedDailyCareReports,
  resubmitReturnedDailyCareReport,
  type CareStudent,
  type CareSubmissionResult,
  type DailyCareEntry,
  type DailyCarePayload,
  type ReturnedDailyCareBatch,
} from "@/api/care";
import { riyadhDateKey } from "@/calendar/week";
import { AppScreen } from "@/components/app-screen";
import { PrimaryButton, TextButton } from "@/components/buttons";
import { useSession } from "@/session";
import { colors, radius, spacing, touchTarget } from "@/theme";

type MealAmount = "" | "ALL" | "HALF" | "LITTLE" | "REFUSED";
type NapStatus = "NO_RECORD" | "SLEPT" | "DID_NOT_SLEEP";
type ToiletValue = "NO_RECORD" | "DIAPER_WET" | "DIAPER_SOILED" | "POTTY";
type Mood = "" | "HAPPY" | "CALM" | "TIRED" | "UPSET" | "CRYING" | "UNWELL";

type EntryState = {
  mealAmount: MealAmount;
  napStatus: NapStatus;
  napStart: string;
  napEnd: string;
  toilet: ToiletValue;
  toiletTime: string;
  mood: Mood;
  note: string;
  supplies: string;
  health: string;
  medicationName: string;
  medicationDose: string;
  medicationTime: string;
};

function currentTime() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function blankEntry(): EntryState {
  return {
    mealAmount: "",
    napStatus: "NO_RECORD",
    napStart: "",
    napEnd: "",
    toilet: "NO_RECORD",
    toiletTime: "",
    mood: "",
    note: "",
    supplies: "",
    health: "",
    medicationName: "",
    medicationDose: "",
    medicationTime: "",
  };
}

function batchKey() {
  return globalThis.crypto?.randomUUID?.() ?? `care-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function asciiDigits(value: string) {
  const arabic = "٠١٢٣٤٥٦٧٨٩";
  const persian = "۰۱۲۳۴۵۶۷۸۹";
  return value.replace(/[٠-٩۰-۹]/g, (digit) => {
    const arabicIndex = arabic.indexOf(digit);
    return String(arabicIndex >= 0 ? arabicIndex : persian.indexOf(digit));
  });
}

function normalizeTime(value: string): string | null {
  const clean = asciiDigits(value).trim().replace("٫", ":").replace(".", ":");
  if (!clean) return null;
  const match = clean.match(/^(\d{1,2})(?::(\d{1,2}))?$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = match[2] === undefined ? 0 : Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function localIso(date: string, time: string) {
  return new Date(`${date}T${time}:00+03:00`).toISOString();
}

function timeFromIso(value: string | null | undefined) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Riyadh",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function formatReturnedAt(value: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("ar-SA", {
    timeZone: "Asia/Riyadh",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function entryFromReturned(entry: DailyCareEntry): EntryState {
  return {
    mealAmount: entry.mealAmount ?? "",
    napStatus: entry.napStatus,
    napStart: timeFromIso(entry.napStartAt),
    napEnd: timeFromIso(entry.napEndAt),
    toilet: entry.toilet,
    toiletTime: timeFromIso(entry.toiletOccurredAt),
    mood: entry.mood ?? "",
    note: entry.note ?? "",
    supplies: entry.supplies ?? "",
    health: entry.health ?? "",
    medicationName: entry.medication?.name ?? "",
    medicationDose: entry.medication?.dose ?? "",
    medicationTime: timeFromIso(entry.medication?.occurredAt),
  };
}

function freshEntries(students: CareStudent[], returned?: ReturnedDailyCareBatch) {
  const returnedByStudent = new Map(
    returned?.entries.map((entry) => [entry.studentId, entry]) ?? []
  );
  return Object.fromEntries(students.map((student) => [
    student.id,
    returnedByStudent.has(student.id)
      ? entryFromReturned(returnedByStudent.get(student.id)!)
      : blankEntry(),
  ]));
}

export function StaffCareScreen() {
  const { account, signOut } = useSession();
  const [activeTab, setActiveTab] = useState<"create" | "returned">("create");
  const [students, setStudents] = useState<CareStudent[]>([]);
  const [returned, setReturned] = useState<ReturnedDailyCareBatch[]>([]);
  const [selectedReturned, setSelectedReturned] = useState<ReturnedDailyCareBatch | null>(null);
  const [reviewRequired, setReviewRequired] = useState(true);
  const [loadingStudents, setLoadingStudents] = useState(true);
  const [loadingReturned, setLoadingReturned] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const reportableStudents = useMemo(
    () => students.filter((student) => !student.hasDailyCareReportToday),
    [students]
  );

  const loadStudents = useCallback(async () => {
    setLoadingStudents(true);
    setLoadError(null);
    try {
      setStudents(await loadCareStudents());
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : "تعذّر تحميل الأطفال");
    } finally {
      setLoadingStudents(false);
    }
  }, []);

  const loadReturned = useCallback(async () => {
    setLoadingReturned(true);
    setLoadError(null);
    try {
      setReturned(await loadReturnedDailyCareReports());
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : "تعذّر تحميل التقارير المرتجعة");
    } finally {
      setLoadingReturned(false);
    }
  }, []);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const [nextStudents, nextReturned, policy] = await Promise.all([
          loadCareStudents(),
          loadReturnedDailyCareReports(),
          loadCareReportPolicy().catch(() => ({ reviewRequired: true })),
        ]);
        if (!active) return;
        setStudents(nextStudents);
        setReturned(nextReturned);
        setReviewRequired(policy.reviewRequired);
      } catch (caught) {
        if (!active) return;
        setLoadError(caught instanceof Error ? caught.message : "تعذّر تحميل تقارير الرعاية");
      } finally {
        if (active) {
          setLoadingStudents(false);
          setLoadingReturned(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  if (!account || account.kind !== "staff") return null;

  return (
    <AppScreen
      action={<TextButton label="تسجيل الخروج" onPress={() => void signOut()} />}
      subtitle={account.schoolName}
      title="تقارير الرعاية"
    >
      <View accessibilityRole="tablist" style={styles.modeTabs}>
        <ModeTab
          active={activeTab === "create"}
          label="إنشاء التقارير"
          onPress={() => {
            setActiveTab("create");
            setSelectedReturned(null);
          }}
        />
        <ModeTab
          active={activeTab === "returned"}
          count={returned.length}
          label="مرتجعة للتعديل"
          onPress={() => setActiveTab("returned")}
        />
      </View>

      {loadError ? <Text style={styles.error}>{loadError}</Text> : null}

      {activeTab === "create" ? (
        loadingStudents ? (
          <LoadingState label="جارٍ تحميل الأطفال…" />
        ) : students.length === 0 ? (
          <EmptyState label="لا يوجد أطفال مرتبطون بفصولك" onRetry={loadStudents} />
        ) : reportableStudents.length === 0 ? (
          <EmptyState label="تم إرسال تقارير جميع الأطفال اليوم" onRetry={loadStudents} />
        ) : (
          <DailyCareForm
            key="create"
            onCreated={(studentIds) => setStudents((current) => current.map((student) => (
              studentIds.includes(student.id)
                ? { ...student, hasDailyCareReportToday: true }
                : student
            )))}
            onSubmit={createDailyCareReports}
            reviewRequired={reviewRequired}
            students={reportableStudents}
          />
        )
      ) : selectedReturned ? (
        <DailyCareForm
          initialBatch={selectedReturned}
          key={selectedReturned.batchId}
          onBack={() => setSelectedReturned(null)}
          onSubmit={(payload) => resubmitReturnedDailyCareReport(selectedReturned.batchId, payload)}
          onSubmitted={async () => {
            setSelectedReturned(null);
            await loadReturned();
          }}
          reviewRequired={reviewRequired}
          students={selectedReturned.students}
        />
      ) : loadingReturned ? (
        <LoadingState label="جارٍ تحميل التقارير المرتجعة…" />
      ) : returned.length === 0 ? (
        <View style={styles.emptyPanel}>
          <Text style={styles.emptyTitle}>لا توجد تقارير مرتجعة</Text>
          <Text style={styles.emptyCopy}>ستظهر هنا التقارير التي تعيدها الإدارة للتعديل.</Text>
          <TextButton label="تحديث" onPress={() => void loadReturned()} />
        </View>
      ) : (
        <ReturnedList batches={returned} onOpen={setSelectedReturned} onRefresh={loadReturned} />
      )}
    </AppScreen>
  );
}

function ModeTab({ active, count, label, onPress }: {
  active: boolean;
  count?: number;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.modeTab, active && styles.modeTabActive]}
    >
      <Text style={[styles.modeTabText, active && styles.modeTabTextActive]}>{label}</Text>
      {count ? <Text style={styles.modeCount}>{count}</Text> : null}
    </Pressable>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <View style={styles.statePanel}>
      <ActivityIndicator color={colors.primary} size="large" />
      <Text style={styles.stateCopy}>{label}</Text>
    </View>
  );
}

function EmptyState({ label, onRetry }: { label: string; onRetry: () => Promise<void> }) {
  return (
    <View style={styles.statePanel}>
      <Text style={styles.emptyTitle}>{label}</Text>
      <PrimaryButton label="إعادة المحاولة" onPress={() => void onRetry()} />
    </View>
  );
}

function ReturnedList({ batches, onOpen, onRefresh }: {
  batches: ReturnedDailyCareBatch[];
  onOpen: (batch: ReturnedDailyCareBatch) => void;
  onRefresh: () => Promise<void>;
}) {
  return (
    <View style={styles.listSection}>
      <SectionHeading
        subtitle="راجعي ملاحظة الإدارة ثم عدّلي التقرير وأعيدي إرساله."
        title="بحاجة إلى تعديل"
      />
      {batches.map((batch) => (
        <View key={batch.batchId} style={styles.returnedCard}>
          <View style={styles.returnedHeader}>
            <View style={styles.returnedTitleCopy}>
              <Text style={styles.returnedTitle}>{batch.students.map((student) => student.name).join("، ")}</Text>
              <Text style={styles.metaText}>{batch.students.length} أطفال · {formatReturnedAt(batch.returnedAt)}</Text>
            </View>
            <View style={styles.returnedBadge}>
              <Text style={styles.returnedBadgeText}>مرتجع</Text>
            </View>
          </View>
          <View style={styles.reviewNoteBox}>
            <Text style={styles.reviewNoteLabel}>ملاحظة الإدارة</Text>
            <Text style={styles.reviewNoteText}>{batch.reviewNote || "لم تُضف ملاحظة."}</Text>
          </View>
          <PrimaryButton label="فتح وتعديل التقرير" onPress={() => onOpen(batch)} />
        </View>
      ))}
      <TextButton label="تحديث القائمة" onPress={() => void onRefresh()} />
    </View>
  );
}

function DailyCareForm({ initialBatch, onBack, onCreated, onSubmit, onSubmitted, reviewRequired, students }: {
  initialBatch?: ReturnedDailyCareBatch;
  onBack?: () => void;
  onCreated?: (studentIds: string[]) => void;
  onSubmit: (payload: DailyCarePayload) => Promise<CareSubmissionResult>;
  onSubmitted?: () => Promise<void> | void;
  reviewRequired: boolean;
  students: CareStudent[];
}) {
  const today = useMemo(() => riyadhDateKey(new Date()), []);
  const returnedMode = Boolean(initialBatch);
  const [selectedIds, setSelectedIds] = useState<string[]>(() => students.map((student) => student.id));
  const [entries, setEntries] = useState<Record<string, EntryState>>(() => freshEntries(students, initialBatch));
  const [mealSource, setMealSource] = useState<"CENTER" | "HOME">(() => initialBatch?.meal.source ?? "CENTER");
  const [mealName, setMealName] = useState(() => initialBatch?.meal.name ?? "");
  const [mealTime, setMealTime] = useState(() => timeFromIso(initialBatch?.meal.occurredAt) || currentTime());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => initialBatch?.batchId ?? batchKey());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const updateEntry = (studentId: string, patch: Partial<EntryState>) => {
    setEntries((current) => ({
      ...current,
      [studentId]: { ...(current[studentId] ?? blankEntry()), ...patch },
    }));
    setSuccess(null);
  };

  const toggleStudent = (id: string) => {
    if (returnedMode) return;
    setSelectedIds((current) => (
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
    ));
    setSuccess(null);
  };

  const validationError = useMemo(() => {
    if (selectedIds.length === 0) return "اختاري طفلاً واحداً على الأقل";
    for (const studentId of selectedIds) {
      const entry = entries[studentId] ?? blankEntry();
      const napStart = normalizeTime(entry.napStart);
      const napEnd = normalizeTime(entry.napEnd);
      if (napStart && napEnd && napEnd <= napStart) {
        return "نهاية النوم يجب أن تكون بعد بدايته";
      }
    }
    return null;
  }, [entries, selectedIds]);

  const resetAfterCreate = (
    submittedStudentIds: string[],
    status: CareSubmissionResult["status"]
  ) => {
    const remainingStudents = students.filter((student) => !submittedStudentIds.includes(student.id));
    setSelectedIds(remainingStudents.map((student) => student.id));
    setEntries(freshEntries(remainingStudents));
    setMealSource("CENTER");
    setMealName("");
    setMealTime(currentTime());
    setExpandedId(null);
    setIdempotencyKey(batchKey());
    setError(null);
    setSuccess(status === "APPROVED"
      ? `تم إرسال تقارير ${submittedStudentIds.length} أطفال مباشرة لأولياء الأمور`
      : `تم إرسال تقارير ${submittedStudentIds.length} أطفال للمراجعة`);
    onCreated?.(submittedStudentIds);
  };

  const submit = async () => {
    if (validationError) {
      setError(validationError);
      return;
    }
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    const submittedStudentIds = [...selectedIds];
    try {
      const sharedMealTime = normalizeTime(mealTime) ?? currentTime();
      const payload: DailyCarePayload = {
        idempotencyKey,
        meal: {
          source: mealSource,
          name: mealSource === "CENTER" ? mealName.trim() || null : null,
          occurredAt: localIso(today, sharedMealTime),
        },
        entries: selectedIds.map((studentId) => toPayloadEntry(studentId, entries[studentId], today)),
      };
      const result = await onSubmit(payload);
      if (onSubmitted) {
        await onSubmitted();
      } else {
        resetAfterCreate(submittedStudentIds, result.status);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذّر إرسال التقرير");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.formStack}>
      {returnedMode ? (
        <View style={styles.returnedEditorHeader}>
          <View style={styles.returnedEditorTitleRow}>
            <Text style={styles.returnedEditorTitle}>تعديل التقرير المرتجع</Text>
            {onBack ? <TextButton label="رجوع" onPress={onBack} /> : null}
          </View>
          <View style={styles.reviewNoteBox}>
            <Text style={styles.reviewNoteLabel}>ملاحظة الإدارة</Text>
            <Text style={styles.reviewNoteText}>{initialBatch?.reviewNote || "لم تُضف ملاحظة."}</Text>
          </View>
        </View>
      ) : null}

      <View style={styles.sectionPanel}>
        <SectionHeading subtitle="تُكتب مرة واحدة وتُطبّق على الأطفال المحددين." title="الوجبة المشتركة" />
        <View style={styles.sectionBody}>
          <LabeledChoices
            label="مصدر الوجبة"
            onChange={(value) => setMealSource(value as "CENTER" | "HOME")}
            options={[["CENTER", "المدرسة"], ["HOME", "من المنزل"]]}
            value={mealSource}
          />
          {mealSource === "CENTER" ? (
            <Field label="اسم الوجبة (اختياري)" onChangeText={setMealName} value={mealName} />
          ) : null}
          <TimePickerField label="وقت الوجبة (اختياري)" onChange={setMealTime} value={mealTime} />
        </View>
      </View>

      <View style={styles.sectionPanel}>
        <View style={styles.childrenHeading}>
          <SectionHeading subtitle="كل الحقول اختيارية؛ سجّلي فقط ما حدث للطفل." title="تفاصيل الأطفال" />
          <View style={styles.selectionSummary}>
            <Text style={styles.selectionText}>{selectedIds.length} محدد</Text>
            {!returnedMode ? (
              <TextButton
                label={selectedIds.length === students.length ? "إلغاء الكل" : "تحديد الكل"}
                onPress={() => setSelectedIds(
                  selectedIds.length === students.length ? [] : students.map((student) => student.id)
                )}
              />
            ) : null}
          </View>
        </View>

        <View style={styles.childrenTable}>
          {students.map((student, index) => (
            <ChildCareRow
              entry={entries[student.id] ?? blankEntry()}
              expanded={expandedId === student.id}
              isLast={index === students.length - 1}
              key={student.id}
              locked={returnedMode}
              onChange={(patch) => updateEntry(student.id, patch)}
              onToggle={() => toggleStudent(student.id)}
              onToggleExpanded={() => setExpandedId(expandedId === student.id ? null : student.id)}
              selected={selectedIds.includes(student.id)}
              student={student}
            />
          ))}
        </View>
      </View>

      {success ? <Text style={styles.success}>{success}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!error && validationError ? <Text style={styles.validation}>{validationError}</Text> : null}
      <PrimaryButton
        disabled={Boolean(validationError)}
        label={returnedMode
          ? reviewRequired ? "إعادة الإرسال للمراجعة" : "إرسال التقرير المعدّل مباشرة"
          : reviewRequired ? "إرسال التقارير للمراجعة" : "إرسال التقارير مباشرة"}
        loading={submitting}
        onPress={() => void submit()}
      />
    </View>
  );
}

function SectionHeading({ subtitle, title }: { subtitle: string; title: string }) {
  return (
    <View style={styles.sectionHeading}>
      <View style={styles.sectionAccent} />
      <View style={styles.sectionHeadingCopy}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.sectionSubtitle}>{subtitle}</Text>
      </View>
    </View>
  );
}

function toPayloadEntry(studentId: string, value: EntryState | undefined, date: string): DailyCareEntry {
  const entry = value ?? blankEntry();
  const napStart = normalizeTime(entry.napStart);
  const napEnd = normalizeTime(entry.napEnd);
  const toiletTime = normalizeTime(entry.toiletTime);
  const medicationTime = normalizeTime(entry.medicationTime);
  const hasMedication = Boolean(entry.medicationName.trim() || entry.medicationDose.trim() || medicationTime);
  return {
    studentId,
    mealAmount: entry.mealAmount || null,
    napStatus: entry.napStatus,
    napStartAt: entry.napStatus === "SLEPT" && napStart ? localIso(date, napStart) : null,
    napEndAt: entry.napStatus === "SLEPT" && napEnd ? localIso(date, napEnd) : null,
    toilet: entry.toilet,
    toiletOccurredAt: entry.toilet !== "NO_RECORD" && toiletTime ? localIso(date, toiletTime) : null,
    mood: entry.mood || null,
    note: entry.note.trim() || null,
    extraEvents: [],
    supplies: entry.supplies.trim() || null,
    health: entry.health.trim() || null,
    medication: hasMedication ? {
      name: entry.medicationName.trim(),
      dose: entry.medicationDose.trim(),
      occurredAt: medicationTime ? localIso(date, medicationTime) : null,
    } : null,
  };
}

function ChildCareRow({ entry, expanded, isLast, locked, onChange, onToggle, onToggleExpanded, selected, student }: {
  entry: EntryState;
  expanded: boolean;
  isLast: boolean;
  locked: boolean;
  onChange: (patch: Partial<EntryState>) => void;
  onToggle: () => void;
  onToggleExpanded: () => void;
  selected: boolean;
  student: CareStudent;
}) {
  return (
    <View style={[styles.childRow, !isLast && styles.childRowBorder, !selected && styles.childRowInactive]}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected, disabled: locked }}
        disabled={locked}
        onPress={onToggle}
        style={styles.childHeader}
      >
        <View style={[styles.check, selected && styles.checkSelected]}>
          <Text style={styles.checkText}>{selected ? "✓" : ""}</Text>
        </View>
        <View style={styles.childCopy}>
          <Text style={styles.childName}>{student.name}</Text>
          <Text style={styles.childClass}>{student.className || "بدون فصل"}</Text>
        </View>
      </Pressable>

      {selected ? (
        <View style={styles.childFields}>
          <LabeledChoices label="كمية الوجبة" onChange={(value) => onChange({ mealAmount: value as MealAmount })} options={[["ALL", "الكل"], ["HALF", "النصف"], ["LITTLE", "قليل"], ["REFUSED", "رفض"]]} value={entry.mealAmount} />
          <View style={styles.fieldDivider} />
          <LabeledChoices label="النوم" onChange={(value) => onChange({ napStatus: value as NapStatus, ...(value !== "SLEPT" ? { napStart: "", napEnd: "" } : {}) })} options={[["NO_RECORD", "لم يسجل"], ["SLEPT", "نام"], ["DID_NOT_SLEEP", "لم ينم"]]} value={entry.napStatus} />
          {entry.napStatus === "SLEPT" ? (
            <View style={styles.twoColumns}>
              <TimePickerField compact label="من (اختياري)" onChange={(napStart) => onChange({ napStart })} value={entry.napStart} />
              <TimePickerField compact label="إلى (اختياري)" onChange={(napEnd) => onChange({ napEnd })} value={entry.napEnd} />
            </View>
          ) : null}
          <View style={styles.fieldDivider} />
          <LabeledChoices label="دورة المياه" onChange={(value) => onChange({ toilet: value as ToiletValue })} options={[["NO_RECORD", "لم يسجل"], ["DIAPER_WET", "حفاض مبلل"], ["DIAPER_SOILED", "حفاض متسخ"], ["POTTY", "حمّام"]]} value={entry.toilet} />
          {entry.toilet !== "NO_RECORD" ? <TimePickerField label="الوقت (اختياري)" onChange={(toiletTime) => onChange({ toiletTime })} value={entry.toiletTime} /> : null}
          <View style={styles.fieldDivider} />
          <LabeledChoices label="المزاج" onChange={(value) => onChange({ mood: value as Mood })} options={[["", "لم يسجل"], ["HAPPY", "سعيد"], ["CALM", "هادئ"], ["TIRED", "متعب"], ["UPSET", "منزعج"], ["CRYING", "يبكي"], ["UNWELL", "متوعك"]]} value={entry.mood} />
          <Pressable accessibilityRole="button" onPress={onToggleExpanded} style={styles.detailsButton}>
            <Text style={styles.detailsButtonText}>ملاحظات وتفاصيل إضافية</Text>
            <Text style={styles.detailsChevron}>{expanded ? "−" : "+"}</Text>
          </Pressable>
          {expanded ? (
            <View style={styles.extraFields}>
              <Field label="ملاحظة" multiline onChangeText={(note) => onChange({ note })} value={entry.note} />
              <Field label="مستلزمات مطلوبة" onChangeText={(supplies) => onChange({ supplies })} value={entry.supplies} />
              <Field label="ملاحظة صحية" multiline onChangeText={(health) => onChange({ health })} value={entry.health} />
              <View style={styles.subsectionHeading}>
                <Text style={styles.subsectionTitle}>الدواء (اختياري)</Text>
                <Text style={styles.subsectionCopy}>يمكن تعبئة أي معلومة متوفرة فقط.</Text>
              </View>
              <Field label="اسم الدواء" onChangeText={(medicationName) => onChange({ medicationName })} value={entry.medicationName} />
              <Field label="الجرعة" onChangeText={(medicationDose) => onChange({ medicationDose })} value={entry.medicationDose} />
              <TimePickerField label="الوقت" onChange={(medicationTime) => onChange({ medicationTime })} value={entry.medicationTime} />
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function LabeledChoices({ label, onChange, options, value }: {
  label: string;
  onChange: (value: string) => void;
  options: [string, string][];
  value: string;
}) {
  return (
    <View style={styles.choiceField}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.options}>
        {options.map(([optionValue, optionLabel]) => (
          <Choice active={value === optionValue} key={`${label}-${optionValue || "empty"}`} label={optionLabel} onPress={() => onChange(optionValue)} />
        ))}
      </View>
    </View>
  );
}

function Choice({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress} style={[styles.choice, active && styles.choiceActive]}>
      <Text style={[styles.choiceText, active && styles.choiceTextActive]}>{label}</Text>
    </Pressable>
  );
}

function timePickerParts(value: string) {
  const normalized = normalizeTime(value) ?? currentTime();
  const [hour24, rawMinute] = normalized.split(":").map(Number);
  return {
    hour: hour24 % 12 || 12,
    minute: Math.floor(rawMinute / 5) * 5,
    period: (hour24 >= 12 ? "PM" : "AM") as "AM" | "PM",
  };
}

function displayTime(value: string) {
  if (!value) return "اختيار الوقت";
  const normalized = normalizeTime(value);
  if (!normalized) return "اختيار الوقت";
  const [hour24, minute] = normalized.split(":").map(Number);
  return `${hour24 % 12 || 12}:${String(minute).padStart(2, "0")} ${hour24 >= 12 ? "م" : "ص"}`;
}

function TimePickerField({ compact = false, label, onChange, value }: {
  compact?: boolean;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  const initial = timePickerParts(value);
  const [open, setOpen] = useState(false);
  const [hour, setHour] = useState(initial.hour);
  const [minute, setMinute] = useState(initial.minute);
  const [period, setPeriod] = useState<"AM" | "PM">(initial.period);

  const openPicker = () => {
    const next = timePickerParts(value);
    setHour(next.hour);
    setMinute(next.minute);
    setPeriod(next.period);
    setOpen(true);
  };

  const confirm = () => {
    const hour24 = period === "AM"
      ? hour % 12
      : (hour % 12) + 12;
    onChange(`${String(hour24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
    setOpen(false);
  };

  return (
    <View style={[styles.field, compact && styles.compactField]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable accessibilityRole="button" onPress={openPicker} style={styles.timeButton}>
        <Text style={[styles.timeButtonText, !value && styles.timeButtonPlaceholder]}>{displayTime(value)}</Text>
        <Text style={styles.timeIcon}>◷</Text>
      </Pressable>
      <Modal animationType="fade" onRequestClose={() => setOpen(false)} transparent visible={open}>
        <View style={styles.modalOverlay}>
          <View style={styles.timeModal}>
            <Text style={styles.timeModalTitle}>{label}</Text>
            <Text style={styles.timeModalHint}>اختاري الساعة والدقيقة</Text>
            <View style={styles.timeSelectors}>
              <TimeStepper
                label="الساعة"
                onDecrease={() => setHour((current) => current === 1 ? 12 : current - 1)}
                onIncrease={() => setHour((current) => current === 12 ? 1 : current + 1)}
                value={String(hour).padStart(2, "0")}
              />
              <TimeStepper
                label="الدقيقة"
                onDecrease={() => setMinute((current) => current === 0 ? 55 : current - 5)}
                onIncrease={() => setMinute((current) => current === 55 ? 0 : current + 5)}
                value={String(minute).padStart(2, "0")}
              />
            </View>
            <View style={styles.periodChoices}>
              <Choice active={period === "AM"} label="صباحًا" onPress={() => setPeriod("AM")} />
              <Choice active={period === "PM"} label="مساءً" onPress={() => setPeriod("PM")} />
            </View>
            <View style={styles.timeModalActions}>
              <TextButton label="إلغاء" onPress={() => setOpen(false)} />
              <TextButton label="مسح الوقت" onPress={() => { onChange(""); setOpen(false); }} />
              <PrimaryButton label="اعتماد" onPress={confirm} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function TimeStepper({ label, onDecrease, onIncrease, value }: {
  label: string;
  onDecrease: () => void;
  onIncrease: () => void;
  value: string;
}) {
  return (
    <View style={styles.timeStepper}>
      <Text style={styles.timeStepperLabel}>{label}</Text>
      <View style={styles.timeStepperControls}>
        <Pressable accessibilityLabel={`إنقاص ${label}`} accessibilityRole="button" onPress={onDecrease} style={styles.stepButton}>
          <Text style={styles.stepButtonText}>−</Text>
        </Pressable>
        <Text style={styles.stepValue}>{value}</Text>
        <Pressable accessibilityLabel={`زيادة ${label}`} accessibilityRole="button" onPress={onIncrease} style={styles.stepButton}>
          <Text style={styles.stepButtonText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Field({ compact = false, label, multiline = false, onChangeText, placeholder, value }: {
  compact?: boolean;
  label: string;
  multiline?: boolean;
  onChangeText: (value: string) => void;
  placeholder?: string;
  value: string;
}) {
  return (
    <View style={[styles.field, compact && styles.compactField]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        multiline={multiline}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        style={[styles.input, multiline && styles.multiline]}
        textAlign="right"
        value={value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  modeTabs: { flexDirection: "row-reverse", gap: 6, padding: 6, borderRadius: 999, backgroundColor: colors.primarySoft },
  modeTab: { minHeight: 46, flex: 1, flexDirection: "row-reverse", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 999 },
  modeTabActive: { backgroundColor: colors.primary },
  modeTabText: { color: colors.muted, fontSize: 14, fontWeight: "700" },
  modeTabTextActive: { color: colors.surface, fontWeight: "900" },
  modeCount: { minWidth: 22, height: 22, paddingHorizontal: 6, overflow: "hidden", borderRadius: 999, backgroundColor: colors.danger, color: colors.surface, fontSize: 12, fontWeight: "900", lineHeight: 22, textAlign: "center" },
  formStack: { gap: spacing.md },
  listSection: { gap: spacing.md },
  statePanel: { minHeight: 220, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  stateCopy: { color: colors.muted, fontSize: 14 },
  emptyPanel: { minHeight: 220, alignItems: "center", justifyContent: "center", gap: spacing.sm, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: "900", textAlign: "center" },
  emptyCopy: { color: colors.muted, fontSize: 13, textAlign: "center" },
  sectionPanel: { overflow: "hidden", borderWidth: 1, borderColor: colors.primarySoft, borderRadius: radius.lg, backgroundColor: colors.surface },
  sectionHeading: { minHeight: 72, flexDirection: "row-reverse", alignItems: "stretch", backgroundColor: colors.primarySoft },
  sectionAccent: { width: 0 },
  sectionHeadingCopy: { flex: 1, justifyContent: "center", gap: 3, padding: spacing.md },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: "900", textAlign: "right" },
  sectionSubtitle: { color: colors.muted, fontSize: 12, lineHeight: 19, textAlign: "right" },
  sectionBody: { gap: spacing.md, padding: spacing.md },
  childrenHeading: { backgroundColor: colors.primarySoft },
  selectionSummary: { minHeight: 44, flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md },
  selectionText: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  childrenTable: { gap: spacing.sm, padding: spacing.sm, backgroundColor: colors.background },
  childRow: { overflow: "hidden", borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
  childRowBorder: {},
  childRowInactive: { opacity: 0.58 },
  childHeader: { minHeight: 66, flexDirection: "row-reverse", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.surface },
  check: { width: 30, height: 30, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border, borderRadius: 999, backgroundColor: colors.surface },
  checkSelected: { borderColor: colors.primary, backgroundColor: colors.primary },
  checkText: { color: colors.surface, fontSize: 16, fontWeight: "900" },
  childCopy: { flex: 1, gap: 2 },
  childName: { color: colors.text, fontSize: 16, fontWeight: "900", textAlign: "right" },
  childClass: { color: colors.primary, fontSize: 12, fontWeight: "700", textAlign: "right" },
  childFields: { gap: spacing.md, padding: spacing.md, backgroundColor: "#FCFAFF" },
  fieldDivider: { height: 1, backgroundColor: colors.primarySoft },
  choiceField: { gap: spacing.sm },
  options: { flexDirection: "row-reverse", flexWrap: "wrap", gap: 8 },
  choice: { minHeight: 40, alignItems: "center", justifyContent: "center", paddingHorizontal: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 999, backgroundColor: colors.surface },
  choiceActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  choiceText: { color: colors.text, fontSize: 13, fontWeight: "700" },
  choiceTextActive: { color: colors.primary, fontWeight: "900" },
  twoColumns: { flexDirection: "row-reverse", gap: spacing.sm },
  field: { gap: 7 },
  compactField: { flex: 1 },
  fieldLabel: { color: colors.text, fontSize: 13, fontWeight: "800", textAlign: "right" },
  input: { minHeight: touchTarget, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: 18, backgroundColor: colors.surface, color: colors.text, fontSize: 15, writingDirection: "rtl" },
  timeButton: { minHeight: touchTarget, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: 999, backgroundColor: colors.surface },
  timeButtonText: { color: colors.text, fontSize: 15, fontWeight: "800", writingDirection: "ltr" },
  timeButtonPlaceholder: { color: colors.muted, fontWeight: "600" },
  timeIcon: { color: colors.primary, fontSize: 22, fontWeight: "900" },
  modalOverlay: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg, backgroundColor: "rgba(20, 12, 34, 0.48)" },
  timeModal: { width: "100%", maxWidth: 390, gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface },
  timeModalTitle: { color: colors.text, fontSize: 20, fontWeight: "900", textAlign: "center" },
  timeModalHint: { color: colors.muted, fontSize: 13, textAlign: "center" },
  timeSelectors: { flexDirection: "row-reverse", gap: spacing.md },
  timeStepper: { flex: 1, gap: spacing.sm, alignItems: "center" },
  timeStepperLabel: { color: colors.text, fontSize: 13, fontWeight: "800" },
  timeStepperControls: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  stepButton: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: 999, backgroundColor: colors.primarySoft },
  stepButtonText: { color: colors.primary, fontSize: 23, fontWeight: "900" },
  stepValue: { minWidth: 48, color: colors.text, fontSize: 24, fontWeight: "900", textAlign: "center" },
  periodChoices: { flexDirection: "row-reverse", justifyContent: "center", gap: spacing.sm },
  timeModalActions: { gap: spacing.sm, paddingTop: spacing.sm },
  multiline: { minHeight: 88, textAlignVertical: "top" },
  detailsButton: { minHeight: touchTarget, flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.primarySoft, borderRadius: 999, backgroundColor: colors.primarySoft },
  detailsButtonText: { color: colors.text, fontSize: 14, fontWeight: "800" },
  detailsChevron: { color: colors.primary, fontSize: 20, fontWeight: "900" },
  extraFields: { gap: spacing.md, paddingTop: spacing.sm },
  subsectionHeading: { gap: 3, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  subsectionTitle: { color: colors.text, fontSize: 15, fontWeight: "900", textAlign: "right" },
  subsectionCopy: { color: colors.muted, fontSize: 12, textAlign: "right" },
  returnedCard: { gap: spacing.md, padding: spacing.md, borderWidth: 1, borderColor: colors.warningSoft, borderRadius: radius.lg, backgroundColor: colors.surface },
  returnedHeader: { flexDirection: "row-reverse", alignItems: "flex-start", gap: spacing.sm },
  returnedTitleCopy: { flex: 1, gap: 4 },
  returnedTitle: { color: colors.text, fontSize: 15, fontWeight: "900", textAlign: "right" },
  metaText: { color: colors.muted, fontSize: 12, textAlign: "right" },
  returnedBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.warningSoft },
  returnedBadgeText: { color: colors.warning, fontSize: 11, fontWeight: "900" },
  reviewNoteBox: { gap: 5, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.warningSoft },
  reviewNoteLabel: { color: colors.warning, fontSize: 12, fontWeight: "900", textAlign: "right" },
  reviewNoteText: { color: colors.text, fontSize: 14, lineHeight: 22, textAlign: "right" },
  returnedEditorHeader: { gap: spacing.sm },
  returnedEditorTitleRow: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between" },
  returnedEditorTitle: { color: colors.text, fontSize: 18, fontWeight: "900", textAlign: "right" },
  success: { padding: spacing.md, borderRightWidth: 4, borderRightColor: colors.success, backgroundColor: colors.successSoft, color: colors.success, fontSize: 14, fontWeight: "800", textAlign: "right" },
  error: { padding: spacing.md, borderRightWidth: 4, borderRightColor: colors.danger, backgroundColor: colors.dangerSoft, color: colors.danger, fontSize: 14, fontWeight: "800", textAlign: "right" },
  validation: { color: colors.muted, fontSize: 13, textAlign: "right" },
});
