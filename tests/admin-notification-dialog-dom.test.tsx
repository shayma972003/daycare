// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
vi.mock("axios", () => ({ default: { get: mocks.get, patch: mocks.patch } }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ status: "authenticated", update: vi.fn() }) }));
vi.mock("@/lib/i18n-provider", () => ({ useT: () => (key: string) => key }));

import AdminNotificationBell from "@/components/AdminNotificationBell";

beforeEach(() => {
  mocks.get.mockResolvedValue({ data: { unreadCount: 1, messages: [{ recipientId: "r1", messageId: "m1", subject: "رسالة كاملة", body: "هذا هو النص الكامل الذي يجب أن يظهر داخل نافذة القراءة", sent_at: "2026-09-06T10:00:00Z", read_at: null, system: false }] } });
  mocks.patch.mockResolvedValue({ data: { success: true } });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("admin notification dialog", () => {
  it("opens the complete body and marks a stored message as read", async () => {
    const user = userEvent.setup();
    render(<AdminNotificationBell />);
    await waitFor(() => expect(mocks.get).toHaveBeenCalled());
    await user.click(screen.getByTitle("notifications.adminMessages"));
    await user.click(await screen.findByText("رسالة كاملة"));
    expect(await screen.findByText("هذا هو النص الكامل الذي يجب أن يظهر داخل نافذة القراءة")).toBeTruthy();
    expect(mocks.patch).toHaveBeenCalledWith("/api/notifications/admin-messages", { recipientId: "r1" });
  });
});
