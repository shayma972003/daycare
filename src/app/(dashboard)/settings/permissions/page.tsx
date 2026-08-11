"use client";

/**
 * Staff accounts and permissions (task 1.6).
 *
 * Two panes because they answer two different questions: "who can sign in" and
 * "what does each role allow". Merging them into a per-person checkbox grid is
 * the obvious design and the wrong one — permissions would then be set twelve
 * times for twelve teachers and drift apart, which is the problem roles exist to
 * prevent.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import axios from "axios";
import { Topbar } from "@/components/layout/Topbar";
import { GuardianAccounts } from "@/components/accounts/GuardianAccounts";
import { PermissionGate } from "@/components/auth/PermissionGate";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  closeDialogOnOpenChange,
} from "@/components/ui/Dialog";
import { describeApiError } from "@/lib/api-error";
import type { PermissionDefinition, PermissionCategory, CapabilityBundle } from "@/lib/permissions";
import { CAPABILITY_BUNDLES, keysOutsideBundles } from "@/lib/permissions";
import { useT } from "@/lib/i18n-provider";
import { invalidatePermissions } from "@/lib/use-permissions";

interface RoleRow {
  id: string;
  key: string;
  nameAr: string;
  permissions: string[];
  isSystem: boolean;
  userCount: number;
}

interface RolesResponse {
  roles: RoleRow[];
  catalogue: PermissionDefinition[];
  categoryLabels: Record<PermissionCategory, string>;
}

interface StaffRow {
  id: string;
  name: string;
  email: string;
  teacherId: string | null;
  disabled: boolean;
  /** Five states, not a boolean — see accountState() in src/lib/invitations.ts. */
  state: "none" | "invited" | "expired" | "active" | "disabled";
  isSelf: boolean;
  role: { id: string; nameAr: string; isOwner: boolean } | null;
}

interface PageNotice {
  message: string;
  tone: "success" | "warning";
}

/**
 * What the nursery sees next to a name.
 *
 * "Invited" and "expired" look the same to a school that only has an on/off
 * flag, and they need opposite responses: wait, or send again. Keeping them
 * apart here is the whole reason the API reports a state rather than a boolean.
 */
const STATE_CLASS: Record<StaffRow["state"], string> = {
  active: "text-emerald-600",
  invited: "text-amber-600",
  expired: "text-orange-600",
  none: "text-gray-500",
  disabled: "text-red-500",
};

const OWNER_WILDCARD = "*";

export default function PermissionsPage() {
  const t = useT();
  const [data, setData] = useState<RolesResponse | null>(null);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<PageNotice | null>(null);

  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const inviteTriggerRef = useRef<HTMLButtonElement>(null);
  /** The id currently being invited, so only that row's button shows progress. */
  const [inviting, setInviting] = useState<string | null>(null);
  const invitingIds = useRef(new Set<string>());

  const load = useCallback(async () => {
    try {
      const [rolesRes, staffRes] = await Promise.all([
        axios.get<RolesResponse>("/api/roles"),
        axios.get<StaffRow[]>("/api/staff-accounts"),
      ]);
      setData(rolesRes.data);
      setStaff(staffRes.data);
      setError(null);
      setSelectedRoleId((current) => current ?? rolesRes.data.roles[0]?.id ?? null);
    } catch (err) {
      setError(describeApiError(err, t("permissions.loadFailed")));
    }
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      axios.get<RolesResponse>("/api/roles"),
      axios.get<StaffRow[]>("/api/staff-accounts"),
    ])
      .then(([rolesRes, staffRes]) => {
        if (cancelled) return;
        setData(rolesRes.data);
        setStaff(staffRes.data);
        setSelectedRoleId(rolesRes.data.roles[0]?.id ?? null);
      })
      .catch((err) => {
        if (!cancelled) setError(describeApiError(err, t("permissions.loadFailed")));
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  const selectedRole = data?.roles.find((r) => r.id === selectedRoleId) ?? null;
  const isOwnerRole = selectedRole?.permissions.includes(OWNER_WILDCARD) ?? false;

  async function setDisabled(user: StaffRow, disabled: boolean) {
    setError(null);
    try {
      await axios.put(`/api/staff-accounts/${user.id}`, { disabled });
      await load();
    } catch (err) {
      setError(describeApiError(err, t("permissions.updateFailed")));
    }
  }

  async function resendInvite(user: StaffRow) {
    if (invitingIds.current.has(user.id)) return;
    invitingIds.current.add(user.id);
    setError(null);
    setNotice(null);
    setInviting(user.id);
    try {
      const res = await axios.post<{ sent: boolean; deliveryStatus: "sent" | "failed" }>(
        `/api/staff-accounts/${user.id}/invite`
      );
      setStaff((current) =>
        current.map((row) => (row.id === user.id ? { ...row, state: "invited" } : row))
      );
      setNotice({
        message: res.data.sent
          ? t("permissions.resendSent", { email: user.email })
          : t("permissions.resendFailed", { email: user.email }),
        tone: res.data.sent ? "success" : "warning",
      });
    } catch (err) {
      setError(describeApiError(err, t("permissions.resendError")));
    } finally {
      invitingIds.current.delete(user.id);
      setInviting(null);
    }
  }

  function canResendInvite(user: StaffRow) {
    return (
      !user.disabled &&
      !user.isSelf &&
      !user.role?.isOwner &&
      (user.state === "none" || user.state === "invited" || user.state === "expired")
    );
  }

  async function changeRole(user: StaffRow, roleId: string) {
    setError(null);
    try {
      await axios.put(`/api/staff-accounts/${user.id}`, { roleId });
      await invalidatePermissions();
      setNotice({
        message: t("permissions.roleUpdated", { name: user.name }),
        tone: "success",
      });
      await load();
    } catch (err) {
      setError(describeApiError(err, t("permissions.roleChangeFailed")));
    }
  }

  const grouped = data
    ? data.catalogue.reduce<Record<string, PermissionDefinition[]>>((acc, permission) => {
        (acc[permission.category] ??= []).push(permission);
        return acc;
      }, {})
    : {};

  return (
    <div className="min-h-screen bg-brand-bg">
      <Topbar title={t("permissions.title")} />

      <div className="space-y-6 p-3 sm:p-6">
        {error && (
          <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
            {error}
          </div>
        )}
        {notice && (
          <div
            role="status"
            className={`rounded-xl border p-3 text-sm ${
              notice.tone === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-amber-200 bg-amber-50 text-amber-800"
            }`}
          >
            {notice.message}
          </div>
        )}

        {!data ? (
          <div className="py-20 text-center text-sm text-gray-400">{t("common.loadingDots")}</div>
        ) : (
          <>
            {/* ── Staff accounts ─────────────────────────────────────────── */}
            <section className="rounded-2xl bg-white p-4 shadow-sm sm:p-6">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-bold text-[#111111]">{t("permissions.staffAccounts")}</h2>
                <PermissionGate permission="staff.manage">
                  <button
                    ref={inviteTriggerRef}
                    onClick={() => setShowInvite(true)}
                    className="px-4 py-2 bg-[#2F96A6] text-white rounded-xl text-sm font-medium hover:bg-[#26808e]"
                  >
                    {t("permissions.addAccount")}
                  </button>
                </PermissionGate>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[620px]">
                  <thead>
                    <tr className="border-b border-gray-100 text-gray-500">
                      {[t("students.columns.name"), t("fields.mail"), t("fields.role"), t("home.status"), ""].map((h) => (
                        <th key={h} className="px-3 py-2 text-start font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {staff.map((user) => (
                      <tr key={user.id}>
                        <td className="px-3 py-3 text-[#111111]">
                          {user.name}
                          {user.isSelf && <span className="text-xs text-gray-400"> {t("fields.you")}</span>}
                        </td>
                        <td className="px-3 py-3 text-gray-600" dir="ltr">{user.email}</td>
                        <td className="px-3 py-3">
                          {user.role?.isOwner ? (
                            // The owner's role is fixed — see the guard on the API.
                            <span className="text-gray-500">{user.role.nameAr}</span>
                          ) : (
                            <PermissionGate
                              permission="staff.manage"
                              fallback={
                                <span className="text-gray-500">
                                  {user.role?.nameAr ?? t("permissions.noRole")}
                                </span>
                              }
                            >
                              <select
                                aria-label={t("permissions.changeRoleFor", { name: user.name })}
                                value={user.role?.id ?? ""}
                                onChange={(e) => changeRole(user, e.target.value)}
                                className="border border-gray-200 rounded-lg px-2 py-1 text-sm"
                              >
                                <option value="" disabled>{t("permissions.noRole")}</option>
                                {data.roles
                                  .filter((role) => !role.permissions.includes(OWNER_WILDCARD))
                                  .map((role) => (
                                    <option key={role.id} value={role.id}>{role.nameAr}</option>
                                  ))}
                              </select>
                            </PermissionGate>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <span className={STATE_CLASS[user.state]}>
                            {t(`permissions.accountStates.${user.state}`)}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <PermissionGate permission="staff.manage">
                            <div className="flex flex-wrap items-center gap-3">
                              {canResendInvite(user) && (
                                <button
                                  onClick={() => resendInvite(user)}
                                  disabled={inviting === user.id}
                                  aria-label={t(
                                    user.state === "none"
                                      ? "permissions.sendInviteFor"
                                      : "permissions.resendInviteFor",
                                    { name: user.name }
                                  )}
                                  className="text-xs text-[#2F96A6] hover:underline disabled:opacity-50"
                                >
                                  {inviting === user.id
                                    ? t("permissions.sendingInvite")
                                    : user.state === "none"
                                      ? t("permissions.sendInvite")
                                      : t("permissions.resendInvite")}
                                </button>
                              )}
                              {!user.role?.isOwner && !user.isSelf && (
                                <button
                                  onClick={() => setDisabled(user, !user.disabled)}
                                  aria-label={t(
                                    user.disabled
                                      ? "permissions.enableAccountFor"
                                      : "permissions.disableAccountFor",
                                    { name: user.name }
                                  )}
                                  className="text-xs text-[#2F96A6] hover:underline"
                                >
                                  {user.disabled ? t("permissions.enable") : t("permissions.disable")}
                                </button>
                              )}
                            </div>
                          </PermissionGate>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* ── Guardian accounts ──────────────────────────────────────────
                Beside the staff table, because a nursery asking "who can sign
                in" means both. Hides itself if this account may not read
                guardian records. */}
            <GuardianAccounts />

            {/* ── Roles ──────────────────────────────────────────────────── */}
            <section className="bg-white rounded-2xl shadow-sm p-6">
              <h2 className="font-bold text-[#111111] mb-4">{t("permissions.rolesTitle")}</h2>

              <div className="flex flex-wrap gap-2 mb-5">
                {data.roles.map((role) => (
                  <button
                    key={role.id}
                    onClick={() => setSelectedRoleId(role.id)}
                    className={`px-4 py-2 rounded-xl text-sm transition-colors ${
                      role.id === selectedRoleId
                        ? "bg-[#2F96A6] text-white"
                        : "bg-gray-50 text-gray-600 hover:bg-gray-100"
                    }`}
                  >
                    {role.nameAr}
                    <span className="text-xs opacity-70"> ({role.userCount})</span>
                  </button>
                ))}
              </div>

              {isOwnerRole ? (
                <p className="text-sm text-gray-500 bg-gray-50 rounded-xl p-4">
                  {t("permissions.ownerRoleLocked")}
                </p>
              ) : selectedRole ? (
                /* Keyed on the role id so switching roles remounts the editor
                   with fresh state. Resetting a draft from an effect instead
                   would fire a second render on every selection — and React
                   flags it, correctly, as a cascading update. */
                <RolePermissionEditor
                  key={selectedRole.id}
                  role={selectedRole}
                  grouped={grouped}
                  categoryLabels={data.categoryLabels}
                  onSaved={async (message) => {
                    setNotice({ message, tone: "success" });
                    setError(null);
                    await load();
                  }}
                  onError={setError}
                />
              ) : null}
            </section>
          </>
        )}
      </div>

      {showInvite && data && (
        <InviteStaffModal
          roles={data.roles.filter((r) => !r.permissions.includes(OWNER_WILDCARD))}
          returnFocusRef={inviteTriggerRef}
          onClose={() => setShowInvite(false)}
          onCreated={(message, delivered) => {
            setShowInvite(false);
            setNotice({ message, tone: delivered ? "success" : "warning" });
            load();
          }}
        />
      )}
    </div>
  );
}

/**
 * The checkbox grid for one role.
 *
 * Separate component so the parent can remount it with `key={role.id}` — the
 * draft then starts from the selected role's permissions with no effect and no
 * extra render pass.
 */
function RolePermissionEditor({
  role,
  grouped,
  categoryLabels,
  onSaved,
  onError,
}: {
  role: RoleRow;
  grouped: Record<string, PermissionDefinition[]>;
  categoryLabels: Record<PermissionCategory, string>;
  onSaved: (message: string) => Promise<void> | void;
  onError: (message: string) => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState<string[]>(role.permissions);
  const [saving, setSaving] = useState(false);
  /* Simple by default. The full grid is a click away and never goes anywhere —
     see CAPABILITY_BUNDLES for why one is a view over the other. */
  const [advanced, setAdvanced] = useState(false);

  function toggle(key: string) {
    setDraft((current) =>
      current.includes(key) ? current.filter((k) => k !== key) : [...current, key]
    );
  }

  /** A bundle is on only when every key it stands for is held. */
  function bundleOn(bundle: CapabilityBundle) {
    return bundle.keys.every((key) => draft.includes(key));
  }

  function toggleBundle(bundle: CapabilityBundle) {
    const on = bundleOn(bundle);
    setDraft((current) =>
      on
        ? current.filter((key) => !bundle.keys.includes(key))
        : Array.from(new Set([...current, ...bundle.keys]))
    );
  }

  /* Held keys this view cannot draw. Counted and shown rather than ignored: the
     user is entitled to know the role carries more than the boxes in front of
     them, and that saving here will not disturb it. */
  const hiddenCount = keysOutsideBundles(draft).length;

  async function save() {
    setSaving(true);
    try {
      await axios.put(`/api/roles/${role.id}`, { permissions: draft });
      await invalidatePermissions();
      await onSaved(t("permissions.roleSaved", { role: role.nameAr }));
    } catch (err) {
      onError(describeApiError(err, t("permissions.saveFailed")));
    } finally {
      setSaving(false);
    }
  }

  if (!advanced) {
    return (
      <>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {CAPABILITY_BUNDLES.map((bundle) => (
            <label
              key={bundle.key}
              className="flex items-start gap-2.5 text-sm text-gray-700 border border-gray-100 rounded-xl px-4 py-3 cursor-pointer hover:bg-gray-50"
            >
              <input
                type="checkbox"
                checked={bundleOn(bundle)}
                onChange={() => toggleBundle(bundle)}
                className="mt-0.5 accent-[#2F96A6]"
              />
              <span>{t(`capabilities.${bundle.key}`)}</span>
            </label>
          ))}
        </div>

        {hiddenCount > 0 && (
          <p className="mt-3 text-xs text-gray-400">
            {t("permissions.alsoHolds", { count: String(hiddenCount) })}
          </p>
        )}

        <div className="flex items-center gap-3 mt-5">
          <button
            onClick={save}
            disabled={saving}
            className="px-6 py-2 bg-[#2F96A6] text-white rounded-xl text-sm font-medium hover:bg-[#26808e] disabled:opacity-60"
          >
            {saving ? t("careForm.saving") : t("permissions.savePermissions")}
          </button>
          <button
            onClick={() => setAdvanced(true)}
            className="text-sm text-[#2F96A6] hover:underline"
          >
            {t("permissions.advanced")}
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <button
        onClick={() => setAdvanced(false)}
        className="text-sm text-[#2F96A6] hover:underline mb-4"
      >
        {t("permissions.backToSimple")}
      </button>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {Object.entries(grouped).map(([category, permissions]) => (
          <div key={category} className="border border-gray-100 rounded-xl p-4">
            <h3 className="text-sm font-bold text-[#111111] mb-3">
              {categoryLabels[category as PermissionCategory] ?? category}
            </h3>
            <div className="space-y-2">
              {permissions.map((permission) => (
                <label key={permission.key} className="flex items-start gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={draft.includes(permission.key)}
                    onChange={() => toggle(permission.key)}
                    className="mt-0.5 accent-[#2F96A6]"
                  />
                  <span>
                    {permission.labelAr}
                    {permission.hintAr && (
                      <span className="block text-xs text-gray-400">{permission.hintAr}</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={save}
        disabled={saving}
        className="mt-5 px-6 py-2 bg-[#2F96A6] text-white rounded-xl text-sm font-medium hover:bg-[#26808e] disabled:opacity-60"
      >
        {saving ? t("careForm.saving") : t("permissions.savePermissions")}
      </button>
    </>
  );
}

function InviteStaffModal({
  roles,
  returnFocusRef,
  onClose,
  onCreated,
}: {
  roles: RoleRow[];
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onCreated: (message: string, delivered: boolean) => void;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState(roles[0]?.id ?? "");
  const [teacherId, setTeacherId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [teachers, setTeachers] = useState<{ id: string; name: string }[]>([]);

  // Loaded here rather than by the page: only this form needs them, and a list
  // that is empty simply leaves the account unlinked.
  useEffect(() => {
    let cancelled = false;
    axios
      .get<{ teachers?: { id: string; name: string }[] } | { id: string; name: string }[]>(
        "/api/teachers"
      )
      .then((res) => {
        if (cancelled) return;
        const body = res.data;
        const list = Array.isArray(body) ? body : (body.teachers ?? []);
        setTeachers(list.map((row) => ({ id: row.id, name: row.name })));
      })
      .catch(() => {
        // Not fatal: the picker is optional, so it degrades to "no link".
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await axios.post<{
        invitationSent: boolean;
        deliveryStatus: "sent" | "failed";
      }>("/api/staff-accounts", {
        name,
        email,
        roleId,
        ...(teacherId ? { teacherId } : {}),
      });
      const delivered = res.status === 201 && res.data.invitationSent;
      onCreated(
        delivered
          ? t("permissions.accountCreated", { email })
          : t("permissions.accountCreatedNoEmail", { email }),
        delivered
      );
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 409) {
        setError(t("permissions.emailInUse"));
      } else if (axios.isAxiosError(err) && err.response?.status === 422) {
        setError(describeApiError(err, t("permissions.validationFailed")));
      } else {
        setError(describeApiError(err, t("permissions.createFailed")));
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => closeDialogOnOpenChange(nextOpen, saving, onClose)}
    >
      <DialogContent
        dismissBlocked={saving}
        className="max-w-md p-0"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusRef.current?.focus();
        }}
      >
        <form onSubmit={submit} className="flex max-h-[calc(100dvh-1.5rem)] flex-col">
          <DialogHeader className="p-6 pb-3">
            <div className="space-y-1">
              <DialogTitle>{t("permissions.newAccount")}</DialogTitle>
              <DialogDescription>{t("permissions.inviteExplanation")}</DialogDescription>
            </div>
          </DialogHeader>

          <div className="space-y-4 overflow-y-auto px-6 pb-6">
            {error && (
              <div
                role="alert"
                className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600"
              >
                {error}
              </div>
            )}

            <div>
              <label htmlFor="staff-account-name" className="mb-1 block text-xs text-gray-500">
                {t("fields.name")}
              </label>
              <input
                id="staff-account-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="name"
                required
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label htmlFor="staff-account-email" className="mb-1 block text-xs text-gray-500">
                {t("fields.email")}
              </label>
              <input
                id="staff-account-email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                dir="ltr"
                autoComplete="email"
                required
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label htmlFor="staff-account-role" className="mb-1 block text-xs text-gray-500">
                {t("fields.role")}
              </label>
              <select
                id="staff-account-role"
                value={roleId}
                onChange={(event) => setRoleId(event.target.value)}
                required
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
              >
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>{role.nameAr}</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="staff-account-teacher" className="mb-1 block text-xs text-gray-500">
                {t("permissions.linkTeacher")} {t("permissions.optional")}
              </label>
              <select
                id="staff-account-teacher"
                value={teacherId}
                onChange={(event) => setTeacherId(event.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
              >
                <option value="">{t("permissions.administrativeAccount")}</option>
                {teachers.map((teacher) => (
                  <option key={teacher.id} value={teacher.id}>{teacher.name}</option>
                ))}
              </select>
              <p className="mt-1 text-[11px] leading-relaxed text-gray-400">
                {t("permissions.teacherLinkHelp")}
              </p>
            </div>
          </div>

          <DialogFooter className="justify-end px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-xl border border-gray-200 px-5 py-2 text-sm text-gray-600 disabled:opacity-60"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={saving || !name || !email || !roleId}
              className="rounded-xl bg-[#2F96A6] px-5 py-2 text-sm font-medium text-white hover:bg-[#26808e] disabled:opacity-60"
            >
              {saving ? t("permissions.creating") : t("permissions.createAndInvite")}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
