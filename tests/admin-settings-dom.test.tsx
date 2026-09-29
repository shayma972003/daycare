// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn() }));

vi.mock("axios", () => ({
  default: {
    get: mocks.get,
    put: mocks.put,
    post: mocks.post,
    isAxiosError: () => false,
  },
}));

import AdminSettingsPage from "@/app/admin/(protected)/settings/page";

const triggerLabels: Record<string, string> = {
  no_login: "عدم تسجيل الدخول",
  renewal_soon: "تجديد قريب",
  renewal_tomorrow: "تجديد غداً",
  expired: "اشتراك منتهٍ",
  plan_limit: "تجاوز الحد",
};

let rules = Object.keys(triggerLabels).map((trigger, index) => ({
  id: `rule-${index + 1}`,
  trigger_type: trigger,
  threshold_days: index,
  message_subject: `موضوع ${index + 1}`,
  message_template: `قالب ${index + 1}`,
  is_active: index % 2 === 0,
}));

beforeEach(() => {
  rules = rules.map((rule, index) => ({
    ...rule,
    threshold_days: index,
    message_subject: `موضوع ${index + 1}`,
    message_template: `قالب ${index + 1}`,
    is_active: index % 2 === 0,
  }));
  vi.clearAllMocks();
  mocks.get.mockImplementation((url: string) => {
    if (url === "/api/admin/alert-rules") return Promise.resolve({ data: rules.map((rule) => ({ ...rule })) });
    if (url === "/api/admin/overview") return Promise.resolve({ data: { stats: { totalActiveSchools: 3, totalStudents: 17 } } });
    throw new Error(`unexpected GET ${url}`);
  });
  mocks.put.mockImplementation((url: string, payload: typeof rules[number]) => {
    const id = url.split("/").at(-1);
    rules = rules.map((rule) => rule.id === id ? { ...payload } : rule);
    return Promise.resolve({ data: payload });
  });
  mocks.post.mockResolvedValue({ data: { success: true } });
});

afterEach(cleanup);

describe("super-admin settings interactions", () => {
  it("loads system information and edits every field of every alert rule", async () => {
    const user = userEvent.setup();
    render(<AdminSettingsPage />);

    expect(await screen.findByText("17")).toBeTruthy();
    expect(screen.getAllByText("3").length).toBeGreaterThan(0);

    for (const [index, rule] of rules.entries()) {
      const label = triggerLabels[rule.trigger_type];
      await user.click(screen.getByRole("button", { name: `تعديل ${label}` }));

      const threshold = screen.getByRole("spinbutton", { name: `عتبة ${label}` });
      const subject = screen.getByRole("textbox", { name: `موضوع ${label}` });
      const template = screen.getByRole("textbox", { name: `قالب ${label}` });
      const active = screen.getByRole("checkbox", { name: `تفعيل ${label}` });

      fireEvent.change(threshold, { target: { value: String(index + 10) } });
      await user.clear(subject);
      await user.type(subject, `موضوع اختباري ${index + 1}`);
      await user.clear(template);
      await user.type(template, `قالب اختباري ${index + 1}`);
      await user.click(active);
      await user.click(screen.getByRole("button", { name: `حفظ ${label}` }));

      await waitFor(() => expect(mocks.put).toHaveBeenCalledWith(
        `/api/admin/alert-rules/${rule.id}`,
        expect.objectContaining({
          threshold_days: index + 10,
          message_subject: `موضوع اختباري ${index + 1}`,
          message_template: `قالب اختباري ${index + 1}`,
          is_active: !rule.is_active,
        })
      ));
      expect(screen.getByRole("button", { name: `تعديل ${label}` })).toBeTruthy();
    }

    expect(mocks.put).toHaveBeenCalledTimes(rules.length);
  }, 15_000);

  it("cancels an edit without saving and rejects invalid rule inputs", async () => {
    const user = userEvent.setup();
    render(<AdminSettingsPage />);
    await screen.findByText("17");

    const label = triggerLabels.no_login;
    await user.click(screen.getByRole("button", { name: `تعديل ${label}` }));
    await user.clear(screen.getByRole("textbox", { name: `موضوع ${label}` }));
    await user.click(screen.getByRole("button", { name: `إلغاء ${label}` }));
    expect(mocks.put).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: `تعديل ${label}` }));
    fireEvent.change(screen.getByRole("spinbutton", { name: `عتبة ${label}` }), { target: { value: "-1" } });
    await user.click(screen.getByRole("button", { name: `حفظ ${label}` }));
    expect(await screen.findByText("عتبة الأيام لا يمكن أن تكون سالبة")).toBeTruthy();
    expect(mocks.put).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole("spinbutton", { name: `عتبة ${label}` }), { target: { value: "1" } });
    await user.clear(screen.getByRole("textbox", { name: `موضوع ${label}` }));
    await user.click(screen.getByRole("button", { name: `حفظ ${label}` }));
    expect(await screen.findByText("موضوع التنبيه ونص القالب مطلوبان")).toBeTruthy();
    expect(mocks.put).not.toHaveBeenCalled();
  }, 15_000);

  it("tests password validation and success without changing a real password", async () => {
    const user = userEvent.setup();
    render(<AdminSettingsPage />);
    await screen.findByText("17");

    const current = screen.getByLabelText("كلمة المرور الحالية");
    const next = screen.getByLabelText("كلمة المرور الجديدة");
    const confirmation = screen.getByLabelText("تأكيد كلمة المرور");
    const save = screen.getByRole("button", { name: "حفظ التغييرات" });

    await user.type(current, "current-password");
    await user.type(next, "new-password");
    await user.type(confirmation, "different-password");
    await user.click(save);
    expect(await screen.findByText("كلمتا المرور غير متطابقتين")).toBeTruthy();
    expect(mocks.post).not.toHaveBeenCalled();

    await user.clear(next);
    await user.clear(confirmation);
    await user.type(next, "short");
    await user.type(confirmation, "short");
    await user.click(save);
    expect(await screen.findByText("كلمة المرور يجب أن تكون 8 أحرف على الأقل")).toBeTruthy();
    expect(mocks.post).not.toHaveBeenCalled();

    await user.clear(next);
    await user.clear(confirmation);
    await user.type(next, "new-password-value");
    await user.type(confirmation, "new-password-value");
    await user.click(save);
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith("/api/admin/settings/password", {
      currentPassword: "current-password",
      newPassword: "new-password-value",
    }));
    expect(screen.getByText("تم تغيير كلمة المرور بنجاح")).toBeTruthy();
  }, 15_000);

  it("shows an error when the initial settings request fails", async () => {
    mocks.get.mockRejectedValueOnce(new Error("offline"));
    render(<AdminSettingsPage />);
    expect((await screen.findByRole("alert")).textContent).toContain("تعذر تحميل الإعدادات");
  });
});
