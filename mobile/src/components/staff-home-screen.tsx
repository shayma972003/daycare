import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, AppState, Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";

import {
  acknowledgeArrivalNotice,
  loadArrivalNotices,
  type StaffArrivalNotice,
} from "@/api/arrival";
import { loadTodayAttendance, type AttendanceChild } from "@/api/attendance";
import { loadCalendar, type CalendarEventType, type MobileCalendarEvent } from "@/api/calendar";
import { loadReturnedDailyCareReports, type ReturnedDailyCareBatch } from "@/api/care";
import {
  loadLocationAttendanceSettings,
  type LocationAttendanceSettings,
} from "@/api/location-attendance";
import { riyadhDateKey } from "@/calendar/week";
import { AppScreen } from "@/components/app-screen";
import { Text, useLanguage } from "@/language";
import { useSession } from "@/session";
import { colors, radius, shadow, spacing, touchTarget } from "@/theme";

const RIYADH_ZONE = "Asia/Riyadh";

const TYPE_LABELS: Record<CalendarEventType, string> = {
  LESSON: "درس",
  ACTIVITY: "نشاط",
  ANNOUNCEMENT: "إعلان",
  UNIT: "وحدة",
};

type HomeErrors = {
  arrival: string | null;
  attendance: string | null;
  care: string | null;
  calendar: string | null;
  location: string | null;
};

const EMPTY_ERRORS: HomeErrors = { arrival: null, attendance: null, care: null, calendar: null, location: null };

function errorMessage(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback;
}

function eventTime(event: MobileCalendarEvent, locale: string) {
  if (event.allDay) return "طوال اليوم";
  const formatter = new Intl.DateTimeFormat(locale, {
    timeZone: RIYADH_ZONE,
    hour: "numeric",
    minute: "2-digit",
  });
  const start = formatter.format(new Date(event.startAt));
  return event.endAt ? `${start} – ${formatter.format(new Date(event.endAt))}` : start;
}

function returnedStudentNames(batches: ReturnedDailyCareBatch[]) {
  return Array.from(new Set(batches.flatMap((batch) => batch.students.map((student) => student.name))));
}

export function StaffHomeScreen() {
  const { account } = useSession();
  const { isRTL, locale } = useLanguage();
  const router = useRouter();
  const today = useMemo(() => riyadhDateKey(new Date()), []);
  const [arrivalNotices, setArrivalNotices] = useState<StaffArrivalNotice[]>([]);
  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null);
  const [children, setChildren] = useState<AttendanceChild[] | null>(null);
  const [returnedReports, setReturnedReports] = useState<ReturnedDailyCareBatch[] | null>(null);
  const [events, setEvents] = useState<MobileCalendarEvent[] | null>(null);
  const [locationAttendance, setLocationAttendance] = useState<LocationAttendanceSettings | null>(null);
  const [errors, setErrors] = useState<HomeErrors>(EMPTY_ERRORS);
  const [refreshing, setRefreshing] = useState(false);
  const can = useCallback(
    (permission: string) =>
      account?.kind === "staff" &&
      (account.permissions.includes("*") || account.permissions.includes(permission)),
    [account]
  );
  const canUseStudentAttendance = can("attendance.students");
  const canUseCare = canUseStudentAttendance && account?.kind === "staff" && Boolean(account.teacherId);
  const canUseCalendar = can("schedule.view");
  const canUseLocationAttendance = account?.kind === "staff" && Boolean(account.teacherId);

  const applyResults = useCallback((results: [
    PromiseSettledResult<Awaited<ReturnType<typeof loadArrivalNotices>>>,
    PromiseSettledResult<Awaited<ReturnType<typeof loadTodayAttendance>>>,
    PromiseSettledResult<ReturnedDailyCareBatch[]>,
    PromiseSettledResult<Awaited<ReturnType<typeof loadCalendar>>>,
    PromiseSettledResult<LocationAttendanceSettings | null>,
  ]) => {
    const [arrivalResult, attendanceResult, careResult, calendarResult, locationResult] = results;
    if (arrivalResult.status === "fulfilled") setArrivalNotices(arrivalResult.value.notices);
    setChildren(attendanceResult.status === "fulfilled" ? attendanceResult.value.children : null);
    setReturnedReports(careResult.status === "fulfilled" ? careResult.value : null);
    setEvents(calendarResult.status === "fulfilled" ? calendarResult.value.events : null);
    setLocationAttendance(locationResult.status === "fulfilled" ? locationResult.value : null);
    setErrors({
      arrival: arrivalResult.status === "rejected"
        ? errorMessage(arrivalResult.reason, "تعذّر تحميل إشعارات الوصول")
        : null,
      attendance: attendanceResult.status === "rejected"
        ? errorMessage(attendanceResult.reason, "تعذّر تحميل الحضور")
        : null,
      care: careResult.status === "rejected"
        ? errorMessage(careResult.reason, "تعذّر تحميل التقارير المرجعة")
        : null,
      calendar: calendarResult.status === "rejected"
        ? errorMessage(calendarResult.reason, "تعذّر تحميل أحداث اليوم")
        : null,
      location: locationResult.status === "rejected"
        ? errorMessage(locationResult.reason, "تعذّر تحميل حالة حضورك")
        : null,
    });
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.allSettled([
      loadArrivalNotices(),
      canUseStudentAttendance
        ? loadTodayAttendance()
        : Promise.resolve({ date: today, children: [] }),
      canUseCare ? loadReturnedDailyCareReports() : Promise.resolve([]),
      canUseCalendar
        ? loadCalendar(today, today)
        : Promise.resolve({ from: today, to: today, events: [] }),
      canUseLocationAttendance ? loadLocationAttendanceSettings() : Promise.resolve(null),
    ]).then((results) => {
      if (active) applyResults(results);
    });
    return () => {
      active = false;
    };
  }, [applyResults, canUseCalendar, canUseCare, canUseLocationAttendance, canUseStudentAttendance, today]);

  useEffect(() => {
    if (!canUseLocationAttendance) return;
    let active = true;
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "active") return;
      void loadLocationAttendanceSettings()
        .then((result) => {
          if (!active) return;
          setLocationAttendance(result);
          setErrors((current) => ({ ...current, location: null }));
        })
        .catch((caught: unknown) => {
          if (!active) return;
          setErrors((current) => ({
            ...current,
            location: errorMessage(caught, "تعذّر تحميل حالة حضورك"),
          }));
        });
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [canUseLocationAttendance]);

  useEffect(() => {
    let active = true;
    const timer = setInterval(() => {
      void loadArrivalNotices()
        .then((result) => {
          if (active) {
            setArrivalNotices(result.notices);
            setErrors((current) => ({ ...current, arrival: null }));
          }
        })
        .catch((caught: unknown) => {
          if (active) {
            setErrors((current) => ({
              ...current,
              arrival: errorMessage(caught, "تعذّر تحميل إشعارات الوصول"),
            }));
          }
        });
    }, 15_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setErrors(EMPTY_ERRORS);
    try {
      const results = await Promise.allSettled([
        loadArrivalNotices(),
        canUseStudentAttendance
          ? loadTodayAttendance()
          : Promise.resolve({ date: today, children: [] }),
        canUseCare ? loadReturnedDailyCareReports() : Promise.resolve([]),
        canUseCalendar
          ? loadCalendar(today, today)
          : Promise.resolve({ from: today, to: today, events: [] }),
        canUseLocationAttendance ? loadLocationAttendanceSettings() : Promise.resolve(null),
      ]);
      applyResults(results);
    } finally {
      setRefreshing(false);
    }
  }, [applyResults, canUseCalendar, canUseCare, canUseLocationAttendance, canUseStudentAttendance, today]);

  const attendance = useMemo(() => ({
    total: children?.length ?? 0,
    present: children?.filter((child) => child.nextAction === "checkout").length ?? 0,
    left: children?.filter((child) => child.nextAction === "done").length ?? 0,
    absent: children?.filter((child) => child.nextAction === "checkin").length ?? 0,
  }), [children]);
  const returnedNames = useMemo(
    () => returnedReports ? returnedStudentNames(returnedReports) : [],
    [returnedReports]
  );

  if (!account || account.kind !== "staff") return null;

  const acknowledgeArrival = async (notice: StaffArrivalNotice) => {
    setAcknowledgingId(notice.id);
    setErrors((current) => ({ ...current, arrival: null }));
    try {
      await acknowledgeArrivalNotice(notice.id);
      setArrivalNotices((current) => current.filter((item) => item.id !== notice.id));
    } catch (caught) {
      setErrors((current) => ({
        ...current,
        arrival: errorMessage(caught, "تعذّر إغلاق إشعار الوصول"),
      }));
    } finally {
      setAcknowledgingId(null);
    }
  };

  const arrivalNotice = arrivalNotices[0];

  return (
    <AppScreen
      onRefresh={() => void refresh()}
      refreshing={refreshing}
      subtitle={account.schoolName}
      title="الرئيسية"
    >
      {arrivalNotice ? (
        <View style={[styles.arrivalNotice, { flexDirection: isRTL ? "row-reverse" : "row" }]}>
          <View style={styles.arrivalIcon}>
            <Text style={styles.arrivalIconText}>!</Text>
          </View>
          <View style={styles.arrivalCopy}>
            <Text style={styles.arrivalLabel}>إشعار وصول</Text>
            <Text style={styles.arrivalMessage}>{arrivalNotice.message}</Text>
            {arrivalNotices.length > 1 ? (
              <Text style={styles.arrivalMore}>يتبقى {arrivalNotices.length - 1} إشعار آخر</Text>
            ) : null}
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={acknowledgingId === arrivalNotice.id}
            onPress={() => void acknowledgeArrival(arrivalNotice)}
            style={({ pressed }) => [styles.okButton, pressed && styles.pressed]}
          >
            {acknowledgingId === arrivalNotice.id
              ? <ActivityIndicator color={colors.surface} size="small" />
              : <Text style={styles.okButtonText}>حسنًا</Text>}
          </Pressable>
        </View>
      ) : null}
      {errors.arrival ? <ErrorState message={errors.arrival} /> : null}

      {canUseLocationAttendance ? <SectionCard title="حضورك الآن">
        {locationAttendance === null && !errors.location ? (
          <LoadingState label="جارٍ تحميل حالة حضورك…" />
        ) : errors.location ? (
          <ErrorState message={errors.location} />
        ) : locationAttendance ? (
          <View style={[styles.locationState, { flexDirection: isRTL ? "row-reverse" : "row" }]}>
            <View style={styles.locationStateCopy}>
              <Text style={styles.locationStateLabel}>الحالة الحالية</Text>
              {!locationAttendance.enabled ? (
                <Text style={styles.locationStateHint}>الحضور التلقائي غير مفعّل من إدارة المدرسة</Text>
              ) : null}
            </View>
            <View style={[
              styles.locationBadge,
              locationAttendance.attendanceOpen ? styles.locationBadgeIn : styles.locationBadgeOut,
            ]}>
              <Text style={[
                styles.locationBadgeText,
                locationAttendance.attendanceOpen ? styles.locationBadgeTextIn : styles.locationBadgeTextOut,
              ]}>
                {locationAttendance.attendanceOpen ? "مسجلة دخول" : "مسجلة خروج"}
              </Text>
            </View>
          </View>
        ) : null}
      </SectionCard> : null}

      {canUseStudentAttendance ? <SectionCard
        actionLabel="فتح الحضور"
        onPress={() => router.push("/(staff)/attendance")}
        title="حضور اليوم"
      >
        {children === null && !errors.attendance ? (
          <LoadingState label="جارٍ تحميل الحضور…" />
        ) : errors.attendance ? (
          <ErrorState message={errors.attendance} />
        ) : (
          <View style={[styles.attendanceSummary, { flexDirection: isRTL ? "row-reverse" : "row" }]}>
            <SummaryItem color={colors.text} label="الإجمالي" value={attendance.total} />
            <SummaryItem color={colors.success} label="حاضر" value={attendance.present} />
            <SummaryItem color={colors.muted} label="غادر" value={attendance.left} />
            <SummaryItem color={colors.danger} label="لم يحضر" value={attendance.absent} />
          </View>
        )}
      </SectionCard> : null}

      {canUseCare ? <SectionCard
        actionLabel={returnedReports?.length ? "فتح التقارير" : undefined}
        onPress={returnedReports?.length ? () => router.push("/(staff)/care") : undefined}
        title="تقارير الرعاية المرجعة"
      >
        {returnedReports === null && !errors.care ? (
          <LoadingState label="جارٍ التحقق من التقارير…" />
        ) : errors.care ? (
          <ErrorState message={errors.care} />
        ) : returnedReports?.length ? (
          <View style={[styles.returnedNotice, { flexDirection: isRTL ? "row-reverse" : "row" }]}>
            <View style={styles.noticeCount}>
              <Text style={styles.noticeCountText}>{returnedNames.length}</Text>
            </View>
            <View style={styles.noticeCopy}>
              <Text style={styles.noticeTitle}>تقارير بحاجة إلى تعديل</Text>
              <Text numberOfLines={2} style={styles.noticeBody}>
                {returnedNames.slice(0, 3).join("، ")}
                {returnedNames.length > 3 ? `، و${returnedNames.length - 3} آخرين` : ""}
              </Text>
            </View>
          </View>
        ) : (
          <View style={styles.clearState}>
            <Text style={styles.clearDot}>✓</Text>
            <Text style={styles.clearText}>لا توجد تقارير مرجعة</Text>
          </View>
        )}
      </SectionCard> : null}

      {canUseCalendar ? <SectionCard
        actionLabel={events?.length ? "فتح التقويم" : undefined}
        onPress={events?.length ? () => router.push("/(staff)/calendar") : undefined}
        title="أحداث اليوم"
      >
        {events === null && !errors.calendar ? (
          <LoadingState label="جارٍ تحميل أحداث اليوم…" />
        ) : errors.calendar ? (
          <ErrorState message={errors.calendar} />
        ) : events?.length ? (
          <View style={styles.eventsList}>
            {events.map((event) => (
              <View key={event.id} style={[styles.eventRow, { flexDirection: isRTL ? "row-reverse" : "row" }]}>
                <View style={styles.eventType}>
                  <Text style={styles.eventTypeText}>{TYPE_LABELS[event.type]}</Text>
                </View>
                <View style={styles.eventCopy}>
                  <Text style={styles.eventTitle}>{event.title}</Text>
                  <Text style={styles.eventTime}>{eventTime(event, locale)}</Text>
                </View>
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.clearState}>
            <Text style={styles.clearDot}>○</Text>
            <Text style={styles.clearText}>لا توجد أحداث اليوم</Text>
          </View>
        )}
      </SectionCard> : null}
    </AppScreen>
  );
}

function SectionCard({ actionLabel, children, onPress, title }: {
  actionLabel?: string;
  children: ReactNode;
  onPress?: () => void;
  title: string;
}) {
  const { isRTL } = useLanguage();
  return (
    <View style={styles.sectionCard}>
      <View style={[styles.sectionHeader, { flexDirection: isRTL ? "row-reverse" : "row" }]}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {actionLabel && onPress ? (
          <Pressable accessibilityRole="button" onPress={onPress}>
            <Text style={styles.sectionAction}>{actionLabel}</Text>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function SummaryItem({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <View style={styles.summaryItem}>
      <Text style={[styles.summaryValue, { color }]}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <View style={styles.inlineState}>
      <ActivityIndicator color={colors.primary} size="small" />
      <Text style={styles.stateText}>{label}</Text>
    </View>
  );
}

function ErrorState({ message }: { message: string }) {
  return <Text style={styles.errorText}>{message}</Text>;
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.72 },
  arrivalNotice: {
    ...shadow.card,
    minHeight: 96,
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.xl,
    backgroundColor: colors.warningSoft,
  },
  arrivalIcon: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 21,
    backgroundColor: colors.warning,
  },
  arrivalIconText: { color: colors.surface, fontSize: 22, fontWeight: "900" },
  arrivalCopy: { flex: 1, gap: 3 },
  arrivalLabel: { color: colors.warning, fontSize: 12, fontWeight: "900", textAlign: "right" },
  arrivalMessage: { color: colors.text, fontSize: 16, fontWeight: "900", textAlign: "right", writingDirection: "rtl" },
  arrivalMore: { color: colors.muted, fontSize: 11, textAlign: "right", writingDirection: "rtl" },
  okButton: {
    minWidth: 66,
    minHeight: touchTarget,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  okButtonText: { color: colors.surface, fontSize: 14, fontWeight: "900" },
  locationState: {
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  locationStateCopy: { flex: 1, gap: 3 },
  locationStateLabel: { color: colors.text, fontSize: 14, fontWeight: "900", textAlign: "right" },
  locationStateHint: { color: colors.muted, fontSize: 11, lineHeight: 17, textAlign: "right" },
  locationBadge: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: 999 },
  locationBadgeIn: { backgroundColor: colors.successSoft },
  locationBadgeOut: { backgroundColor: colors.primarySoft },
  locationBadgeText: { fontSize: 13, fontWeight: "900" },
  locationBadgeTextIn: { color: colors.success },
  locationBadgeTextOut: { color: colors.primary },
  sectionCard: {
    ...shadow.card,
    overflow: "hidden",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
  },
  sectionHeader: {
    minHeight: 32,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "900",
    textAlign: "right",
    writingDirection: "rtl",
  },
  sectionAction: { color: colors.primary, fontSize: 13, fontWeight: "800" },
  attendanceSummary: { flexDirection: "row-reverse", gap: spacing.sm },
  summaryItem: {
    minHeight: 72,
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  summaryValue: { fontSize: 23, fontWeight: "900" },
  summaryLabel: { color: colors.muted, fontSize: 11, fontWeight: "700", textAlign: "center" },
  returnedNotice: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.warningSoft,
  },
  noticeCount: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
    backgroundColor: colors.warning,
  },
  noticeCountText: { color: colors.surface, fontSize: 19, fontWeight: "900" },
  noticeCopy: { flex: 1, gap: 4 },
  noticeTitle: {
    color: colors.warning,
    fontSize: 15,
    fontWeight: "900",
    textAlign: "right",
    writingDirection: "rtl",
  },
  noticeBody: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 20,
    textAlign: "right",
    writingDirection: "rtl",
  },
  clearState: {
    minHeight: 64,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  clearDot: { color: colors.success, fontSize: 20, fontWeight: "900" },
  clearText: { color: colors.muted, fontSize: 14, fontWeight: "700" },
  eventsList: { gap: spacing.sm },
  eventRow: {
    minHeight: 64,
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  eventType: {
    minWidth: 58,
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.primarySoft,
  },
  eventTypeText: { color: colors.primary, fontSize: 12, fontWeight: "900" },
  eventCopy: { flex: 1, gap: 4 },
  eventTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "900",
    textAlign: "right",
    writingDirection: "rtl",
  },
  eventTime: {
    color: colors.muted,
    fontSize: 12,
    textAlign: "right",
    writingDirection: "rtl",
  },
  inlineState: {
    minHeight: 80,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  stateText: { color: colors.muted, fontSize: 13 },
  errorText: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
    color: colors.danger,
    fontSize: 13,
    fontWeight: "700",
    textAlign: "right",
    writingDirection: "rtl",
  },
});
