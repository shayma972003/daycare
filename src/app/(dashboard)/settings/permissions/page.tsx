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

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { Topbar } from "@/components/layout/Topbar";
import { describeApiError } from "@/lib/api-error";
import { PasswordRules, meetsRequiredRules } from "@/components/ui/PasswordRules";
import type { PermissionDefinition, PermissionCategory } from "@/lib/permissions";
import { useT } from "@/lib/i18n-provider";

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
  isSelf: boolean;
  role: { id: string; nameAr: string; isOwner: boolean } | null;
}

const OWNER_WILDCARD = "*";

export default function PermissionsPage() {
  const [data, setData] = useState<RolesResponse | null>(null);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);

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
      setError(describeApiError(err, "تعذر تحميل الصلاحيات"));
    }
  }, []);

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
        if (!cancelled) setError(describeApiError(err, "تعذر تحميل الصلاحيات"));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedRole = data?.roles.find((r) => r.id === selectedRoleId) ?? null;
  const isOwnerRole = selectedRole?.permissions.includes(OWNER_WILDCARD) ?? false;

  async function setDisabled(user: StaffRow, disabled: boolean) {
    setError(null);
    try {
      await axios.put(`/api/staff-accounts/${user.id}`, { disabled });
      await load();
    } catch (err) {
      setError(describeApiError(err, "تعذر تحديث الحساب"));
    }
  }

  async function changeRole(user: StaffRow, roleId: string) {
    setError(null);
    try {
      await axios.put(`/api/staff-accounts/${user.id}`, { roleId });
      setNotice(`تم تحديث دور ${user.name}`);
      await load();
    } catch (err) {
      setError(describeApiError(err, "تعذر تغيير الدور"));
    }
  }

  const grouped = data
    ? data.catalogue.reduce<Record<string, PermissionDefinition[]>>((acc, permission) => {
        (acc[permission.category] ??= []).push(permission);
        return acc;
      }, {})
    : {};

  return (
    <div dir="rtl" className="min-h-screen bg-brand-bg">
      <Topbar title="الصلاحيات وحسابات الموظفين" />

      <div className="p-6 space-y-6">
        {error && (
          <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
            {error}
          </div>
        )}
        {notice && (
          <div role="status" className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-700">
            {notice}
          </div>
        )}

        {!data ? (
          <div className="py-20 text-center text-sm text-gray-400">جارٍ التحميل…</div>
        ) : (
          <>
            {/* ── Staff accounts ─────────────────────────────────────────── */}
            <section className="bg-white rounded-2xl shadow-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-[#111111]">حسابات الموظفين</h2>
                <button
                  onClick={() => setShowInvite(true)}
                  className="px-4 py-2 bg-[#2F96A6] text-white rounded-xl text-sm font-medium hover:bg-[#26808e]"
                >
                  إضافة حساب
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[620px]">
                  <thead>
                    <tr className="border-b border-gray-100 text-gray-500">
                      {["الاسم", "البريد", "الدور", "الحالة", ""].map((h) => (
                        <th key={h} className="px-3 py-2 text-right font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {staff.map((user) => (
                      <tr key={user.id}>
                        <td className="px-3 py-3 text-[#111111]">
                          {user.name}
                          {user.isSelf && <span className="text-xs text-gray-400"> (أنت)</span>}
                        </td>
                        <td className="px-3 py-3 text-gray-600" dir="ltr">{user.email}</td>
                        <td className="px-3 py-3">
                          {user.role?.isOwner ? (
                            // The owner's role is fixed — see the guard on the API.
                            <span className="text-gray-500">{user.role.nameAr}</span>
                          ) : (
                            <select
                              value={user.role?.id ?? ""}
                              onChange={(e) => changeRole(user, e.target.value)}
                              className="border border-gray-200 rounded-lg px-2 py-1 text-sm"
                            >
                              <option value="" disabled>بلا دور</option>
                              {data.roles
                                .filter((role) => !role.permissions.includes(OWNER_WILDCARD))
                                .map((role) => (
                                  <option key={role.id} value={role.id}>{role.nameAr}</option>
                                ))}
                            </select>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          {user.disabled ? (
                            <span className="text-red-500">معطَّل</span>
                          ) : (
                            <span className="text-emerald-600">نشط</span>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          {!user.role?.isOwner && !user.isSelf && (
                            <button
                              onClick={() => setDisabled(user, !user.disabled)}
                              className="text-xs text-[#2F96A6] hover:underline"
                            >
                              {user.disabled ? "تفعيل" : "تعطيل"}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* ── Roles ──────────────────────────────────────────────────── */}
            <section className="bg-white rounded-2xl shadow-sm p-6">
              <h2 className="font-bold text-[#111111] mb-4">الأدوار والصلاحيات</h2>

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
                  دور المدير يملك كل الصلاحيات ولا يمكن تعديله — تعديله قد يُخرج الحضانة من
                  إعداداتها بلا طريقة للرجوع.
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
                    setNotice(message);
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
          onClose={() => setShowInvite(false)}
          onCreated={(message) => {
            setShowInvite(false);
            setNotice(message);
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
  const [draft, setDraft] = useState<string[]>(role.permissions);
  const [saving, setSaving] = useState(false);

  function toggle(key: string) {
    setDraft((current) =>
      current.includes(key) ? current.filter((k) => k !== key) : [...current, key]
    );
  }

  async function save() {
    setSaving(true);
    try {
      await axios.put(`/api/roles/${role.id}`, { permissions: draft });
      await onSaved(`تم حفظ صلاحيات "${role.nameAr}"`);
    } catch (err) {
      onError(describeApiError(err, "تعذر حفظ الصلاحيات"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
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
        {saving ? "جارٍ الحفظ…" : "حفظ الصلاحيات"}
      </button>
    </>
  );
}

function InviteStaffModal({
  roles,
  onClose,
  onCreated,
}: {
  roles: RoleRow[];
  onClose: () => void;
  onCreated: (message: string) => void;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState(roles[0]?.id ?? "");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Blank means "generate one and email it", so the rules only gate a password
  // the user actually typed.
  const passwordOk = password.length === 0 || meetsRequiredRules(password);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const res = await axios.post<{ invitationSent: boolean }>("/api/staff-accounts", {
        name,
        email,
        roleId,
        ...(password ? { password } : {}),
      });
      onCreated(
        res.data.invitationSent
          ? `تم إنشاء الحساب وإرسال البيانات إلى ${email}`
          : `تم إنشاء الحساب — لكن تعذّر إرسال البريد إلى ${email}`
      );
    } catch (err) {
      setError(describeApiError(err, "تعذر إنشاء الحساب"));
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md space-y-4" dir="rtl">
        <h3 className="font-bold text-[#111111]">حساب موظف جديد</h3>

        {error && (
          <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
            {error}
          </div>
        )}

        <div>
          <label className="block text-xs text-gray-500 mb-1">{t("fields.name")}</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">{t("fields.email")}</label>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            dir="ltr"
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">{t("fields.role")}</label>
          <select
            value={roleId}
            onChange={(e) => setRoleId(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm"
          >
            {roles.map((role) => (
              <option key={role.id} value={role.id}>{role.nameAr}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">
            كلمة المرور <span className="text-gray-400">(اتركها فارغة لتوليدها وإرسالها بالبريد)</span>
          </label>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            dir="ltr"
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm"
          />
          {password.length > 0 && <PasswordRules value={password} />}
        </div>

        <div className="flex gap-3 justify-end pt-1">
          <button
            onClick={onClose}
            className="px-5 py-2 border border-gray-200 text-gray-600 rounded-xl text-sm"
          >
            إلغاء
          </button>
          <button
            onClick={submit}
            disabled={saving || !name || !email || !roleId || !passwordOk}
            className="px-5 py-2 bg-[#2F96A6] text-white rounded-xl text-sm font-medium hover:bg-[#26808e] disabled:opacity-60"
          >
            {saving ? "جارٍ الإنشاء…" : "إنشاء"}
          </button>
        </div>
      </div>
    </div>
  );
}
