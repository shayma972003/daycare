// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/lib/i18n-provider";
import { deviceDateInputValue } from "@/lib/device-date";

const state = vi.hoisted(() => ({
  reportRequest: null as Promise<{ data: unknown[] }> | null,
  attendanceDate: "" as string,
  classroomScoped: false,
  returnedBatches: [] as unknown[],
}));

vi.mock("@/components/layout/Topbar", () => ({
  Topbar: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
vi.mock("@/lib/use-permissions", () => ({
  usePermissions: () => ({ can: () => true, me: { classroomScoped: state.classroomScoped } }),
}));

vi.mock("axios", () => ({
  default: {
    get: vi.fn((url: string) => {
      if (url === "/api/classes") return Promise.resolve({ data: [{ id: "class-1", name: "Butterflies" }] });
      if (url === "/api/students") {
        return Promise.resolve({ data: { students: [{ id: "student-1", name: "Noura", classId: "class-1" }] } });
      }
      if (url === "/api/attendance/students/today") {
        return Promise.resolve({
          data: [{
            studentId: "student-1",
            date: `${state.attendanceDate}T00:00:00.000Z`,
            checkinAt: `${state.attendanceDate}T06:00:00.000Z`,
          }],
        });
      }
      if (url === "/api/care-reports/returned") return Promise.resolve({ data: state.returnedBatches });
      if (url === "/api/care-reports/settings") return Promise.resolve({ data: { reviewRequired: true } });
      if (url.startsWith("/api/care-reports?date=")) return state.reportRequest;
      throw new Error(`Unexpected request: ${url}`);
    }),
    post: vi.fn(),
    isCancel: () => false,
    isAxiosError: () => false,
  },
}));

import CarePage from "@/app/(dashboard)/care/page";

beforeEach(() => {
  state.reportRequest = new Promise(() => {});
  state.attendanceDate = deviceDateInputValue();
  state.classroomScoped = false;
  state.returnedBatches = [];
});

afterEach(cleanup);

describe("daily care page loading", () => {
  it("shows the care form as soon as the roster is ready without waiting for the report feed", async () => {
    render(
      <LocaleProvider initialLocale="en">
        <CarePage />
      </LocaleProvider>
    );

    await waitFor(() => expect(screen.getByText("Noura")).not.toBeNull());
    expect(screen.getByText("Shared entry")).not.toBeNull();
    expect(screen.getByText("Class")).not.toBeNull();
    expect(screen.getByText("Care report delivery")).not.toBeNull();
    expect(screen.getByText("Manager review before sending")).not.toBeNull();
    expect(screen.getByText("Today’s reports")).not.toBeNull();
    expect(screen.getAllByText("Loading…").length).toBeGreaterThan(0);
  });

  it("does not treat an older unclosed attendance row as present today", async () => {
    state.attendanceDate = "2026-09-01";

    render(
      <LocaleProvider initialLocale="en">
        <CarePage />
      </LocaleProvider>
    );

    await waitFor(() => expect(screen.getByText("No children are checked in for this class today")).not.toBeNull());
    expect(screen.queryByText("Noura")).toBeNull();
    screen.getByRole("button", { name: "Show all children" }).click();
    await waitFor(() => expect(screen.getByText("Noura")).not.toBeNull());
  });

  it("groups one submission by child and expands each child's report with its author", async () => {
    state.reportRequest = Promise.resolve({
      data: [
        {
          id: "report-1",
          type: "MEAL",
          summary: "Breakfast",
          occurredAt: "2026-09-18T08:00:00.000Z",
          reportedByName: "Teacher A",
          note: null,
          dailyBatchId: "batch-1",
          reviewStatus: "PENDING_REVIEW",
          reviewNote: null,
          student: { id: "student-1", name: "Noura" },
        },
        {
          id: "report-2",
          type: "MOOD",
          summary: "Happy",
          occurredAt: "2026-09-18T08:00:00.000Z",
          reportedByName: "Teacher A",
          note: null,
          dailyBatchId: "batch-1",
          reviewStatus: "PENDING_REVIEW",
          reviewNote: null,
          student: { id: "student-1", name: "Noura" },
        },
        {
          id: "report-3",
          type: "NAP",
          summary: "Slept for one hour",
          occurredAt: "2026-09-18T09:00:00.000Z",
          reportedByName: "Teacher B",
          note: "Rested well",
          dailyBatchId: "batch-1",
          reviewStatus: "PENDING_REVIEW",
          reviewNote: null,
          student: { id: "student-2", name: "Salma" },
        },
      ],
    });

    render(
      <LocaleProvider initialLocale="en">
        <CarePage />
      </LocaleProvider>
    );

    await waitFor(() => expect(screen.getByText("One submission · 2 children · 3 entries")).not.toBeNull());
    expect(screen.getAllByRole("button", { name: "Approve and send" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Return for changes" })).toHaveLength(1);
    expect(screen.getByText(/Teacher A/)).not.toBeNull();
    expect(screen.getByText(/Teacher B/)).not.toBeNull();
    expect(screen.queryByText("Breakfast")).toBeNull();
    expect(screen.queryByText("Slept for one hour")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "View Noura’s report" }));
    expect(screen.getByText("Breakfast")).not.toBeNull();
    expect(screen.getAllByText("Happy").length).toBeGreaterThan(1);
    expect(screen.queryByText("Slept for one hour")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "View Salma’s report" }));
    expect(screen.getByText("Slept for one hour")).not.toBeNull();
    expect(screen.getByText("Rested well")).not.toBeNull();
  });

  it("shows a returned batch to its classroom teacher and opens the previous values", async () => {
    state.classroomScoped = true;
    state.returnedBatches = [{
      batchId: "returned-batch-123456",
      reviewNote: "Correct the nap time",
      returnedAt: "2026-09-18T10:00:00.000Z",
      reportedByName: "Teacher A",
      meal: { source: "CENTER", name: "Rice", occurredAt: "2026-09-18T08:00:00.000Z" },
      students: [{ id: "student-1", name: "Noura" }],
      entries: [{
        studentId: "student-1",
        mealAmount: "ALL",
        napStatus: "DID_NOT_SLEEP",
        napStartAt: null,
        napEndAt: null,
        toilet: "NO_RECORD",
        toiletOccurredAt: null,
        mood: "HAPPY",
        note: null,
        extraEvents: [],
        supplies: null,
        health: null,
        medication: null,
      }],
    }];

    render(
      <LocaleProvider initialLocale="en">
        <CarePage />
      </LocaleProvider>
    );

    await waitFor(() => expect(screen.getByText("Reports returned for changes")).not.toBeNull());
    expect(screen.getByText("Correct the nap time")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open and edit report" }));
    expect(screen.getByText("Manager’s note on the report")).not.toBeNull();
    expect(screen.getByDisplayValue("Rice")).not.toBeNull();
    expect(screen.getByRole("combobox", { name: "Food - Noura" })).toHaveProperty("value", "ALL");
  });

  it("removes a returned batch from the manager review queue", async () => {
    state.reportRequest = Promise.resolve({
      data: [{
        id: "report-1",
        type: "MEAL",
        summary: "Breakfast",
        occurredAt: "2026-09-18T08:00:00.000Z",
        reportedByName: "Teacher A",
        note: null,
        dailyBatchId: "batch-1",
        reviewStatus: "REJECTED",
        reviewNote: "Correct the meal amount",
        student: { id: "student-1", name: "Noura" },
      }],
    });

    render(
      <LocaleProvider initialLocale="en">
        <CarePage />
      </LocaleProvider>
    );

    await waitFor(() => expect(screen.getByText("Returned to teachers")).not.toBeNull());
    expect(screen.getByText("Correct the meal amount")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Approve and send" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Return for changes" })).toBeNull();
  });
});
