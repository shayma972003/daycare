// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/lib/i18n-provider";

const state = vi.hoisted(() => ({
  reportRequest: null as Promise<{ data: unknown[] }> | null,
}));

vi.mock("@/components/layout/Topbar", () => ({
  Topbar: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

vi.mock("axios", () => ({
  default: {
    get: vi.fn((url: string) => {
      if (url === "/api/classes") return Promise.resolve({ data: [{ id: "class-1", name: "Butterflies" }] });
      if (url === "/api/students") {
        return Promise.resolve({ data: { students: [{ id: "student-1", name: "Noura", classId: "class-1" }] } });
      }
      if (url === "/api/attendance/students/today") {
        return Promise.resolve({ data: [{ studentId: "student-1", checkinAt: "2026-09-08T06:00:00.000Z" }] });
      }
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
    expect(screen.getByText("Today’s reports")).not.toBeNull();
    expect(screen.getAllByText("Loading…").length).toBeGreaterThan(0);
  });
});
