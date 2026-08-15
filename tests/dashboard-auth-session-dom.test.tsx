// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  replace: vi.fn(),
  clearPermissions: vi.fn(),
  updateSession: vi.fn(),
  useSession: vi.fn(),
}));

vi.mock("axios", () => ({
  default: {
    get: mocks.get,
    patch: vi.fn(),
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock("next-auth/react", () => ({ useSession: mocks.useSession }));
vi.mock("@/lib/use-permissions", () => ({ clearPermissions: mocks.clearPermissions }));
vi.mock("@/lib/i18n-provider", () => ({
  useT: () => (key: string) => key,
}));

import AdminNotificationBell from "@/components/AdminNotificationBell";
import { DashboardSessionBoundary } from "@/components/layout/DashboardSessionBoundary";

type SessionStatus = "loading" | "authenticated" | "unauthenticated";
let sessionStatus: SessionStatus;

beforeEach(() => {
  sessionStatus = "loading";
  mocks.get.mockReset();
  mocks.replace.mockReset();
  mocks.clearPermissions.mockReset();
  mocks.updateSession.mockReset();
  mocks.useSession.mockImplementation(() => ({
    status: sessionStatus,
    data: null,
    update: mocks.updateSession,
  }));
  mocks.get.mockResolvedValue({ data: { unreadCount: 0, messages: [] } });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("dashboard session lifecycle", () => {
  it("does not mount protected dashboard work before authentication and redirects once", () => {
    const view = render(
      <DashboardSessionBoundary>
        <div>protected dashboard</div>
      </DashboardSessionBoundary>
    );

    expect(screen.queryByText("protected dashboard")).toBeNull();
    expect(mocks.replace).not.toHaveBeenCalled();

    sessionStatus = "unauthenticated";
    view.rerender(
      <DashboardSessionBoundary>
        <div>protected dashboard</div>
      </DashboardSessionBoundary>
    );
    expect(mocks.clearPermissions).toHaveBeenCalledTimes(1);
    expect(mocks.replace).toHaveBeenCalledTimes(1);
    expect(mocks.replace).toHaveBeenCalledWith("/login");

    view.rerender(
      <DashboardSessionBoundary>
        <div>protected dashboard</div>
      </DashboardSessionBoundary>
    );
    expect(mocks.replace).toHaveBeenCalledTimes(1);
  });

  it("starts notification polling only when authenticated and aborts it on sign-out", async () => {
    vi.useFakeTimers();
    const view = render(<AdminNotificationBell />);
    expect(mocks.get).not.toHaveBeenCalled();

    sessionStatus = "authenticated";
    view.rerender(<AdminNotificationBell />);
    expect(mocks.get).toHaveBeenCalledTimes(1);
    const firstSignal = mocks.get.mock.calls[0]?.[1]?.signal as AbortSignal;
    expect(firstSignal.aborted).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(mocks.get).toHaveBeenCalledTimes(2);

    sessionStatus = "unauthenticated";
    view.rerender(<AdminNotificationBell />);
    expect(firstSignal.aborted).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });

  it("revalidates the session once when a poll discovers an expired cookie", async () => {
    vi.useFakeTimers();
    sessionStatus = "authenticated";
    mocks.get.mockRejectedValueOnce({ response: { status: 401 } });
    const view = render(<AdminNotificationBell />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.updateSession).toHaveBeenCalledTimes(1);

    sessionStatus = "unauthenticated";
    view.rerender(<AdminNotificationBell />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });
});
