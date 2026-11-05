import {
  Children,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  I18nManager,
  Platform,
  StyleSheet,
  Text as NativeText,
  type TextProps,
} from "react-native";
import * as SecureStore from "expo-secure-store";

export type AppLanguage = "ar" | "en";

const LANGUAGE_KEY = "tofolatech.app-language";

I18nManager.allowRTL(false);
I18nManager.forceRTL(false);
I18nManager.swapLeftAndRightInRTL(false);

const english: Record<string, string> = {
  "أحداث اليوم": "Today's events",
  "أدخلي البريد الإلكتروني وكلمة المرور": "Enter your email and password",
  "أطفالي": "My children",
  "إرسال التقارير للمراجعة": "Send reports for review",
  "إرسال التقارير مباشرة": "Send reports directly",
  "إرسال التقرير المعدّل مباشرة": "Send the updated report directly",
  "إشعار جديد": "New notification",
  "إعادة الإرسال للمراجعة": "Resend for review",
  "إعادة المحاولة": "Try again",
  "إظهار كلمة المرور": "Show password",
  "إخفاء كلمة المرور": "Hide password",
  "إعلان": "Announcement",
  "إعلان جديد": "New announcement",
  "إلغاء": "Cancel",
  "إلغاء الكل": "Clear all",
  "إلى (اختياري)": "To (optional)",
  "إنشاء التقارير": "Create reports",
  "اختاري طفلاً واحداً على الأقل": "Select at least one child",
  "اختيار الوقت": "Choose time",
  "اسم الدواء": "Medicine name",
  "اسم الوجبة (اختياري)": "Meal name (optional)",
  "اعتماد": "Confirm",
  "اكتمل اليوم": "Day completed",
  "الأحداث المرتبطة بك أو بفصولك": "Events linked to you or your classes",
  "الأحداث والإعلانات المرتبطة بالتقويم": "Calendar events and announcements",
  "الإجمالي": "Total",
  "الإشعارات": "Notifications",
  "الإعلانات": "Announcements",
  "البحث بالاسم أو الفصل…": "Search by name or class...",
  "البحث بالاسم…": "Search by name...",
  "البحث عن طفل": "Search for a child",
  "البحث في الحضور": "Search attendance",
  "البريد": "Email",
  "البريد الإلكتروني": "Email",
  "التقويم": "Calendar",
  "الجرعة": "Dose",
  "الجوال": "Mobile",
  "الحضور": "Attendance",
  "الحضور والانصراف": "Check-in and check-out",
  "الدخول": "Check-in",
  "الدقيقة": "Minute",
  "الدور": "Role",
  "الرئيسية": "Home",
  "الرعاية": "Care",
  "الساعة": "Hour",
  "الشهر": "Month",
  "الغياب": "Absence",
  "الفترة": "Period",
  "الفصل": "Class",
  "الكل": "All",
  "المدرسة": "School",
  "المزاج": "Mood",
  "المعلم": "Teacher",
  "النصف": "Half",
  "النوم": "Nap",
  "الوجبة المشتركة": "Shared meal",
  "الوقت": "Time",
  "الوقت (اختياري)": "Time (optional)",
  "اليوم": "Today",
  "انتهت الجلسة، سجّلي الدخول مجددًا": "Your session has expired. Sign in again.",
  "بحاجة إلى تعديل": "Needs changes",
  "بدون فصل": "No class",
  "بعد 10 دقائق": "In 10 minutes",
  "بعد 15 دقيقة": "In 15 minutes",
  "بعد 5 دقائق": "In 5 minutes",
  "تحديث": "Refresh",
  "تحديث الإشعارات": "Refresh notifications",
  "تحديث التقويم": "Refresh calendar",
  "تحديث الحضور": "Refresh attendance",
  "تحديث الرئيسية": "Refresh home",
  "تحديث القائمة": "Refresh list",
  "تحديث تقارير الرعاية": "Refresh care reports",
  "تحديد الكل": "Select all",
  "تحديد الكل كمقروء": "Mark all as read",
  "تسجيل الخروج": "Sign out",
  "تسجيل الدخول": "Sign in",
  "تعذّر إرسال الإشعار": "Could not send the notification",
  "تعذّر إرسال التقرير": "Could not send the report",
  "تعذّر إغلاق إشعار الوصول": "Could not dismiss the arrival notification",
  "تعذّر الاتصال بالخادم. تحققي من الشبكة وعنوان التطبيق.": "Could not connect to the server. Check your network and app address.",
  "تعذّر تحديث الإشعار": "Could not update the notification",
  "تعذّر تحديث الإشعارات": "Could not update notifications",
  "تعذّر تحميل أحداث اليوم": "Could not load today's events",
  "تعذّر تحميل إشعارات الوصول": "Could not load arrival notifications",
  "تعذّر تحميل إعدادات الإشعارات": "Could not load notification settings",
  "تعذّر تحميل الأطفال": "Could not load children",
  "تعذّر تحميل الإشعارات": "Could not load notifications",
  "تعذّر تحميل التقارير": "Could not load reports",
  "تعذّر تحميل التقارير المرتجعة": "Could not load returned reports",
  "تعذّر تحميل التقارير المرجعة": "Could not load returned reports",
  "تعذّر تحميل التقويم": "Could not load the calendar",
  "تعذّر تحميل الحضور": "Could not load attendance",
  "تعذّر تحميل تقارير الرعاية": "Could not load care reports",
  "تعذّر تحميل تقارير اليوم": "Could not load today's reports",
  "تعذّر تسجيل الدخول، حاولي مرة أخرى": "Could not sign in. Try again.",
  "تعذّر حفظ الإعداد": "Could not save the setting",
  "تعذّر حفظ الحضور": "Could not save attendance",
  "تفاصيل الأطفال": "Children's details",
  "تقارير الرعاية": "Care reports",
  "تقارير الرعاية المرجعة": "Returned care reports",
  "تقرير الرعاية": "Care report",
  "تقويم": "Calendar",
  "تُكتب مرة واحدة وتُطبّق على الأطفال المحددين.": "Enter once and apply to the selected children.",
  "تم إرسال إشعار الوصول": "Arrival notification sent",
  "تم إرسال تقارير جميع الأطفال اليوم": "All children's reports were sent today",
  "تنبيه غياب": "Absence alert",
  "جارٍ التحديث…": "Refreshing...",
  "جارٍ التحقق من التقارير…": "Checking reports...",
  "جارٍ تحميل أحداث اليوم…": "Loading today's events...",
  "جارٍ تحميل الأطفال…": "Loading children...",
  "جارٍ تحميل الإشعارات…": "Loading notifications...",
  "جارٍ تحميل الإعدادات…": "Loading settings...",
  "جارٍ تحميل التقارير…": "Loading reports...",
  "جارٍ تحميل التقارير المرتجعة…": "Loading returned reports...",
  "جارٍ تحميل الحضور…": "Loading attendance...",
  "جارٍ تحميل الأحداث…": "Loading events...",
  "جميع المدرسة": "Whole school",
  "حاضر": "Present",
  "حدث خطأ، حاولي مرة أخرى": "Something went wrong. Try again.",
  "حسابي": "My account",
  "حضور اليوم": "Today's attendance",
  "حفاض مبلل": "Wet diaper",
  "حفاض متسخ": "Soiled diaper",
  "حمّام": "Toilet",
  "دخول": "Sign in",
  "الخروج": "Check-out",
  "درس": "Lesson",
  "دورة المياه": "Toilet",
  "راجعي ملاحظة الإدارة ثم عدّلي التقرير وأعيدي إرساله.": "Review the management note, update the report, then resend it.",
  "رجوع": "Back",
  "رسائل المدرسة والأنشطة": "School messages and activities",
  "رسائل المدرسة والأنشطة المرسلة لك": "School messages and activities sent to you",
  "رفض": "Refused",
  "سعيد": "Happy",
  "صباحًا": "AM",
  "صباحي": "Morning",
  "طوال اليوم": "All day",
  "عند إرسال ولي الأمر وقت وصوله": "When a guardian sends an arrival time",
  "عند تسجيل دخول أو خروج طفلك": "When your child checks in or out",
  "عند تسجيل غياب أحد أطفالك": "When one of your children is marked absent",
  "عند وصول تقرير رعاية جديد": "When a new care report arrives",
  "غادر": "Left",
  "غياب": "Absence",
  "غير محدد": "Not specified",
  "غير مرتبط": "Not linked",
  "غير مسجل": "Not provided",
  "فتح التقارير": "Open reports",
  "فتح التقويم": "Open calendar",
  "فتح الحضور": "Open attendance",
  "فتح وتعديل التقرير": "Open and edit report",
  "قليل": "A little",
  "كل الحقول اختيارية؛ سجّلي فقط ما حدث للطفل.": "All fields are optional. Record only what happened.",
  "كل الفصول": "All classes",
  "كمية الوجبة": "Meal amount",
  "لا توجد تفاصيل إضافية.": "No additional details.",
  "لا توجد أحداث في هذا اليوم": "No events on this day",
  "لا توجد أحداث اليوم": "No events today",
  "لا توجد إشعارات": "No notifications",
  "لا توجد تقارير معتمدة بعد": "No approved reports yet",
  "لا توجد تقارير مرتجعة": "No returned reports",
  "لا توجد نتائج مطابقة": "No matching results",
  "لا يوجد أطفال مرتبطون بالحساب": "No children are linked to this account",
  "لا يوجد أطفال مرتبطون بفصولك": "No children are linked to your classes",
  "لم تُضف ملاحظة.": "No note was added.",
  "لم يحضر": "Absent",
  "لم يسجل": "Not recorded",
  "لم ينم": "Did not sleep",
  "م": "PM",
  "متعب": "Tired",
  "متوعك": "Unwell",
  "متوقف": "Off",
  "مرتبط": "Linked",
  "مرتجع": "Returned",
  "مرتجعة للتعديل": "Returned for changes",
  "مساءً": "PM",
  "مسائي": "Evening",
  "مستلزمات مطلوبة": "Supplies needed",
  "مسح البحث": "Clear search",
  "مسح البحث والفلاتر": "Clear search and filters",
  "مسح الوقت": "Clear time",
  "مصدر الوجبة": "Meal source",
  "مفعّل": "On",
  "مكان رسم توضيحي": "Illustration placeholder",
  "مكان رسم للتقويم": "Calendar illustration placeholder",
  "مكان صورة ترحيبية": "Welcome image placeholder",
  "ملاحظة": "Note",
  "ملاحظة الإدارة": "Management note",
  "ملاحظة صحية": "Health note",
  "ملاحظات وتفاصيل إضافية": "Additional notes and details",
  "ملف المعلم": "Teacher profile",
  "ملف الموظف": "Employee profile",
  "من (اختياري)": "From (optional)",
  "من المنزل": "From home",
  "منزعج": "Upset",
  "نام": "Slept",
  "نشاط": "Activity",
  "نهاية النوم يجب أن تكون بعد بدايته": "Nap end time must be after its start time",
  "نوع الحساب غير متوافق": "Account type does not match",
  "هذا الأسبوع": "This week",
  "هادئ": "Calm",
  "وحدة": "Unit",
  "وصلت": "Arrived",
  "وصول أولياء الأمور": "Guardian arrivals",
  "وقت الوجبة (اختياري)": "Meal time (optional)",
  "ولي الأمر": "Guardian",
  "يبكي": "Crying",
  "نوع الحساب": "Account type",
  "كلمة المرور": "Password",
  "تطبيق المدرسة لولي الأمر والمعلم": "The school app for guardians and teachers",
  "الدخول بعد تفعيل الدعوة وإنشاء كلمة المرور.": "Sign in after accepting the invitation and creating a password.",
  "طفولة تيك": "Tofola Tech",
  "مدرستك أقرب إليك": "Your school, closer to you",
  "اللغة": "Language",
  "لغة التطبيق": "App language",
  "العربية": "Arabic",
  "الإنجليزية": "English",
  "اختاري لغة واجهة التطبيق.": "Choose the app interface language.",
  "إعدادات الإشعارات": "Notification settings",
  "تُطبق التغييرات على الإشعارات الجديدة.": "Changes apply to new notifications.",
  "ستظهر هنا الإعلانات وتنبيهات التقويم.": "Announcements and calendar alerts will appear here.",
  "ستظهر هنا تنبيهات الغياب والإعلانات والتقويم.": "Absence alerts, announcements, and calendar updates will appear here.",
  "ستظهر هنا التقارير التي تعيدها الإدارة للتعديل.": "Reports returned by management will appear here.",
  "اختاري يوماً آخر من التقويم.": "Choose another day from the calendar.",
  "هل أنت في الطريق؟": "Are you on your way?",
  "أرسلي تنبيهًا سريعًا للمعلمة": "Send a quick notification to the teacher",
  "اختاري وقت الوصول ⌄": "Choose arrival time ⌄",
  "اختاري وقت الوصول ⌃": "Choose arrival time ⌃",
  "تم إرسال تقارير رعاية اليوم": "Today's care reports were sent",
  "لا توجد تقارير مرجعة": "No returned reports",
  "تقارير بحاجة إلى تعديل": "Reports need changes",
  "إشعار وصول": "Arrival notification",
  "حسنًا": "OK",
  "أعدّه:": "Prepared by:",
  "المكان:": "Location:",
  "النطاق:": "Scope:",
  "التاريخ:": "Date:",
  "تعديل التقرير المرتجع": "Edit returned report",
  "الدواء (اختياري)": "Medication (optional)",
  "يمكن تعبئة أي معلومة متوفرة فقط.": "Enter any available information only.",
  "اختاري الساعة والدقيقة": "Choose the hour and minute",
  "تقليل": "Decrease",
  "زيادة": "Increase",
  "الحضور التلقائي بالموقع": "Automatic location attendance",
  "تفعيل الحضور التلقائي": "Enable automatic attendance",
  "اربط حساب التطبيق بملف الموظف من حسابات الموظفين في النظام أولًا.": "Link this app account to an employee profile from Staff Accounts in the system first.",
  "يسجل دخولك عند وصولك إلى نطاق المدرسة وخروجك عند مغادرته. لا يحفظ التطبيق مسار حركتك.": "Checks you in when you reach the school area and out when you leave it. The app does not store your movement path.",
  "لعمل الحضور التلقائي: شغّلي موقع الجهاز، ثم امنحي تطبيق طفولة تيك إذن الموقع «طوال الوقت».": "For automatic attendance, turn on the device location service and allow Tofola Tech to use location all the time.",
  "يلزم تشغيل موقع الجهاز ومنح تطبيق طفولة تيك إذن الموقع طوال الوقت لتسجيل الدخول والخروج تلقائيًا.": "Turn on the device location service and allow Tofola Tech to use location all the time for automatic check-in and check-out.",
  "مفعّل — سيتم تسجيل الدخول والخروج تلقائيًا": "On — check-in and check-out will be recorded automatically",
  "الميزة غير مفعّلة من إدارة المدرسة": "The school has not enabled this feature",
  "يحتاج إذن الموقع الدائم من إعدادات الهاتف": "Always-on location permission is required",
  "موقع الجهاز متوقف — شغّليه لإكمال الحضور التلقائي": "Device location is off — turn it on to complete automatic attendance setup",
  "الحضور بالموقع غير متاح على هذا الجهاز": "Location attendance is unavailable on this device",
  "تعذر التحقق من إعدادات الموقع": "Could not check location settings",
  "تعذر تفعيل الحضور بالموقع. تحققي من اتصال الخادم وإذن الموقع.": "Could not enable location attendance. Check the server connection and location permission.",
  "تعذر تفعيل الحضور بالموقع. تحققي من اتصال الخادم، وتشغيل موقع الجهاز، وإذن التطبيق.": "Could not enable location attendance. Check the server connection, device location service, and app permission.",
  "تحديث إعداد الموقع": "Update location settings",
  "تفعيل إذن الموقع": "Enable location permission",
  "تشغيل الموقع ومنح الإذن": "Turn on location and grant permission",
  "فتح إعدادات التطبيق": "Open app settings",
  "فتح إعدادات الهاتف": "Open phone settings",
  "إذن التطبيق": "App permission",
  "موقع الجهاز": "Device location",
  "مسموح طوال الوقت": "Allowed all the time",
  "غير مكتمل": "Not complete",
  "يعمل": "On",
  "لاحقًا": "Later",
  "حضورك الآن": "Your attendance now",
  "الحالة الحالية": "Current status",
  "الحضور التلقائي غير مفعّل من إدارة المدرسة": "Automatic attendance is not enabled by the school",
  "جارٍ تحميل حالة حضورك…": "Loading your attendance status...",
  "تعذّر تحميل حالة حضورك": "Could not load your attendance status",
  "حالتك الآن": "Your current status",
  "مسجلة دخول": "Checked in",
  "مسجلة خروج": "Checked out",
  "سيصلك إشعار عند تسجيل دخولك أو خروجك تلقائيًا.": "You will receive a notification when you are checked in or out automatically.",
};

function translateDynamic(value: string): string {
  const leading = value.match(/^\s*/u)?.[0] ?? "";
  const trailing = value.match(/\s*$/u)?.[0] ?? "";
  const content = value.trim();
  const direct = english[content];
  if (direct) return `${leading}${direct}${trailing}`;

  const replacements: [RegExp, (...matches: string[]) => string][] = [
    [/^غياب (.+)$/u, (_, name) => `${name} absence`],
    [/^(\d+) إشعار غير مقروء$/u, (_, count) => `${count} unread notification${count === "1" ? "" : "s"}`],
    [/^يتبقى (\d+) إشعار آخر$/u, (_, count) => `${count} more notification${count === "1" ? "" : "s"}`],
    [/^(\d+) أطفال$/u, (_, count) => `${count} children`],
    [/^(\d+) أطفال · (.+)$/u, (_, count, date) => `${count} children · ${date}`],
    [/^(\d+) غير مقروء$/u, (_, count) => `${count} unread`],
    [/^، و(\d+) آخرين$/u, (_, count) => `, and ${count} more`],
    [/^(\d+) محدد$/u, (_, count) => `${count} selected`],
    [/^يمكن الإرسال بعد (.+)$/u, (_, time) => `You can send again in ${time}`],
    [/^تم تسجيل دخول (.+)$/u, (_, name) => `${name} checked in`],
    [/^تم تسجيل خروج (.+)$/u, (_, name) => `${name} checked out`],
    [/^سيصل (.+) خلال (\d+) دقائق$/u, (_, name, minutes) => `${name} will arrive in ${minutes} minutes`],
    [/^ولي الأمر (.+) وصل$/u, (_, name) => `Guardian ${name} has arrived`],
    [/^أعدّه: (.+)$/u, (_, name) => `Prepared by: ${name}`],
    [/^المكان: (.+)$/u, (_, location) => `Location: ${location}`],
    [/^النطاق: (.+)$/u, (_, scope) => `Scope: ${scope}`],
    [/^التاريخ: (.+)$/u, (_, date) => `Date: ${date}`],
    [/^تم إرسال تقارير (\d+) أطفال مباشرة لأولياء الأمور$/u, (_, count) => `${count} children's reports were sent directly to guardians`],
    [/^تم إرسال تقارير (\d+) أطفال للمراجعة$/u, (_, count) => `${count} children's reports were sent for review`],
  ];

  for (const [pattern, replacement] of replacements) {
    if (pattern.test(content)) return `${leading}${content.replace(pattern, replacement)}${trailing}`;
  }
  return value;
}

function translateNode(node: ReactNode, language: AppLanguage): ReactNode {
  if (language === "ar") return node;
  if (typeof node === "string") return translateDynamic(node);
  if (Array.isArray(node)) return Children.map(node, (child) => translateNode(child, language));
  return node;
}

async function readStoredLanguage(): Promise<AppLanguage> {
  try {
    const stored = Platform.OS === "web"
      ? globalThis.localStorage?.getItem(LANGUAGE_KEY)
      : await SecureStore.getItemAsync(LANGUAGE_KEY);
    return stored === "en" ? "en" : "ar";
  } catch {
    return "ar";
  }
}

async function persistLanguage(language: AppLanguage): Promise<void> {
  if (Platform.OS === "web") {
    globalThis.localStorage?.setItem(LANGUAGE_KEY, language);
    return;
  }
  await SecureStore.setItemAsync(LANGUAGE_KEY, language);
}

type LanguageContextValue = {
  language: AppLanguage;
  loading: boolean;
  isRTL: boolean;
  locale: string;
  setLanguage: (language: AppLanguage) => Promise<void>;
  t: (value: string) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setCurrentLanguage] = useState<AppLanguage>("ar");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void readStoredLanguage().then((stored) => {
      if (active) {
        setCurrentLanguage(stored);
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const setLanguage = useCallback(async (next: AppLanguage) => {
    setCurrentLanguage(next);
    try {
      await persistLanguage(next);
    } catch {
      // The visible preference still applies for this session if storage is unavailable.
    }
  }, []);

  const t = useCallback((value: string) => (
    language === "en" ? translateDynamic(value) : value
  ), [language]);

  const value = useMemo<LanguageContextValue>(() => ({
    language,
    loading,
    isRTL: language === "ar",
    locale: language === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-US",
    setLanguage,
    t,
  }), [language, loading, setLanguage, t]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage must be used inside LanguageProvider");
  return context;
}

export function Text({ children, style, ...props }: TextProps) {
  const { language, isRTL } = useLanguage();
  const flatStyle = StyleSheet.flatten(style);
  const centered = flatStyle?.textAlign === "center";
  return (
    <NativeText
      {...props}
      style={[
        style,
        {
          textAlign: centered ? "center" : isRTL ? "right" : "left",
          writingDirection: isRTL ? "rtl" : "ltr",
        },
      ]}
    >
      {translateNode(children, language)}
    </NativeText>
  );
}
