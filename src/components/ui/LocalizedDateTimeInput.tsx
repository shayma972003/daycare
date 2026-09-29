"use client";

import { forwardRef, type InputHTMLAttributes } from "react";
import { useLocale } from "@/lib/i18n-provider";

type NativeDateTimeType = "date" | "time" | "datetime-local";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  nativeType: NativeDateTimeType;
};

const ENGLISH_PLACEHOLDERS: Record<NativeDateTimeType, string> = {
  date: "YYYY-MM-DD",
  time: "HH:MM",
  "datetime-local": "YYYY-MM-DDTHH:MM",
};

/**
 * Chromium localizes native date/time controls using the operating system.
 * On Arabic Windows that can put Arabic hints and AM/PM inside an English UI.
 * Rendering as text from the first React render avoids that without mutating
 * the element type after mount, which would break controlled input updates.
 */
export const LocalizedDateTimeInput = forwardRef<HTMLInputElement, Props>(
  function LocalizedDateTimeInput({ nativeType, placeholder, dir, lang, ...props }, ref) {
    const { locale } = useLocale();
    const english = locale === "en";

    return (
      <input
        {...props}
        ref={ref}
        type={english ? "text" : nativeType}
        data-localized-native-type={nativeType}
        inputMode={english ? "numeric" : props.inputMode}
        placeholder={english ? (placeholder ?? ENGLISH_PLACEHOLDERS[nativeType]) : placeholder}
        dir={dir ?? "ltr"}
        lang={lang ?? (english ? "en-GB" : "ar-SA")}
      />
    );
  }
);

LocalizedDateTimeInput.displayName = "LocalizedDateTimeInput";
