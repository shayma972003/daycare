// @vitest-environment jsdom

import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/Dialog";

afterEach(cleanup);

function DialogHarness({ dismissBlocked = false }: { dismissBlocked?: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button">Background action</button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <button type="button">Open dialog</button>
        </DialogTrigger>
        <DialogContent dismissBlocked={dismissBlocked}>
          <DialogTitle>Accessible dialog</DialogTitle>
          <DialogDescription>Dialog behavior under test</DialogDescription>
          <button type="button">First action</button>
          <button type="button">Last action</button>
          <DialogClose asChild>
            <button type="button">Close dialog</button>
          </DialogClose>
        </DialogContent>
      </Dialog>
    </>
  );
}

describe("shared Dialog DOM behavior", () => {
  it("connects the title and description and moves focus into the dialog", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);

    await user.click(screen.getByRole("button", { name: "Open dialog" }));

    const dialog = screen.getByRole("dialog", { name: "Accessible dialog" });
    const descriptionId = dialog.getAttribute("aria-describedby");
    expect(descriptionId).toBeTruthy();
    expect(document.getElementById(descriptionId!)?.textContent).toBe(
      "Dialog behavior under test"
    );
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });

  it("traps focus instead of allowing it to move to a background action", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    const background = screen.getByRole("button", { name: "Background action" });

    await user.click(screen.getByRole("button", { name: "Open dialog" }));
    const dialog = screen.getByRole("dialog");

    for (let index = 0; index < 6; index += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }

    background.focus();
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });

  it("closes with Escape and restores focus to its trigger", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    const trigger = screen.getByRole("button", { name: "Open dialog" });

    await user.click(trigger);
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("closes when the backdrop is clicked", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);

    await user.click(screen.getByRole("button", { name: "Open dialog" }));
    const overlay = document.querySelector<HTMLElement>("[data-dialog-overlay]");
    expect(overlay).not.toBeNull();
    await user.click(overlay!);

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("keeps the dialog open when dismissal is blocked by a pending mutation", async () => {
    const user = userEvent.setup();
    render(<DialogHarness dismissBlocked />);

    await user.click(screen.getByRole("button", { name: "Open dialog" }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).not.toBeNull();

    const overlay = document.querySelector<HTMLElement>("[data-dialog-overlay]");
    await user.click(overlay!);
    expect(screen.getByRole("dialog")).not.toBeNull();
  });
});
