import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(path, "utf8");

describe("6F push and mobile hardening contracts", () => {
  it("claims push rows with a conditional lease before sending", () => {
    const code = source("src/lib/push.ts");
    expect(code).toContain("const claimed = await tx.pushNotification.updateMany");
    expect(code).toContain("claimed.count === 1");
    expect(code).toContain("leaseToken");
    expect(code).toContain("leaseExpiresAt");
    expect(code).toContain("finishClaim");
  });

  it("supports Expo push tokens for both mobile platforms", () => {
    const push = source("src/lib/push.ts");
    const devices = source("src/app/api/mobile/v1/devices/route.ts");
    const schema = source("prisma/schema.prisma");
    const registration = source("mobile/src/notifications/device.native.ts");
    expect(schema).toContain("EXPO");
    expect(devices).toContain('"EXPO"');
    expect(push).toContain("sendViaExpo");
    expect(push).toContain("https://exp.host/--/api/v2/push/send");
    expect(registration).toContain("getExpoPushTokenAsync");
    expect(registration).toContain('platform: "EXPO"');
  });

  it("uses an explicit audible high-priority Android channel", () => {
    const push = source("src/lib/push.ts");
    const registration = source("mobile/src/notifications/device.native.ts");
    const appConfig = source("mobile/app.json");
    for (const code of [push, registration, appConfig]) {
      expect(code).toContain("daycare-alerts-v2");
    }
    expect(push).toContain('priority: "high"');
    expect(push).toContain("channelId: ANDROID_ALERT_CHANNEL_ID");
    expect(registration).toContain('sound: "default"');
    expect(registration).toContain("AndroidImportance.MAX");
  });

  it("starts one bounded queue drain after the originating response", () => {
    const code = source("src/lib/push.ts");
    expect(code).toContain('import { after } from "next/server"');
    expect(code).toContain("const scheduleDrainAfterResponse = cache");
    expect(code).toContain("await drainPushQueue(IMMEDIATE_BATCH_SIZE)");
    expect(code).toContain("schedulePushDrain();");
  });

  it("expires stale five-minute arrival pushes instead of delivering them late", () => {
    const code = source("src/lib/push.ts");
    expect(code).toContain("ARRIVAL_PUSH_TTL_MS");
    expect(code).toContain('notificationData?.kind === "guardian_arrival"');
    expect(code).toContain('lastError: "EXPIRED_ARRIVAL"');
  });

  it("never targets a disabled account or suspended school", () => {
    const code = source("src/lib/push.ts");
    expect(code).toContain("disabledAt: null");
    expect(code).toContain("subscription_status");
    expect(code).toContain("ownerUnavailable");
  });

  it("revalidates every mobile bearer token against current database state", () => {
    const guard = source("src/lib/mobile-guard.ts");
    expect(guard).not.toContain("if (options.fresh)");
    expect(guard).toContain("current.schoolId !== claims.schoolId");
    expect(guard).toContain("current.school.subscription_status");
    expect(guard).toContain("current.roleRef?.permissions");
  });

  it("revokes staff sessions while subscription suspension preserves read-only access", () => {
    const staff = source("src/app/api/staff-accounts/[id]/route.ts");
    const school = source("src/app/api/admin/schools/[id]/suspend/route.ts");
    expect(staff).toContain("tx.deviceToken.deleteMany");
    expect(staff).toContain("tx.refreshToken.updateMany");
    expect(school).not.toContain("tx.deviceToken.deleteMany");
    expect(school).not.toContain("tx.refreshToken.updateMany");
    expect(school).toContain('subscription_status: "suspended"');
  });

  it("keeps mobile refresh rate limiting and token replay detection", () => {
    const refresh = source("src/app/api/mobile/v1/auth/refresh/route.ts");
    const auth = source("src/lib/mobile-auth.ts");
    expect(refresh).toContain("rateLimit");
    expect(auth).toContain('reason: "reused"');
    expect(auth).toContain("revokeTokenFamily");
  });
});
