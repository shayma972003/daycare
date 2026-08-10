// @vitest-environment jsdom

import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LocaleProvider } from "@/lib/i18n-provider";
import StudentsPage from "@/app/(dashboard)/students/page";

const axiosMocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
}));

const routerMocks = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("axios", () => ({
  default: {
    ...axiosMocks,
    isAxiosError: () => false,
    isCancel: () => false,
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMocks,
}));

vi.mock("@/components/layout/Topbar", () => ({
  Topbar: ({ title }: { title: string }) => <header>{title}</header>,
}));

vi.mock("@/components/auth/PermissionGate", () => ({
  PermissionGate: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/use-permissions", () => ({
  usePermissions: () => ({ can: () => true }),
}));

vi.mock("@/lib/use-academic-stages", () => ({
  useAcademicStages: () => ({
    stages: [{ id: "stage-1", nameAr: "المرحلة الأولى", nameEn: "Stage A" }],
  }),
  useStageName: () => (stage: { nameEn?: string; nameAr?: string }) =>
    stage.nameEn ?? stage.nameAr ?? "",
}));

const students = [
  {
    id: "student-1",
    name: "Student One",
    period: "MORNING",
    paymentStatus: "PAID",
    class: null,
    classId: null,
    guardian: null,
    isActive: true,
  },
];

function submission(id: string, name: string) {
  return {
    id,
    full_name: name,
    guardian_name: null,
    guardian_phone_1: null,
    guardian_phone_2: null,
    guardian_email: null,
    guardian_name_2: null,
    guardian_phone_3: null,
    guardian_phone_4: null,
    guardian_email_2: null,
    id_number: null,
    nationality: null,
    academic_stage: null,
    gender: null,
    period: null,
    date_of_birth: null,
    health_condition: null,
    allergies: null,
    attendance_type: null,
    payment_method: null,
    submitted_at: "2026-08-10T08:00:00.000Z",
  };
}

const submissions = [submission("submission-1", "First child"), submission("submission-2", "Second child")];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  axiosMocks.get.mockImplementation((url: string) => {
    if (url === "/api/classes") return Promise.resolve({ data: [{ id: "class-1", name: "Class A" }] });
    if (url.startsWith("/api/students?")) return Promise.resolve({ data: students });
    if (url === "/api/attendance/students/today") return Promise.resolve({ data: [] });
    if (url === "/api/enrollment/submissions") return Promise.resolve({ data: submissions });
    return Promise.reject(new Error(`Unexpected GET in students dialog test: ${url}`));
  });
  axiosMocks.post.mockResolvedValue({ data: {} });
  axiosMocks.put.mockResolvedValue({ data: {} });
});

afterEach(cleanup);

async function renderPage() {
  render(
    <LocaleProvider initialLocale="en">
      <StudentsPage />
    </LocaleProvider>
  );
  await screen.findByText("Student One");
}

type User = ReturnType<typeof userEvent.setup>;

async function openExtendDialog(user: User) {
  const checkboxes = screen.getAllByRole("checkbox");
  if (!checkboxes[1].matches(":checked")) await user.click(checkboxes[1]);
  const option = screen.getByRole("option", { name: "Extend subscription date" });
  await user.selectOptions(option.parentElement as HTMLSelectElement, "extend_subscription");
  const apply = screen.getByRole("button", { name: "Apply" });
  await user.click(apply);
  return { apply, dialog: screen.getByRole("dialog", { name: "Extend subscription date" }) };
}

async function openEnrollmentDialog(user: User) {
  const addStudent = screen.getByRole("button", { name: /Add Student/ });
  await user.click(addStudent);
  await user.click(screen.getByRole("button", { name: "Send a registration form" }));
  return {
    addStudent,
    dialog: screen.getByRole("dialog", { name: "Send the registration form" }),
  };
}

async function expandReviewQueue(user: User) {
  const queue = await screen.findByRole("button", { name: /Pending registration requests/ });
  if (!screen.queryByText("First child")) await user.click(queue);
}

function reviewButtonFor(name: string) {
  const row = screen.getByText(name).closest("tr");
  if (!row) throw new Error(`Missing review row for ${name}`);
  return within(row).getByRole("button", { name: "Review" });
}

describe("student page shared dialogs", () => {
  it("preserves extend payload, blocks dismissal while pending, and restores focus", async () => {
    const user = userEvent.setup();
    const pending = deferred<{ data: { updated: number } }>();
    axiosMocks.post.mockImplementation((url: string) => {
      if (url === "/api/students/bulk-extend") return pending.promise;
      return Promise.resolve({ data: {} });
    });
    await renderPage();

    let { apply, dialog } = await openExtendDialog(user);
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(apply);
    expect(axiosMocks.post).not.toHaveBeenCalled();

    ({ apply, dialog } = await openExtendDialog(user));
    const date = dialog.querySelector<HTMLInputElement>('input[type="date"]');
    fireEvent.change(date!, { target: { value: "2026-09-30" } });
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(axiosMocks.post).toHaveBeenCalledWith("/api/students/bulk-extend", {
      ids: ["student-1"],
      enrollmentEndDate: "2026-09-30",
    });
    await user.keyboard("{Escape}");
    await user.click(document.querySelector<HTMLElement>("[data-dialog-overlay]")!);
    expect(screen.getByRole("dialog")).toBe(dialog);

    await act(async () => pending.resolve({ data: { updated: 1 } }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(
      screen.getByRole("option", { name: "Bulk Action" }).parentElement
    );
  }, 10_000);

  it("supports safe enrollment cancellation and preserves the create-token payload", async () => {
    const user = userEvent.setup();
    const pending = deferred<{ data: { success: boolean; email: string } }>();
    axiosMocks.post.mockImplementation((url: string) => {
      if (url === "/api/enrollment/create-token") return pending.promise;
      return Promise.resolve({ data: {} });
    });
    await renderPage();

    let { addStudent, dialog } = await openEnrollmentDialog(user);
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(addStudent);

    ({ addStudent, dialog } = await openEnrollmentDialog(user));
    await user.click(document.querySelector<HTMLElement>("[data-dialog-overlay]")!);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(addStudent);

    ({ dialog } = await openEnrollmentDialog(user));
    await user.type(screen.getByRole("textbox", { name: /Email/ }), "cancel@example.com");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(axiosMocks.post).not.toHaveBeenCalled();

    ({ dialog } = await openEnrollmentDialog(user));
    const email = screen.getByRole("textbox", { name: /Email/ });
    expect((email as HTMLInputElement).value).toBe("");
    await user.type(email, "parent@example.com");
    await user.click(screen.getByRole("button", { name: "Send the link" }));
    expect(axiosMocks.post).toHaveBeenCalledWith("/api/enrollment/create-token", {
      email: "parent@example.com",
    });

    await user.keyboard("{Escape}");
    await user.click(document.querySelector<HTMLElement>("[data-dialog-overlay]")!);
    expect(screen.getByRole("dialog")).toBe(dialog);

    await act(async () => pending.resolve({ data: { success: true, email: "parent@example.com" } }));
    await screen.findByText(/parent@example.com/);
    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(addStudent);
  }, 10_000);

  it("isolates review records, defaults Enter to cancel, and preserves approve/reject calls", async () => {
    const user = userEvent.setup();
    await renderPage();
    await expandReviewQueue(user);

    const firstReview = reviewButtonFor("First child");
    await user.click(firstReview);
    const close = screen.getByRole("button", { name: "Close" });
    expect(document.activeElement).toBe(close);
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(firstReview);
    expect(axiosMocks.post).not.toHaveBeenCalled();

    await user.click(reviewButtonFor("First child"));
    const firstName = screen.getByDisplayValue("First child");
    await user.clear(firstName);
    await user.type(firstName, "Stale child");
    await user.click(screen.getByRole("button", { name: "Close" }));

    await user.click(reviewButtonFor("Second child"));
    expect(screen.getByDisplayValue("Second child")).not.toBeNull();
    expect(screen.queryByDisplayValue("Stale child")).toBeNull();
    const secondName = screen.getByDisplayValue("Second child");
    await user.clear(secondName);
    await user.type(secondName, "Approved child");
    const classOption = screen.getByRole("option", { name: "Class A" });
    const stageOption = screen.getByRole("option", { name: "Stage A" });
    await user.selectOptions(classOption.parentElement as HTMLSelectElement, "class-1");
    await user.selectOptions(stageOption.parentElement as HTMLSelectElement, "stage-1");
    await user.click(screen.getByRole("button", { name: "Accept and activate" }));

    expect(axiosMocks.post).toHaveBeenCalledWith("/api/enrollment/approve/submission-2", {
      full_name: "Approved child",
      id_number: "",
      nationality: "",
      academic_stage: "",
      gender: "",
      period: "",
      health_condition: "",
      allergies: "",
      attendance_type: "",
      payment_method: "",
      guardian_name: "",
      guardian_phone_1: "",
      guardian_phone_2: "",
      guardian_email: "",
      guardian_name_2: "",
      guardian_phone_3: "",
      guardian_phone_4: "",
      guardian_email_2: "",
      class_id: "class-1",
      stage_id: "stage-1",
      date_of_birth: undefined,
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    const rejection = deferred<{ data: Record<string, never> }>();
    axiosMocks.post.mockImplementation((url: string) => {
      if (url === "/api/enrollment/reject/submission-1") return rejection.promise;
      return Promise.resolve({ data: {} });
    });
    await user.click(reviewButtonFor("First child"));
    await user.click(screen.getByRole("button", { name: "Reject" }));
    expect(axiosMocks.post).toHaveBeenCalledWith("/api/enrollment/reject/submission-1");
    await user.keyboard("{Escape}");
    await user.click(document.querySelector<HTMLElement>("[data-dialog-overlay]")!);
    expect(screen.getByRole("dialog")).not.toBeNull();

    await act(async () => rejection.resolve({ data: {} }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  }, 10_000);
});
