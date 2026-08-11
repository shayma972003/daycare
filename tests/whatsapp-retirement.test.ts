import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("retired external messaging channel", () => {
  it("removes the old monthly quota from schema, seed, APIs, and admin UI", () => {
    for (const path of [
      "prisma/schema.prisma",
      "prisma/seed-admin.ts",
      "src/app/api/admin/plans/route.ts",
      "src/app/api/admin/plans/[id]/route.ts",
      "src/app/admin/(protected)/subscriptions/page.tsx",
    ]) {
      expect(source(path), path).not.toContain("max_whatsapp_per_month");
    }
  });

  it("keeps email, internal delivery logs, and push support in place", () => {
    expect(source("src/lib/notifications.ts")).toContain(
      "export async function sendEmail"
    );
    expect(source("src/lib/notifications.ts")).toContain(
      "prisma.notificationLog.create"
    );
    expect(source("src/app/api/notifications/route.ts")).toContain(
      "prisma.notificationLog.findMany"
    );
    expect(source("src/lib/push.ts")).toContain("export async function enqueuePush");
    expect(source("src/lib/push.ts")).toContain(
      "export async function drainPushQueue"
    );
  });

  it("does not expose the retired channel as an active dashboard filter", () => {
    const dashboard = source("src/app/(dashboard)/dashboard/page.tsx");
    expect(dashboard).not.toContain('<option value="WHATSAPP">');
    expect(dashboard).not.toContain("home.whatsapp");
    expect(source("locales/ar.json")).not.toContain('"whatsapp":');
    expect(source("locales/en.json")).not.toContain('"whatsapp":');
  });

  it("preserves historical channel identity while dropping only the quota column", () => {
    const schema = source("prisma/schema.prisma");
    const migration = source(
      "prisma/migrations/20260811183000_remove_whatsapp_plan_quota/migration.sql"
    );

    expect(schema).toMatch(/enum NotificationType\s*{\s*WHATSAPP\s*EMAIL\s*}/);
    expect(migration).toContain(
      'ALTER TABLE "SubscriptionPlan" DROP COLUMN "max_whatsapp_per_month";'
    );
    expect(migration).not.toMatch(/UPDATE\s+"NotificationLog"|DROP TYPE/i);
    expect(source("locales/ar.json")).toContain('"WHATSAPP": "واتساب (سجل قديم)"');
    expect(source("locales/en.json")).toContain(
      '"WHATSAPP": "WhatsApp (legacy record)"'
    );
  });
});
