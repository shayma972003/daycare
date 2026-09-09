// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LocaleProvider } from "@/lib/i18n-provider";
import { UnifiedDailyCareForm } from "@/components/care/UnifiedDailyCareForm";

const mocks = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock("axios", () => ({
  default: { post: mocks.post, isAxiosError: () => false },
}));

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.post.mockResolvedValue({ data: { created: 7 } });
});

describe("unified daily care form", () => {
  it("shares only the meal and keeps nap, toilet and mood per child", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(
      <LocaleProvider initialLocale="en">
        <UnifiedDailyCareForm
          date="2026-09-08"
          students={[
            { id: "student-1", name: "Noura" },
            { id: "student-2", name: "Yousef" },
          ]}
          onSaved={onSaved}
        />
      </LocaleProvider>
    );

    await user.type(screen.getByPlaceholderText("For example: rice and vegetables"), "Rice");
    await user.selectOptions(screen.getByRole("combobox", { name: "Food - Noura" }), "ALL");
    await user.selectOptions(screen.getByRole("combobox", { name: "Food - Yousef" }), "HALF");
    await user.selectOptions(screen.getByRole("combobox", { name: "Sleep - Noura" }), "SLEPT");
    await user.type(screen.getByLabelText("Nap start"), "12:00");
    await user.type(screen.getByLabelText("Nap end"), "13:30");
    await user.selectOptions(screen.getByRole("combobox", { name: "Sleep - Yousef" }), "DID_NOT_SLEEP");
    await user.selectOptions(screen.getByRole("combobox", { name: "Toilet - Noura" }), "DIAPER_WET");
    await user.selectOptions(screen.getByRole("combobox", { name: "Mood - Noura" }), "HAPPY");
    await user.click(screen.getByRole("button", { name: "Send report for 2 children" }));

    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    const [url, payload] = mocks.post.mock.calls[0];
    expect(url).toBe("/api/care-reports/daily");
    expect(payload.meal).toEqual(expect.objectContaining({ source: "CENTER", name: "Rice" }));
    expect(payload.entries).toEqual([
      expect.objectContaining({
        studentId: "student-1",
        mealAmount: "ALL",
        napStatus: "SLEPT",
        toilet: "DIAPER_WET",
        mood: "HAPPY",
      }),
      expect.objectContaining({
        studentId: "student-2",
        mealAmount: "HALF",
        napStatus: "DID_NOT_SLEEP",
      }),
    ]);
    expect(onSaved).toHaveBeenCalledWith("Saved and sent 7 care entries");
  });

  it("hides the centre meal name for home meals", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider initialLocale="en">
        <UnifiedDailyCareForm
          date="2026-09-08"
          students={[{ id: "student-1", name: "Noura" }]}
          onSaved={vi.fn()}
        />
      </LocaleProvider>
    );

    await user.click(screen.getByRole("button", { name: "Meal from home" }));
    expect(screen.queryByPlaceholderText("For example: rice and vegetables")).toBeNull();
    await user.selectOptions(screen.getByRole("combobox", { name: "Food - Noura" }), "LITTLE");
    await user.click(screen.getByRole("button", { name: "Send report for 1 children" }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    expect(mocks.post.mock.calls[0][1].meal).toEqual(expect.objectContaining({ source: "HOME", name: null }));
  });

  it("opens the same focused child-details flow as the approved demo", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider initialLocale="en">
        <UnifiedDailyCareForm
          date="2026-09-08"
          students={[{ id: "student-1", name: "Noura" }]}
          onSaved={vi.fn()}
        />
      </LocaleProvider>
    );

    await user.type(screen.getByPlaceholderText("For example: rice and vegetables"), "Rice");
    await user.click(screen.getByRole("button", { name: "+ Details" }));

    expect(screen.getByRole("heading", { name: "Report for Noura" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Today’s details" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Only when needed" })).toBeTruthy();
    expect(screen.getByText("Add another event")).toBeTruthy();
    expect(screen.getByText("Request supplies")).toBeTruthy();
    expect(screen.getByText("Health note")).toBeTruthy();
    expect(screen.getByText("Record medication")).toBeTruthy();
    expect(document.querySelectorAll("[data-disclosure-arrow]")).toHaveLength(4);

    await user.selectOptions(screen.getByLabelText("Food amount"), "ALL");
    await user.click(screen.getByText("Add another event"));
    await user.selectOptions(screen.getByLabelText("Event type"), "TOILET");
    await user.clear(screen.getByLabelText("Time"));
    await user.type(screen.getByLabelText("Time"), "14:15");
    await user.type(screen.getByPlaceholderText("For example: apple — ate half"), "Used the toilet");
    await user.click(screen.getByRole("button", { name: "Add event" }));

    await user.click(screen.getByText("Request supplies"));
    await user.type(screen.getByLabelText("Requested supplies"), "Spare clothes");
    await user.click(screen.getByRole("button", { name: "Save and return to class" }));
    expect(screen.getByRole("button", { name: "Details (2)" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Send report for 1 children" }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    expect(mocks.post.mock.calls[0][1].entries[0]).toEqual(expect.objectContaining({
      studentId: "student-1",
      mealAmount: "ALL",
      supplies: "Spare clothes",
      extraEvents: [expect.objectContaining({ kind: "TOILET", details: "Used the toilet" })],
    }));
  });
});
