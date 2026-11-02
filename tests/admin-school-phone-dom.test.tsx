// @vitest-environment jsdom

import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn(), push: vi.fn() }));

vi.mock("axios", () => ({
  default: {
    get: mocks.get,
    put: mocks.put,
    post: mocks.post,
    delete: vi.fn(),
    isAxiosError: () => false,
  },
}));
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "school-1" }),
  useRouter: () => ({ push: mocks.push }),
}));
vi.mock("@/components/admin/AdminInvoiceModal", () => ({ AdminInvoiceModal: () => null }));

import SchoolDetailPage from "@/app/admin/(protected)/schools/[id]/page";

function schoolDetail(contactNumber: string, phoneNumber: string) {
  return {
    school: {
      id: "school-1",
      name: "حضانة الاختبار",
      email: "school@example.invalid",
      plan_id: null,
      plan: null,
      subscription_type: "UNASSIGNED",
      subscription_status: "active",
      access_mode: "active",
      renewal_date: null,
      suspended_at: null,
      suspension_reason: null,
      last_login_at: null,
      createdAt: "2026-09-01T00:00:00.000Z",
      contactNumber,
      phoneNumber,
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
    },
    stats: { students: 0, teachers: 0, classes: 0, invoices: 0, notifications: 0 },
    support: {
      accounts: {
        staff: { total: 3, active: 2, pending: 1, expiredInvitations: 1, disabled: 0 },
        guardians: { total: 5, active: 4, pending: 1, expiredInvitations: 0, disabled: 0 },
        latestGuardianLoginAt: "2026-09-05T09:00:00.000Z",
      },
      devices: {
        total: 4,
        healthy: 3,
        failed: 1,
        expo: 4,
        web: 0,
        lastSeenAt: "2026-09-05T10:00:00.000Z",
        items: [{
          id: "device-1",
          ownerKind: "staff",
          ownerName: "سارة المعلمة",
          ownerEmail: "te***@example.invalid",
          platform: "EXPO",
          status: "healthy",
          lastSeenAt: "2026-09-05T10:00:00.000Z",
          registeredAt: "2026-09-01T10:00:00.000Z",
          canTest: true,
        }],
      },
      notifications: {
        windowDays: 30,
        push: {
          pending: 1,
          sent: 12,
          failed: 2,
          latestFailureAt: "2026-09-05T08:00:00.000Z",
          latestFailure: "رمز الجهاز غير صالح أو أُلغي تسجيله",
          recentFailures: [{ id: "push-1", deviceId: "device-1", occurredAt: "2026-09-05T08:00:00.000Z", reason: "رمز الجهاز غير صالح أو أُلغي تسجيله" }],
        },
        outbound: {
          sent: 7,
          failed: 1,
          recent: [{ id: "mail-1", type: "EMAIL", status: "SENT", source: "invitation", sentAt: "2026-09-05T07:00:00.000Z" }],
        },
      },
      storage: {
        totalBytes: 5242880,
        maxBytes: 104857600,
        computedAt: "2026-09-05T07:00:00.000Z",
        breakdown: { studentFilesBytes: 1048576, careReportBytes: 1048576, staffFilesBytes: 0, unitFilesBytes: 0, invoiceBytes: 0, otherBytes: 3145728 },
      },
      configuration: { careReportReviewRequired: true, arrivalRecipientCount: 0, pendingCareReportCount: 3 },
    },
    activityLogs: [],
    messages: [],
  };
}

describe("Super Admin school phone fields", () => {
  beforeEach(() => {
    cleanup();
    vi.resetAllMocks();
    let saved = schoolDetail("+966500000001", "+966500000002");
    mocks.get.mockImplementation((url: string) => {
      if (url === "/api/admin/schools/school-1") return Promise.resolve({ data: saved });
      if (url === "/api/admin/plans") return Promise.resolve({ data: [] });
      if (url === "/api/admin/invoices/school-1") return Promise.resolve({ data: [] });
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
    mocks.put.mockImplementation(async (_url: string, payload: Record<string, unknown>) => {
      saved = schoolDetail(String(payload.contactNumber), String(payload.phoneNumber));
      return { data: saved.school };
    });
    mocks.post.mockResolvedValue({ data: { queued: true } });
  });

  it("opens with a support 360 summary for accounts, delivery, settings, and storage", async () => {
    render(<SchoolDetailPage />);

    expect(await screen.findByText("ملخص الدعم الفني")).toBeTruthy();
    expect(screen.getByText("الحسابات والدعوات")).toBeTruthy();
    expect(screen.getByText("الأجهزة والإشعارات")).toBeTruthy();
    expect(screen.getByText("الإعدادات التشغيلية")).toBeTruthy();
    expect(screen.getByText("مساحة التخزين")).toBeTruthy();
    expect(screen.getByText("لم يُحدد مستلم لإشعارات الوصول")).toBeTruthy();
    expect(screen.getByText("رمز الجهاز غير صالح أو أُلغي تسجيله", { exact: false })).toBeTruthy();
  });

  it("opens the general information editor when the top edit button is pressed", async () => {
    render(<SchoolDetailPage />);

    expect(await screen.findByText("ملخص الدعم الفني")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "تعديل" }));

    expect(screen.getByRole("tab", { name: "معلومات عامة" }).getAttribute("data-state")).toBe("active");
    expect(screen.getByLabelText("رقم التواصل الإداري")).toBeTruthy();
    expect(screen.getByRole("button", { name: "حفظ" })).toBeTruthy();
  });

  it("diagnoses a registered device and queues a scoped test notification", async () => {
    render(<SchoolDetailPage />);
    await userEvent.click(await screen.findByRole("tab", { name: "تشخيص الإرسال" }));

    expect(await screen.findByText("سارة المعلمة")).toBeTruthy();
    expect(screen.getByText("سجل البريد والرسائل")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "إرسال إشعار اختباري" }));

    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith(
      "/api/admin/schools/school-1/notifications/test",
      { deviceId: "device-1" }
    ));
    expect(await screen.findByText("تم وضع إشعار الاختبار في قائمة الإرسال لهذا الجهاز.")).toBeTruthy();
  });

  it("edits the school phone separately from the administrative contact and reloads both saved values", async () => {
    render(<SchoolDetailPage />);
    await userEvent.click(await screen.findByRole("tab", { name: "معلومات عامة" }));
    expect(await screen.findByText("+966500000001")).toBeTruthy();
    expect(screen.getByText("+966500000002")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "تعديل" }));
    const contact = screen.getByLabelText("رقم التواصل الإداري");
    const phone = screen.getByLabelText("رقم هاتف الحضانة");
    await userEvent.clear(contact);
    await userEvent.type(contact, "+966511111111");
    await userEvent.clear(phone);
    await userEvent.type(phone, "+966522222222");
    await userEvent.click(screen.getByRole("button", { name: "حفظ" }));

    await waitFor(() => expect(mocks.put).toHaveBeenCalledWith(
      "/api/admin/schools/school-1",
      expect.objectContaining({
        contactNumber: "+966511111111",
        phoneNumber: "+966522222222",
      })
    ));
    const genericPayload = mocks.put.mock.calls.find(([url]) => url === "/api/admin/schools/school-1")?.[1];
    expect(genericPayload).not.toHaveProperty("plan_id");
    expect(genericPayload).not.toHaveProperty("renewal_date");
    expect(genericPayload).not.toHaveProperty("subscription_status");
    await waitFor(() => expect(screen.getByText("+966511111111")).toBeTruthy());
    expect(screen.getByText("+966522222222")).toBeTruthy();
    expect(mocks.get.mock.calls.filter(([url]) => url === "/api/admin/schools/school-1")).toHaveLength(2);
  });

  it("changes the subscription through the dedicated automatic lifecycle action", async () => {
    const unassigned = schoolDetail("+966500000001", "+966500000002");
    const monthly = {
      ...unassigned,
      school: {
        ...unassigned.school,
        subscription_type: "MONTHLY" as const,
        subscription_status: "active",
        renewal_date: "2026-10-06T00:00:00.000Z",
        plan: {
          id: "monthly-plan",
          name: "الاشتراك الشهري",
          price: 299,
          billing_interval: "MONTHLY" as const,
        },
      },
    };
    let schoolReads = 0;
    mocks.get.mockImplementation((url: string) => {
      if (url === "/api/admin/schools/school-1") {
        schoolReads += 1;
        return Promise.resolve({ data: schoolReads === 1 ? unassigned : monthly });
      }
      if (url === "/api/admin/invoices/school-1") return Promise.resolve({ data: [] });
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
    mocks.put.mockResolvedValue({ data: monthly.school });

    render(<SchoolDetailPage />);
    expect(await screen.findByText(/سجل قديم بلا نوع اشتراك/)).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText("نوع الاشتراك"), "MONTHLY");
    await userEvent.click(screen.getByRole("button", { name: "تطبيق النوع وتحديث المدة" }));

    await waitFor(() => expect(mocks.put).toHaveBeenCalledWith(
      "/api/admin/subscriptions/school-1",
      { action: "change_type", subscription_type: "MONTHLY" }
    ));
    await waitFor(() => expect(screen.getAllByText("شهري — 299 ر.س").length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.queryByText(/سجل قديم بلا نوع اشتراك/)).toBeNull());
  });
});
