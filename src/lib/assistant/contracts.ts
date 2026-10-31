import { z } from "zod";

export const ASSISTANT_MAX_MESSAGES = 10;
export const ASSISTANT_MAX_MESSAGE_CHARS = 2_000;

export const assistantMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(ASSISTANT_MAX_MESSAGE_CHARS),
}).strict();

export const assistantRequestSchema = z.object({
  messages: z.array(assistantMessageSchema).min(1).max(ASSISTANT_MAX_MESSAGES),
}).strict().refine(
  (value) => value.messages[value.messages.length - 1]?.role === "user",
  { message: "The final message must come from the user", path: ["messages"] }
);

/**
 * Defence in depth for text typed into the assistant.
 *
 * The aggregate tools below never return PII. This catches the most common
 * accidental secrets a manager might paste into the free-text box before the
 * request leaves our server. Names cannot be detected reliably, so the UI also
 * states that the first release is for aggregate questions only.
 */
export function redactAssistantInput(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[بريد محجوب]")
    .replace(/(?:\+?966|00966|0)?5\d{8}/g, "[جوال محجوب]")
    .replace(/\b\d{10,}\b/g, "[رقم محجوب]")
    .replace(/\b(?:sk|Bearer)[-_ A-Za-z0-9.]{12,}\b/gi, "[سر محجوب]");
}

/**
 * Converts the manager's free text to a fixed, non-identifying intent before
 * any provider request. The original sentence never leaves this application.
 * Each recognised topic maps to a fixed aggregate capability; names and free
 * text never become provider input.
 */
export function assistantSafePrompt(value: string): string {
  const text = value.toLocaleLowerCase("ar");
  const topics: string[] = [];
  const asksAboutClassAssignment =
    /(?:كل|جميع|غير مسجل|غير مرتبط|بدون).*(?:فصل|الفصول)|(?:فصل|الفصول).*(?:كل|جميع|غير مسجل|غير مرتبط|بدون)/.test(text);
  const asksAboutAttendance = /حضور|غياب|غائب|متأخر|تأخير|انصراف/.test(text);
  const asksAboutStaff = /معلم|معلمة|موظف|موظفة|طاقم/.test(text);

  if (asksAboutAttendance) {
    topics.push(asksAboutStaff ? "ملخص حضور الموظفين اليوم" : "ملخص حضور الأطفال اليوم");
  }
  if (/فاتور|مالي|مالية|مصروف|دفع|مدفوع/.test(text)) {
    topics.push("ملخص التنبيهات المالية وتفاصيل عمليات الفواتير والمصروفات المجمعة");
  }
  if (/تقويم|حدث|أحداث|موعد|مواعيد|برنامج اليوم/.test(text)) {
    topics.push("ملخص أحداث التقويم لليوم");
  }
  if (/تقرير الرعاية|تقارير الرعاية|رعاية.*مراجع|مراجع.*رعاية|مرجع.*تقرير/.test(text)) {
    topics.push("ملخص تقارير الرعاية التي تحتاج متابعة");
  }
  if (/طلب.*تسجيل|طلبات.*تسجيل|تسجيل.*جديد|تسجيل.*مراجع/.test(text)) {
    topics.push("عدد طلبات التسجيل التي تنتظر المراجعة");
  }
  if (/تخزين|مساحة|ملفات.*مساحة|استهلاك.*ملفات/.test(text)) {
    topics.push("ملخص مساحة التخزين المجمعة");
  }
  if (/إشعار|اشعار|إشعارات|اشعارات|رسائل|تسليم/.test(text)) {
    topics.push("ملخص تسليم الإشعارات خلال آخر ثلاثين يوما دون بيانات المستلمين");
  }
  if (/سلة|محذوف|محذوفات|المحذوفة/.test(text)) {
    topics.push("ملخص سلة المحذوفات حسب نوع السجل");
  }
  if (/اشتراك النظام|خطة النظام|تجديد النظام|اشتراك طفولة|اشتراك المنصة/.test(text)) {
    topics.push("ملخص اشتراك النظام الحالي وحدوده");
  }
  if (/جاهزية|إعدادات.*ناقص|ناقص.*إعدادات|اكتمال.*إعدادات|إعدادات المنشأة/.test(text)) {
    topics.push("ملخص جاهزية إعدادات المنشأة دون عرض بيانات الاتصال");
  }
  if (/سجل النشاط|آخر النشاط|نشاطات أخيرة|تغييرات أخيرة|سجل التغييرات/.test(text)) {
    topics.push("ملخص النشاط الإداري الحديث حسب نوع السجل");
  }
  if (/سعة|ممتل|امتلاء|توزيع.*فصل|فصل.*توزيع/.test(text)) {
    topics.push("ملخص سعة الفصول وتوزيع الأطفال دون أسماء");
  }
  if (/حسابات الموظف|حسابات الموظفين|أدوار|صلاحيات|دعوات الموظف|دعوات الموظفين/.test(text)) {
    topics.push("ملخص جاهزية حسابات الموظفين والأدوار دون بيانات دخول");
  }
  if (asksAboutClassAssignment) {
    topics.push("تحقق هل كل الأطفال النشطين مرتبطون بفصل واذكر عدد المرتبطين وغير المرتبطين بوضوح");
  } else if (!asksAboutAttendance && /عدد|أعداد|طلاب|طالب|أطفال|طفل|معلم|معلمة|موظف|فصل|فصول/.test(text)) {
    topics.push("ملخص أعداد الأطفال والموظفين والفصول");
  }

  if (topics.length === 0) {
    return "اشرح أن النسخة الحالية تدعم ملخصات الأعداد والحضور والمالية والتقويم والرعاية والتسجيل والتخزين والإشعارات والمحذوفات والاشتراك والإعدادات والنشاط والفصول والحسابات، واطلب اختيار أحدها.";
  }

  return `أجب عن الطلب باستخدام الأدوات المجمعة فقط: ${Array.from(new Set(topics)).join("، ")}.`;
}

export type AssistantRequest = z.infer<typeof assistantRequestSchema>;
