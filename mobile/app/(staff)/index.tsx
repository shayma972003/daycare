import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "../../src/session";
import {
  fetchRoster,
  markAttendance,
  riyadhTime,
  type RosterChild,
} from "../../src/api/attendance";
import { colors, radius, spacing, TOUCH_TARGET } from "../../src/theme";
import { CareSheet } from "../../src/CareSheet";

/**
 * The teacher's home: today's children, one tap each.
 *
 * The list is the screen. There is no dashboard above it and no menu to open —
 * she is standing, holding a child, and the thing she came to do is the first
 * thing under her thumb.
 *
 * Marking is optimistic. A check-in that waits for a round trip on nursery
 * Wi-Fi means tapping a name and watching nothing happen, so the row moves at
 * once and rolls back if the server disagrees. The rollback is visible — a
 * silent revert would leave her believing a child is marked in when they are
 * not.
 */
export default function Roster() {
  const insets = useSafeAreaInsets();
  const { account, signOut } = useSession();

  const [children, setChildren] = useState<RosterChild[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Ids mid-flight, so a double tap cannot send two check-ins. */
  const [busy, setBusy] = useState<Set<string>>(new Set());
  /* The one-child care path, kept out of the attendance state so opening it
     cannot disturb a row mid-flight. */
  const [caring, setCaring] = useState<RosterChild | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setChildren(await fetchRoster());
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذّر تحميل الكشف");
    }
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  async function mark(child: RosterChild) {
    if (child.nextAction === "done" || busy.has(child.id)) return;
    const action = child.nextAction;

    setBusy((current) => new Set(current).add(child.id));
    const before = children;

    // Moves now; the server confirms or we put it back.
    setChildren((current) =>
      current.map((row) =>
        row.id === child.id
          ? {
              ...row,
              nextAction: action === "checkin" ? "checkout" : "done",
              checkedInAt: action === "checkin" ? new Date().toISOString() : row.checkedInAt,
              checkedOutAt: action === "checkout" ? new Date().toISOString() : row.checkedOutAt,
            }
          : row
      )
    );

    try {
      const result = await markAttendance(child.id, action);
      setChildren((current) =>
        current.map((row) => (row.id === child.id ? { ...row, ...result } : row))
      );
      setError(null);
    } catch (caught) {
      // Put the row back and say so. A silent revert would leave her believing
      // a child is marked in when they are not.
      setChildren(before);
      setError(caught instanceof Error ? caught.message : "تعذّر تسجيل الحضور");
    } finally {
      setBusy((current) => {
        const next = new Set(current);
        next.delete(child.id);
        return next;
      });
    }
  }

  const present = children.filter((child) => child.checkedInAt && !child.checkedOutAt).length;

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.teal} size="large" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <View
        style={{
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.md,
          backgroundColor: colors.surface,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <View>
          <Text style={{ fontSize: 18, fontWeight: "700", color: colors.navy }}>حضور اليوم</Text>
          <Text style={{ fontSize: 13, color: colors.textMuted, marginTop: 2 }}>
            {present} من {children.length} حاضر
          </Text>
        </View>
        <Pressable
          onPress={signOut}
          style={{ minHeight: TOUCH_TARGET, justifyContent: "center", paddingHorizontal: spacing.sm }}
        >
          <Text style={{ color: colors.textMuted, fontSize: 13 }}>خروج</Text>
        </Pressable>
      </View>

      {error && (
        <View style={{ backgroundColor: colors.dangerBg, padding: spacing.md }}>
          <Text style={{ color: colors.danger, fontSize: 14 }}>{error}</Text>
        </View>
      )}

      {notice && (
        <Pressable onPress={() => setNotice(null)} style={{ backgroundColor: colors.successBg, padding: spacing.md }}>
          <Text style={{ color: colors.success, fontSize: 14 }}>{notice}</Text>
        </Pressable>
      )}

      <FlatList
        data={children}
        keyExtractor={(child) => child.id}
        contentContainerStyle={{ padding: spacing.md, gap: spacing.sm, paddingBottom: insets.bottom + spacing.xl }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load().finally(() => setRefreshing(false));
            }}
            tintColor={colors.teal}
          />
        }
        ListEmptyComponent={
          <Text style={{ textAlign: "center", color: colors.textMuted, marginTop: spacing.xl }}>
            {account?.schoolName ? "لا يوجد أطفال مسجّلون" : "لا يوجد أطفال"}
          </Text>
        }
        renderItem={({ item }) => (
          <ChildRow
            child={item}
            busy={busy.has(item.id)}
            onMark={() => mark(item)}
            onCare={() => setCaring(item)}
          />
        )}
      />

      {caring && (
        <CareSheet
          childIds={[caring.id]}
          childLabel={caring.name}
          onClose={() => setCaring(null)}
          onFiled={(count) => {
            setCaring(null);
            setNotice(`تم حفظ ${count} تقرير`);
            setError(null);
          }}
        />
      )}
    </View>
  );
}

function ChildRow({
  child,
  busy,
  onMark,
  onCare,
}: {
  child: RosterChild;
  busy: boolean;
  onMark: () => void;
  onCare: () => void;
}) {
  const done = child.nextAction === "done";
  const inside = Boolean(child.checkedInAt) && !child.checkedOutAt;

  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        padding: spacing.md,
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.md,
        borderWidth: 1,
        borderColor: inside ? colors.teal : colors.border,
      }}
    >
      {/* Two targets: the name area files a report, the button marks attendance.
          The same split the web roster uses. */}
      <Pressable onPress={onCare} style={{ flex: 1 }}>
        <Text style={{ fontSize: 16, fontWeight: "600", color: colors.navy }}>{child.name}</Text>
        <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
          {child.className ?? "بدون فصل"}
          {child.checkedInAt ? ` · دخول ${riyadhTime(child.checkedInAt)}` : ""}
          {child.checkedOutAt ? ` · خروج ${riyadhTime(child.checkedOutAt)}` : ""}
        </Text>
        <Text style={{ fontSize: 11, color: colors.teal, marginTop: 2 }}>+ تقرير رعاية</Text>
      </Pressable>

      <Pressable
        onPress={onMark}
        disabled={done || busy}
        style={{
          minWidth: 96,
          minHeight: TOUCH_TARGET,
          borderRadius: radius.md,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: spacing.md,
          backgroundColor: done
            ? colors.successBg
            : child.nextAction === "checkin"
              ? colors.teal
              : colors.tealLight,
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? (
          <ActivityIndicator color={colors.teal} />
        ) : (
          <Text
            style={{
              fontSize: 14,
              fontWeight: "700",
              color: done
                ? colors.success
                : child.nextAction === "checkin"
                  ? "#FFFFFF"
                  : colors.teal,
            }}
          >
            {done ? "انتهى" : child.nextAction === "checkin" ? "دخول" : "خروج"}
          </Text>
        )}
      </Pressable>
    </View>
  );
}
