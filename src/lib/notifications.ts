import { prisma } from "@/lib/prisma";
import { replaceVariables } from "@/lib/utils";
import { type MessageContext } from "@/lib/message-variables";
import { env, emailEnabled, emailProvider } from "@/lib/env";

export type NotificationVars = Record<string, string>;
export type { MessageContext };

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Message bodies and school names are user-controlled and land inside an HTML
 * email. Without escaping, a crafted name or template injects markup into every
 * recipient's inbox.
 */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

export async function sendEmail(
  to: string,
  subject: string,
  body: string,
  schoolName: string
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!emailEnabled) {
      console.warn("No email backend configured, skipping email");
      return { success: false, error: "Email not configured" };
    }

    const from = env.FROM_EMAIL!;

    const html = `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="UTF-8"><style>
body{font-family:'Tajawal',Arial,sans-serif;background:#f4f6fb;margin:0;padding:20px;direction:rtl}
.container{max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.08)}
.header{background:#1a2340;padding:24px;text-align:center}
.header h1{color:#fff;margin:0;font-size:20px}
.body{padding:32px;color:#1a2340;font-size:16px;line-height:1.8}
.footer{background:#f8fafc;padding:16px;text-align:center;color:#64748b;font-size:13px}
</style></head>
<body>
<div class="container">
  <div class="header"><h1>${escapeHtml(schoolName)}</h1></div>
  <div class="body"><p>${escapeHtml(body).replace(/\n/g, "<br>")}</p></div>
  <div class="footer">تم الإرسال بواسطة نظام إدارة الروضة</div>
</div>
</body>
</html>`;

    if (emailProvider === "smtp") {
      // Dynamic import keeps nodemailer out of the bundle when Resend is used.
      const { createTransport } = await import("nodemailer");
      const transport = createTransport({
        host: env.SMTP_HOST!,
        port: env.SMTP_PORT ?? 587,
        secure: (env.SMTP_PORT ?? 587) === 465,
        auth: { user: env.SMTP_USER!, pass: env.SMTP_PASSWORD! },
      });

      await transport.sendMail({ from, to, subject, html });
      return { success: true };
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY!}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, html }),
    });

    if (!response.ok) return { success: false, error: await response.text() };
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Who the message is *about*, as opposed to who receives it.
 *
 * A payment reminder goes to a guardian but concerns a child, and the logged
 * body quotes that child by name. Recording the subject is what lets the
 * retention sweep find these rows years later — without it the name outlives
 * anonymisation in every reminder ever sent. See docs/DATA_LIFECYCLE.md.
 */
export interface NotificationSubject {
  studentId?: string | null;
  teacherId?: string | null;
}

export type NotificationDeliveryResult =
  | { status: "sent" }
  | { status: "failed"; reason: "email_delivery" | "delivery_log" }
  | { status: "no_email" };

export async function sendNotification(
  schoolId: string,
  recipientName: string,
  email: string | null,
  template: string,
  vars: NotificationVars,
  schoolName: string,
  source: string = "other",
  subject: NotificationSubject = {}
): Promise<NotificationDeliveryResult> {
  const message = replaceVariables(template, vars as Record<string, string>);
  const subjectColumns = {
    studentId: subject.studentId ?? null,
    teacherId: subject.teacherId ?? null,
  };

  if (!email) return { status: "no_email" };

  const delivery = await sendEmail(
    email,
    `رسالة من ${schoolName}`,
    message,
    schoolName
  );

  try {
    await prisma.notificationLog.create({
      data: {
        schoolId,
        recipientName,
        type: "EMAIL",
        content: message,
        status: delivery.success ? "SENT" : "FAILED",
        source,
        ...subjectColumns,
      },
    });
  } catch {
    console.error("[notifications] failed to record email delivery", {
      schoolId,
      source,
    });
    return { status: "failed", reason: "delivery_log" };
  }

  return delivery.success
    ? { status: "sent" }
    : { status: "failed", reason: "email_delivery" };
}
