// @vitest-environment jsdom

import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), push: vi.fn() }));

vi.mock("axios", () => ({
  default: {
    get: mocks.get,
    put: mocks.put,
    post: vi.fn(),
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
      subscription_status: "active",
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
  });

  it("edits the school phone separately from the administrative contact and reloads both saved values", async () => {
    render(<SchoolDetailPage />);
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
    await waitFor(() => expect(screen.getByText("+966511111111")).toBeTruthy());
    expect(screen.getByText("+966522222222")).toBeTruthy();
    expect(mocks.get.mock.calls.filter(([url]) => url === "/api/admin/schools/school-1")).toHaveLength(2);
  });
});
