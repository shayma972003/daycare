import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { loadMessages, markMessageRead, type MobileMessage } from "@/api/messages";
import { AppScreen, cardStyles } from "@/components/app-screen";
import { TextButton } from "@/components/buttons";
import { NotificationSettingsCard } from "@/components/notification-settings-card";
import { StaffChildrenSection } from "@/components/staff-children-screen";
import { useSession } from "@/session";
import { colors, radius, spacing, touchTarget } from "@/theme";

type Section = "notifications" | "account";

function messageTitle(message: MobileMessage) {
  if (message.kind === "absence") return message.student ? `غياب ${message.student.name}` : "تنبيه غياب";
  if (message.kind === "calendar") return message.calendarEvent?.title ?? "تحديث التقويم";
  return message.activity?.name ?? "إشعار جديد";
}

function kindLabel(kind: MobileMessage["kind"]) {
  if (kind === "absence") return "غياب";
  if (kind === "calendar") return "تقويم";
  return "إعلان";
}

function formatMessageDate(value: string) {
  return new Intl.DateTimeFormat("ar-SA", {
    timeZone: "Asia/Riyadh",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function StaffAccountScreen() {
  const { account, signOut } = useSession();
  const [section, setSection] = useState<Section>("account");
  const [messages, setMessages] = useState<MobileMessage[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unreadCount = useMemo(
    () => messages.filter((message) => !message.readAt).length,
    [messages]
  );

  const reload = async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const result = await loadMessages();
      setMessages(result.messages);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذّر تحميل الإشعارات");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await loadMessages();
        if (active) setMessages(result.messages);
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "تعذّر تحميل الإشعارات");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (!account || account.kind !== "staff") return null;

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
      setMessages((current) => current.map((message) => ({ ...message, readAt: message.readAt ?? readAt })));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذّر تحديث الإشعارات");
    }
  };

  const logout = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <AppScreen subtitle={account.schoolName} title="حسابي">
      <View accessibilityRole="tablist" style={styles.sections}>
        <SectionTab
          active={section === "notifications"}
          count={unreadCount}
          label="الإشعارات"
          onPress={() => setSection("notifications")}
        />
        <SectionTab
          active={section === "account"}
          label="حسابي"
          onPress={() => setSection("account")}
        />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {section === "notifications" ? (
        <View style={styles.stack}>
          <View style={styles.notificationActions}>
            <TextButton label={refreshing ? "جارٍ التحديث…" : "تحديث"} onPress={() => void reload(true)} />
            {unreadCount > 0 ? (
              <TextButton label="تحديد الكل كمقروء" onPress={() => void markAll()} />
            ) : null}
          </View>

          {loading ? (
            <View style={styles.statePanel}>
              <ActivityIndicator color={colors.primary} size="large" />
              <Text style={styles.stateText}>جارٍ تحميل الإشعارات…</Text>
            </View>
          ) : messages.length === 0 ? (
            <View style={styles.statePanel}>
              <Text style={styles.emptyTitle}>لا توجد إشعارات</Text>
              <Text style={styles.stateText}>ستظهر هنا الإعلانات وتنبيهات التقويم.</Text>
            </View>
          ) : (
            <View style={styles.stack}>
              {messages.map((message) => (
                <MessageCard
                  expanded={expandedId === message.recipientId}
                  key={message.recipientId}
                  message={message}
                  onPress={() => void openMessage(message)}
                />
              ))}
            </View>
          )}
        </View>
      ) : (
        <View style={styles.stack}>
          <View style={cardStyles.card}>
            <Text style={cardStyles.heading}>{account.name}</Text>
            <AccountRow label="الدور" value={account.roleName ?? "غير محدد"} />
            <View style={styles.divider} />
            <AccountRow label="البريد" value={account.email} />
            <View style={styles.divider} />
            <AccountRow label="المدرسة" value={account.schoolName} />
            <View style={styles.divider} />
            <AccountRow label="ملف المعلم" value={account.teacherId ? "مرتبط" : "غير مرتبط"} />
          </View>

          <StaffChildrenSection />

          <NotificationSettingsCard kind="staff" />

          <Pressable
            accessibilityRole="button"
            disabled={signingOut}
            onPress={() => void logout()}
            style={({ pressed }) => [styles.logoutButton, pressed && styles.pressed]}
          >
            {signingOut
              ? <ActivityIndicator color={colors.danger} />
              : <Text style={styles.logoutText}>تسجيل الخروج</Text>}
          </Pressable>
        </View>
      )}
    </AppScreen>
  );
}

function SectionTab({ active, count, label, onPress }: {
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
      style={[styles.sectionTab, active && styles.sectionTabActive]}
    >
      <Text style={[styles.sectionTabText, active && styles.sectionTabTextActive]}>{label}</Text>
      {count ? <Text style={styles.count}>{count}</Text> : null}
    </Pressable>
  );
}

function MessageCard({ expanded, message, onPress }: {
  expanded: boolean;
  message: MobileMessage;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      onPress={onPress}
      style={({ pressed }) => [styles.messageCard, !message.readAt && styles.unreadCard, pressed && styles.pressed]}
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
      {expanded ? <Text style={styles.messageBody}>{message.body}</Text> : null}
    </Pressable>
  );
}

function AccountRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.accountRow}>
      <Text style={styles.accountValue}>{value}</Text>
      <Text style={styles.accountLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sections: { flexDirection: "row-reverse", gap: 6, padding: 6, borderRadius: 999, backgroundColor: colors.primarySoft },
  sectionTab: { minHeight: 46, flex: 1, flexDirection: "row-reverse", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 999 },
  sectionTabActive: { backgroundColor: colors.primary },
  sectionTabText: { color: colors.muted, fontSize: 14, fontWeight: "800" },
  sectionTabTextActive: { color: colors.surface },
  count: { minWidth: 22, height: 22, paddingHorizontal: 6, overflow: "hidden", borderRadius: 11, backgroundColor: colors.danger, color: colors.surface, fontSize: 11, fontWeight: "900", lineHeight: 22, textAlign: "center" },
  stack: { gap: spacing.md },
  notificationActions: { minHeight: touchTarget, flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between" },
  statePanel: { minHeight: 220, alignItems: "center", justifyContent: "center", gap: spacing.sm, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
  stateText: { color: colors.muted, fontSize: 13, lineHeight: 21, textAlign: "center" },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: "900" },
  messageCard: { gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
  unreadCard: { borderRightWidth: 4, borderRightColor: colors.primary, backgroundColor: "#FCFAFF" },
  messageHeader: { flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm },
  unreadDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.primary },
  messageCopy: { flex: 1, gap: 3 },
  messageTitle: { color: colors.text, fontSize: 15, fontWeight: "900", textAlign: "right" },
  messageDate: { color: colors.muted, fontSize: 11, textAlign: "right" },
  kindBadge: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999, backgroundColor: colors.primarySoft },
  kindText: { color: colors.primary, fontSize: 10, fontWeight: "900" },
  messageBody: { paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, color: colors.text, fontSize: 14, lineHeight: 23, textAlign: "right", writingDirection: "rtl" },
  accountRow: { minHeight: 42, flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  accountLabel: { color: colors.muted, fontSize: 13, textAlign: "right" },
  accountValue: { flex: 1, color: colors.text, fontSize: 14, fontWeight: "700", textAlign: "left" },
  divider: { height: 1, backgroundColor: colors.border },
  logoutButton: { minHeight: touchTarget, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.danger, borderRadius: radius.md, backgroundColor: colors.surface },
  logoutText: { color: colors.danger, fontSize: 15, fontWeight: "900" },
  pressed: { opacity: 0.72 },
  error: { padding: spacing.md, borderRightWidth: 4, borderRightColor: colors.danger, backgroundColor: colors.dangerSoft, color: colors.danger, fontSize: 14, fontWeight: "800", textAlign: "right" },
});
