import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { loadMessages, markMessageRead, type MobileMessage } from "@/api/messages";
import { AppScreen } from "@/components/app-screen";
import { TextButton } from "@/components/buttons";
import { useSession } from "@/session";
import { colors, radius, spacing, touchTarget } from "@/theme";

function messageTitle(message: MobileMessage) {
  if (message.kind === "absence") {
    return message.student ? `غياب ${message.student.name}` : "تنبيه غياب";
  }
  if (message.kind === "calendar") return message.calendarEvent?.title ?? "تحديث التقويم";
  return message.activity?.name ?? "إعلان جديد";
}

function kindLabel(kind: MobileMessage["kind"]) {
  if (kind === "absence") return "غياب";
  if (kind === "calendar") return "تقويم";
  return "إعلان";
}

function formatMessageDate(value: string) {
  return new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", {
    timeZone: "Asia/Riyadh",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatAbsenceDate(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(value));
}

export function GuardianNotificationsScreen() {
  const { account } = useSession();
  const router = useRouter();
  const [messages, setMessages] = useState<MobileMessage[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unreadCount = useMemo(
    () => messages.filter((message) => !message.readAt).length,
    [messages]
  );

  useEffect(() => {
    let active = true;
    const updateInbox = (initial = false) => {
      void loadMessages()
        .then((result) => {
          if (active) {
            setMessages(result.messages);
            setError(null);
          }
        })
        .catch((caught: unknown) => {
          if (active) setError(caught instanceof Error ? caught.message : "تعذّر تحميل الإشعارات");
        })
        .finally(() => {
          if (active && initial) setLoading(false);
        });
    };
    updateInbox(true);
    const timer = setInterval(() => updateInbox(), 30_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  if (!account || account.kind !== "guardian") return null;

  const reload = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const result = await loadMessages();
      setMessages(result.messages);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذّر تحميل الإشعارات");
    } finally {
      setRefreshing(false);
    }
  };

  const openMessage = async (message: MobileMessage) => {
    setExpandedId(expandedId === message.recipientId ? null : message.recipientId);
    if (message.readAt) return;
    try {
      await markMessageRead(message.recipientId);
      const readAt = new Date().toISOString();
      setMessages((current) => current.map((item) => (
        item.recipientId === message.recipientId ? { ...item, readAt } : item
      )));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذّر تحديث الإشعار");
    }
  };

  const markAll = async () => {
    if (unreadCount === 0) return;
    setError(null);
    try {
      await markMessageRead();
      const readAt = new Date().toISOString();
      setMessages((current) => current.map((message) => ({
        ...message,
        readAt: message.readAt ?? readAt,
      })));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذّر تحديث الإشعارات");
    }
  };

  return (
    <AppScreen
      action={(
        <Pressable
          accessibilityLabel="تحديث الإشعارات"
          accessibilityRole="button"
          disabled={refreshing}
          onPress={() => void reload()}
          style={({ pressed }) => [styles.refreshButton, pressed && styles.pressed]}
        >
          {refreshing
            ? <ActivityIndicator color={colors.primary} size="small" />
            : <Text style={styles.refreshIcon}>↻</Text>}
        </Pressable>
      )}
      subtitle={unreadCount ? `${account.schoolName} · ${unreadCount} غير مقروء` : account.schoolName}
      title="الإشعارات"
    >
      {unreadCount > 0 ? (
        <View style={styles.actions}>
          <Text style={styles.unreadText}>{unreadCount} إشعار غير مقروء</Text>
          <TextButton label="تحديد الكل كمقروء" onPress={() => void markAll()} />
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {loading ? (
        <View style={styles.statePanel}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.stateText}>جارٍ تحميل الإشعارات…</Text>
        </View>
      ) : messages.length === 0 ? (
        <View style={styles.statePanel}>
          <Text style={styles.emptyIcon}>○</Text>
          <Text style={styles.emptyTitle}>لا توجد إشعارات</Text>
          <Text style={styles.stateText}>ستظهر هنا تنبيهات الغياب والإعلانات والتقويم.</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {messages.map((message) => (
            <MessageCard
              expanded={expandedId === message.recipientId}
              key={message.recipientId}
              message={message}
              onOpenCalendar={() => router.push("/(guardian)/calendar")}
              onPress={() => void openMessage(message)}
            />
          ))}
        </View>
      )}
    </AppScreen>
  );
}

function MessageCard({ expanded, message, onOpenCalendar, onPress }: {
  expanded: boolean;
  message: MobileMessage;
  onOpenCalendar: () => void;
  onPress: () => void;
}) {
  const absenceDate = formatAbsenceDate(message.absenceDate);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.messageCard,
        !message.readAt && styles.unreadCard,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.messageHeader}>
        {!message.readAt ? <View style={styles.unreadDot} /> : null}
        <View style={styles.messageCopy}>
          <Text style={styles.messageTitle}>{messageTitle(message)}</Text>
          <Text style={styles.messageDate}>{formatMessageDate(message.createdAt)}</Text>
        </View>
        <View style={styles.kindBadge}>
          <Text style={styles.kindText}>{kindLabel(message.kind)}</Text>
        </View>
      </View>
      {expanded ? (
        <View style={styles.details}>
          <Text style={styles.messageBody}>{message.body}</Text>
          {absenceDate ? <Text style={styles.detailMeta}>التاريخ: {absenceDate}</Text> : null}
          {message.kind === "calendar" ? (
            <Pressable accessibilityRole="button" onPress={onOpenCalendar}>
              <Text style={styles.calendarLink}>فتح التقويم</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  refreshButton: { width: touchTarget, height: touchTarget, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border, borderRadius: 999, backgroundColor: colors.surface },
  refreshIcon: { color: colors.primary, fontSize: 27, fontWeight: "800" },
  actions: { minHeight: touchTarget, flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  unreadText: { color: colors.primary, fontSize: 13, fontWeight: "900", textAlign: "right" },
  list: { gap: spacing.sm },
  messageCard: { gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
  unreadCard: { borderRightWidth: 4, borderRightColor: colors.primary, backgroundColor: "#FCFAFF" },
  messageHeader: { flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm },
  unreadDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.primary },
  messageCopy: { flex: 1, gap: 3 },
  messageTitle: { color: colors.text, fontSize: 15, fontWeight: "900", textAlign: "right", writingDirection: "rtl" },
  messageDate: { color: colors.muted, fontSize: 11, textAlign: "right" },
  kindBadge: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999, backgroundColor: colors.primarySoft },
  kindText: { color: colors.primary, fontSize: 10, fontWeight: "900" },
  details: { gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  messageBody: { color: colors.text, fontSize: 14, lineHeight: 23, textAlign: "right", writingDirection: "rtl" },
  detailMeta: { color: colors.muted, fontSize: 12, textAlign: "right", writingDirection: "rtl" },
  calendarLink: { minHeight: touchTarget, color: colors.primary, fontSize: 13, fontWeight: "900", lineHeight: touchTarget, textAlign: "right" },
  statePanel: { minHeight: 230, alignItems: "center", justifyContent: "center", gap: spacing.sm, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
  stateText: { color: colors.muted, fontSize: 13, lineHeight: 21, textAlign: "center", writingDirection: "rtl" },
  emptyIcon: { color: colors.primary, fontSize: 34, fontWeight: "900" },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: "900" },
  error: { padding: spacing.md, borderRightWidth: 4, borderRightColor: colors.danger, backgroundColor: colors.dangerSoft, color: colors.danger, fontSize: 14, fontWeight: "800", textAlign: "right", writingDirection: "rtl" },
  pressed: { opacity: 0.72 },
});
