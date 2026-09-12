import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(path, "utf8");

describe("school subscription contracts", () => {
  it("offers only the canonical monthly and yearly plans", () => {
    const migration = source("prisma/migrations/20260906120000_school_subscription_checkout/migration.sql");
    expect(migration).toContain("299.00");
    expect(migration).toContain("2990.00");
    expect(migration).toContain('WHERE "billing_interval" IS NULL');
    expect(source("src/app/api/admin/plans/route.ts")).toContain('billing_interval: { in: ["MONTHLY", "YEARLY"] }');
  });

  it("creates the first school user as the protected manager role", () => {
    const route = source("src/app/api/admin/schools/route.ts");
    expect(route).toContain('key: "manager"');
    expect(route).toContain('role: "manager"');
    expect(route).toContain("roleId: managerRole.id");
    expect(route).toContain('subscription_status: "trial"');
    expect(route).toContain('addSchoolBillingPeriod(createdAt, "MONTHLY")');
  });

  it("keeps subscription lifecycle changes out of the generic school editor", () => {
    const genericEditor = source("src/app/api/admin/schools/[id]/route.ts");
    const subscriptionEditor = source("src/app/api/admin/subscriptions/[schoolId]/route.ts");
    expect(genericEditor).not.toContain("plan_id: z.");
    expect(genericEditor).not.toContain("renewal_date: z.");
    expect(genericEditor).not.toContain("subscription_status: z.");
    expect(subscriptionEditor).toContain('action: z.enum(["extend", "change_type"');
    expect(subscriptionEditor).toContain('subscription_status: type === "TRIAL" ? "trial" : "active"');
  });

  it("embeds Moyasar without storing abandoned pending attempts and verifies paid payments server-side", () => {
    const checkout = source("src/app/api/subscription/checkout/route.ts");
    const provider = source("src/lib/moyasar.ts");
    const form = source("src/components/subscription/MoyasarPaymentForm.tsx");
    expect(checkout).not.toMatch(/card_number|\bcvc\b|credit_card/);
    expect(checkout).not.toContain("schoolSubscriptionPayment.create");
    expect(checkout).toContain("createMoyasarPaymentIntent");
    expect(form).toContain("Moyasar.init");
    expect(form).toContain('methods: ["creditcard"]');
    expect(provider).toContain("fetchMoyasarPayment");
    expect(provider).toContain('payment.status !== "paid"');
    expect(provider).toContain("payment.amount !== intent.amountHalalas");
    expect(provider).toContain("FOR UPDATE");
  });

  it("keeps only the subscription flow available after the grace period", () => {
    const suspend = source("src/app/api/admin/schools/[id]/suspend/route.ts");
    const session = source("src/lib/session.ts");
    const sidebar = source("src/components/layout/Sidebar.tsx");
    const topbar = source("src/components/layout/Topbar.tsx");
    const layout = source("src/app/(dashboard)/layout.tsx");
    expect(suspend).not.toContain("refreshToken.updateMany");
    expect(suspend).not.toContain("deviceToken.deleteMany");
    expect(session).toContain('"/api/subscription"');
    expect(session).not.toContain('"/api/notifications/admin-messages"');
    expect(session).toContain("LOCKED_ACCESS_ALLOWLIST");
    expect(sidebar).toContain('item.href !== "/subscription"');
    expect(sidebar).toContain("bg-red-500");
    expect(topbar).toContain("!subscriptionLocked");
    expect(layout).toContain('disabled={subscriptionAccess.mode === "locked"}');
  });
});
