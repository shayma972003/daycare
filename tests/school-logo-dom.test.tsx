// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SchoolLogo } from "@/components/layout/SchoolLogo";

afterEach(cleanup);

describe("school logo fallback", () => {
  it("replaces a failed logo with school initials and does not keep the broken image", () => {
    const { container } = render(
      <SchoolLogo src="https://example.invalid/missing-logo.png" name="روضة الأمل" />
    );
    const image = screen.getByRole("img", { name: "روضة الأمل" });
    expect(container.querySelector("[data-school-logo-state='image']")).toBeTruthy();
    fireEvent.error(image);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[data-school-logo-state='fallback']")).toBeTruthy();
    expect(screen.getByRole("img", { name: "روضة الأمل" }).textContent).toBe("را");
  });

  it("renders the fallback immediately when no logo exists", () => {
    const { container } = render(<SchoolLogo name="Tofolah School" src={null} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("img", { name: "Tofolah School" }).textContent).toBe("TS");
  });
});
