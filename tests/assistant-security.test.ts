import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assistantRequestSchema,
  assistantSafePrompt,
  redactAssistantInput,
} from "@/lib/assistant/contracts";
import { assistantToolCatalog, assistantToolDefinitions } from "@/lib/assistant/tools";
import { parseAssistantActionCommand } from "@/lib/assistant/action-command";
import { requirementFor } from "@/lib/route-permissions";
import type { AuthSession } from "@/lib/session";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function session(permissions: string[]): AuthSession {
  return {
    user: {
      id: "user-1",
      name: "Manager",
      email: null,
      schoolId: "school-1",
      schoolName: "School",
      role: "admin",
      authVersion: 0,
    },
    permissions,
    teacherId: null,
    teacherClassIds: null,
    subscription: {
      mode: "active",
      reason: "active",
      renewalDate: null,
      daysUntilRenewal: null,
      showRenewalWarning: false,
      daysOverdue: 0,
      graceDaysRemaining: 0,
      showFirstExpiredDayPopup: false,
    },
    can: (permission) => permissions.includes("*") || permissions.includes(permission),
  };
}

describe("AI assistant privacy boundary", () => {
  it("uses a dedicated permission for the assistant route", () => {
    expect(requirementFor("/api/assistant/chat", "POST")).toBe("settings.ai");
    expect(requirementFor("/api/assistant/actions/prepare", "POST")).toBe("settings.ai");
    expect(requirementFor("/api/assistant/actions/confirm", "POST")).toBe("settings.ai");
    expect(source("src/app/(dashboard)/assistant/page.tsx")).toContain('session.can("settings.ai")');
  });

  it("accepts only bounded strict chat requests ending with a user message", () => {
    expect(assistantRequestSchema.safeParse({
      messages: [{ role: "user", content: "ملخص اليوم" }],
    }).success).toBe(true);
    expect(assistantRequestSchema.safeParse({
      messages: [{ role: "assistant", content: "answer" }],
    }).success).toBe(false);
    expect(assistantRequestSchema.safeParse({
      messages: [{ role: "user", content: "hello", schoolId: "other-school" }],
    }).success).toBe(false);
  });

  it("redacts common credentials and contact identifiers before provider calls", () => {
    const safe = redactAssistantInput(
      "email guardian@example.test phone +966501234567 id 1234567890 Bearer secret-token-value"
    );
    expect(safe).not.toContain("guardian@example.test");
    expect(safe).not.toContain("+966501234567");
    expect(safe).not.toContain("1234567890");
    expect(safe).not.toContain("secret-token-value");
  });

  it("sends a fixed aggregate intent instead of the manager's original wording", () => {
    const safe = assistantSafePrompt("كم فاتورة على الطفلة سارة ورقمها 0501234567؟");
    expect(safe).toContain("ملخص التنبيهات المالية");
    expect(safe).not.toContain("سارة");
    expect(safe).not.toContain("0501234567");

    const classAssignment = assistantSafePrompt("هل كل الطلاب مسجلين في فصل؟");
    expect(classAssignment).toContain("غير المرتبطين");

    expect(assistantSafePrompt("ما أحداث التقويم اليوم؟")).toContain("أحداث التقويم");
    expect(assistantSafePrompt("هل توجد تقارير رعاية تحتاج مراجعة؟")).toContain("تقارير الرعاية");
    expect(assistantSafePrompt("كم طلب تسجيل ينتظر المراجعة؟")).toContain("طلبات التسجيل");
    expect(assistantSafePrompt("ما مساحة التخزين المستخدمة؟")).toContain("مساحة التخزين");
    expect(assistantSafePrompt("كم موظف سجل حضوره؟")).toContain("حضور الموظفين");
    expect(assistantSafePrompt("كيف تسليم الإشعارات؟")).toContain("تسليم الإشعارات");
    expect(assistantSafePrompt("كم عنصر في سلة المحذوفات؟")).toContain("سلة المحذوفات");
    expect(assistantSafePrompt("هل إعدادات المنشأة مكتملة؟")).toContain("جاهزية إعدادات");
    expect(assistantSafePrompt("هل الفصول ممتلئة؟")).toContain("سعة الفصول");
    expect(assistantSafePrompt("ما حالة اشتراك النظام؟")).toContain("اشتراك النظام");
    expect(assistantSafePrompt("اعرض سجل النشاط")).toContain("النشاط الإداري");
    expect(assistantSafePrompt("هل حسابات الموظفين مفعلة؟")).toContain("حسابات الموظفين");
  });

  it("never exposes tenant or user ids as model-controlled tool arguments", () => {
    const definitions = assistantToolDefinitions(session(["*"]));
    expect(definitions.length).toBeGreaterThan(0);
    for (const definition of definitions) {
      expect(definition.parameters.properties).toEqual({});
      expect(JSON.stringify(definition)).not.toMatch(/schoolId|userId|studentId|teacherId/);
    }
  });

  it("offers only tools backed by the caller's permissions", () => {
    expect(assistantToolDefinitions(session(["finance.view"])).map((tool) => tool.name))
      .toEqual(["get_finance_attention_summary", "get_finance_operations_summary"]);
    expect(assistantToolDefinitions(session([]))).toEqual([]);
    expect(assistantToolDefinitions(session(["schedule.view"])).map((tool) => tool.name))
      .toEqual(["get_today_calendar_summary"]);
    expect(assistantToolDefinitions(session(["settings.storage"])).map((tool) => tool.name))
      .toEqual(["get_storage_summary"]);
    expect(assistantToolDefinitions(session(["staff.view", "attendance.staff"])).map((tool) => tool.name))
      .toEqual(["get_roster_summary", "get_staff_attendance_summary", "get_trash_summary"]);
    expect(assistantToolDefinitions(session(["settings.manage"])).map((tool) => tool.name))
      .toEqual([
        "get_notification_delivery_summary",
        "get_system_subscription_summary",
        "get_configuration_readiness_summary",
        "get_recent_activity_summary",
      ]);
  });

  it("keeps action approval outside model-controlled tool arguments", () => {
    const catalog = assistantToolCatalog(session(["*"]));
    expect(catalog).toHaveLength(16);
    expect(catalog.every((tool) => tool.effect === "read" && !tool.confirmationRequired)).toBe(true);
    const toolsSource = source("src/lib/assistant/tools.ts");
    expect(toolsSource).toContain('context.approvedWriteTool !== name');
    for (const definition of assistantToolDefinitions(session(["*"]))) {
      expect(JSON.stringify(definition.parameters)).not.toContain("approvedWriteTool");
    }
  });

  it("keeps the API key server-only and disables provider response storage", () => {
    const example = source(".env.example");
    const gateway = source("src/lib/assistant/openai.ts");
    const route = source("src/app/api/assistant/chat/route.ts");
    expect(example).toContain('OPENAI_API_KEY=""');
    expect(example).not.toContain("NEXT_PUBLIC_OPENAI");
    expect(gateway).toContain("store: false");
    expect(route).not.toContain("request: parsed.data");
    expect(route).toContain("assistantSafePrompt");
  });

  it("keeps local Ollama server-only and constrained to loopback", () => {
    const example = source(".env.example");
    const envSource = source("src/lib/env.ts");
    const gateway = source("src/lib/assistant/openai.ts");
    expect(example).toContain('AI_PROVIDER=""');
    expect(example).toContain('OLLAMA_BASE_URL="http://127.0.0.1:11434"');
    expect(example).not.toContain("NEXT_PUBLIC_OLLAMA");
    expect(envSource).toContain('"127.0.0.1", "localhost", "::1"');
    expect(envSource).toContain("Ollama is limited to local development");
    expect(gateway).toContain("think: false");
  });

  it("keeps write approval outside the model and binds it to one actor and tenant", () => {
    const approval = source("src/lib/assistant/action-approval.ts");
    const actions = source("src/lib/assistant/actions.ts");
    const prepareRoute = source("src/app/api/assistant/actions/prepare/route.ts");
    const confirmRoute = source("src/app/api/assistant/actions/confirm/route.ts");

    expect(approval).toContain('createHmac("sha256", env.NEXTAUTH_SECRET)');
    expect(approval).toContain("timingSafeEqual");
    expect(approval).toContain("envelope.schoolId !== input.schoolId");
    expect(approval).toContain("envelope.userId !== input.userId");
    expect(approval).toContain("prisma.rateLimit.deleteMany");
    expect(actions).toContain('grants(session.permissions, "attendance.students")');
    expect(actions).toContain('grants(session.permissions, "schedule.manage")');
    expect(actions).toContain('grants(session.permissions, "finance.manage")');
    expect(actions).toContain('grants(session.permissions, "classes.manage")');
    expect(actions).toContain('grants(session.permissions, "students.manage")');
    expect(actions).toContain("notifyGuardiansOfAttendance");
    expect(actions).toContain("syncExpenseOccurrence");
    expect(actions).toContain("sendNotification");
    expect(actions).toContain("expectedUpdatedAt");
    expect(actions).toContain("rateLimit({");
    expect(actions).toContain("NO_ELIGIBLE_RECIPIENTS");
    expect(actions).toContain("enqueuePush");
    expect(actions).toContain('notifyCalendar: true');
    expect(prepareRoute).toContain("prepareAssistantAction");
    expect(confirmRoute).toContain("confirmAssistantAction");
    expect(prepareRoute).not.toContain("answerAssistantRequest");
    expect(confirmRoute).not.toContain("answerAssistantRequest");
  });

  it("does not expose irreversible deletion, credentials, or role editing as assistant actions", () => {
    const actions = source("src/lib/assistant/actions.ts");
    const commands = source("src/lib/assistant/action-command.ts");
    expect(actions).not.toContain('tool: "permanent_delete"');
    expect(actions).not.toContain('tool: "password_change"');
    expect(actions).not.toContain('tool: "role_update"');
    expect(commands).not.toMatch(/password|permanent_delete|role_update/);
    expect(commands).toContain('kind: "broadcast_create"');
  });

  it("parses supported action commands locally without sending names to the provider", () => {
    expect(parseAssistantActionCommand("سجلي حضور الطفل سارة أحمد", { timeZone: "Asia/Riyadh" }))
      .toMatchObject({ kind: "action", proposal: { kind: "attendance", subject: "student", operation: "checkin", name: "سارة أحمد" } });
    expect(parseAssistantActionCommand("أضيفي مصروف قرطاسية بمبلغ 500 شهري", { now: new Date("2026-10-22T08:00:00Z"), timeZone: "Asia/Riyadh" }))
      .toMatchObject({ kind: "action", proposal: { kind: "expense_create", title: "قرطاسية", amount: 500, type: "monthly", startDate: "2026-10-22" } });
    expect(parseAssistantActionCommand("أضيفي طفل سارة أحمد إلى فصل الزهور", { timeZone: "Asia/Riyadh" }))
      .toMatchObject({ kind: "action", proposal: { kind: "student_create", name: "سارة أحمد", className: "الزهور" } });
    expect(parseAssistantActionCommand("انقلي الطفل سارة أحمد إلى فصل التمهيدي", { timeZone: "Asia/Riyadh" }))
      .toMatchObject({ kind: "action", proposal: { kind: "student_move_class", studentName: "سارة أحمد", className: "التمهيدي" } });
    expect(parseAssistantActionCommand("جددي اشتراك الطفل سارة أحمد", { timeZone: "Asia/Riyadh" }))
      .toMatchObject({ kind: "action", proposal: { kind: "student_subscription_renew", studentName: "سارة أحمد" } });
    expect(parseAssistantActionCommand("ألغِ اشتراك الطفل سارة أحمد", { timeZone: "Asia/Riyadh" }))
      .toMatchObject({ kind: "action", proposal: { kind: "student_subscription_cancel", studentName: "سارة أحمد" } });
    expect(parseAssistantActionCommand("اربطي ولي الأمر فاطمة سعد بالطفل سارة أحمد", { timeZone: "Asia/Riyadh" }))
      .toMatchObject({ kind: "action", proposal: { kind: "guardian_link", guardianName: "فاطمة سعد", studentName: "سارة أحمد" } });
    expect(parseAssistantActionCommand("ارفعي ملف تقييم للطفل سارة أحمد", { timeZone: "Asia/Riyadh" }))
      .toMatchObject({ kind: "upload", upload: { kind: "evaluation", studentName: "سارة أحمد" } });
    expect(parseAssistantActionCommand("أضيفي معلمة نورة علي صباحية", { timeZone: "Asia/Riyadh" }))
      .toMatchObject({ kind: "action", proposal: { kind: "staff_create", name: "نورة علي", period: "MORNING" } });
    expect(parseAssistantActionCommand("عيّني المعلمة نورة علي في فصل الزهور", { timeZone: "Asia/Riyadh" }))
      .toMatchObject({ kind: "action", proposal: { kind: "staff_assign_class", staffName: "نورة علي", className: "الزهور" } });
    expect(parseAssistantActionCommand("عدلي سعة فصل الزهور إلى 20", { timeZone: "Asia/Riyadh" }))
      .toMatchObject({ kind: "action", proposal: { kind: "class_update", className: "الزهور", capacity: 20 } });
    expect(parseAssistantActionCommand("اعتمدي تقرير الرعاية للطفل سارة أحمد", { timeZone: "Asia/Riyadh" }))
      .toMatchObject({ kind: "action", proposal: { kind: "care_review", action: "approve", studentName: "سارة أحمد" } });
    expect(parseAssistantActionCommand("أصدري فاتورة راتب للمعلمة نورة علي", { timeZone: "Asia/Riyadh" }))
      .toMatchObject({ kind: "action", proposal: { kind: "invoice_create", subject: "staff", name: "نورة علي" } });
    expect(parseAssistantActionCommand("أنشئي رابط تسجيل إلى parent@example.test", { timeZone: "Asia/Riyadh" }))
      .toMatchObject({ kind: "action", proposal: { kind: "enrollment_link", email: "parent@example.test" } });
    expect(parseAssistantActionCommand("عدلي الرسوم الشهرية إلى 900", { timeZone: "Asia/Riyadh" }))
      .toMatchObject({ kind: "action", proposal: { kind: "settings_update", field: "monthlyStudentFee", value: 900 } });
    expect(parseAssistantActionCommand("ارفعي شعار المنشأة", { timeZone: "Asia/Riyadh" }))
      .toMatchObject({ kind: "upload", upload: { kind: "school_logo" } });
    expect(parseAssistantActionCommand("ارفعي ملف للوحدة الحيوانات", { timeZone: "Asia/Riyadh" }))
      .toMatchObject({ kind: "upload", upload: { kind: "unit_file", unitName: "الحيوانات" } });
    expect(parseAssistantActionCommand("أنشئي حدث اجتماع أولياء الأمور بتاريخ 2026-11-02 لفصل الزهور", { timeZone: "Asia/Riyadh" }))
      .toMatchObject({ kind: "action", proposal: { kind: "calendar_create", title: "اجتماع أولياء الأمور", date: "2026-11-02", className: "الزهور" } });
    expect(parseAssistantActionCommand("أضيفي وحدة الحيوانات من 2026-11-01 إلى 2026-11-30 لفصل الزهور", { timeZone: "Asia/Riyadh" }))
      .toMatchObject({ kind: "action", proposal: { kind: "unit_create", name: "الحيوانات", startDate: "2026-11-01", endDate: "2026-11-30", className: "الزهور" } });
    expect(parseAssistantActionCommand("أضيفي درس حيوانات المزرعة في وحدة الحيوانات", { timeZone: "Asia/Riyadh" }))
      .toMatchObject({ kind: "action", proposal: { kind: "lesson_create", title: "حيوانات المزرعة", unitName: "الحيوانات" } });
    expect(parseAssistantActionCommand("أضيفي نشاط الرسم من 2026-11-02 إلى 2026-11-03 لفصل الزهور", { timeZone: "Asia/Riyadh" }))
      .toMatchObject({ kind: "action", proposal: { kind: "activity_create", name: "الرسم", className: "الزهور" } });
    expect(parseAssistantActionCommand("أرسلي نشاط الرسم إلى أولياء الأمور", { timeZone: "Asia/Riyadh" }))
      .toMatchObject({ kind: "action", proposal: { kind: "activity_send", activityName: "الرسم", audience: "guardians" } });
    expect(parseAssistantActionCommand("احذفي ملف الخطة.pdf من وحدة الحيوانات", { timeZone: "Asia/Riyadh" }))
      .toMatchObject({ kind: "action", proposal: { kind: "unit_file_delete", fileName: "الخطة.pdf", unitName: "الحيوانات" } });
    expect(parseAssistantActionCommand("أرجعي تقرير الرعاية للطفلة سارة أحمد مع ملاحظة أضيفي وقت الوجبة", { timeZone: "Asia/Riyadh" }))
      .toMatchObject({ kind: "action", proposal: { kind: "care_review", action: "return", studentName: "سارة أحمد", note: "أضيفي وقت الوجبة" } });
    expect(parseAssistantActionCommand("أوقفي تكرار المصروف الإيجار", { timeZone: "Asia/Riyadh" }))
      .toMatchObject({ kind: "action", proposal: { kind: "expense_stop", title: "الإيجار" } });
    expect(parseAssistantActionCommand("أصدري تقرير مالي شهري 2026-10", { timeZone: "Asia/Riyadh" }))
      .toMatchObject({ kind: "action", proposal: { kind: "financial_report", type: "monthly", periodLabel: "2026-10" } });
    expect(parseAssistantActionCommand("أرسلي تذكيرات دفع لجميع الأطفال في فصل الزهور", { timeZone: "Asia/Riyadh" }))
      .toMatchObject({ kind: "action", proposal: { kind: "bulk_reminder", reminderKind: "payment", className: "الزهور" } });
    expect(parseAssistantActionCommand("أضيفي مرحلة دراسية التمهيدي", { timeZone: "Asia/Riyadh" }))
      .toMatchObject({ kind: "action", proposal: { kind: "stage_manage", action: "create", name: "التمهيدي" } });
    expect(parseAssistantActionCommand("عدلي وقت دخول الأطفال الصباحي إلى 07:00", { timeZone: "Asia/Riyadh" }))
      .toMatchObject({ kind: "action", proposal: { kind: "settings_update", field: "studentMorningCheckinTime", value: "07:00" } });
    expect(parseAssistantActionCommand("حدثي حساب مساحة التخزين", { timeZone: "Asia/Riyadh" }))
      .toMatchObject({ kind: "action", proposal: { kind: "storage_refresh" } });
    expect(parseAssistantActionCommand("كم عدد الأطفال؟", { timeZone: "Asia/Riyadh" })).toBeNull();
    const route = source("src/app/api/assistant/chat/route.ts");
    expect(route.indexOf("parseAssistantActionCommand")).toBeLessThan(route.indexOf("assistantSafePrompt(lastUserMessage.content)"));
    expect(route).toContain("prepareAssistantUpload");
  });

  it("keeps student files on direct protected upload routes", () => {
    const chat = source("src/components/assistant/AssistantChat.tsx");
    const actions = source("src/lib/assistant/actions.ts");
    expect(actions).toContain('endpoint: `/api/students/${student.id}/avatar`');
    expect(actions).toContain('endpoint: `/api/students/${student.id}/evaluation`');
    expect(actions).toContain('grants(session.permissions, "students.files")');
    expect(chat).toContain("form.append(pendingUpload.formField, uploadFile)");
    expect(chat).toContain("pendingUpload.method");
    expect(chat).toContain("pendingUpload.successMessage");
    expect(chat).not.toContain("OPENAI_API_KEY");
  });
});
