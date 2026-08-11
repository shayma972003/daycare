// @vitest-environment jsdom

import { type ReactNode } from "react";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PermissionsPage from "@/app/(dashboard)/settings/permissions/page";
import { LocaleProvider } from "@/lib/i18n-provider";

const axiosMocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  isAxiosError: vi.fn(
    (error: unknown) => Boolean(error && typeof error === "object" && "response" in error)
  ),
  isCancel: vi.fn(() => false),
}));

const permissionMocks = vi.hoisted(() => ({ invalidatePermissions: vi.fn() }));

vi.mock("axios", () => ({ default: axiosMocks }));
vi.mock("@/lib/use-permissions", () => ({
  invalidatePermissions: permissionMocks.invalidatePermissions,
}));
vi.mock("@/components/layout/Topbar", () => ({
  Topbar: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
vi.mock("@/components/accounts/GuardianAccounts", () => ({
  GuardianAccounts: () => null,
}));
vi.mock("@/components/auth/PermissionGate", () => ({
  PermissionGate: ({ children }: { children?: ReactNode }) => children ?? null,
}));

type AccountState = "none" | "invited" | "expired" | "active" | "disabled";

interface StaffFixture {
  id: string;
  name: string;
  email: string;
  teacherId: string | null;
  disabled: boolean;
  state: AccountState;
  isSelf: boolean;
  role: { id: string; nameAr: string; isOwner: boolean } | null;
}

const rolesResponse = {
  roles: [
    {
      id: "role-1",
      key: "teacher",
      nameAr: "Teacher",
      permissions: ["students.view"],
      isSystem: false,
      userCount: 1,
    },
    {
      id: "role-2",
      key: "office",
      nameAr: "Office",
      permissions: ["staff.view"],
      isSystem: false,
      userCount: 0,
    },
    {
      id: "owner-role",
      key: "owner",
      nameAr: "Owner",
      permissions: ["*"],
      isSystem: true,
      userCount: 1,
    },
  ],
  catalogue: [],
  categoryLabels: {},
};

let staffRows: StaffFixture[] = [];

function staff(
  id: string,
  name: string,
  state: AccountState,
  overrides: Partial<StaffFixture> = {}
): StaffFixture {
  return {
    id,
    name,
    email: `${id}@example.test`,
    teacherId: null,
    disabled: state === "disabled",
    state,
    isSelf: false,
    role: { id: "role-1", nameAr: "Teacher", isOwner: false },
    ...overrides,
  };
}

function renderPage() {
  return render(
    <LocaleProvider initialLocale="en">
      <PermissionsPage />
    </LocaleProvider>
  );
}

async function openCreateDialog(user: ReturnType<typeof userEvent.setup>) {
  const trigger = await screen.findByRole("button", { name: "Add account" });
  await user.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "New staff account" });
  await user.type(within(dialog).getByLabelText("Name"), "New Staff");
  await user.type(within(dialog).getByLabelText("Email"), "new.staff@example.test");
  return { dialog, trigger };
}

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  staffRows = [];
  axiosMocks.get.mockImplementation((url: string) => {
    if (url === "/api/roles") return Promise.resolve({ data: rolesResponse });
    if (url === "/api/staff-accounts") return Promise.resolve({ data: staffRows });
    if (url === "/api/teachers") return Promise.resolve({ data: { teachers: [] } });
    return Promise.reject(new Error(`Unexpected GET in staff account UI test: ${url}`));
  });
  axiosMocks.put.mockResolvedValue({ status: 200, data: {} });
  permissionMocks.invalidatePermissions.mockResolvedValue(undefined);
});

describe("staff invitation-only account creation UI", () => {
  it("has no password field, explains the email invitation, and restores focus on Escape", async () => {
    const user = userEvent.setup();
    renderPage();

    const { dialog, trigger } = await openCreateDialog(user);
    expect(within(dialog).queryByLabelText(/password/i)).toBeNull();
    expect(
      within(dialog).getByText(
        "The staff member will receive an email invitation and choose their own password."
      )
    ).not.toBeNull();
    expect(dialog.contains(document.activeElement)).toBe(true);

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it.each([
    [201, true, "Account created and the invitation was sent to new.staff@example.test"],
    [
      207,
      false,
      "Account created, but the invitation email to new.staff@example.test could not be sent. You can resend it from the account row.",
    ],
  ] as const)("handles a %s creation result without sending a password", async (status, sent, message) => {
    const user = userEvent.setup();
    axiosMocks.post.mockResolvedValueOnce({
      status,
      data: {
        id: "new-staff",
        invitationSent: sent,
        deliveryStatus: sent ? "sent" : "failed",
        token: "must-not-render",
        tokenHash: "must-not-render-hash",
        password: "must-not-render-password",
      },
    });
    renderPage();

    const { dialog } = await openCreateDialog(user);
    await user.click(
      within(dialog).getByRole("button", { name: "Create account and send invitation" })
    );

    expect(await screen.findByText(message)).not.toBeNull();
    expect(axiosMocks.post).toHaveBeenCalledWith("/api/staff-accounts", {
      name: "New Staff",
      email: "new.staff@example.test",
      roleId: "role-1",
    });
    const payload = axiosMocks.post.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("password");
    expect(document.body.textContent).not.toMatch(/must-not-render/);
  });

  it.each([
    [409, {}, "That email address is already in use"],
    [
      422,
      { error: { fieldErrors: { name: ["The staff name is invalid"] } } },
      "The staff name is invalid",
    ],
  ] as const)("shows a clear %s API error and keeps the form open", async (status, data, message) => {
    const user = userEvent.setup();
    axiosMocks.post.mockRejectedValueOnce({ response: { status, data } });
    renderPage();

    const { dialog } = await openCreateDialog(user);
    await user.click(
      within(dialog).getByRole("button", { name: "Create account and send invitation" })
    );

    expect((await within(dialog).findByRole("alert")).textContent).toContain(message);
    expect(screen.getByRole("dialog", { name: "New staff account" })).not.toBeNull();
  });
});

describe("staff invitation states and account actions", () => {
  it("renders all five states and offers resend only to eligible pending accounts", async () => {
    staffRows = [
      staff("active", "Active Staff", "active"),
      staff("invited", "Invited Staff", "invited"),
      staff("expired", "Expired Staff", "expired"),
      staff("none", "Never Invited Staff", "none"),
      staff("disabled", "Disabled Staff", "disabled"),
      staff("owner", "Owner Staff", "expired", {
        role: { id: "owner-role", nameAr: "Owner", isOwner: true },
      }),
      staff("self", "Current Staff", "expired", { isSelf: true }),
    ];
    renderPage();

    expect(await screen.findByText("Awaiting invitation acceptance")).not.toBeNull();
    expect(screen.getAllByText("Invitation expired")).toHaveLength(3);
    expect(screen.getByText("Active")).not.toBeNull();
    expect(screen.getByText("Disabled")).not.toBeNull();
    expect(screen.getByText("No active invitation")).not.toBeNull();

    expect(screen.getByRole("button", { name: "Resend invitation for Invited Staff" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Resend invitation for Expired Staff" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Send invitation for Never Invited Staff" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: /invitation for Active Staff/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /invitation for Disabled Staff/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /invitation for Owner Staff/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /invitation for Current Staff/ })).toBeNull();
  });

  it("prevents duplicate resend requests and updates the row state locally", async () => {
    const user = userEvent.setup();
    staffRows = [staff("pending", "Pending Staff", "expired")];
    let resolveResend!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      resolveResend = resolve;
    });
    axiosMocks.post.mockReturnValueOnce(pending);
    renderPage();

    const resend = await screen.findByRole("button", {
      name: "Resend invitation for Pending Staff",
    });
    await user.click(resend);
    await user.click(resend);
    expect(axiosMocks.post).toHaveBeenCalledTimes(1);
    expect((resend as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      resolveResend({ status: 200, data: { sent: true, deliveryStatus: "sent" } });
      await pending;
    });

    expect(await screen.findByText("Awaiting invitation acceptance")).not.toBeNull();
    expect(screen.queryByText("Invitation expired")).toBeNull();
    expect(axiosMocks.get.mock.calls.filter(([url]) => url === "/api/staff-accounts")).toHaveLength(1);
  });

  it("keeps role changes and account disabling wired to their existing payloads", async () => {
    const user = userEvent.setup();
    staffRows = [staff("staff-1", "Staff One", "invited")];
    renderPage();

    const role = await screen.findByRole("combobox", { name: "Change role for Staff One" });
    await user.selectOptions(role, "role-2");
    await waitFor(() =>
      expect(axiosMocks.put).toHaveBeenCalledWith("/api/staff-accounts/staff-1", {
        roleId: "role-2",
      })
    );
    expect(permissionMocks.invalidatePermissions).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Disable account for Staff One" }));
    await waitFor(() =>
      expect(axiosMocks.put).toHaveBeenCalledWith("/api/staff-accounts/staff-1", {
        disabled: true,
      })
    );
  });
});
