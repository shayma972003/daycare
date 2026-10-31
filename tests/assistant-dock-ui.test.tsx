// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/i18n-provider", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/lib/device-date", () => ({
  deviceHeaders: () => ({ "x-device-timezone": "Asia/Riyadh" }),
  deviceDateInputValue: () => "2026-10-29",
}));

import { AssistantDock } from "@/components/assistant/AssistantDock";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
});

describe("assistant side panel", () => {
  it("opens from a floating icon and closes without navigating away", () => {
    render(<AssistantDock />);

    const launcher = screen.getByRole("button", { name: "assistant.openPanel" });
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(launcher);
    expect(screen.getByRole("dialog", { name: "assistant.title" })).not.toBeNull();
    expect(screen.getByLabelText("assistant.placeholder").id).toBe("assistant-panel-question");

    fireEvent.click(screen.getByRole("button", { name: "assistant.closePanel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(launcher.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes with Escape", () => {
    render(<AssistantDock />);
    fireEvent.click(screen.getByRole("button", { name: "assistant.openPanel" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
