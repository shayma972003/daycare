// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LocaleProvider } from "@/lib/i18n-provider";
import { RenewalConfirmation } from "@/components/students/RenewalConfirmation";

afterEach(cleanup);
const props = () => ({ endDate: "2026-09-30", needsReactivation: true, pending: false, error: null, onConfirm: vi.fn(), onClose: vi.fn() });
describe("explicit renewal consent", () => {
  it("does not renew or reactivate until consent, and cancel remains initially focused", () => {
    const values = props();
    render(<LocaleProvider initialLocale="en"><RenewalConfirmation {...values} /></LocaleProvider>);
    const confirm = screen.getByRole("button", { name: "Renew subscription" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(confirm);
    expect(values.onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(confirm);
    expect(values.onConfirm).toHaveBeenCalledWith(true);
  });
  it("does not ask to reactivate a student who only expired", () => {
    const values = { ...props(), needsReactivation: false };
    render(<LocaleProvider initialLocale="en"><RenewalConfirmation {...values} /></LocaleProvider>);
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Renew subscription" }));
    expect(values.onConfirm).toHaveBeenCalledWith(false);
  });
  it("resets consent on another opening and blocks actions while pending", () => {
    const values = props();
    const first = render(<LocaleProvider initialLocale="en"><RenewalConfirmation {...values} /></LocaleProvider>);
    fireEvent.click(screen.getByRole("checkbox"));
    first.unmount();
    render(<LocaleProvider initialLocale="en"><RenewalConfirmation {...values} pending /></LocaleProvider>);
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(values.onClose).not.toHaveBeenCalled();
  });
});
