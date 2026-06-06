import { prisma } from "@/lib/prisma";
import { replaceVariables } from "@/lib/utils";

export type NotificationVars = {
  child_name?: string;
  guardian_name?: string;
  checkin_time?: string;
  checkout_time?: string;
  amount_due?: string;
  due_date?: string;
  school_name?: string;
  activity_name?: string;
};

export async function sendWhatsApp(
  to: string,
  body: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_WHATSAPP_FROM;

    if (!accountSid || !authToken || !from) {
      console.warn("Twilio not configured, skipping WhatsApp");
      return { success: false, error: "Twilio not configured" };
    }

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          From: from,
          To: `whatsapp:${to}`,
          Body: body,
        }),
      }
    );

    if (!response.ok) return { success: false, error: await response.text() };
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function sendEmail(
  to: string,
  subject: string,
  body: string,
  schoolName: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.FROM_EMAIL;

    if (!apiKey || !from) {
      console.warn("Resend not configured, skipping email");
      return { success: false, error: "Resend not configured" };
    }

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
  <div class="header"><h1>${schoolName}</h1></div>
  <div class="body"><p>${body.replace(/\n/g, "<br>")}</p></div>
  <div class="footer">تم الإرسال بواسطة نظام إدارة الروضة</div>
</div>
</body>
</html>`;

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
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

export async function sendNotification(
  schoolId: string,
  recipientName: string,
  phone: string | null,
  email: string | null,
  template: string,
  vars: NotificationVars,
  schoolName: string,
  source: string = "other"
) {
  const message = replaceVariables(template, vars as Record<string, string>);

  const results: Array<Promise<void>> = [];

  if (phone) {
    results.push(
      sendWhatsApp(phone, message).then(async (res) => {
        await prisma.notificationLog.create({
          data: {
            schoolId,
            recipientName,
            type: "WHATSAPP",
            content: message,
            status: res.success ? "SENT" : "FAILED",
            source,
          },
        });
      })
    );
  }

  if (email) {
    results.push(
      sendEmail(email, `رسالة من ${schoolName}`, message, schoolName).then(
        async (res) => {
          await prisma.notificationLog.create({
            data: {
              schoolId,
              recipientName,
              type: "EMAIL",
              content: message,
              status: res.success ? "SENT" : "FAILED",
              source,
            },
          });
        }
      )
    );
  }

  await Promise.allSettled(results);
}
