// @vitest-environment jsdom

import { type ReactNode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GuardianAccounts } from "@/components/accounts/GuardianAccounts";
import { LocaleProvider } from "@/lib/i18n-provider";

const axiosMocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  isCancel: vi.fn(() => false),
  isAxiosError: vi.fn(
    (error: unknown) => Boolean(error && typeof error === "object" && "response" in error)
  ),
}));
const permissionMocks = vi.hoisted(() => ({
  status: "ready" as "loading" | "ready" | "error",
  permissions: ["students.guardians"] as string[],
}));

vi.mock("axios", () => ({ default: axiosMocks }));
vi.mock("@/lib/use-permissions", () => ({
  usePermissions: () => ({
    status: permissionMocks.status,
    me: { permissions: permissionMocks.permissions },
  }),
}));
vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

type State = "none" | "invited" | "expired" | "active" | "disabled";

function row(id: string, name: string, state: State) {
  return {
    guardianId: `guardian-${id}`,
    name,
    email: `${id}@example.test`,
    phone: null,
    children: [{ id: `child-${id}`, name: `Child ${id}` }],
    account:
      state === "none"
        ? null
        : {
            id: `account-${id}`,
            email: `${id}@example.test`,
            status: state,
            inviteExpiresAt: null,
            lastLoginAt: null,
          },
  };
}

function renderAccounts() {
  return render(
    <LocaleProvider initialLocale="en">
      <GuardianAccounts />
    </LocaleProvider>
  );
}

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  permissionMocks.status = "ready";
  permissionMocks.permissions = ["students.guardians"];
  axiosMocks.get.mockResolvedValue({ data: [] });
});

describe("guardian account permission and invitation states", () => {
  it("hides the whole section and avoids the API without students.guardians", async () => {
    permissionMocks.permissions = [];
    renderAccounts();
    expect(screen.queryByRole("heading", { name: "Guardian accounts" })).toBeNull();
    expect(axiosMocks.get).not.toHaveBeenCalled();
  });

  it("renders five states and only the actions allowed by the 4C contract", async () => {
    axiosMocks.get.mockResolvedValueOnce({
      data: [
        row("none", "No Account", "none"),
        row("invited", "Pending Account", "invited"),
        row("expired", "Expired Account", "expired"),
        row("active", "Active Account", "active"),
        row("disabled", "Disabled Account", "disabled"),
      ],
    });
    renderAccounts();

    expect(await screen.findByText("No account")).not.toBeNull();
    expect(screen.getByText("Awaiting invitation acceptance")).not.toBeNull();
    expect(screen.getByText("Invitation expired")).not.toBeNull();
    expect(screen.getByText("Active")).not.toBeNull();
    expect(screen.getByText("Disabled")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Send invitation for No Account" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Resend invitation for Pending Account" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Resend invitation for Expired Account" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: /Active Account/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Disabled Account/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Forgot password" }).getAttribute("href")).toBe(
      "/forgot-password?kind=guardian"
    );
  });
});

describe("guardian initial invitation", () => {
  it("uses the creation endpoint once and updates the row locally after 201", async () => {
    const user = userEvent.setup();
    axiosMocks.get.mockResolvedValueOnce({ data: [row("none", "No Account", "none")] });
    let resolveCreate!: (value: unknown) => void;
    const pending = new Promise((resolve) => { resolveCreate = resolve; });
    axiosMocks.post.mockReturnValueOnce(pending);
    renderAccounts();

    const button = await screen.findByRole("button", { name: "Send invitation for No Account" });
    await user.click(button);
    await user.click(button);
    expect(axiosMocks.post).toHaveBeenCalledTimes(1);
    expect(axiosMocks.post).toHaveBeenCalledWith("/api/guardian-accounts", {
      guardianId: "guardian-none",
    });

    await act(async () => {
      resolveCreate({
        status: 201,
        data: {
          id: "created-account",
          email: "none@example.test",
          phone: null,
          invitationSent: true,
          deliveryStatus: "sent",
          token: "must-not-render",
          tokenHash: "must-not-render-hash",
          password: "must-not-render-password",
        },
      });
      await pending;
    });

    expect(await screen.findByText("Awaiting invitation acceptance")).not.toBeNull();
    expect(screen.getByText(/account was created and an invitation was sent/i)).not.toBeNull();
    expect(screen.getByRole("button", { name: "Resend invitation for No Account" })).not.toBeNull();
    expect(axiosMocks.get).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toMatch(/must-not-render/);
  });

  it("keeps the locally-created pending row and reports a 207 delivery failure", async () => {
    const user = userEvent.setup();
    axiosMocks.get.mockResolvedValueOnce({ data: [row("none", "No Account", "none")] });
    axiosMocks.post.mockResolvedValueOnce({
      status: 207,
      data: {
        id: "created-account",
        email: "none@example.test",
        phone: null,
        invitationSent: false,
        deliveryStatus: "failed",
      },
    });
    renderAccounts();
    await user.click(await screen.findByRole("button", { name: "Send invitation for No Account" }));
    expect(await screen.findByText(/account was created, but the invitation email/i)).not.toBeNull();
    expect(screen.getByText("Awaiting invitation acceptance")).not.toBeNull();
  });

  it.each([
    [409, "The account could not be created or updated in its current state."],
    [422, "Add a valid guardian email address before sending the invitation."],
    [429, "Too many attempts. Please wait before trying again."],
  ])("shows a clear %s response", async (status, message) => {
    const user = userEvent.setup();
    axiosMocks.get.mockResolvedValueOnce({ data: [row("none", "No Account", "none")] });
    axiosMocks.post.mockRejectedValueOnce({ response: { status, data: {} } });
    renderAccounts();
    await user.click(await screen.findByRole("button", { name: "Send invitation for No Account" }));
    expect((await screen.findByRole("alert")).textContent).toContain(message);
    expect(screen.getByText("No account")).not.toBeNull();
  });
});

describe("guardian invitation resend", () => {
  it("uses only the resend endpoint, locks duplicate clicks, and updates expired to pending", async () => {
    const user = userEvent.setup();
    axiosMocks.get.mockResolvedValueOnce({ data: [row("expired", "Expired Account", "expired")] });
    let resolveResend!: (value: unknown) => void;
    const pending = new Promise((resolve) => { resolveResend = resolve; });
    axiosMocks.post.mockReturnValueOnce(pending);
    renderAccounts();

    const button = await screen.findByRole("button", { name: "Resend invitation for Expired Account" });
    await user.click(button);
    await user.click(button);
    expect(axiosMocks.post).toHaveBeenCalledTimes(1);
    expect(axiosMocks.post).toHaveBeenCalledWith(
      "/api/guardian-accounts/account-expired/invite"
    );

    await act(async () => {
      resolveResend({ status: 200, data: { sent: true, deliveryStatus: "sent" } });
      await pending;
    });
    await waitFor(() => expect(screen.getByText("Awaiting invitation acceptance")).not.toBeNull());
    expect(screen.queryByText("Invitation expired")).toBeNull();
    expect(axiosMocks.get).toHaveBeenCalledTimes(1);
  });

  it("keeps the renewed pending state when resend returns 207", async () => {
    const user = userEvent.setup();
    axiosMocks.get.mockResolvedValueOnce({ data: [row("expired", "Expired Account", "expired")] });
    axiosMocks.post.mockResolvedValueOnce({
      status: 207,
      data: { sent: false, deliveryStatus: "failed" },
    });
    renderAccounts();
    await user.click(
      await screen.findByRole("button", { name: "Resend invitation for Expired Account" })
    );
    expect(await screen.findByText(/invitation was renewed, but the email/i)).not.toBeNull();
    expect(screen.getByText("Awaiting invitation acceptance")).not.toBeNull();
  });
});
