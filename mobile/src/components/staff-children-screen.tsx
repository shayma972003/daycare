import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";

import { loadTodayAttendance, type AttendanceChild } from "@/api/attendance";
import { AppScreen } from "@/components/app-screen";
import { useSession } from "@/session";
import { colors, radius, spacing, touchTarget } from "@/theme";

function periodLabel(period: AttendanceChild["period"]) {
  if (period === "MORNING") return "صباحي";
  if (period === "EVENING") return "مسائي";
  return "غير محدد";
}

function attendanceLabel(child: AttendanceChild) {
  if (child.nextAction === "checkout") return "حاضر";
  if (child.nextAction === "done") return "غادر";
  return "لم يحضر";
}

export function StaffChildrenScreen() {
  const { account } = useSession();
  if (!account || account.kind !== "staff") return null;

  return (
    <AppScreen subtitle={account.schoolName} title="أطفالي">
      <StaffChildrenSection />
    </AppScreen>
  );
}

export function StaffChildrenSection() {
  const router = useRouter();
  const [children, setChildren] = useState<AttendanceChild[]>([]);
  const [search, setSearch] = useState("");
  const [selectedClass, setSelectedClass] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await loadTodayAttendance();
      setChildren(result.children);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذّر تحميل الأطفال");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const result = await loadTodayAttendance();
        if (active) setChildren(result.children);
      } catch (caught) {
        if (active) {
          setError(caught instanceof Error ? caught.message : "تعذّر تحميل الأطفال");
        }
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const classes = useMemo(() => {
    const values = new Map<string, string>();
    for (const child of children) {
      if (child.classId && child.className) values.set(child.classId, child.className);
    }
    return [...values.entries()].map(([id, name]) => ({ id, name }));
  }, [children]);

  const filteredChildren = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("ar");
    return children.filter((child) => {
      const matchesClass = !selectedClass || child.classId === selectedClass;
      const matchesSearch = !query
        || child.name.toLocaleLowerCase("ar").includes(query)
        || child.className?.toLocaleLowerCase("ar").includes(query);
      return matchesClass && matchesSearch;
    });
  }, [children, search, selectedClass]);

  return (
    <View style={styles.section}>
      <View style={styles.searchBox}>
        <TextInput
          accessibilityLabel="البحث عن طفل"
          onChangeText={setSearch}
          placeholder="البحث بالاسم…"
          placeholderTextColor={colors.muted}
          returnKeyType="search"
          style={styles.searchInput}
          textAlign="right"
          value={search}
        />
        <Text style={styles.searchIcon}>⌕</Text>
      </View>

      {classes.length > 1 ? (
        <View style={styles.filters}>
          <FilterChip
            active={selectedClass === null}
            label="كل الفصول"
            onPress={() => setSelectedClass(null)}
          />
          {classes.map((item) => (
            <FilterChip
              active={selectedClass === item.id}
              key={item.id}
              label={item.name}
              onPress={() => setSelectedClass(item.id)}
            />
          ))}
        </View>
      ) : null}

      <View style={styles.listHeading}>
        <Text style={styles.count}>{filteredChildren.length}</Text>
        <Text style={styles.heading}>أطفالي</Text>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {loading ? (
        <View style={styles.statePanel}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.stateText}>جارٍ تحميل الأطفال…</Text>
        </View>
      ) : children.length === 0 ? (
        <EmptyState label="لا يوجد أطفال مرتبطون بفصولك" onRetry={reload} />
      ) : filteredChildren.length === 0 ? (
        <View style={styles.statePanel}>
          <Text style={styles.emptyTitle}>لا توجد نتائج مطابقة</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setSearch("");
              setSelectedClass(null);
            }}
          >
            <Text style={styles.clearText}>مسح البحث والفلاتر</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.list}>
          {filteredChildren.map((child) => (
            <ChildCard
              child={child}
              expanded={expandedId === child.id}
              key={child.id}
              onAttendance={() => router.push("/(staff)/attendance")}
              onCare={() => router.push("/(staff)/care")}
              onToggle={() => setExpandedId(expandedId === child.id ? null : child.id)}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function FilterChip({ active, label, onPress }: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.filterChip, active && styles.filterChipActive]}
    >
      <Text style={[styles.filterText, active && styles.filterTextActive]}>{label}</Text>
    </Pressable>
  );
}

function ChildCard({ child, expanded, onAttendance, onCare, onToggle }: {
  child: AttendanceChild;
  expanded: boolean;
  onAttendance: () => void;
  onCare: () => void;
  onToggle: () => void;
}) {
  const attendance = attendanceLabel(child);
  return (
    <View style={styles.childCard}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={onToggle}
        style={({ pressed }) => [styles.childHeader, pressed && styles.pressed]}
      >
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{child.name.trim().slice(0, 1) || "ط"}</Text>
        </View>
        <View style={styles.childCopy}>
          <Text style={styles.childName}>{child.name}</Text>
          <Text style={styles.childMeta}>
            {child.className ?? "بدون فصل"} · {periodLabel(child.period)}
          </Text>
        </View>
        <View style={[
          styles.status,
          attendance === "حاضر" && styles.statusPresent,
          attendance === "غادر" && styles.statusLeft,
        ]}>
          <Text style={[
            styles.statusText,
            attendance === "حاضر" && styles.statusPresentText,
            attendance === "غادر" && styles.statusLeftText,
          ]}>{attendance}</Text>
        </View>
        <Text style={styles.chevron}>{expanded ? "⌃" : "⌄"}</Text>
      </Pressable>

      {expanded ? (
        <View style={styles.details}>
          <View style={styles.detailsRow}>
            <Detail label="الفصل" value={child.className ?? "بدون فصل"} />
            <View style={styles.detailsDivider} />
            <Detail label="الفترة" value={periodLabel(child.period)} />
          </View>
          <View style={styles.actions}>
            <CardAction label="فتح الحضور" onPress={onAttendance} />
            <CardAction label="تقرير الرعاية" onPress={onCare} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detail}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function CardAction({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.cardAction, pressed && styles.pressed]}
    >
      <Text style={styles.cardActionText}>{label}</Text>
    </Pressable>
  );
}

function EmptyState({ label, onRetry }: { label: string; onRetry: () => Promise<void> }) {
  return (
    <View style={styles.statePanel}>
      <Text style={styles.emptyTitle}>{label}</Text>
      <Pressable accessibilityRole="button" onPress={() => void onRetry()} style={styles.retryButton}>
        <Text style={styles.retryText}>إعادة المحاولة</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.md },
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
  filters: { flexDirection: "row-reverse", flexWrap: "wrap", gap: spacing.sm },
  filterChip: {
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    backgroundColor: colors.surface,
  },
  filterChipActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  filterText: { color: colors.text, fontSize: 13, fontWeight: "700" },
  filterTextActive: { color: colors.surface },
  listHeading: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xs,
  },
  heading: { color: colors.text, fontSize: 18, fontWeight: "900", textAlign: "right" },
  count: {
    minWidth: 28,
    height: 28,
    overflow: "hidden",
    borderRadius: 14,
    backgroundColor: colors.primarySoft,
    color: colors.primary,
    fontSize: 13,
    fontWeight: "900",
    lineHeight: 28,
    textAlign: "center",
  },
  list: { gap: spacing.sm },
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
  childMeta: { color: colors.muted, fontSize: 12, textAlign: "right" },
  status: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999, backgroundColor: colors.dangerSoft },
  statusText: { color: colors.danger, fontSize: 10, fontWeight: "900" },
  statusPresent: { backgroundColor: colors.successSoft },
  statusPresentText: { color: colors.success },
  statusLeft: { backgroundColor: colors.background },
  statusLeftText: { color: colors.muted },
  chevron: { color: colors.primary, fontSize: 19, fontWeight: "900" },
  pressed: { opacity: 0.72 },
  details: { gap: spacing.md, padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.background },
  detailsRow: { flexDirection: "row-reverse", alignItems: "center" },
  detail: { flex: 1, alignItems: "center", gap: 3 },
  detailsDivider: { width: 1, height: 36, backgroundColor: colors.border },
  detailLabel: { color: colors.muted, fontSize: 11, fontWeight: "700" },
  detailValue: { color: colors.text, fontSize: 14, fontWeight: "800" },
  actions: { flexDirection: "row-reverse", gap: spacing.sm },
  cardAction: {
    minHeight: touchTarget,
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  cardActionText: { color: colors.primary, fontSize: 13, fontWeight: "900" },
  statePanel: {
    minHeight: 220,
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
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: "800", textAlign: "center" },
  clearText: { color: colors.primary, fontSize: 14, fontWeight: "800" },
  retryButton: { minHeight: touchTarget, justifyContent: "center", paddingHorizontal: spacing.md },
  retryText: { color: colors.primary, fontSize: 14, fontWeight: "800" },
  error: {
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
