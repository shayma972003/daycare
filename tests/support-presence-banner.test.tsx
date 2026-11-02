// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  delete: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("axios", () => ({
  default: {
    get: mocks.get,
    post: mocks.post,
    delete: mocks.delete,
    isAxiosError: (value: unknown) => Boolean(value && typeof value === "object" && "response" in value),
  },
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/calendar",
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));

import { SupportPresenceBanner } from "@/components/layout/SupportPresenceBanner";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.post.mockResolvedValue({ data: { success: true } });
});

afterEach(cleanup);

describe("support presence banner", () => {
  it("tells the school that support is currently viewing the account", async () => {
    mocks.get.mockResolvedValue({ data: { active: true, expiresAt: "2099-01-01T00:00:00Z", isSupportViewer: false } });
    render(<SupportPresenceBanner />);

    expect(await screen.findByText(/الدعم الفني مطّلع الآن على الحساب/)).toBeTruthy();
  });

  it("shows read-only status to support and audits the current page", async () => {
    mocks.get.mockResolvedValue({ data: { active: true, expiresAt: "2099-01-01T00:00:00Z", isSupportViewer: true } });
    render(<SupportPresenceBanner initial={{ active: true, expiresAt: "2099-01-01T00:00:00Z", isSupportViewer: true }} />);

    expect(screen.getByText(/أنت داخل حساب المنشأة بصفة دعم فني/)).toBeTruthy();
    await vi.waitFor(() => expect(mocks.post).toHaveBeenCalledWith("/api/support-presence", { pathname: "/calendar" }));
  });

  it("keeps the safety banner visible through a temporary heartbeat failure", async () => {
    mocks.get.mockRejectedValue(new Error("temporary network failure"));
    render(<SupportPresenceBanner initial={{ active: true, expiresAt: "2099-01-01T00:00:00Z", isSupportViewer: true }} />);

    expect(screen.getByText(/أنت داخل حساب المنشأة بصفة دعم فني/)).toBeTruthy();
    await vi.waitFor(() => expect(mocks.get).toHaveBeenCalled());
    expect(screen.getByText(/أنت داخل حساب المنشأة بصفة دعم فني/)).toBeTruthy();
  });
});
