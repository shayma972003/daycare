import { prisma } from "@/lib/prisma";

interface LogActionParams {
  school_id: string;
  action: string;
  entity_type?: string;
  entity_id?: string;
  entity_name?: string;
  performed_by?: string;
  request?: Request;
}

function parseDeviceInfo(userAgent: string): string {
  let browser = "متصفح غير معروف";
  let os = "نظام غير معروف";

  if (userAgent.includes("Chrome") && !userAgent.includes("Edg")) browser = "Chrome";
  else if (userAgent.includes("Safari") && !userAgent.includes("Chrome")) browser = "Safari";
  else if (userAgent.includes("Firefox")) browser = "Firefox";
  else if (userAgent.includes("Edg")) browser = "Edge";

  if (userAgent.includes("Windows NT 11") || userAgent.includes("Windows NT 10")) os = "Windows";
  else if (userAgent.includes("Mac OS X")) os = "macOS";
  else if (userAgent.includes("iPhone") || userAgent.includes("iPad")) os = "iOS";
  else if (userAgent.includes("Android")) os = "Android";
  else if (userAgent.includes("Linux")) os = "Linux";

  return `${browser} على ${os}`;
}

export async function logAction({
  school_id,
  action,
  entity_type,
  entity_id,
  entity_name,
  performed_by = "المدير",
  request,
}: LogActionParams) {
  try {
    let ip_address: string | undefined;
    let device_info: string | undefined;

    if (request) {
      const headersList = request.headers;
      ip_address =
        headersList.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        headersList.get("x-real-ip") ??
        "غير متاح";

      const userAgent = headersList.get("user-agent") ?? "";
      device_info = userAgent ? parseDeviceInfo(userAgent) : "غير معروف";
    }

    await prisma.activityLog.create({
      data: {
        school_id,
        action,
        entity_type,
        entity_id,
        entity_name,
        performed_by,
        ip_address,
        device_info,
      },
    });
  } catch (error) {
    console.error("Activity log failed:", error);
  }
}
