import { authJson } from "@/lib/auth-response";

/** Kept for old bookmarks; tenant creation is invitation-only. */
export async function POST() {
  return authJson(
    {
      error: "التسجيل العام غير متاح. تُنشأ الحسابات عبر دعوة إدارية آمنة.",
      code: "SELF_REGISTRATION_DISABLED",
    },
    { status: 410 }
  );
}
