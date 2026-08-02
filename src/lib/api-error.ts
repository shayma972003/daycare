import axios from "axios";

/**
 * Turns any thrown value into a message worth showing a user.
 *
 * Several pages awaited a mutation with no try/catch at all, so a 500 rejected
 * the promise, React swallowed it, and the screen simply did not change — the
 * user re-clicked a button that would never work and had no idea why. This is
 * the shared way to say what went wrong.
 */
export function describeApiError(error: unknown, fallback = "حدث خطأ، يرجى المحاولة مجدداً"): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { error?: unknown } | undefined;

    if (typeof data?.error === "string") return data.error;

    // Zod's flatten() shape, which several routes return on 422.
    if (data?.error && typeof data.error === "object") {
      const fieldErrors = (data.error as { fieldErrors?: Record<string, string[]> }).fieldErrors;
      const first = fieldErrors && Object.values(fieldErrors).flat()[0];
      if (first) return first;
    }

    switch (error.response?.status) {
      case 401:
        return "انتهت الجلسة. يرجى تسجيل الدخول مجدداً.";
      case 403:
        return "لا تملك صلاحية لهذا الإجراء.";
      case 404:
        return "العنصر غير موجود.";
      case 409:
        return "تعارض في البيانات. حدّث الصفحة وحاول مجدداً.";
      case 413:
        return "حجم البيانات كبير جداً.";
      case 429:
        return "تم تجاوز عدد المحاولات. حاول بعد قليل.";
      default:
        break;
    }

    if (!error.response) return "تعذر الاتصال بالخادم. تحقق من الإنترنت.";
  }

  return fallback;
}
