import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  loadTodayAttendance,
  recordAttendance,
  type AttendanceAction,
  type AttendanceChild,
} from "@/api/attendance";
import { AppScreen } from "@/components/app-screen";
import { PrimaryButton } from "@/components/buttons";
import { useSession } from "@/session";
import { colors, radius, spacing, touchTarget } from "@/theme";

const actionLabels: Record<AttendanceAction, string> = {
  checkin: "تسجيل الدخول",
  checkout: "تسجيل الخروج",
  done: "اكتمل اليوم",
};

function formatTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ar-SA", {
    timeZone: "Asia/Riyadh",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDate(value: string | null) {
  if (!value) return "اليوم";
  return new Intl.DateTimeFormat("ar-SA", {
    timeZone: "Asia/Riyadh",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(value));
}

function statusLabel(action: AttendanceAction) {
  if (action === "checkin") return "لم يحضر";
  if (action === "checkout") return "حاضر";
  return "غادر";
}

export function StaffAttendanceScreen() {
  const { account } = useSession();
  const [date, setDate] = useState<string | null>(null);
  const [children, setChildren] = useState<AttendanceChild[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const result = await loadTodayAttendance();
      setDate(result.date);
      setChildren(result.children);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذّر تحميل الحضور");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const result = await loadTodayAttendance();
        if (!active) return;
        setDate(result.date);
        setChildren(result.children);
      } catch (caught) {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "تعذّر تحميل الحضور");
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const summary = useMemo(() => ({
    present: children.filter((child) => child.nextAction === "checkout").length,
    left: children.filter((child) => child.nextAction === "done").length,
    absent: children.filter((child) => child.nextAction === "checkin").length,
  }), [children]);

  const filteredChildren = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("ar");
    if (!query) return children;
    return children.filter((child) => (
      child.name.toLocaleLowerCase("ar").includes(query)
      || child.className?.toLocaleLowerCase("ar").includes(query)
    ));
  }, [children, search]);

  if (!account || account.kind !== "staff") return null;

  const submit = async (child: AttendanceChild) => {
    if (child.nextAction === "done") return;
    setBusyId(child.id);
    setError(null);
    setMessage(null);
    try {
      const result = await recordAttendance(child.id, child.nextAction);
      setChildren((current) => current.map((item) => item.id === child.id ? {
        ...item,
        checkedInAt: result.checkedInAt,
        checkedOutAt: result.checkedOutAt,
        nextAction: result.nextAction,
      } : item));
      setMessage(
        child.nextAction === "checkin"
          ? `تم تسجيل دخول ${child.name}`
          : `تم تسجيل خروج ${child.name}`
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذّر حفظ الحضور");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <AppScreen
      action={(
        <Pressable
          accessibilityLabel="تحديث الحضور"
          accessibilityRole="button"
          disabled={refreshing}
          onPress={() => void load(true)}
          style={({ pressed }) => [styles.refreshButton, pressed && styles.pressed]}
        >
          {refreshing
            ? <ActivityIndicator color={colors.primary} size="small" />
            : <Text style={styles.refreshIcon}>↻</Text>}
        </Pressable>
      )}
      subtitle={`${account.schoolName} · ${formatDate(date)}`}
      title="الحضور"
    >
      <View style={styles.summary}>
        <SummaryItem color={colors.success} label="حاضر" value={summary.present} />
        <SummaryItem color={colors.muted} label="غادر" value={summary.left} />
        <SummaryItem color={colors.danger} label="لم يحضر" value={summary.absent} />
      </View>

      <View style={styles.searchBox}>
        <TextInput
          accessibilityLabel="البحث في الحضور"
          onChangeText={setSearch}
          placeholder="البحث بالاسم أو الفصل…"
          placeholderTextColor={colors.muted}
          returnKeyType="search"
          style={styles.searchInput}
          textAlign="right"
          value={search}
        />
        <Text style={styles.searchIcon}>⌕</Text>
      </View>

      {message ? <Text style={styles.successMessage}>{message}</Text> : null}
      {error ? <Text style={styles.errorMessage}>{error}</Text> : null}

      {loading ? (
        <View style={styles.statePanel}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.stateText}>جارٍ تحميل الأطفال…</Text>
        </View>
      ) : children.length === 0 ? (
        <View style={styles.statePanel}>
          <Text style={styles.emptyTitle}>لا يوجد أطفال مرتبطون بفصولك</Text>
          <PrimaryButton label="إعادة المحاولة" onPress={() => void load()} />
        </View>
      ) : filteredChildren.length === 0 ? (
        <View style={styles.searchEmpty}>
          <Text style={styles.emptyTitle}>لا توجد نتائج مطابقة</Text>
          <Pressable accessibilityRole="button" onPress={() => setSearch("")}>
            <Text style={styles.clearSearch}>مسح البحث</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.list}>
          {filteredChildren.map((child) => (
            <AttendanceRow
              busy={busyId === child.id}
              child={child}
              key={child.id}
              onPress={() => void submit(child)}
            />
          ))}
        </View>
      )}
    </AppScreen>
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

function AttendanceRow({ busy, child, onPress }: {
  busy: boolean;
  child: AttendanceChild;
  onPress: () => void;
}) {
  const done = child.nextAction === "done";
  return (
    <View style={styles.childCard}>
      <View style={styles.childHeader}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{child.name.trim().slice(0, 1) || "ط"}</Text>
        </View>
        <View style={styles.childCopy}>
          <Text style={styles.childName}>{child.name}</Text>
          <Text style={styles.childClass}>{child.className ?? "بدون فصل"}</Text>
        </View>
        <View style={[
          styles.statusBadge,
          child.nextAction === "checkout" && styles.presentBadge,
          done && styles.leftBadge,
        ]}>
          <Text style={[
            styles.statusText,
            child.nextAction === "checkout" && styles.presentText,
            done && styles.leftText,
          ]}>{statusLabel(child.nextAction)}</Text>
        </View>
      </View>

      <View style={styles.times}>
        <View style={styles.timeCell}>
          <Text style={styles.timeLabel}>الدخول</Text>
          <Text style={styles.timeValue}>{formatTime(child.checkedInAt)}</Text>
        </View>
        <View style={styles.timeDivider} />
        <View style={styles.timeCell}>
          <Text style={styles.timeLabel}>الخروج</Text>
          <Text style={styles.timeValue}>{formatTime(child.checkedOutAt)}</Text>
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        disabled={done || busy}
        onPress={onPress}
        style={({ pressed }) => [
          styles.actionButton,
          child.nextAction === "checkout" && styles.checkoutButton,
          done && styles.doneButton,
          pressed && styles.pressed,
        ]}
      >
        {busy
          ? <ActivityIndicator color={child.nextAction === "checkout" ? colors.danger : colors.surface} />
          : <Text style={[
            styles.actionText,
            child.nextAction === "checkout" && styles.checkoutText,
            done && styles.doneText,
          ]}>{actionLabels[child.nextAction]}</Text>}
      </Pressable>
    </View>
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
  pressed: { opacity: 0.72 },
  summary: {
    flexDirection: "row-reverse",
    gap: spacing.sm,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  summaryItem: {
    minHeight: 72,
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  summaryValue: { fontSize: 24, fontWeight: "900" },
  summaryLabel: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  searchBox: {
    minHeight: touchTarget,
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    backgroundColor: colors.surface,
  },
  searchInput: {
    minHeight: touchTarget,
    flex: 1,
    color: colors.text,
    fontSize: 15,
    writingDirection: "rtl",
  },
  searchIcon: { color: colors.primary, fontSize: 22, fontWeight: "900" },
  statePanel: {
    minHeight: 240,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  stateText: { color: colors.muted, fontSize: 14 },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: "800", textAlign: "center" },
  searchEmpty: {
    minHeight: 150,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  clearSearch: { color: colors.primary, fontSize: 14, fontWeight: "800" },
  list: { gap: spacing.md },
  childCard: {
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  childHeader: {
    minHeight: 78,
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
  },
  avatar: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
    backgroundColor: colors.primarySoft,
  },
  avatarText: { color: colors.primary, fontSize: 18, fontWeight: "900" },
  childCopy: { flex: 1, gap: 3 },
  childName: { color: colors.text, fontSize: 16, fontWeight: "900", textAlign: "right" },
  childClass: { color: colors.muted, fontSize: 12, textAlign: "right" },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.dangerSoft,
  },
  statusText: { color: colors.danger, fontSize: 11, fontWeight: "900" },
  presentBadge: { backgroundColor: colors.successSoft },
  presentText: { color: colors.success },
  leftBadge: { backgroundColor: colors.background },
  leftText: { color: colors.muted },
  times: {
    flexDirection: "row-reverse",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  timeCell: { flex: 1, alignItems: "center", gap: 3 },
  timeDivider: { width: 1, height: 34, backgroundColor: colors.border },
  timeLabel: { color: colors.muted, fontSize: 11, fontWeight: "700" },
  timeValue: { color: colors.text, fontSize: 14, fontWeight: "800" },
  actionButton: {
    minHeight: touchTarget,
    alignItems: "center",
    justifyContent: "center",
    margin: spacing.md,
    marginTop: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  actionText: { color: colors.surface, fontSize: 14, fontWeight: "900" },
  checkoutButton: { borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.surface },
  checkoutText: { color: colors.danger },
  doneButton: { backgroundColor: colors.background },
  doneText: { color: colors.muted },
  successMessage: {
    padding: spacing.md,
    borderRightWidth: 4,
    borderRightColor: colors.success,
    backgroundColor: colors.successSoft,
    color: colors.success,
    fontSize: 14,
    fontWeight: "800",
    textAlign: "right",
  },
  errorMessage: {
    padding: spacing.md,
    borderRightWidth: 4,
    borderRightColor: colors.danger,
    backgroundColor: colors.dangerSoft,
    color: colors.danger,
    fontSize: 14,
    fontWeight: "800",
    textAlign: "right",
  },
});
