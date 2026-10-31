import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";

import { loadCalendar, type CalendarEventType, type MobileCalendarEvent } from "@/api/calendar";
import {
  addDateKeyDays,
  currentMonthGrid,
  currentWeekStart,
  daysFrom,
  eventOccursOnDate,
  riyadhDateKey,
} from "@/calendar/week";
import { AppScreen, cardStyles } from "@/components/app-screen";
import { PrimaryButton } from "@/components/buttons";
import { IllustrationPlaceholder } from "@/components/illustration-placeholder";
import { Text, useLanguage } from "@/language";
import { useSession } from "@/session";
import { colors, radius, spacing, touchTarget } from "@/theme";

const RIYADH_ZONE = "Asia/Riyadh";

const TYPE_LABELS: Record<CalendarEventType, string> = {
  LESSON: "درس",
  ACTIVITY: "نشاط",
  ANNOUNCEMENT: "إعلان",
  UNIT: "وحدة",
};

const TYPE_COLORS: Record<CalendarEventType, string> = {
  LESSON: "#2563EB",
  ACTIVITY: "#D97706",
  ANNOUNCEMENT: colors.primary,
  UNIT: "#067647",
};

function dayLabel(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: RIYADH_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
}

function weekdayLabel(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    weekday: "short",
  }).format(new Date(`${value}T12:00:00.000Z`));
}

function dayNumber(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    day: "numeric",
  }).format(new Date(`${value}T12:00:00.000Z`));
}

function monthLabel(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00.000Z`));
}

function timeLabel(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: RIYADH_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function eventTime(event: MobileCalendarEvent, locale: string) {
  if (event.allDay) return "طوال اليوم";
  const start = timeLabel(event.startAt, locale);
  if (!event.endAt) return start;
  return `${start} – ${timeLabel(event.endAt, locale)}`;
}

export function CalendarScreen() {
  const { account } = useSession();
  const { isRTL, locale, t } = useLanguage();
  const firstWeekStart = useMemo(() => currentWeekStart(), []);
  const today = useMemo(() => riyadhDateKey(new Date()), []);
  const month = useMemo(() => currentMonthGrid(today), [today]);
  const rangeFrom = firstWeekStart < month.gridStart ? firstWeekStart : month.gridStart;
  const weekEnd = addDateKeyDays(firstWeekStart, 6);
  const rangeTo = weekEnd > month.gridEnd ? weekEnd : month.gridEnd;
  const [viewMode, setViewMode] = useState<"week" | "month">("week");
  const [selectedDay, setSelectedDay] = useState(today);
  const [events, setEvents] = useState<MobileCalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await loadCalendar(rangeFrom, rangeTo);
      setEvents(response.events);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذّر تحميل التقويم");
    } finally {
      setLoading(false);
    }
  }, [rangeFrom, rangeTo]);

  useEffect(() => {
    let active = true;
    loadCalendar(rangeFrom, rangeTo)
      .then((response) => {
        if (active) setEvents(response.events);
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : "تعذّر تحميل التقويم");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [rangeFrom, rangeTo]);

  const visibleDays = useMemo(() => daysFrom(firstWeekStart, 7), [firstWeekStart]);
  const selectedEvents = useMemo(
    () => events.filter((event) => eventOccursOnDate(event, selectedDay)),
    [events, selectedDay]
  );

  const selectView = (next: "week" | "month") => {
    setViewMode(next);
    setSelectedDay(today);
    setExpandedId(null);
  };

  if (!account) return null;

  return (
    <AppScreen
      action={(
        <Pressable
          accessibilityLabel={t("تحديث التقويم")}
          accessibilityRole="button"
          disabled={loading}
          onPress={() => void refresh()}
          style={({ pressed }) => [styles.refreshButton, pressed && !loading && styles.pressed]}
        >
          {loading ? (
            <ActivityIndicator color={colors.primary} size="small" />
          ) : (
            <Text style={styles.refreshIcon}>↻</Text>
          )}
        </Pressable>
      )}
      subtitle={account.schoolName}
      title="التقويم"
    >
      <View style={[styles.weekSwitch, { flexDirection: isRTL ? "row-reverse" : "row" }]}>
        <Pressable
          accessibilityRole="button"
          onPress={() => selectView("week")}
          style={[styles.weekOption, viewMode === "week" && styles.weekOptionActive]}
        >
          <Text style={[styles.weekOptionText, viewMode === "week" && styles.weekOptionTextActive]}>
            هذا الأسبوع
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => selectView("month")}
          style={[styles.weekOption, viewMode === "month" && styles.weekOptionActive]}
        >
          <Text style={[styles.weekOptionText, viewMode === "month" && styles.weekOptionTextActive]}>
            الشهر
          </Text>
        </Pressable>
      </View>

      {viewMode === "week" ? (
        <View style={[styles.dayStrip, { flexDirection: isRTL ? "row-reverse" : "row" }]}>
          {visibleDays.map((day) => {
            const selected = day === selectedDay;
            const hasEvents = events.some((event) => eventOccursOnDate(event, day));
            return (
              <Pressable
                accessibilityLabel={dayLabel(`${day}T12:00:00.000Z`, locale)}
                accessibilityRole="button"
                key={day}
                onPress={() => {
                  setSelectedDay(day);
                  setExpandedId(null);
                }}
                style={[styles.dayButton, selected && styles.dayButtonSelected]}
              >
                <Text style={[styles.dayName, selected && styles.dayTextSelected]}>
                  {weekdayLabel(day, locale)}
                </Text>
                <Text style={[styles.dayNumber, selected && styles.dayTextSelected]}>
                  {dayNumber(day, locale)}
                </Text>
                <View
                  style={[
                    styles.dayDot,
                    hasEvents && styles.dayDotFilled,
                    selected && styles.dayDotSelected,
                  ]}
                />
              </Pressable>
            );
          })}
        </View>
      ) : (
        <View style={styles.monthSection}>
          <Text style={styles.monthTitle}>{monthLabel(month.monthStart, locale)}</Text>
          <View style={[styles.monthWeekdays, { flexDirection: isRTL ? "row-reverse" : "row" }]}>
            {daysFrom(month.gridStart, 7).map((day) => (
              <Text key={day} style={styles.monthWeekday}>
                {weekdayLabel(day, locale)}
              </Text>
            ))}
          </View>
          <View style={[styles.monthGrid, { flexDirection: isRTL ? "row-reverse" : "row" }]}>
            {month.days.map((day) => {
              const selected = day === selectedDay;
              const inMonth = day >= month.monthStart && day <= month.monthEnd;
              const hasEvents = events.some((event) => eventOccursOnDate(event, day));
              return (
                <Pressable
                  accessibilityLabel={dayLabel(`${day}T12:00:00.000Z`, locale)}
                  accessibilityRole="button"
                  key={day}
                  onPress={() => {
                    setSelectedDay(day);
                    setExpandedId(null);
                  }}
                  style={[styles.monthDay, selected && styles.monthDaySelected]}
                >
                  <Text
                    style={[
                      styles.monthDayNumber,
                      !inMonth && styles.monthDayOutside,
                      selected && styles.dayTextSelected,
                    ]}
                  >
                    {dayNumber(day, locale)}
                  </Text>
                  <View
                    style={[
                      styles.dayDot,
                      hasEvents && styles.dayDotFilled,
                      selected && styles.dayDotSelected,
                    ]}
                  />
                </Pressable>
              );
            })}
          </View>
        </View>
      )}

      <Text style={styles.selectedDate}>{dayLabel(`${selectedDay}T12:00:00.000Z`, locale)}</Text>

      {loading ? (
        <View style={styles.stateCard}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={cardStyles.body}>جارٍ تحميل الأحداث…</Text>
        </View>
      ) : error ? (
        <View style={[styles.stateCard, styles.errorCard]}>
          <Text style={styles.errorTitle}>تعذّر تحميل التقويم</Text>
          <Text style={cardStyles.body}>{error}</Text>
          <PrimaryButton label="إعادة المحاولة" onPress={() => void refresh()} />
        </View>
      ) : selectedEvents.length === 0 ? (
        <View style={styles.stateCard}>
          <IllustrationPlaceholder compact label="مكان رسم للتقويم" />
          <Text style={styles.emptyTitle}>لا توجد أحداث في هذا اليوم</Text>
          <Text style={cardStyles.body}>اختاري يوماً آخر من التقويم.</Text>
        </View>
      ) : (
        <View style={styles.eventsList}>
          {selectedEvents.map((event) => {
            const expanded = expandedId === event.id;
            const scope = event.schoolWide ? "جميع المدرسة" : event.classNames.join("، ");
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                key={event.id}
                onPress={() => setExpandedId(expanded ? null : event.id)}
                style={({ pressed }) => [styles.eventCard, pressed && styles.pressed]}
              >
                <View style={[styles.eventHeader, { flexDirection: isRTL ? "row-reverse" : "row" }]}>
                  <View
                    style={[
                      styles.typePill,
                      { backgroundColor: `${TYPE_COLORS[event.type]}16` },
                    ]}
                  >
                    <Text style={[styles.typeText, { color: TYPE_COLORS[event.type] }]}>
                      {TYPE_LABELS[event.type]}
                    </Text>
                  </View>
                  <View style={styles.eventCopy}>
                    <Text style={styles.eventTitle}>{event.title}</Text>
                    <Text style={styles.eventMeta}>{eventTime(event, locale)}</Text>
                  </View>
                  <Text style={styles.chevron}>{expanded ? "⌃" : "⌄"}</Text>
                </View>

                {expanded ? (
                  <View style={styles.details}>
                    <Text style={styles.detailsText}>
                      {event.description?.trim() || "لا توجد تفاصيل إضافية."}
                    </Text>
                    {event.location ? (
                      <Text style={styles.detailMeta}>المكان: {event.location}</Text>
                    ) : null}
                    <Text style={styles.detailMeta}>النطاق: {scope || "الفصل"}</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      )}
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
    borderColor: "rgba(255,255,255,0.55)",
    borderRadius: 999,
    backgroundColor: colors.surface,
  },
  refreshIcon: {
    color: colors.primary,
    fontSize: 25,
    fontWeight: "800",
  },
  weekSwitch: {
    flexDirection: "row-reverse",
    padding: 4,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  weekOption: {
    flex: 1,
    minHeight: touchTarget,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
  },
  weekOptionActive: { backgroundColor: colors.primary },
  weekOptionText: { color: colors.muted, fontSize: 14, fontWeight: "700" },
  weekOptionTextActive: { color: colors.surface },
  dayStrip: { flexDirection: "row-reverse", gap: 5 },
  dayButton: {
    flex: 1,
    minHeight: 70,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    backgroundColor: colors.surface,
  },
  dayButtonSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayName: { color: colors.muted, fontSize: 11, fontWeight: "700" },
  dayNumber: { color: colors.text, fontSize: 16, fontWeight: "800" },
  dayTextSelected: { color: colors.surface },
  dayDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: "transparent" },
  dayDotFilled: { backgroundColor: colors.primary },
  dayDotSelected: { backgroundColor: colors.surface },
  monthSection: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    shadowColor: colors.primaryDark,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.07,
    shadowRadius: 20,
    elevation: 2,
  },
  monthTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "800",
    textAlign: "center",
  },
  monthWeekdays: { flexDirection: "row-reverse", gap: 4 },
  monthWeekday: {
    width: "13.1%",
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
    textAlign: "center",
  },
  monthGrid: { flexDirection: "row-reverse", flexWrap: "wrap", gap: 4 },
  monthDay: {
    width: "13.1%",
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    borderRadius: radius.sm,
  },
  monthDaySelected: { backgroundColor: colors.primary },
  monthDayNumber: { color: colors.text, fontSize: 14, fontWeight: "700" },
  monthDayOutside: { color: colors.muted, opacity: 0.4 },
  selectedDate: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
    textAlign: "right",
    writingDirection: "rtl",
  },
  stateCard: {
    minHeight: 220,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
  },
  errorCard: { borderColor: "#F8B4B4", backgroundColor: colors.dangerSoft },
  errorTitle: { color: colors.danger, fontSize: 17, fontWeight: "800" },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: "800" },
  eventsList: { gap: spacing.sm },
  eventCard: {
    minHeight: touchTarget,
    padding: spacing.md,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  pressed: { opacity: 0.75 },
  eventHeader: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: spacing.sm,
  },
  eventCopy: { flex: 1, gap: spacing.xs },
  eventTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800",
    textAlign: "right",
    writingDirection: "rtl",
  },
  eventMeta: {
    color: colors.muted,
    fontSize: 13,
    textAlign: "right",
    writingDirection: "rtl",
  },
  typePill: {
    minWidth: 58,
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: 999,
  },
  typeText: { fontSize: 12, fontWeight: "800" },
  chevron: { width: 22, color: colors.muted, fontSize: 20, textAlign: "center" },
  details: {
    gap: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  detailsText: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 24,
    textAlign: "right",
    writingDirection: "rtl",
  },
  detailMeta: {
    color: colors.muted,
    fontSize: 13,
    textAlign: "right",
    writingDirection: "rtl",
  },
});
