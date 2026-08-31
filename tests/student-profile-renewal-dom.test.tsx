// @vitest-environment jsdom
import { Suspense, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { LocaleProvider } from "@/lib/i18n-provider";
import StudentProfilePage from "@/app/(dashboard)/students/[id]/page";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));
vi.mock("axios", () => ({ default: { ...api, isCancel: () => false, isAxiosError: () => true } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/layout/Topbar", () => ({ Topbar: () => null }));
vi.mock("@/components/students/InvoiceModal", () => ({ InvoiceModal: () => null }));
vi.mock("@/components/care/StudentCareFeed", () => ({ StudentCareFeed: () => null }));
vi.mock("@/components/auth/PermissionGate", () => ({ PermissionGate: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/lib/use-permissions", () => ({ usePermissions: () => ({ can: () => true }) }));
vi.mock("@/lib/use-academic-stages", () => ({ useAcademicStages: () => ({ stages: [] }), useStageName: () => () => "" }));

function fixture() {
  return { id: "student-1", name: "Shosho", period: "MORNING", gender: "FEMALE", classId: null, guardianId: "guardian-1",
    guardian: { id: "guardian-1", name: "Parent", email: "parent@example.invalid" },
    registrationDate: "2025-01-01T00:00:00.000Z", registration_fee: 0, billingCycle: "MONTHLY", billingIntervalDays: null,
    cycleFee: null as number | null, paymentMethod: "CASH", paymentStatus: "PAID", isActive: true, status: "ACTIVE",
    enrollmentDate: "2026-08-01T00:00:00.000Z", enrollmentEndDate: "2026-08-26T00:00:00.000Z", attendanceHours: 1, lateHours: 0, siblings: [] };
}
let saved = fixture();
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-08-27T09:00:00Z"));
  vi.clearAllMocks(); saved = fixture();
  vi.spyOn(window, "alert").mockImplementation(() => {});
  api.get.mockImplementation(async (url: string) => ({ data: url.startsWith("/api/students/student-1") ? { ...saved } : [] }));
  api.put.mockImplementation(async (_url: string, data: Partial<typeof saved>) => {
    saved = { ...saved, ...data }; return { data: { ...saved } };
  });
  api.post.mockImplementation(async () => {
    saved = { ...saved, enrollmentDate: "2026-08-27T00:00:00.000Z", enrollmentEndDate: saved.billingCycle === "YEARLY" ? "2027-08-26T00:00:00.000Z" : "2026-09-26T00:00:00.000Z", paymentStatus: "PENDING" };
    return { data: { student: { ...saved } } };
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
async function open() {
  const params = Promise.resolve({ id: "student-1" });
  let result!: ReturnType<typeof render>;
  await act(async () => { result = render(<LocaleProvider initialLocale="en"><Suspense fallback="Loading"><StudentProfilePage params={params} /></Suspense></LocaleProvider>); });
  await waitFor(() => expect(input("Current subscription start").value).toBe(saved.enrollmentDate.slice(0, 10)));
  return result;
}

describe("profile subscription state after renewal and save", () => {
  it("updates the actual form dates/status, preserves contact edits, and reopens with the persisted renewal", async () => {
    const view = await open();
    const email = document.querySelector<HTMLInputElement>('input[name="guardianEmail"]')!;
    fireEvent.change(email, { target: { value: "edited@example.invalid" } });
    fireEvent.click(screen.getByRole("button", { name: "Renew subscription" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Renew subscription" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(input("Current subscription start").value).toBe("2026-08-27");
    expect(input("Enrollment End Date").value).toBe("2026-09-26");
    expect((document.querySelector('[name="paymentStatus"]') as HTMLSelectElement).value).toBe("PENDING");
    expect(email.value).toBe("edited@example.invalid");
    fireEvent.submit(document.querySelector("form")!);
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(api.put.mock.calls[0][1]).not.toHaveProperty("enrollmentDate");
    expect(api.put.mock.calls[0][1]).not.toHaveProperty("enrollmentEndDate");
    await waitFor(() => expect(window.alert).toHaveBeenCalledTimes(2));
    view.unmount(); await open();
    expect(input("Enrollment End Date").value).toBe("2026-09-26");
    expect(saved.registrationDate).toBe("2025-01-01T00:00:00.000Z");
  });
  it("requires saving changed terms, then uses the saved type in the next renewal and updates all fields", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("Subscription type"), { target: { value: "YEARLY" } });
    fireEvent.change(screen.getByLabelText("Fee per cycle"), { target: { value: "1200" } });
    fireEvent.click(screen.getByRole("button", { name: "Renew subscription" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("Save changes");
    fireEvent.submit(document.querySelector("form")!);
    await waitFor(() => expect(window.alert).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Renew subscription" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("26/08/2027");
    fireEvent.click(within(dialog).getByRole("button", { name: "Renew subscription" }));
    await waitFor(() => expect(input("Enrollment End Date").value).toBe("2027-08-26"));
    expect((screen.getByLabelText("Subscription type") as HTMLSelectElement).value).toBe("YEARLY");
    expect(input("Fee per cycle").value).toBe("1200");
  });
  it("does not replace stored dates or hide the error when renewal fails", async () => {
    await open();
    api.post.mockRejectedValueOnce({ response: { data: { code: "CYCLE_FEE_REQUIRED" } } });
    fireEvent.click(screen.getByRole("button", { name: "Renew subscription" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Renew subscription" }));
    await screen.findByRole("alert");
    expect(input("Current subscription start").value).toBe("2026-08-01");
    expect(input("Enrollment End Date").value).toBe("2026-08-26");
    expect(saved.enrollmentEndDate).toBe("2026-08-26T00:00:00.000Z");
  });
});
