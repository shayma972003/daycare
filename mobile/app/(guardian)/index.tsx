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
import { riyadhTime } from "../../src/api/attendance";
import {
  fetchMyChildren,
  fetchMyAttendance,
  fetchCareFeed,
  fetchInvoices,
  type Child,
  type ChildAttendance,
  type CareEntry,
  type Invoice,
} from "../../src/api/guardian";
import { colors, radius, spacing, TOUCH_TARGET } from "../../src/theme";

/**
 * The parent's screen.
 *
 * It opens on the one question a parent actually has — has my child arrived —
 * and puts the day's care underneath it. The invoices are a tab rather than a
 * section: money is a monthly errand, not a daily one, and putting it in the
 * same scroll as "she napped an hour" gets the balance of the screen wrong.
 *
 * Everything here is scoped on the server. The app never asks "may I see this
 * child"; it asks for what this account is entitled to and draws what comes
 * back.
 */
type Tab = "today" | "invoices";

export default function GuardianHome() {
  const insets = useSafeAreaInsets();
  const { signOut } = useSession();

  const [tab, setTab] = useState<Tab>("today");
  const [children, setChildren] = useState<Child[]>([]);
  const [attendance, setAttendance] = useState<ChildAttendance[]>([]);
  const [feed, setFeed] = useState<CareEntry[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [schoolName, setSchoolName] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    /**
     * `allSettled`, not `all`.
     *
     * Four independent reads. Under `Promise.all` one slow or failing call —
     * a school with no invoices yet, say — would blank the attendance a parent
     * opened the app to see.
     */
    const [me, today, care, bills] = await Promise.allSettled([
      fetchMyChildren(),
      fetchMyAttendance(),
      fetchCareFeed(),
      fetchInvoices(),
    ]);

    if (me.status === "fulfilled") {
      setChildren(me.value.children);
      setSchoolName(me.value.schoolName);
    }
    if (today.status === "fulfilled") setAttendance(today.value);
    if (care.status === "fulfilled") setFeed(care.value);
    if (bills.status === "fulfilled") setInvoices(bills.value);

    // Only the one that matters is worth a message; the rest degrade quietly.
    setError(
      me.status === "rejected"
        ? me.reason instanceof Error
          ? me.reason.message
          : "تعذّر تحميل البيانات"
        : null
    );
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.teal} size="large" />
      </View>
    );
  }

  const refresh = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        load().finally(() => setRefreshing(false));
      }}
      tintColor={colors.teal}
    />
  );

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
          <Text style={{ fontSize: 18, fontWeight: "700", color: colors.navy }}>أطفالي</Text>
          {schoolName ? (
            <Text style={{ fontSize: 13, color: colors.textMuted, marginTop: 2 }}>{schoolName}</Text>
          ) : null}
        </View>
        <Pressable
          onPress={signOut}
          style={{ minHeight: TOUCH_TARGET, justifyContent: "center", paddingHorizontal: spacing.sm }}
        >
          <Text style={{ color: colors.textMuted, fontSize: 13 }}>خروج</Text>
        </Pressable>
      </View>

      <View style={{ flexDirection: "row", padding: spacing.md, gap: spacing.sm }}>
        {(["today", "invoices"] as Tab[]).map((option) => (
          <Pressable
            key={option}
            onPress={() => setTab(option)}
            style={{
              flex: 1,
              minHeight: TOUCH_TARGET,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: radius.md,
              backgroundColor: tab === option ? colors.teal : colors.surface,
              borderWidth: 1,
              borderColor: tab === option ? colors.teal : colors.border,
            }}
          >
            <Text
              style={{
                fontSize: 14,
                fontWeight: tab === option ? "700" : "400",
                color: tab === option ? "#FFFFFF" : colors.navy,
              }}
            >
              {option === "today" ? "اليوم" : "الفواتير"}
            </Text>
          </Pressable>
        ))}
      </View>

      {error && (
        <View style={{ backgroundColor: colors.dangerBg, padding: spacing.md }}>
          <Text style={{ color: colors.danger, fontSize: 14 }}>{error}</Text>
        </View>
      )}

      {tab === "today" ? (
        <FlatList
          data={children}
          keyExtractor={(child) => child.id}
          refreshControl={refresh}
          contentContainerStyle={{
            padding: spacing.md,
            paddingTop: 0,
            gap: spacing.md,
            paddingBottom: insets.bottom + spacing.xl,
          }}
          ListEmptyComponent={
            <Text style={{ textAlign: "center", color: colors.textMuted, marginTop: spacing.xl }}>
              لا يوجد أطفال مرتبطون بحسابك
            </Text>
          }
          renderItem={({ item }) => (
            <ChildCard
              child={item}
              attendance={attendance.find((row) => row.childId === item.id) ?? null}
              reports={feed.filter((entry) => entry.student.id === item.id)}
            />
          )}
        />
      ) : (
        <FlatList
          data={invoices}
          keyExtractor={(invoice) => invoice.id}
          refreshControl={refresh}
          contentContainerStyle={{
            padding: spacing.md,
            paddingTop: 0,
            gap: spacing.sm,
            paddingBottom: insets.bottom + spacing.xl,
          }}
          ListEmptyComponent={
            <Text style={{ textAlign: "center", color: colors.textMuted, marginTop: spacing.xl }}>
              لا توجد فواتير
            </Text>
          }
          renderItem={({ item }) => (
            <View
              style={{
                backgroundColor: colors.surface,
                borderRadius: radius.lg,
                padding: spacing.md,
                borderWidth: 1,
                borderColor: colors.border,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontWeight: "600", color: colors.navy }}>
                  {item.childName ?? "فاتورة"}
                </Text>
                <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
                  {arabicDate(item.issuedAt)}
                </Text>
              </View>
              <Text style={{ fontSize: 15, fontWeight: "700", color: colors.navy }}>
                {item.amount.toFixed(2)} ر.س
              </Text>
            </View>
          )}
        />
      )}
    </View>
  );
}

function ChildCard({
  child,
  attendance,
  reports,
}: {
  child: Child;
  attendance: ChildAttendance | null;
  reports: CareEntry[];
}) {
  const inside = Boolean(attendance?.checkedInAt) && !attendance?.checkedOutAt;

  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        padding: spacing.md,
        borderWidth: 1,
        borderColor: inside ? colors.teal : colors.border,
        gap: spacing.sm,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 16, fontWeight: "700", color: colors.navy }}>{child.name}</Text>
          <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
            {child.class?.name ?? "بدون فصل"}
          </Text>
        </View>

        {/* The first question a parent opens the app with. */}
        <View
          style={{
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.xs + 2,
            borderRadius: radius.md,
            backgroundColor: inside
              ? colors.successBg
              : attendance?.checkedOutAt
                ? colors.tealLight
                : "#F3F4F6",
          }}
        >
          <Text
            style={{
              fontSize: 13,
              fontWeight: "600",
              color: inside ? colors.success : attendance?.checkedOutAt ? colors.teal : colors.textMuted,
            }}
          >
            {inside
              ? `حاضر · ${riyadhTime(attendance!.checkedInAt)}`
              : attendance?.checkedOutAt
                ? `غادر · ${riyadhTime(attendance.checkedOutAt)}`
                : "لم يحضر بعد"}
          </Text>
        </View>
      </View>

      {reports.length > 0 && (
        <View style={{ gap: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm }}>
          {reports.slice(0, 6).map((entry) => (
            <View key={entry.id} style={{ flexDirection: "row", gap: spacing.sm }}>
              <Text style={{ fontSize: 12, color: colors.textMuted, minWidth: 62 }}>
                {riyadhTime(entry.occurredAt)}
              </Text>
              <Text style={{ fontSize: 13, color: colors.navy, flex: 1 }}>
                <Text style={{ fontWeight: "600" }}>{entry.typeLabel ?? entry.type}</Text>
                {entry.summary ? ` · ${entry.summary}` : ""}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

/** Riyadh calendar date, Latin digits — matching every other surface. */
function arabicDate(iso: string): string {
  const shifted = new Date(new Date(iso).getTime() + 3 * 60 * 60 * 1000);
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${shifted.getUTCFullYear()}`;
}
