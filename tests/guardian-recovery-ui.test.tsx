// @vitest-environment jsdom

import { type ReactNode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ForgotPasswordForm } from "@/app/forgot-password/page";
import ResetPasswordPage from "@/app/reset-password/page";
import { LocaleProvider } from "@/lib/i18n-provider";

const axiosMocks = vi.hoisted(() => ({
  post: vi.fn(),
  isAxiosError: vi.fn(
    (error: unknown) => Boolean(error && typeof error === "object" && "response" in error)
  ),
}));
const routerMocks = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("axios", () => ({ default: axiosMocks }));
vi.mock("next/navigation", () => ({
  useRouter: () => routerMocks,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

function inEnglish(children: ReactNode) {
  return <LocaleProvider initialLocale="en">{children}</LocaleProvider>;
}

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

describe("guardian forgot-password mode", () => {
  it("sends the explicit guardian email contract without an identifier", async () => {
    const user = userEvent.setup();
    axiosMocks.post.mockResolvedValueOnce({
      status: 200,
      data: {
        success: true,
        token: "must-not-render",
        tokenHash: "must-not-render-hash",
      },
    });
    render(inEnglish(<ForgotPasswordForm kind="guardian" />));

    await user.type(screen.getByLabelText("Email"), "guardian@example.test");
    await user.click(screen.getByRole("button", { name: "Send the code" }));

    expect(axiosMocks.post).toHaveBeenCalledWith("/api/auth/forgot-password", {
      email: "guardian@example.test",
      kind: "guardian",
    });
    expect(axiosMocks.post.mock.calls[0]?.[1]).not.toHaveProperty("identifier");
    expect(await screen.findByText("Sent")).not.toBeNull();
    expect(screen.getByText(/If the account exists/i)).not.toBeNull();
    expect(screen.getByRole("link", { name: "Enter the verification code" }).getAttribute("href")).toBe(
      "/reset-password?kind=guardian"
    );
    expect(document.body.textContent).not.toMatch(/must-not-render/);
    expect(sessionStorage.getItem("reset_kind")).toBe("guardian");
  });

  it("keeps the existing staff payload and sends no kind", async () => {
    const user = userEvent.setup();
    axiosMocks.post.mockResolvedValueOnce({ status: 200, data: { success: true } });
    render(inEnglish(<ForgotPasswordForm kind="staff" />));
    await user.type(screen.getByLabelText("Email or mobile number"), "owner@example.test");
    await user.click(screen.getByRole("button", { name: "Send the code" }));
    expect(axiosMocks.post).toHaveBeenCalledWith("/api/auth/forgot-password", {
      identifier: "owner@example.test",
    });
    expect(axiosMocks.post.mock.calls[0]?.[1]).not.toHaveProperty("kind");
    expect(sessionStorage.getItem("reset_kind")).toBeNull();
  });

  it("prevents duplicate requests while the first request is pending", async () => {
    const user = userEvent.setup();
    let resolveRequest!: (value: unknown) => void;
    const pending = new Promise((resolve) => { resolveRequest = resolve; });
    axiosMocks.post.mockReturnValueOnce(pending);
    render(inEnglish(<ForgotPasswordForm kind="guardian" />));
    await user.type(screen.getByLabelText("Email"), "guardian@example.test");
    const submit = screen.getByRole("button", { name: "Send the code" });
    await user.click(submit);
    await user.click(submit);
    expect(axiosMocks.post).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveRequest({ status: 200, data: { success: true } });
      await pending;
    });
  });

  it("does not display a server detail that could reveal whether the email exists", async () => {
    const user = userEvent.setup();
    axiosMocks.post.mockRejectedValueOnce({
      response: { status: 502, data: { error: "account guardian@example.test exists" } },
    });
    render(inEnglish(<ForgotPasswordForm kind="guardian" />));
    await user.type(screen.getByLabelText("Email"), "guardian@example.test");
    await user.click(screen.getByRole("button", { name: "Send the code" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Something went wrong. Please try again."
    );
    expect(document.body.textContent).not.toContain("account guardian@example.test exists");
  });
});

describe("guardian reset-password continuation", () => {
  it("carries guardian kind internally, resets successfully, and never redirects to staff login", async () => {
    const user = userEvent.setup();
    sessionStorage.setItem("reset_identifier", "guardian@example.test");
    sessionStorage.setItem("reset_kind", "guardian");
    axiosMocks.post.mockResolvedValueOnce({ status: 200, data: { success: true } });
    render(inEnglish(<ResetPasswordPage />));

    await waitFor(() =>
      expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe(
        "guardian@example.test"
      )
    );
    await user.type(screen.getByLabelText("Verification code"), "123456");
    await user.type(screen.getByLabelText("New password"), "ValidPass1!");
    await user.type(screen.getByLabelText("Confirm the password"), "ValidPass1!");
    await user.click(screen.getByRole("button", { name: "Set the password" }));

    expect(axiosMocks.post).toHaveBeenCalledWith("/api/auth/reset-password", {
      identifier: "guardian@example.test",
      otp: "123456",
      newPassword: "ValidPass1!",
      kind: "guardian",
    });
    expect(await screen.findByText("Password updated")).not.toBeNull();
    expect(screen.getByText(/guardian account is ready/i)).not.toBeNull();
    expect(routerMocks.push).not.toHaveBeenCalled();
    expect(screen.queryByRole("link")).toBeNull();
    expect(sessionStorage.getItem("reset_kind")).toBeNull();
  });

  it("keeps staff reset free of the guardian kind and redirects as before", async () => {
    const user = userEvent.setup();
    sessionStorage.setItem("reset_identifier", "owner@example.test");
    axiosMocks.post.mockResolvedValueOnce({ status: 200, data: { success: true } });
    render(inEnglish(<ResetPasswordPage />));
    await waitFor(() =>
      expect((screen.getByLabelText("Email or mobile number") as HTMLInputElement).value).toBe(
        "owner@example.test"
      )
    );
    await user.type(screen.getByLabelText("Verification code"), "123456");
    await user.type(screen.getByLabelText("New password"), "ValidPass1!");
    await user.type(screen.getByLabelText("Confirm the password"), "ValidPass1!");
    await user.click(screen.getByRole("button", { name: "Set the password" }));

    const payload = axiosMocks.post.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("kind");
    expect(routerMocks.push).toHaveBeenCalledWith("/login?reset=1");
  });
});
