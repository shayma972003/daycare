import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { sendArrivalNotice } from "@/api/arrival";
import { loadCalendar, type CalendarEventType, type MobileCalendarEvent } from "@/api/calendar";
import { loadGuardianCareReportsForDate, type GuardianCareReport } from "@/api/care";
import { ApiError } from "@/api/client";
import { riyadhDateKey } from "@/calendar/week";
import { AppScreen } from "@/components/app-screen";
import { useSession } from "@/session";
import { colors, radius, spacing, touchTarget } from "@/theme";

const RIYADH_ZONE = "Asia/Riyadh";

const TYPE_LABELS: Record<CalendarEventType, string> = {
  LESSON: "درس",
  ACTIVITY: "نشاط",
  ANNOUNCEMENT: "إعلان",
  UNIT: "وحدة",
};

function countdownLabel(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function eventTime(event: MobileCalendarEvent) {
  if (event.allDay) return "طوال اليوم";
  const formatter = new Intl.DateTimeFormat("ar-SA", {
    timeZone: RIYADH_ZONE,
    hour: "numeric",
    minute: "2-digit",
  });
  const start = formatter.format(new Date(event.startAt));
  return event.endAt ? `${start} – ${formatter.format(new Date(event.endAt))}` : start;
}

export function GuardianHomeScreen() {
  const { account } = useSession();
  const router = useRouter();
  const today = useMemo(() => riyadhDateKey(new Date()), []);
  const [sending, setSending] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const [message, setMessage] = useState<string | null>(null);
  const [arrivalError, setArrivalError] = useState<string | null>(null);
  const [events, setEvents] = useState<MobileCalendarEvent[] | null>(null);
  const [reports, setReports] = useState<GuardianCareReport[] | null>(null);
  const [eventError, setEventError] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const applyResults = useCallback((results: [
    PromiseSettledResult<Awaited<ReturnType<typeof loadCalendar>>>,
    PromiseSettledResult<GuardianCareReport[]>,
  ]) => {
    const [calendarResult, careResult] = results;
    setEvents(calendarResult.status === "fulfilled" ? calendarResult.value.events : null);
    setReports(careResult.status === "fulfilled" ? careResult.value : null);
    setEventError(calendarResult.status === "rejected"
      ? calendarResult.reason instanceof Error
        ? calendarResult.reason.message
        : "تعذّر تحميل أحداث اليوم"
      : null);
    setReportError(careResult.status === "rejected"
      ? careResult.reason instanceof Error
        ? careResult.reason.message
        : "تعذّر تحميل تقارير اليوم"
      : null);
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.allSettled([
      loadCalendar(today, today),
      loadGuardianCareReportsForDate(today),
    ]).then((results) => {
      if (active) applyResults(results);
    });
    return () => {
      active = false;
    };
  }, [applyResults, today]);

  useEffect(() => {
    if (!cooldownUntil) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setClock(now);
      if (now >= cooldownUntil) {
        clearInterval(timer);
        setCooldownUntil(null);
      }
    }, 1_000);
    return () => clearInterval(timer);
  }, [cooldownUntil]);

  const remainingSeconds = useMemo(
    () => cooldownUntil ? Math.max(0, Math.ceil((cooldownUntil - clock) / 1_000)) : 0,
    [clock, cooldownUntil]
  );
  const reportChildren = useMemo(
    () => Array.from(new Set(reports?.map((report) => report.student.name) ?? [])),
    [reports]
  );

  if (!account || account.kind !== "guardian") return null;

  const refresh = async () => {
    setRefreshing(true);
    setEventError(null);
    setReportError(null);
    try {
      const results = await Promise.allSettled([
        loadCalendar(today, today),
        loadGuardianCareReportsForDate(today),
      ]);
      applyResults(results);
    } finally {
      setRefreshing(false);
    }
  };

  const send = async () => {
    if (sending || remainingSeconds > 0) return;
    setSending(true);
    setMessage(null);
    setArrivalError(null);
    try {
      const result = await sendArrivalNotice();
      setCooldownUntil(new Date(result.expectedAt).getTime());
      setClock(Date.now());
      setMessage("تم إرسال إشعار الوصول");
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "ARRIVAL_COOLDOWN") {
        const wait = caught.retryAfterSeconds ?? 300;
        setCooldownUntil(Date.now() + wait * 1_000);
        setClock(Date.now());
      }
      setArrivalError(caught instanceof Error ? caught.message : "تعذّر إرسال الإشعار");
    } finally {
      setSending(false);
    }
  };

  return (
    <AppScreen
      action={(
        <Pressable
          accessibilityLabel="تحديث الرئيسية"
          accessibilityRole="button"
          disabled={refreshing}
          onPress={() => void refresh()}
          style={({ pressed }) => [styles.refreshButton, pressed && styles.pressed]}
        >
          {refreshing
            ? <ActivityIndicator color={colors.primary} size="small" />
            : <Text style={styles.refreshIcon}>↻</Text>}
        </Pressable>
      )}
      subtitle={account.schoolName}
      title="الرئيسية"
    >
      <View style={styles.arrivalCard}>
        <Text style={styles.arrivalTitle}>هل أنت في الطريق؟</Text>
        <Pressable
          accessibilityRole="button"
          disabled={sending || remainingSeconds > 0}
          onPress={() => void send()}
          style={({ pressed }) => [
            styles.arrivalButton,
            remainingSeconds > 0 && styles.arrivalButtonDisabled,
            pressed && styles.pressed,
          ]}
        >
          {sending ? (
            <ActivityIndicator color={colors.surface} />
          ) : (
            <Text style={styles.arrivalButtonText}>
              {remainingSeconds > 0
                ? `يمكن الإرسال بعد ${countdownLabel(remainingSeconds)}`
                : "سأصل خلال 5 دقائق"}
            </Text>
          )}
        </Pressable>
        {message ? <Text style={styles.successMessage}>{message}</Text> : null}
        {arrivalError ? <Text style={styles.errorMessage}>{arrivalError}</Text> : null}
      </View>

      {reports?.length ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/(guardian)/care")}
          style={({ pressed }) => [styles.reportNotice, pressed && styles.pressed]}
        >
          <View style={styles.reportCount}>
            <Text style={styles.reportCountText}>{reports.length}</Text>
          </View>
          <View style={styles.reportCopy}>
            <Text style={styles.reportTitle}>تم إرسال تقارير رعاية اليوم</Text>
            <Text numberOfLines={1} style={styles.reportNames}>{reportChildren.join("، ")}</Text>
          </View>
          <Text style={styles.noticeArrow}>‹</Text>
        </Pressable>
      ) : reportError ? (
        <Text style={styles.inlineError}>{reportError}</Text>
      ) : null}

      <View style={styles.eventsCard}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>أحداث اليوم</Text>
          {events?.length ? (
            <Pressable accessibilityRole="button" onPress={() => router.push("/(guardian)/calendar")}>
              <Text style={styles.sectionAction}>فتح التقويم</Text>
            </Pressable>
          ) : null}
        </View>
        {events === null && !eventError ? (
          <View style={styles.loadingState}>
            <ActivityIndicator color={colors.primary} size="small" />
          </View>
        ) : eventError ? (
          <Text style={styles.inlineError}>{eventError}</Text>
        ) : events?.length ? (
          <View style={styles.eventsList}>
            {events.map((event) => (
              <View key={event.id} style={styles.eventRow}>
                <View style={styles.eventType}>
                  <Text style={styles.eventTypeText}>{TYPE_LABELS[event.type]}</Text>
                </View>
                <View style={styles.eventCopy}>
                  <Text style={styles.eventTitle}>{event.title}</Text>
                  <Text style={styles.eventTime}>{eventTime(event)}</Text>
                </View>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.emptyText}>لا توجد أحداث اليوم</Text>
        )}
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  refreshButton: {
    width: touchTarget,
    height: touchTarget,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    backgroundColor: colors.surface,
  },
  refreshIcon: { color: colors.primary, fontSize: 27, fontWeight: "800" },
  arrivalCard: { gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.primarySoft },
  arrivalTitle: { color: colors.text, fontSize: 20, fontWeight: "900", textAlign: "right", writingDirection: "rtl" },
  arrivalButton: { minHeight: touchTarget + 8, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.primary },
  arrivalButtonDisabled: { backgroundColor: colors.muted },
  arrivalButtonText: { color: colors.surface, fontSize: 16, fontWeight: "900" },
  pressed: { opacity: 0.75 },
  successMessage: { color: colors.success, fontSize: 14, fontWeight: "800", textAlign: "center" },
  errorMessage: { color: colors.danger, fontSize: 13, fontWeight: "700", textAlign: "center" },
  reportNotice: { minHeight: 78, flexDirection: "row-reverse", alignItems: "center", gap: spacing.md, padding: spacing.md, borderWidth: 1, borderColor: "#C7B4F6", borderRadius: radius.lg, backgroundColor: colors.surface },
  reportCount: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: 21, backgroundColor: colors.primary },
  reportCountText: { color: colors.surface, fontSize: 18, fontWeight: "900" },
  reportCopy: { flex: 1, gap: 4 },
  reportTitle: { color: colors.text, fontSize: 15, fontWeight: "900", textAlign: "right", writingDirection: "rtl" },
  reportNames: { color: colors.muted, fontSize: 12, textAlign: "right", writingDirection: "rtl" },
  noticeArrow: { color: colors.primary, fontSize: 27, fontWeight: "900" },
  eventsCard: { gap: spacing.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
  sectionHeader: { minHeight: 32, flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: "900", textAlign: "right", writingDirection: "rtl" },
  sectionAction: { color: colors.primary, fontSize: 13, fontWeight: "800" },
  eventsList: { gap: spacing.sm },
  eventRow: { minHeight: 62, flexDirection: "row-reverse", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  eventType: { minWidth: 58, alignItems: "center", paddingHorizontal: spacing.sm, paddingVertical: 7, borderRadius: 999, backgroundColor: colors.primarySoft },
  eventTypeText: { color: colors.primary, fontSize: 12, fontWeight: "900" },
  eventCopy: { flex: 1, gap: 4 },
  eventTitle: { color: colors.text, fontSize: 15, fontWeight: "900", textAlign: "right", writingDirection: "rtl" },
  eventTime: { color: colors.muted, fontSize: 12, textAlign: "right", writingDirection: "rtl" },
  loadingState: { minHeight: 80, alignItems: "center", justifyContent: "center" },
  emptyText: { minHeight: 64, color: colors.muted, fontSize: 14, lineHeight: 64, textAlign: "center" },
  inlineError: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.dangerSoft, color: colors.danger, fontSize: 13, fontWeight: "700", textAlign: "right", writingDirection: "rtl" },
});
