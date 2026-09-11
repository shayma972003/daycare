import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { publicEnrollmentFormSchema } from "@/lib/enrollment-form";
import { isPlanLimitExceeded } from "@/lib/plan-limits";

const validForm = {
  full_name: "طفل تجريبي",
  id_number: "١٠٩٨٧٦٥٤٣٢",
  nationality: "سعودي",
  gender: "ذكر",
  period: "صباحي",
  date_of_birth: "2022-01-10",
  health_condition: "لا يوجد",
  allergies: "لا يوجد",
  guardian_name: "ولي الأمر الأول",
  guardian_phone_1: "٠٥٠٠٠٠٠٠٠١",
  guardian_phone_2: "0500000002",
  guardian_email: "guardian@example.com",
  guardian_name_2: "ولي الأمر الثاني",
  guardian_email_2: "",
  enrollment_date: "2026-09-09",
  payment_method: "نقدي",
};

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("public enrollment form contract", () => {
  it("requires every retained field except the evaluation and second email", () => {
    expect(publicEnrollmentFormSchema.safeParse(validForm).success).toBe(true);
    for (const key of Object.keys(validForm)) {
      if (key === "guardian_email_2") continue;
      const result = publicEnrollmentFormSchema.safeParse({ ...validForm, [key]: "" });
      expect(result.success, key).toBe(false);
    }
    expect(publicEnrollmentFormSchema.safeParse({
      ...validForm,
      guardian_email_2: undefined,
      evaluation_file_url: undefined,
      evaluation_file_name: undefined,
    }).success).toBe(true);
  });

  it("accepts Arabic numerals and strips retired public fields", () => {
    const result = publicEnrollmentFormSchema.parse({
      ...validForm,
      academic_stage: "KG1",
      guardian_phone_3: "0500000003",
      guardian_phone_4: "0500000004",
    });
    expect(result.id_number).toBe("1098765432");
    expect(result.guardian_phone_1).toBe("0500000001");
    expect(result).not.toHaveProperty("academic_stage");
    expect(result).not.toHaveProperty("guardian_phone_3");
    expect(result).not.toHaveProperty("guardian_phone_4");
  });

  it("removes the obsolete verification step and raw request counter from the page", () => {
    const page = source("src/app/enroll/[token]/page.tsx");
    expect(page).not.toContain('"التحقق", "معلومات التسجيل", "تأكيد"');
    expect(page).not.toContain("المسموح بها في هذا الرابط");
    expect(page).not.toContain('label="المرحلة الدراسية"');
    expect(page).not.toContain('label="رقم الجوال 3"');
    expect(page).not.toContain('label="رقم الجوال 4"');
    expect(page).toContain("إضافة تقييم الطفل");
  });

  it("keeps a local-only preview without exposing invitation URLs in production", () => {
    const createToken = source("src/app/api/enrollment/create-token/route.ts");
    const students = source("src/app/(dashboard)/students/page.tsx");
    expect(createToken).toContain('env.NODE_ENV === "development"');
    expect(createToken).toContain("localPreview ? { previewUrl: enrollUrl } : {}");
    expect(students).toContain("openLocalRegistrationForm");
  });
});

describe("admin plan-limit alerts", () => {
  it("treats zero as unlimited and positive caps as actual limits", () => {
    expect(isPlanLimitExceeded(4, 0)).toBe(false);
    expect(isPlanLimitExceeded(4, -1)).toBe(false);
    expect(isPlanLimitExceeded(4, 4)).toBe(false);
    expect(isPlanLimitExceeded(5, 4)).toBe(true);
  });

  it("uses the shared rule in both the overview and automated alerts", () => {
    const overview = source("src/app/api/admin/overview/route.ts");
    const notifications = source("src/app/api/notifications/admin-messages/route.ts");
    expect(overview).toContain("isPlanLimitExceeded(");
    expect(overview).toContain('students: { where: { isActive: true, deletedAt: null } }');
    expect(source("src/app/api/admin/cron/alerts/route.ts")).toContain("isPlanLimitExceeded(");
    expect(notifications).toContain("const planLimitActive = Boolean(");
    expect(notifications).toContain('NOT: { message: { template_key: "plan_limit" } }');
    expect(notifications).toContain("where: { ...recipientWhere, read_at: null");
    expect(source("src/app/admin/(protected)/schools/[id]/page.tsx")).toContain("إعادة المحاولة");
  });
});
