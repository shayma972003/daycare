import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function source(...segments: string[]) {
  return readFileSync(join(ROOT, ...segments), "utf8");
}

describe("mobile guardian notifications", () => {
  const layout = source("mobile", "src", "app", "(guardian)", "_layout.tsx");
  const route = source("mobile", "src", "app", "(guardian)", "notifications.tsx");
  const screen = source("mobile", "src", "components", "guardian-notifications-screen.tsx");

  it("adds a dedicated guardian notifications tab", () => {
    expect(layout).toContain('name="notifications"');
    expect(layout).toContain('tabBarAccessibilityLabel: "الإشعارات"');
    expect(route).toContain("GuardianNotificationsScreen");
  });

  it("loads absence, calendar, and activity messages from the scoped inbox", () => {
    expect(screen).toContain("loadMessages()");
    expect(screen).toContain('message.kind === "absence"');
    expect(screen).toContain('message.kind === "calendar"');
    expect(screen).toContain("إعلان");
    expect(screen).toContain("تنبيهات الغياب والإعلانات والتقويم");
  });

  it("marks one message or all unread messages as read", () => {
    expect(screen).toContain("markMessageRead(message.recipientId)");
    expect(screen).toContain("await markMessageRead()");
    expect(screen).toContain("تحديد الكل كمقروء");
  });

  it("refreshes the inbox while the app remains open", () => {
    expect(screen).toContain("30_000");
    expect(screen).toContain("setInterval");
  });

  it("shows the child for an absence and opens calendar messages", () => {
    expect(screen).toContain("غياب ${message.student.name}");
    expect(screen).toContain("فتح التقويم");
    expect(screen).toContain('router.push("/(guardian)/calendar")');
  });
});
