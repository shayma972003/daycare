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

  it("keeps card data out of the application and verifies hosted invoices server-side", () => {
    const checkout = source("src/app/api/subscription/checkout/route.ts");
    const provider = source("src/lib/moyasar.ts");
    expect(checkout).not.toMatch(/card_number|\bcvc\b|credit_card/);
    expect(provider).toContain("fetchMoyasarInvoice");
    expect(provider).toContain('invoice.status !== "paid"');
    expect(provider).toContain("invoice.amount !== expectedHalalas");
    expect(provider).toContain("FOR UPDATE");
  });

  it("keeps suspended school sessions so the web portal can remain read-only", () => {
    const suspend = source("src/app/api/admin/schools/[id]/suspend/route.ts");
    expect(suspend).not.toContain("refreshToken.updateMany");
    expect(suspend).not.toContain("deviceToken.deleteMany");
    expect(source("src/lib/session.ts")).toContain("SUBSCRIPTION_READ_ONLY");
  });
});
