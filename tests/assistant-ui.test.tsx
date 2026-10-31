// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/i18n-provider", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/lib/device-date", () => ({
  deviceHeaders: () => ({ "x-device-timezone": "Asia/Riyadh" }),
  deviceDateInputValue: () => "2026-10-22",
}));

import { AssistantChat } from "@/components/assistant/AssistantChat";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("assistant chat UI", () => {
  it("shows the privacy boundary before any provider request", () => {
    render(<AssistantChat />);
    expect(screen.getByText("assistant.privacyTitle")).not.toBeNull();
    expect(screen.getByText("assistant.privacyBody")).not.toBeNull();
    expect(screen.getByText("assistant.readOnlyBadge")).not.toBeNull();
    expect(screen.queryByText("assistant.actionsTitle")).toBeNull();
    expect(screen.queryByText("assistant.managementActionsTitle")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows an action preview returned from a conversational command", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      message: "preview",
      proposal: {
        token: "x".repeat(80),
        expiresAt: "2026-10-22T12:05:00.000Z",
        title: "تسجيل الحضور",
        summary: "تسجيل الحضور للطفل سارة أحمد",
        tool: "student_attendance",
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    render(<AssistantChat />);
    fireEvent.change(screen.getByLabelText("assistant.placeholder"), { target: { value: "سجلي حضور الطفل سارة أحمد" } });
    fireEvent.click(screen.getByRole("button", { name: "assistant.send" }));
    expect(await screen.findByText("تسجيل الحضور")).not.toBeNull();
    expect(screen.getByRole("button", { name: "assistant.confirmAction" })).not.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("shows the safe configuration message when the server feature is disabled", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(
      JSON.stringify({ code: "ASSISTANT_NOT_CONFIGURED" }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    ));

    render(<AssistantChat />);
    fireEvent.click(screen.getByRole("button", { name: "assistant.suggestRoster" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe("assistant.notConfigured");
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
