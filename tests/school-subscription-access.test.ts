import { describe, expect, it } from "vitest";
import { addSchoolBillingPeriod, schoolSubscriptionAccess } from "@/lib/school-subscription";

describe("school subscription access", () => {
  const renewal = new Date("2026-09-01T00:00:00.000Z");

  it("keeps the renewal day active, grants seven grace days, then becomes read-only", () => {
    expect(schoolSubscriptionAccess({ subscription_status: "active", renewal_date: renewal }, new Date("2026-09-01T23:59:00Z")).mode).toBe("active");
    const dayOne = schoolSubscriptionAccess({ subscription_status: "expired", renewal_date: renewal }, new Date("2026-09-02T12:00:00Z"));
    expect(dayOne).toMatchObject({ mode: "grace", daysOverdue: 1, graceDaysRemaining: 7, showFirstExpiredDayPopup: true });
    expect(schoolSubscriptionAccess({ subscription_status: "expired", renewal_date: renewal }, new Date("2026-09-08T12:00:00Z"))).toMatchObject({ mode: "grace", daysOverdue: 7, graceDaysRemaining: 1 });
    expect(schoolSubscriptionAccess({ subscription_status: "expired", renewal_date: renewal }, new Date("2026-09-09T00:00:00Z")).mode).toBe("locked");
  });

  it("locks an explicitly suspended or cancelled school immediately", () => {
    expect(schoolSubscriptionAccess({ subscription_status: "suspended", renewal_date: null }).mode).toBe("locked");
    expect(schoolSubscriptionAccess({ subscription_status: "cancelled", renewal_date: null }).mode).toBe("locked");
  });

  it("uses calendar months and years rather than fixed day counts", () => {
    expect(addSchoolBillingPeriod(new Date("2026-02-01T00:00:00Z"), "MONTHLY").toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(addSchoolBillingPeriod(new Date("2026-09-01T00:00:00Z"), "YEARLY").toISOString()).toBe("2027-09-01T00:00:00.000Z");
    expect(addSchoolBillingPeriod(new Date("2026-01-31T00:00:00Z"), "MONTHLY").toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(addSchoolBillingPeriod(new Date("2028-02-29T00:00:00Z"), "YEARLY").toISOString()).toBe("2029-02-28T00:00:00.000Z");
  });
});
