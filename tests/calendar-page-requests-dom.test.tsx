// @vitest-environment jsdom

import { StrictMode, type ReactNode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/lib/i18n-provider";

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const state = vi.hoisted(() => ({ calendarCalls: [] as { config: { signal?: AbortSignal }; deferred: Deferred<{ data: unknown[] }> }[] }));
vi.mock("@/components/layout/Topbar", () => ({ Topbar: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock("@/components/auth/PermissionGate", () => ({ PermissionGate: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/lib/use-permissions", () => ({ usePermissions: () => ({ can: () => true }) }));
vi.mock("@/components/calendar/CalendarEventModal", () => ({
  CalendarEventModal: ({ onSaved }: { onSaved: () => void }) => (
    <button type="button" onClick={onSaved}>Complete modal save</button>
  ),
}));
vi.mock("axios", () => ({
  default: {
    get: vi.fn((url: string, config: { signal?: AbortSignal } = {}) => {
      if (url === "/api/classes" || url === "/api/teachers") return Promise.resolve({ data: [] });
      if (url.startsWith("/api/calendar?")) {
        const pending = deferred<{ data: unknown[] }>();
        state.calendarCalls.push({ config, deferred: pending });
        return pending.promise;
      }
      return Promise.resolve({ data: { shifts: [] } });
    }),
    isAxiosError: () => false,
  },
}));

import CalendarPage from "@/app/(dashboard)/calendar/page";

const row = (title: string, dayOffset = 0) => {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  const dateKey = date.toISOString().slice(0, 10);
  return ({
  id: title,
  source: "event",
  sourceId: title,
  kind: "event",
  timing: "timed",
  type: "LESSON",
  title,
  description: null,
  startAt: dateKey + "T09:00:00.000Z",
  endAt: dateKey + "T10:00:00.000Z",
  allDay: false,
  teacherId: null,
  location: null,
  classIds: [],
  unit: null,
  });
};

beforeEach(() => { state.calendarCalls.length = 0; });
afterEach(cleanup);

describe("calendar request lifecycle", () => {
  it("aborts the active request on unmount", async () => {
    const rendered = render(<LocaleProvider initialLocale="en"><CalendarPage /></LocaleProvider>);
    await waitFor(() => expect(state.calendarCalls).toHaveLength(1));
    rendered.unmount();
    expect(state.calendarCalls[0].config.signal?.aborted).toBe(true);
    state.calendarCalls[0].deferred.resolve({ data: [row("After unmount")] });
    await Promise.resolve();
  });

  it.each(["success", "failure"] as const)(
    "aborts the retry request itself on unmount and ignores its late %s",
    async (outcome) => {
      const user = userEvent.setup();
      const rendered = render(<LocaleProvider initialLocale="en"><CalendarPage /></LocaleProvider>);
      await waitFor(() => expect(state.calendarCalls).toHaveLength(1));
      state.calendarCalls[0].deferred.reject(new Error("offline"));
      await screen.findByRole("alert");

      await user.click(screen.getByRole("button", { name: "Try again" }));
      await waitFor(() => expect(state.calendarCalls).toHaveLength(2));
      rendered.unmount();
      expect(state.calendarCalls[1].config.signal?.aborted).toBe(true);

      await act(async () => {
        if (outcome === "success") {
          state.calendarCalls[1].deferred.resolve({ data: [row("Late retry")] });
        } else {
          state.calendarCalls[1].deferred.reject(new Error("late failure"));
        }
      });
    }
  );

  it("aborts the post-save refresh when the page unmounts", async () => {
    const user = userEvent.setup();
    const rendered = render(<LocaleProvider initialLocale="en"><CalendarPage /></LocaleProvider>);
    await waitFor(() => expect(state.calendarCalls).toHaveLength(1));
    state.calendarCalls[0].deferred.resolve({ data: [row("Initial")] });
    expect(await screen.findByText("Initial")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.click(screen.getByRole("button", { name: "Complete modal save" }));
    await waitFor(() => expect(state.calendarCalls).toHaveLength(2));
    rendered.unmount();
    expect(state.calendarCalls[1].config.signal?.aborted).toBe(true);
    await act(async () => {
      state.calendarCalls[1].deferred.resolve({ data: [row("Late post-save")] });
    });
  });

  it("aborts the previous range and never lets its stale response replace the latest", async () => {
    const user = userEvent.setup();
    render(<LocaleProvider initialLocale="en"><CalendarPage /></LocaleProvider>);
    await waitFor(() => expect(state.calendarCalls).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: "Day" }));
    await waitFor(() => expect(state.calendarCalls).toHaveLength(2));
    expect(state.calendarCalls[0].config.signal?.aborted).toBe(true);

    state.calendarCalls[1].deferred.resolve({ data: [row("Newest event")] });
    expect(await screen.findByText("Newest event")).not.toBeNull();
    state.calendarCalls[0].deferred.resolve({ data: [row("Stale event")] });
    await Promise.resolve();
    expect(screen.queryByText("Stale event")).toBeNull();
    expect(screen.getByText("Newest event")).not.toBeNull();
  });

  it("shows a retryable error instead of a false empty state", async () => {
    const user = userEvent.setup();
    render(<LocaleProvider initialLocale="en"><CalendarPage /></LocaleProvider>);
    await waitFor(() => expect(state.calendarCalls).toHaveLength(1));
    state.calendarCalls[0].deferred.reject(new Error("offline"));
    expect((await screen.findByRole("alert")).textContent).toContain("Could not load the calendar");
    expect(screen.queryByText("No entries in this period")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(state.calendarCalls).toHaveLength(2));
    state.calendarCalls[1].deferred.resolve({ data: [row("Recovered event")] });
    expect(await screen.findByText("Recovered event")).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps navigation B after retry A resolves late even when transport ignores abort", async () => {
    const user = userEvent.setup();
    render(<LocaleProvider initialLocale="en"><CalendarPage /></LocaleProvider>);
    await waitFor(() => expect(state.calendarCalls).toHaveLength(1));
    state.calendarCalls[0].deferred.reject(new Error("offline"));
    await screen.findByRole("alert");

    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(state.calendarCalls).toHaveLength(2));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(state.calendarCalls).toHaveLength(3));
    expect(state.calendarCalls[1].config.signal?.aborted).toBe(true);

    state.calendarCalls[2].deferred.resolve({ data: [row("Range B", 7)] });
    expect(await screen.findByText("Range B")).not.toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    state.calendarCalls[1].deferred.resolve({ data: [row("Retry A")] });
    await Promise.resolve();
    expect(screen.queryByText("Retry A")).toBeNull();
    expect(screen.getByText("Range B")).not.toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps navigation B after a post-save refresh A resolves late", async () => {
    const user = userEvent.setup();
    render(<LocaleProvider initialLocale="en"><CalendarPage /></LocaleProvider>);
    await waitFor(() => expect(state.calendarCalls).toHaveLength(1));
    state.calendarCalls[0].deferred.resolve({ data: [row("Initial")] });
    expect(await screen.findByText("Initial")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.click(screen.getByRole("button", { name: "Complete modal save" }));
    await waitFor(() => expect(state.calendarCalls).toHaveLength(2));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(state.calendarCalls).toHaveLength(3));

    state.calendarCalls[2].deferred.resolve({ data: [row("After navigation B", 7)] });
    expect(await screen.findByText("After navigation B")).not.toBeNull();
    state.calendarCalls[1].deferred.resolve({ data: [row("Post-save A")] });
    await Promise.resolve();
    expect(screen.queryByText("Post-save A")).toBeNull();
    expect(screen.getByText("After navigation B")).not.toBeNull();
  });

  it("starts a fresh request after the Strict Mode effect replay", async () => {
    render(
      <StrictMode>
        <LocaleProvider initialLocale="en"><CalendarPage /></LocaleProvider>
      </StrictMode>
    );
    await waitFor(() => expect(state.calendarCalls.length).toBeGreaterThanOrEqual(2));
    const first = state.calendarCalls[0];
    const latest = state.calendarCalls.at(-1)!;
    expect(first.config.signal?.aborted).toBe(true);
    expect(latest.config.signal?.aborted).toBe(false);

    latest.deferred.resolve({ data: [row("Strict Mode result")] });
    expect(await screen.findByText("Strict Mode result")).not.toBeNull();
  });
});
