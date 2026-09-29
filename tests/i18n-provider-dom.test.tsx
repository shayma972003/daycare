// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { LocaleProvider, useLocale } from "@/lib/i18n-provider";
import { LocalizedDateTimeInput } from "@/components/ui/LocalizedDateTimeInput";

function NativeInputs() {
  const { setLocale } = useLocale();
  return (
    <>
      <LocalizedDateTimeInput aria-label="date" nativeType="date" />
      <LocalizedDateTimeInput aria-label="time" nativeType="time" />
      <button type="button" onClick={() => setLocale("ar")}>Arabic</button>
    </>
  );
}

afterEach(cleanup);

describe("locale provider native date and time controls", () => {
  it("uses English ISO fields without OS-localized Arabic labels and restores native Arabic controls", async () => {
    const user = userEvent.setup();
    render(<LocaleProvider initialLocale="en"><NativeInputs /></LocaleProvider>);

    await waitFor(() => expect(screen.getByLabelText("date").getAttribute("lang")).toBe("en-GB"));
    expect(screen.getByLabelText("date").getAttribute("dir")).toBe("ltr");
    expect(screen.getByLabelText("date").getAttribute("type")).toBe("text");
    expect(screen.getByLabelText("date").getAttribute("placeholder")).toBe("YYYY-MM-DD");
    expect(screen.getByLabelText("time").getAttribute("lang")).toBe("en-GB");
    expect(screen.getByLabelText("time").getAttribute("type")).toBe("text");
    expect(screen.getByLabelText("time").getAttribute("placeholder")).toBe("HH:MM");

    await act(async () => { await user.click(screen.getByRole("button", { name: "Arabic" })); });
    await waitFor(() => expect(screen.getByLabelText("date").getAttribute("lang")).toBe("ar-SA"));
    expect(screen.getByLabelText("date").getAttribute("type")).toBe("date");
    expect(screen.getByLabelText("date").getAttribute("placeholder")).toBeNull();
    expect(screen.getByLabelText("time").getAttribute("lang")).toBe("ar-SA");
    expect(screen.getByLabelText("time").getAttribute("type")).toBe("time");
  });
});
