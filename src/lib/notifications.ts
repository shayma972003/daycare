import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { replaceVariables } from "@/lib/utils";
import { type MessageContext } from "@/lib/message-variables";
import { env, emailDeliveryEnabled, emailEnabled, emailProvider } from "@/lib/env";
import { platformName, type PlatformLanguage } from "@/lib/branding";

export type NotificationVars = Record<string, string>;
export type { MessageContext };

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const replyToSchema = z.string().trim().max(254).email();

export type EmailSender =
  | { kind: "platform"; displayName?: string | null }
  | {
      kind: "school";
      displayName?: string | null;
      replyTo?: string | null;
    };

export interface SendEmailOptions {
  sender?: EmailSender;
  language?: PlatformLanguage;
}

export type EmailDeliveryResult =
  | { success: true; status: "sent" }
  | { success: false; status: "disabled" }
  | { success: false; status: "failed"; error: string };

/**
 * Message bodies and school names are user-controlled and land inside an HTML
 * email. Without escaping, a crafted name or template injects markup into every
 * recipient's inbox.
 */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]);
}

/** Remove control characters before a value is placed in an email header. */
function sanitizeHeaderText(value: string): string {
  return value
    .replace(/[\r\n]+/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

function safeReplyTo(value: string | null | undefined): string | undefined {
  if (!value || /[\r\n\u0000-\u001f\u007f]/.test(value)) return undefined;
  const parsed = replyToSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function quotedMailbox(displayName: string, email: string): string {
  const escapedName = displayName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escapedName}" <${email}>`;
}

function senderDisplayName(
  schoolName: string,
  sender: EmailSender,
  language: PlatformLanguage
): string {
  const platform = platformName(language);

  if (sender.kind === "school") {
    const requestedName = sanitizeHeaderText(sender.displayName ?? schoolName);
    if (!requestedName) return platform;
    return language === "en"
      ? `${requestedName} via ${platform}`
      : `${requestedName} عبر ${platform}`;
  }

  return sanitizeHeaderText(sender.displayName ?? "") || platform;
}

export async function sendEmail(
  to: string,
  subject: string,
  body: string,
  schoolName: string,
  options: SendEmailOptions = {}
): Promise<EmailDeliveryResult> {
  try {
    // This must remain before provider selection, dynamic imports and fetch.
    // A disabled environment must not initialize or contact either backend.
    if (!emailDeliveryEnabled) {
      return { success: false, status: "disabled" };
    }

    if (!emailEnabled) {
      console.warn("No email backend configured, skipping email");
      return { success: false, status: "failed", error: "Email not configured" };
    }

    const language = options.language ?? "ar";
    const sender = options.sender ?? { kind: "platform" as const };
    const from = quotedMailbox(
      senderDisplayName(schoolName, sender, language),
      env.FROM_EMAIL!
    );
    const replyTo = sender.kind === "school" ? safeReplyTo(sender.replyTo) : undefined;
    const safeSubject = sanitizeHeaderText(subject);
    const direction = language === "ar" ? "rtl" : "ltr";
    const footer =
      language === "ar"
        ? `تم الإرسال بواسطة ${platformName("ar")}`
        : `Sent via ${platformName("en")}`;

    const html = `
<!DOCTYPE html>
<html dir="${direction}" lang="${language}">
<head><meta charset="UTF-8"><style>
body{font-family:'Tajawal',Arial,sans-serif;background:#f4f6fb;margin:0;padding:20px;direction:${direction}}
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
  <div class="footer">${escapeHtml(footer)}</div>
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

      await transport.sendMail({
        from,
        to,
        subject: safeSubject,
        html,
        ...(replyTo ? { replyTo } : {}),
      });
      return { success: true, status: "sent" };
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY!}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        subject: safeSubject,
        html,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });

    if (!response.ok) {
      return { success: false, status: "failed", error: "Email delivery failed" };
    }
    return { success: true, status: "sent" };
  } catch {
    return { success: false, status: "failed", error: "Email delivery failed" };
  }
}

/**
 * Who the message is *about*, as opposed to who receives it.
 *
 * A payment reminder goes to a guardian but concerns a child, and the logged
 * body quotes that child by name. Recording the subject is what lets the
 * retention sweep find these rows years later without preserving that name.
 */
export interface NotificationSubject {
  studentId?: string | null;
  teacherId?: string | null;
}

export type NotificationDeliveryResult =
  | { status: "sent" }
  | { status: "failed"; reason: "email_delivery" | "delivery_log" }
  | { status: "disabled" }
  | { status: "no_email" };

export async function sendNotification(
  schoolId: string,
  recipientName: string,
  email: string | null,
  template: string,
  vars: NotificationVars,
  schoolName: string,
  source: string = "other",
  subject: NotificationSubject = {},
  schoolEmail?: string | null
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
    schoolName,
    {
      sender: {
        kind: "school",
        displayName: schoolName,
        replyTo: schoolEmail,
      },
      language: "ar",
    }
  );

  // Disabled delivery is an intentional non-attempt. Recording it as SENT or
  // FAILED would make operational reporting claim that a provider was called.
  if (delivery.status === "disabled") return { status: "disabled" };

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
