import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  schoolFind: vi.fn(),
  activityFind: vi.fn(),
  messagesFind: vi.fn(),
  usersFind: vi.fn(),
  guardiansFind: vi.fn(),
  devicesFind: vi.fn(),
  pushGroup: vi.fn(),
  pushFailure: vi.fn(),
  deliveryGroup: vi.fn(),
  deliveryFind: vi.fn(),
  settingsFind: vi.fn(),
  storageFind: vi.fn(),
  arrivalCount: vi.fn(),
  careCount: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({ verifyAdminSessionFromRequest: mocks.verify }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    school: { findUnique: mocks.schoolFind },
    adminActivityLog: { findMany: mocks.activityFind },
    adminMessageRecipient: { findMany: mocks.messagesFind },
    user: { findMany: mocks.usersFind },
    guardianAccount: { findMany: mocks.guardiansFind },
    deviceToken: { findMany: mocks.devicesFind },
    pushNotification: { groupBy: mocks.pushGroup, findMany: mocks.pushFailure },
    notificationLog: { groupBy: mocks.deliveryGroup, findMany: mocks.deliveryFind },
    settings: { findUnique: mocks.settingsFind },
    storageUsage: { findUnique: mocks.storageFind },
    arrivalRecipientSetting: { count: mocks.arrivalCount },
    careReport: { count: mocks.careCount },
  },
}));

import { GET } from "@/app/api/admin/schools/[id]/route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.verify.mockResolvedValue({ id: "admin-1" });
  mocks.schoolFind.mockResolvedValue({
    id: "school-1",
    name: "حضانة النور",
    email: "school@example.invalid",
    plan_id: "plan-1",
    subscription_status: "active",
    renewal_date: new Date("2026-11-01T00:00:00.000Z"),
    suspended_at: null,
    suspension_reason: null,
    last_login_at: new Date("2026-10-25T08:00:00.000Z"),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-10-25T08:00:00.000Z"),
    contactNumber: null,
    phoneNumber: null,
    legalName: null,
    commercialRegistration: null,
    nationalUnifiedNumber: null,
    entityType: null,
    businessActivities: null,
    schoolType: null,
    educationStages: [],
    licenseNumber: null,
    branch: null,
    address: null,
    vatRegistered: null,
    vatNumber: null,
    zatcaUnifiedNumber: null,
    zakatStatus: null,
    financialYear: null,
    taxPeriod: null,
    subscription_plan: {
      id: "plan-1",
      name: "شهري",
      price: 299,
      billing_interval: "MONTHLY",
      max_students: 100,
      max_classes: 10,
      max_storage_mb: 100,
    },
    _count: { students: 8, teachers: 2, classes: 2, invoices: 4, notificationLogs: 20 },
  });
  mocks.activityFind.mockResolvedValue([]);
  mocks.messagesFind.mockResolvedValue([]);
  mocks.usersFind.mockResolvedValue([
    { acceptedAt: new Date(), disabledAt: null, inviteExpiresAt: null },
    { acceptedAt: null, disabledAt: null, inviteExpiresAt: new Date("2020-01-01T00:00:00.000Z") },
  ]);
  mocks.guardiansFind.mockResolvedValue([
    { acceptedAt: new Date(), disabledAt: null, inviteExpiresAt: null, lastLoginAt: new Date("2026-10-24T08:00:00.000Z") },
  ]);
  mocks.devicesFind.mockResolvedValue([
    {
      id: "device-1",
      platform: "EXPO",
      failedAt: null,
      lastSeenAt: new Date("2026-10-25T07:00:00.000Z"),
      createdAt: new Date("2026-10-01T07:00:00.000Z"),
      user: { name: "Teacher", email: "teacher@example.invalid", acceptedAt: new Date(), disabledAt: null },
      guardianAccount: null,
    },
    {
      id: "device-2",
      platform: "EXPO",
      failedAt: new Date(),
      lastSeenAt: new Date("2026-10-20T07:00:00.000Z"),
      createdAt: new Date("2026-10-01T07:00:00.000Z"),
      user: null,
      guardianAccount: { email: "parent@example.invalid", acceptedAt: new Date(), disabledAt: null, guardian: { name: "Parent" } },
    },
  ]);
  mocks.pushGroup.mockResolvedValue([
    { status: "SENT", _count: { _all: 9 } },
    { status: "FAILED", _count: { _all: 2 } },
  ]);
  mocks.pushFailure.mockResolvedValue([{ id: "push-1", deviceTokenId: "device-2", lastError: "Device token is unregistered", createdAt: new Date("2026-10-25T06:00:00.000Z") }]);
  mocks.deliveryGroup.mockResolvedValue([
    { status: "SENT", _count: { _all: 5 } },
    { status: "FAILED", _count: { _all: 1 } },
  ]);
  mocks.deliveryFind.mockResolvedValue([{ id: "mail-1", type: "EMAIL", status: "SENT", source: "invitation", sentAt: new Date("2026-10-25T05:30:00.000Z") }]);
  mocks.settingsFind.mockResolvedValue({ careReportReviewRequired: true });
  mocks.storageFind.mockResolvedValue({
    totalBytes: 10485760,
    studentFilesBytes: 5242880,
    careReportBytes: 5242880,
    staffFilesBytes: 0,
    unitFilesBytes: 0,
    invoiceBytes: 0,
    otherBytes: 0,
    computedAt: new Date("2026-10-25T05:00:00.000Z"),
  });
  mocks.arrivalCount.mockResolvedValue(1);
  mocks.careCount.mockResolvedValue(3);
});

describe("super-admin school support 360", () => {
  it("returns account, device, delivery, storage, and configuration diagnostics", async () => {
    const response = await GET(new Request("http://localhost/api/admin/schools/school-1"), {
      params: Promise.resolve({ id: "school-1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      support: {
        accounts: {
          staff: { total: 2, active: 1, pending: 1, expiredInvitations: 1, disabled: 0 },
          guardians: { total: 1, active: 1 },
        },
        devices: {
          total: 2,
          healthy: 1,
          failed: 1,
          expo: 2,
          items: [
            { id: "device-1", ownerKind: "staff", ownerName: "Teacher", ownerEmail: "te***@example.invalid", canTest: true },
            { id: "device-2", ownerKind: "guardian", ownerName: "Parent", ownerEmail: "pa***@example.invalid", canTest: false },
          ],
        },
        notifications: {
          push: { sent: 9, failed: 2, latestFailure: "رمز الجهاز غير صالح أو أُلغي تسجيله", recentFailures: [{ id: "push-1" }] },
          outbound: { sent: 5, failed: 1, recent: [{ id: "mail-1", type: "EMAIL", status: "SENT" }] },
        },
        storage: { totalBytes: 10485760, maxBytes: 104857600 },
        configuration: { careReportReviewRequired: true, arrivalRecipientCount: 1, pendingCareReportCount: 3 },
      },
    });
  });

  it("does not expose support diagnostics without a super-admin session", async () => {
    mocks.verify.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/admin/schools/school-1"), {
      params: Promise.resolve({ id: "school-1" }),
    });

    expect(response.status).toBe(401);
    expect(mocks.schoolFind).not.toHaveBeenCalled();
  });
});
