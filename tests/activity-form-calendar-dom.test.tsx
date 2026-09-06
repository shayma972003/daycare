// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/lib/i18n-provider";
import { ActivityFormModal } from "@/components/activities/ActivityFormModal";

const axiosMocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}));

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

vi.mock("axios", () => ({
  default: {
    ...axiosMocks,
    isAxiosError: () => false,
  },
}));
vi.mock("@/components/auth/PermissionGate", () => ({
  PermissionGate: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

function english(node: ReactNode) {
  return <LocaleProvider initialLocale="en">{node}</LocaleProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  axiosMocks.get.mockImplementation((url: string) => {
    if (url === "/api/academic-stages") return Promise.resolve({ data: [{ id: "stage-1", nameAr: "روضة", nameEn: "Nursery" }] });
    if (url === "/api/teachers") return Promise.resolve({ data: [{ id: "teacher-1", name: "Teacher one" }] });
    if (url === "/api/classes") return Promise.resolve({ data: [{ id: "class-1", name: "Room one" }] });
    if (url === "/api/activities/activity-1") return Promise.resolve({
      data: {
        teacherId: "teacher-1",
        stageId: "stage-1",
        allDay: false,
        message: "Exact message\nsecond line",
        updatedAt: "2026-09-03T08:00:00.000Z",
        activityInvites: [{ classId: "class-1" }],
      },
    });
    return Promise.reject(new Error(`Unexpected GET ${url}`));
  });
  axiosMocks.put.mockResolvedValue({ data: { id: "activity-1" } });
  axiosMocks.post.mockResolvedValue({ data: { success: true } });
});
afterEach(cleanup);

describe("activity calendar form", () => {
  it("round-trips teacher, classes, fee, image, message and timed instants without sending", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(english(<ActivityFormModal
      open
      activity={{
        id: "activity-1",
        name: "Museum visit",
        teacherName: "Teacher one",
        stage: { id: "stage-1", nameAr: "روضة", nameEn: "Nursery" },
        period: "EVENING",
        childrenCount: 12,
        startDate: "2026-09-02T06:00:00.000Z",
        endDate: "2026-09-02T07:30:00.000Z",
        allDay: false,
        fee: 25,
        imageUrl: "/activity.jpg",
        message: "Exact message\nsecond line",
      }}
      onClose={vi.fn()}
      onSaved={onSaved}
    />));

    await waitFor(() => expect((document.querySelector('[name="teacherId"]') as HTMLSelectElement).value).toBe("teacher-1"));
    expect(screen.getByText("Room one").closest("label")?.querySelector("input")?.checked).toBe(true);
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(axiosMocks.put).toHaveBeenCalledTimes(1));
    const payload = axiosMocks.put.mock.calls[0][1];
    expect(payload).toMatchObject({
      teacherId: "teacher-1",
      classIds: ["class-1"],
      fee: 25,
      imageUrl: "/activity.jpg",
      message: "Exact message\nsecond line",
      allDay: false,
      period: "EVENING",
      stageId: "stage-1",
    });
    expect(new Date(payload.endDate).getTime()).toBeGreaterThan(new Date(payload.startDate).getTime());
    expect(payload).not.toHaveProperty("startTime");
    expect(payload).not.toHaveProperty("endTime");
    expect(axiosMocks.post).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("blocks sending edited unsaved text instead of sending the stored version", async () => {
    const user = userEvent.setup();
    render(english(<ActivityFormModal
      open
      activity={{
        id: "activity-1", name: "Activity", startDate: "2026-09-02", endDate: "2026-09-02",
        allDay: true, message: "Stored message",
      }}
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />));
    await waitFor(() => expect(document.querySelector('[name="message"]')).not.toBeNull());
    const textarea = document.querySelector<HTMLTextAreaElement>('[name="message"]')!;
    await user.clear(textarea);
    await user.type(textarea, "Unsaved message");
    const audience = screen.getByText("Send an in-app message to guardians").closest("label")!.querySelector("input")!;
    await user.click(audience);
    await user.click(screen.getByRole("button", { name: "Send in-app message" }));
    expect(await screen.findByText("Save the activity changes before sending")).not.toBeNull();
    expect(axiosMocks.post).not.toHaveBeenCalled();
  });

  it("blocks sending after changing the class and keeps the audience preview on the saved target", async () => {
    const user = userEvent.setup();
    axiosMocks.get.mockImplementation((url: string) => {
      if (url === "/api/academic-stages") return Promise.resolve({ data: [] });
      if (url === "/api/teachers") return Promise.resolve({ data: [{ id: "teacher-1", name: "Teacher one" }] });
      if (url === "/api/classes") return Promise.resolve({
        data: [{ id: "class-1", name: "Room one" }, { id: "class-2", name: "Room two" }],
      });
      if (url === "/api/activities/activity-1") return Promise.resolve({
        data: {
          teacherId: "teacher-1",
          message: "Stored message",
          updatedAt: "2026-09-03T08:00:00.000Z",
          activityInvites: [{ classId: "class-1" }],
        },
      });
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
    render(english(<ActivityFormModal
      open
      activity={{
        id: "activity-1", name: "Activity", startDate: "2026-09-02", endDate: "2026-09-02",
        allDay: true, message: "Stored message",
      }}
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />));

    await waitFor(() => expect(screen.getByText("Room two").closest("label")?.querySelector("input")).not.toBeNull());
    await user.click(screen.getByText("Room two").closest("label")!.querySelector("input")!);
    await user.click(screen.getByText("Send an in-app message to guardians").closest("label")!.querySelector("input")!);
    expect(screen.getByText("Accounts linked to 1 selected classes")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Send in-app message" }));
    expect(await screen.findByText("Save the activity changes before sending")).not.toBeNull();
    expect(axiosMocks.post).not.toHaveBeenCalled();
  });

  it("does not send when loading the persisted activity details failed", async () => {
    const user = userEvent.setup();
    axiosMocks.get.mockImplementation((url: string) => {
      if (url === "/api/academic-stages" || url === "/api/teachers" || url === "/api/classes") {
        return Promise.resolve({ data: [] });
      }
      if (url === "/api/activities/activity-1") return Promise.reject(new Error("offline"));
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
    render(english(<ActivityFormModal
      open
      activity={{ id: "activity-1", name: "Activity", startDate: "2026-09-02", endDate: "2026-09-02", allDay: true, message: "Stored" }}
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />));
    expect(await screen.findByText("Could not load the full activity details")).not.toBeNull();
    await user.click(screen.getByText("Send an in-app message to guardians").closest("label")!.querySelector("input")!);
    await user.click(screen.getByRole("button", { name: "Send in-app message" }));
    expect(axiosMocks.post).not.toHaveBeenCalled();
  });

  it("blocks the save handler after detail loading fails", async () => {
    axiosMocks.get.mockImplementation((url: string) => {
      if (url === "/api/academic-stages") return Promise.resolve({ data: [] });
      if (url === "/api/teachers") return Promise.resolve({ data: [{ id: "teacher-1", name: "Teacher one" }] });
      if (url === "/api/classes") return Promise.resolve({ data: [] });
      if (url === "/api/activities/activity-1") return Promise.reject(new Error("offline"));
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
    render(english(<ActivityFormModal
      open
      activity={{ id: "activity-1", name: "Activity", startDate: "2026-09-02", endDate: "2026-09-02", allDay: true }}
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />));

    expect(await screen.findByText("Could not load the full activity details")).not.toBeNull();
    await waitFor(() => expect(document.querySelectorAll('[name="teacherId"] option')).toHaveLength(2));
    fireEvent.change(document.querySelector('[name="teacherId"]')!, { target: { value: "teacher-1" } });
    // Submit the form directly so this proves the handler guard independently
    // of the disabled Save button.
    await act(async () => {
      fireEvent.submit(document.querySelector("form")!);
      await Promise.resolve();
    });

    expect(axiosMocks.put).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Try again" })).not.toBeNull();
  });

  it("loads the persisted teacher and classes after a successful retry, then allows saving", async () => {
    const user = userEvent.setup();
    let detailsAttempts = 0;
    axiosMocks.get.mockImplementation((url: string) => {
      if (url === "/api/academic-stages") return Promise.resolve({ data: [] });
      if (url === "/api/teachers") return Promise.resolve({ data: [{ id: "teacher-1", name: "Teacher one" }] });
      if (url === "/api/classes") return Promise.resolve({ data: [{ id: "class-1", name: "Room one" }] });
      if (url === "/api/activities/activity-1") {
        detailsAttempts += 1;
        if (detailsAttempts === 1) return Promise.reject(new Error("offline"));
        return Promise.resolve({
          data: {
            teacherId: "teacher-1",
            message: "Persisted message",
            updatedAt: "2026-09-03T08:00:00.000Z",
            activityInvites: [{ classId: "class-1" }],
          },
        });
      }
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
    render(english(<ActivityFormModal
      open
      activity={{ id: "activity-1", name: "Activity", startDate: "2026-09-02", endDate: "2026-09-02", allDay: true }}
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />));

    await user.clear(document.querySelector('[name="name"]')!);
    await user.type(document.querySelector('[name="name"]')!, "Locally edited title");
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect((document.querySelector('[name="teacherId"]') as HTMLSelectElement).value).toBe("teacher-1"));
    expect(screen.getByText("Room one").closest("label")?.querySelector("input")?.checked).toBe(true);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(axiosMocks.put).toHaveBeenCalledTimes(1));
    expect(axiosMocks.put.mock.calls[0][1].name).toBe("Locally edited title");
  });

  it("ignores a late activity A response after activity B is opened", async () => {
    const activityA = deferred<{ data: {
      teacherId: string; message: string; updatedAt: string; activityInvites: { classId: string }[];
    } }>();
    const activityB = deferred<{ data: {
      teacherId: string; message: string; updatedAt: string; activityInvites: { classId: string }[];
    } }>();
    axiosMocks.get.mockImplementation((url: string) => {
      if (url === "/api/academic-stages") return Promise.resolve({ data: [] });
      if (url === "/api/teachers") return Promise.resolve({ data: [
        { id: "teacher-a", name: "Teacher A" },
        { id: "teacher-b", name: "Teacher B" },
      ] });
      if (url === "/api/classes") return Promise.resolve({ data: [
        { id: "class-a", name: "Room A" },
        { id: "class-b", name: "Room B" },
      ] });
      if (url === "/api/activities/activity-a") return activityA.promise;
      if (url === "/api/activities/activity-b") return activityB.promise;
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
    const rendered = render(english(<ActivityFormModal
      open
      activity={{ id: "activity-a", name: "Activity A", startDate: "2026-09-02", endDate: "2026-09-02", allDay: true }}
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />));
    await waitFor(() => expect(axiosMocks.get).toHaveBeenCalledWith(
      "/api/activities/activity-a",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    ));

    rendered.rerender(english(<ActivityFormModal
      open
      activity={{ id: "activity-b", name: "Activity B", startDate: "2026-09-04", endDate: "2026-09-04", allDay: true }}
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />));
    await act(async () => {
      activityB.resolve({ data: {
        teacherId: "teacher-b", message: "Message B", updatedAt: "2026-09-04T08:00:00.000Z",
        activityInvites: [{ classId: "class-b" }],
      } });
    });
    await waitFor(() => expect((document.querySelector('[name="teacherId"]') as HTMLSelectElement).value).toBe("teacher-b"));

    await act(async () => {
      activityA.resolve({ data: {
        teacherId: "teacher-a", message: "Message A", updatedAt: "2026-09-03T08:00:00.000Z",
        activityInvites: [{ classId: "class-a" }],
      } });
    });
    expect((document.querySelector('[name="teacherId"]') as HTMLSelectElement).value).toBe("teacher-b");
    expect(screen.getByText("Room B").closest("label")?.querySelector("input")?.checked).toBe(true);
    expect(screen.getByText("Room A").closest("label")?.querySelector("input")?.checked).toBe(false);
  });

  it("keeps creation independent from the existing-activity details gate", async () => {
    const user = userEvent.setup();
    render(english(<ActivityFormModal
      open
      activity={null}
      defaultDate={new Date("2026-09-05T09:00:00.000Z")}
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />));
    await waitFor(() => expect(document.querySelectorAll('[name="teacherId"] option')).toHaveLength(2));
    await user.type(document.querySelector('[name="name"]')!, "New programme");
    await user.selectOptions(document.querySelector('[name="teacherId"]')!, "teacher-1");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(axiosMocks.post).toHaveBeenCalledWith(
      "/api/activities",
      expect.objectContaining({ name: "New programme", teacherId: "teacher-1", allDay: false })
    ));
    expect(axiosMocks.put).not.toHaveBeenCalled();
    expect(axiosMocks.get.mock.calls.some(([url]) => String(url).startsWith("/api/activities/"))).toBe(false);
  });
});
