// @vitest-environment jsdom

import { Suspense, type ReactNode } from "react";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LocaleProvider } from "@/lib/i18n-provider";
import AdminSchoolsPage from "@/app/admin/(protected)/schools/page";
import ActivatePage from "@/app/activate/[token]/page";

const axiosMocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  isAxiosError: vi.fn((error: unknown) =>
    Boolean(error && typeof error === "object" && "response" in error)
  ),
  isCancel: vi.fn(() => false),
}));

const routerMocks = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("axios", () => ({
  default: axiosMocks,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMocks,
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  axiosMocks.get.mockReset();
  axiosMocks.post.mockReset();
  axiosMocks.get.mockImplementation((url: string) => {
    if (url === "/api/admin/schools") return Promise.resolve({ data: [] });
    return Promise.reject(new Error(`Unexpected GET in invitation UI test: ${url}`));
  });
});

function inEnglish(children: ReactNode) {
  return <LocaleProvider initialLocale="en">{children}</LocaleProvider>;
}

function school(
  id: string,
  name: string,
  invitationStatus: "active" | "pending" | "expired" | "revoked" | "none"
) {
  return {
    id,
    name,
    email: `${id}@example.test`,
    plan: null,
    subscription_status: "active",
    renewal_date: null,
    last_login_at: null,
    createdAt: "2026-08-11T00:00:00.000Z",
    studentCount: 0,
    teacherCount: 0,
    invitation_status: invitationStatus,
  };
}

async function reachCreateAction(user: ReturnType<typeof userEvent.setup>) {
  const dialog = screen.getByRole("dialog", { name: "Create a nursery account" });
  const name = dialog.querySelector<HTMLInputElement>("input:not([type])");
  const email = dialog.querySelector<HTMLInputElement>('input[type="email"]');
  expect(name).not.toBeNull();
  expect(email).not.toBeNull();
  await user.type(name!, "Safe nursery");
  await user.type(email!, "owner@example.test");

  for (let step = 0; step < 3; step += 1) {
    const advance = dialog.querySelector<HTMLButtonElement>("button.flex-1");
    expect(advance).not.toBeNull();
    await user.click(advance!);
  }

  const create = dialog.querySelector<HTMLButtonElement>("button.flex-1");
  expect(create).not.toBeNull();
  return create!;
}

describe("school administrator invitation UI", () => {
  it("contains no temporary-password display or copy implementation", () => {
    const source = readFileSync(
      "src/app/admin/(protected)/schools/page.tsx",
      "utf8"
    );

    expect(source).not.toMatch(/tempPassword/i);
    expect(source).not.toMatch(/clipboard|writeText/i);
    expect(source).not.toMatch(/temporary password/i);
  });

  it("uses the accessible shared dialog and restores focus after Escape", async () => {
    const user = userEvent.setup();
    render(inEnglish(<AdminSchoolsPage />));

    const trigger = screen.getByRole("button", { name: /Create an account/ });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Create a nursery account" });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it.each([
    ["sent", "Nursery created and invitation sent"],
    ["failed", "Nursery created, but email delivery failed"],
  ] as const)(
    "shows the real %s email-delivery result after creation",
    async (emailDelivery, expectedTitle) => {
      const user = userEvent.setup();
      axiosMocks.post.mockResolvedValueOnce({
        status: emailDelivery === "sent" ? 201 : 207,
        data: {
          id: "school-new",
          name: "Safe nursery",
          email: "owner@example.test",
          invitationStatus: "pending",
          emailDelivery,
        },
      });
      render(inEnglish(<AdminSchoolsPage />));

      await user.click(screen.getByRole("button", { name: /Create an account/ }));
      await user.click(await reachCreateAction(user));

      expect(await screen.findByText(expectedTitle)).not.toBeNull();
      expect(screen.getByText("Awaiting acceptance")).not.toBeNull();
      expect(axiosMocks.post).toHaveBeenCalledWith(
        "/api/admin/schools",
        expect.objectContaining({
          schoolName: "Safe nursery",
          email: "owner@example.test",
        })
      );
    }
  );

  it("shows the duplicate-email response without exposing credentials", async () => {
    const user = userEvent.setup();
    axiosMocks.post.mockRejectedValueOnce({ response: { status: 409, data: {} } });
    render(inEnglish(<AdminSchoolsPage />));

    await user.click(screen.getByRole("button", { name: /Create an account/ }));
    await user.click(await reachCreateAction(user));

    expect(await screen.findByText("That email address is already in use")).not.toBeNull();
    expect(screen.queryByLabelText(/temporary password/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /copy password/i })).toBeNull();
  });

  it("shows resend only for inactive accounts and prevents duplicate requests", async () => {
    const user = userEvent.setup();
    axiosMocks.get.mockResolvedValueOnce({
      data: [
        school("active-school", "Active nursery", "active"),
        school("expired-school", "Expired nursery", "expired"),
      ],
    });

    let resolveResend!: (value: unknown) => void;
    const pendingResend = new Promise((resolve) => {
      resolveResend = resolve;
    });
    axiosMocks.post.mockReturnValueOnce(pendingResend);
    render(inEnglish(<AdminSchoolsPage />));

    await screen.findByText("Expired nursery");
    const resend = screen.getByRole("button", { name: "Resend invitation" });
    expect(screen.getAllByRole("button", { name: "Resend invitation" })).toHaveLength(1);

    await user.click(resend);
    await user.click(resend);
    expect(axiosMocks.post).toHaveBeenCalledTimes(1);
    expect(axiosMocks.post).toHaveBeenCalledWith(
      "/api/admin/schools/expired-school/invite"
    );
    expect((resend as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      resolveResend({
        status: 200,
        data: { invitationStatus: "pending", emailDelivery: "sent" },
      });
      await pendingResend;
    });

    expect(await screen.findByText("A new invitation was sent.")).not.toBeNull();
    expect(screen.getByText("Awaiting acceptance")).not.toBeNull();
    expect(axiosMocks.get).toHaveBeenCalledTimes(1);
  });

  it("reports a resend failure and keeps the existing row state", async () => {
    const user = userEvent.setup();
    axiosMocks.get.mockResolvedValueOnce({
      data: [school("revoked-school", "Revoked nursery", "revoked")],
    });
    axiosMocks.post.mockRejectedValueOnce({ response: { status: 503, data: {} } });
    render(inEnglish(<AdminSchoolsPage />));

    await screen.findByText("Revoked nursery");
    await user.click(screen.getByRole("button", { name: "Resend invitation" }));

    expect(await screen.findByText("Could not resend the invitation.")).not.toBeNull();
    expect(screen.getByText("Revoked")).not.toBeNull();
    expect(axiosMocks.get).toHaveBeenCalledTimes(1);
  });
});

async function renderActivation(inviteResult: unknown) {
  axiosMocks.get.mockResolvedValueOnce({ data: inviteResult });
  const params = Promise.resolve({ token: "opaque-token" });
  await act(async () => {
    render(
      inEnglish(
        <Suspense fallback={<p>Suspended</p>}>
          <ActivatePage params={params} />
        </Suspense>
      )
    );
    await params;
  });
  return screen.findByText("Nursery administrator invitation");
}

describe("school administrator activation page", () => {
  it("sets the first password through the 3A route and shows a safe success state", async () => {
    const user = userEvent.setup();
    axiosMocks.post.mockResolvedValueOnce({ status: 200, data: { success: true } });
    await renderActivation({
      kind: "school_admin",
      name: "School owner",
      email: "owner@example.test",
      schoolName: "Safe nursery",
    });

    await user.type(screen.getByLabelText("Password"), "ValidPass1!");
    await user.type(screen.getByLabelText("Confirm password"), "ValidPass1!");
    await user.click(screen.getByRole("button", { name: "Set password" }));

    expect(axiosMocks.post).toHaveBeenCalledWith(
      "/api/activate/opaque-token",
      { password: "ValidPass1!" }
    );
    expect(await screen.findByText("Your account is active")).not.toBeNull();
    expect(document.body.textContent).not.toContain("opaque-token");
    await waitFor(
      () => expect(routerMocks.replace).toHaveBeenCalledWith("/login"),
      { timeout: 2500 }
    );
  });

  it.each(["expired", "used", "revoked"])(
    "shows the non-disclosing invalid state for a %s invitation",
    async (reason) => {
      axiosMocks.get.mockRejectedValueOnce({
        response: { status: 410, data: { reason } },
      });
      const params = Promise.resolve({ token: "opaque-token" });
      await act(async () => {
        render(
          inEnglish(
            <Suspense fallback={<p>Suspended</p>}>
              <ActivatePage params={params} />
            </Suspense>
          )
        );
        await params;
      });

      expect(await screen.findByText("Invalid invitation")).not.toBeNull();
      expect(
        screen.getByText(
          "This link may have expired, already been used, or been revoked. Ask the administrator for a new invitation."
        )
      ).not.toBeNull();
      expect(document.body.textContent).not.toContain("opaque-token");
    }
  );

  it("does not submit when password confirmation differs", async () => {
    const user = userEvent.setup();
    await renderActivation({
      kind: "school_admin",
      name: "School owner",
      email: "owner@example.test",
      schoolName: "Safe nursery",
    });

    await user.type(screen.getByLabelText("Password"), "ValidPass1!");
    await user.type(screen.getByLabelText("Confirm password"), "Different1!");
    await user.click(screen.getByRole("button", { name: "Set password" }));

    expect(await screen.findByText("The passwords do not match")).not.toBeNull();
    expect(axiosMocks.post).not.toHaveBeenCalled();
  });

  it("keeps a guardian out of the staff login flow after activation", async () => {
    const user = userEvent.setup();
    axiosMocks.get.mockResolvedValueOnce({
      data: {
        kind: "guardian",
        name: "Guardian One",
        email: "guardian@example.test",
        schoolName: "Safe nursery",
      },
    });
    axiosMocks.post.mockResolvedValueOnce({
      status: 200,
      data: { success: true, token: "must-not-render", tokenHash: "must-not-render-hash" },
    });
    const params = Promise.resolve({ token: "opaque-guardian-token" });
    await act(async () => {
      render(
        inEnglish(
          <Suspense fallback={<p>Suspended</p>}>
            <ActivatePage params={params} />
          </Suspense>
        )
      );
      await params;
    });

    expect(await screen.findByText("Guardian invitation")).not.toBeNull();
    await user.type(screen.getByLabelText("Password"), "ValidPass1!");
    await user.type(screen.getByLabelText("Confirm password"), "ValidPass1!");
    await user.click(screen.getByRole("button", { name: "Set password" }));

    expect(await screen.findByText("Your account is active")).not.toBeNull();
    expect(screen.getByText(/guardian account is ready to use/i)).not.toBeNull();
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
    expect(routerMocks.replace).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toMatch(/opaque-guardian-token|must-not-render/);
  });
});
