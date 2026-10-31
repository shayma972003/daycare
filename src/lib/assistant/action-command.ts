import "server-only";

import type { AssistantActionProposalInput } from "@/lib/assistant/actions";
import { dateKeyInTimeZone } from "@/lib/device-date";

export type AssistantActionCommand =
  | { kind: "action"; proposal: AssistantActionProposalInput }
  | { kind: "upload"; upload:
      | { kind: "avatar" | "evaluation"; studentName: string }
      | { kind: "unit_file"; unitName: string }
      | { kind: "school_logo" | "student_import" }
    }
  | { kind: "help"; message: string }
  | null;

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

function latinDigits(value: string): string {
  return value.replace(/[٠-٩]/g, (digit) => String(ARABIC_DIGITS.indexOf(digit)));
}

function normalized(value: string): string {
  return latinDigits(value)
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
}

function trimValue(value: string): string {
  return value.replace(/[،,.!?؟]+$/g, "").trim();
}

function originalWords(raw: string, value: string): string {
  const target = normalized(trimValue(value));
  const words = raw.split(/\s+/);
  for (let start = 0; start < words.length; start++) {
    for (let end = start + 1; end <= words.length; end++) {
      const candidate = words.slice(start, end).join(" ");
      if (normalized(trimValue(candidate)) === target) return trimValue(candidate);
    }
  }
  return trimValue(value);
}

function dateFrom(value: string): string | null {
  return latinDigits(value).match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] ?? null;
}

function amountFrom(value: string): number | null {
  const match = latinDigits(value).match(/(?:بمبلغ|مبلغ|بقيمة|قيمته|قيمة)\s*(\d+(?:\.\d{1,2})?)/i);
  if (!match) return null;
  const amount = Number(match[1]);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function actionHelp(): AssistantActionCommand {
  return {
    kind: "help",
    message: "أحتاج تفاصيل العملية في رسالة واحدة. اكتبي اسم السجل كاملًا، وما تريدين تغييره، وأضيفي التاريخ والوقت عند إنشاء مناوبة أو حدث.",
  };
}

export function parseAssistantActionCommand(
  input: string,
  options: { now?: Date; timeZone: string }
): AssistantActionCommand {
  const raw = latinDigits(input).trim();
  const text = normalized(raw);
  const today = dateKeyInTimeZone(options.now ?? new Date(), options.timeZone);
  const cleanValue = (value: string) => originalWords(raw, value);

  if (/^(?:ارفع|ارفعي|غير|غيري)\s+شعار\s+(?:المنشا(?:ه|ة)|المدرس(?:ه|ة)|الحضان(?:ه|ة))$/.test(text)) {
    return { kind: "upload", upload: { kind: "school_logo" } };
  }
  if (/^(?:ارفع|ارفعي)\s+ملف\s+استيراد\s+(?:الاطفال|الطلاب)$/.test(text)) {
    return { kind: "upload", upload: { kind: "student_import" } };
  }
  const unitFile = text.match(/^(?:ارفع|ارفعي|اضف|اضيفي?)\s+ملف(?:ا)?\s+(?:للوحد(?:ه|ة)|الي\s+وحد(?:ه|ة))\s+(.+)$/);
  if (unitFile) {
    return { kind: "upload", upload: { kind: "unit_file", unitName: cleanValue(unitFile[1]!) } };
  }

  const upload = text.match(/^(?:ارفع|ارفعي|اضف|اضيفي?)\s+(صوره|صورة|تقييم|ملف(?:\s+تقييم)?)\s+(?:للطفل|للطالبة|للطالب|للطفلة)\s+(.+)$/);
  if (upload) {
    const studentName = cleanValue(raw.match(/^(?:ارفع|ارفعي|أضف|اضف|أضيفي?|اضيفي?)\s+(?:صورة|صوره|تقييم|ملف(?:\s+تقييم)?)\s+(?:للطفل|للطالبة|للطالب|للطفلة)\s+(.+)$/)?.[1] ?? upload[2]!);
    if (studentName.length < 2) return actionHelp();
    return { kind: "upload", upload: { kind: /صوره|صورة/.test(upload[1]!) ? "avatar" : "evaluation", studentName } };
  }

  const renameStudent = text.match(/^(?:غير|غيري|عدل|عدلي)\s+اسم\s+(?:الطفل|الطفلة|الطالب|الطالبة)\s+(.+)\s+الي\s+(.+)$/);
  if (renameStudent) {
    const source = raw.match(/^(?:غيّر|غير|غيّري|غيري|عدّل|عدل|عدّلي|عدلي)\s+اسم\s+(?:الطفل|الطفلة|الطالب|الطالبة)\s+(.+)\s+(?:إلى|الى)\s+(.+)$/);
    const currentName = cleanValue(source?.[1] ?? renameStudent[1]!);
    const newName = cleanValue(source?.[2] ?? renameStudent[2]!);
    return { kind: "action", proposal: { kind: "student_rename", currentName, newName } };
  }

  const moveStudent = text.match(/^(?:انقل|انقلي|عين|عيني)\s+(?:الطفل|الطفلة|الطالب|الطالبة)\s+(.+)\s+(?:الي|في)\s+فصل\s+(.+)$/);
  if (moveStudent) {
    const source = raw.match(/^(?:انقل|انقلي|عيّن|عين|عيّني|عيني)\s+(?:الطفل|الطفلة|الطالب|الطالبة)\s+(.+)\s+(?:إلى|الى|في)\s+فصل\s+(.+)$/);
    return {
      kind: "action",
      proposal: {
        kind: "student_move_class",
        studentName: cleanValue(source?.[1] ?? moveStudent[1]!),
        className: cleanValue(source?.[2] ?? moveStudent[2]!),
      },
    };
  }

  const archiveStudent = text.match(/^(?:ارشف|ارشفي)\s+(?:الطفل|الطفلة|الطالب|الطالبة)\s+(.+)$/);
  if (archiveStudent) {
    const name = raw.match(/^(?:أرشف|ارشف|أرشفي|ارشفي)\s+(?:الطفل|الطفلة|الطالب|الطالبة)\s+(.+)$/)?.[1] ?? archiveStudent[1]!;
    return { kind: "action", proposal: { kind: "student_archive", studentName: cleanValue(name) } };
  }

  const renewStudent = text.match(/^(?:جدد|جددي)\s+اشتراك\s+(?:الطفل|الطفلة|الطالب|الطالبة)\s+(.+)$/);
  if (renewStudent) {
    const name = raw.match(/^(?:جدد|جددي)\s+اشتراك\s+(?:الطفل|الطفلة|الطالب|الطالبة)\s+(.+)$/)?.[1] ?? renewStudent[1]!;
    return { kind: "action", proposal: { kind: "student_subscription_renew", studentName: cleanValue(name) } };
  }

  const cancelStudent = text.match(/^(?:الغي|الغ)\s+اشتراك\s+(?:الطفل|الطفلة|الطالب|الطالبة)\s+(.+)$/);
  if (cancelStudent) {
    const name = raw.match(/^(?:ألغِ|الغي|الغ)\s+اشتراك\s+(?:الطفل|الطفلة|الطالب|الطالبة)\s+(.+)$/)?.[1] ?? cancelStudent[1]!;
    return { kind: "action", proposal: { kind: "student_subscription_cancel", studentName: cleanValue(name) } };
  }

  const reactivateStudent = text.match(/^(?:فعل|فعلي|اعد|اعيدي)\s+(?:تفعيل\s+)?(?:الطفل|الطفلة|الطالب|الطالبة)\s+(.+?)(?:\s+مجددا)?$/);
  if (reactivateStudent) {
    const name = raw.match(/^(?:فعّل|فعل|فعّلي|فعلي|أعد|اعد|أعيدي|اعيدي)\s+(?:تفعيل\s+)?(?:الطفل|الطفلة|الطالب|الطالبة)\s+(.+?)(?:\s+مجدداً|\s+مجددا)?$/)?.[1] ?? reactivateStudent[1]!;
    return { kind: "action", proposal: { kind: "student_reactivate", studentName: cleanValue(name) } };
  }

  const linkGuardian = text.match(/^(?:اربط|اربطي)\s+ولي\s+الامر\s+(.+)\s+(?:بالطفل|بالطفلة|بالطالب|بالطالبة)\s+(.+)$/);
  if (linkGuardian) {
    const source = raw.match(/^(?:أربط|اربط|أربطي|اربطي)\s+ولي\s+الأمر\s+(.+)\s+(?:بالطفل|بالطفلة|بالطالب|بالطالبة)\s+(.+)$/);
    return {
      kind: "action",
      proposal: {
        kind: "guardian_link",
        guardianName: cleanValue(source?.[1] ?? linkGuardian[1]!),
        studentName: cleanValue((source?.[2] ?? linkGuardian[2]!).replace(/\s+كولي\s+أمر\s+رئيسي$/, "")),
        makePrimary: /كولي\s+امر\s+رئيسي$/.test(text),
      },
    };
  }

  const addGuardian = text.match(/^(?:اضف|اضيفي?)\s+ولي\s+امر\s+(.+)\s+جوال\s+(\+?\d+)\s+(?:للطفل|للطفلة|للطالب|للطالبة)\s+(.+)$/);
  if (addGuardian) {
    const source = raw.match(/^(?:أضف|اضف|أضيفي?|اضيفي?)\s+ولي\s+أمر\s+(.+)\s+جوال\s+(\+?\d+)\s+(?:للطفل|للطفلة|للطالب|للطالبة)\s+(.+)$/);
    return {
      kind: "action",
      proposal: {
        kind: "guardian_link",
        guardianName: cleanValue(source?.[1] ?? addGuardian[1]!),
        guardianPhone: source?.[2] ?? addGuardian[2]!,
        studentName: cleanValue((source?.[3] ?? addGuardian[3]!).replace(/\s+كولي\s+أمر\s+رئيسي$/, "")),
        makePrimary: /كولي\s+امر\s+رئيسي$/.test(text),
      },
    };
  }

  const addExistingStudent = text.match(/^(?:اضف|اضيفي?)\s+(?:الطفل|الطفلة|الطالب|الطالبة)\s+المسجل(?:ة)?\s+(.+)\s+(?:الي|في)\s+فصل\s+(.+)$/);
  if (addExistingStudent) {
    return { kind: "action", proposal: { kind: "class_membership", action: "add", subject: "student", name: cleanValue(addExistingStudent[1]!), className: cleanValue(addExistingStudent[2]!) } };
  }

  const removeStudentFromClass = text.match(/^(?:ازل|ازيلي|احذف|احذفي)\s+(?:الطفل|الطفلة|الطالب|الطالبة)\s+(.+)\s+من\s+فصل\s+(.+)$/);
  if (removeStudentFromClass) {
    return { kind: "action", proposal: { kind: "class_membership", action: "remove", subject: "student", name: cleanValue(removeStudentFromClass[1]!), className: cleanValue(removeStudentFromClass[2]!) } };
  }

  const renameStaff = text.match(/^(?:غير|غيري|عدل|عدلي)\s+اسم\s+(?:المعلم|المعلمة|الموظف|الموظفة)\s+(.+)\s+الي\s+(.+)$/);
  if (renameStaff) {
    return { kind: "action", proposal: { kind: "staff_rename", currentName: cleanValue(renameStaff[1]!), newName: cleanValue(renameStaff[2]!) } };
  }

  const archiveStaff = text.match(/^(?:ارشف|ارشفي)\s+(?:المعلم|المعلمة|الموظف|الموظفة)\s+(.+)$/);
  if (archiveStaff) {
    return { kind: "action", proposal: { kind: "staff_archive", staffName: cleanValue(archiveStaff[1]!) } };
  }

  const assignStaff = text.match(/^(?:عين|عيني|اضف|اضيفي?)\s+(?:المعلم|المعلمة|الموظف|الموظفة)\s+(.+)\s+(?:الي|في)\s+فصل\s+(.+)$/);
  if (assignStaff) {
    return { kind: "action", proposal: { kind: "staff_assign_class", staffName: cleanValue(assignStaff[1]!), className: cleanValue(assignStaff[2]!) } };
  }

  const removeStaffFromClass = text.match(/^(?:ازل|ازيلي|احذف|احذفي)\s+(?:المعلم|المعلمة|الموظف|الموظفة)\s+(.+)\s+من\s+فصل\s+(.+)$/);
  if (removeStaffFromClass) {
    return { kind: "action", proposal: { kind: "class_membership", action: "remove", subject: "staff", name: cleanValue(removeStaffFromClass[1]!), className: cleanValue(removeStaffFromClass[2]!) } };
  }

  const createStaff = text.match(/^(?:اضف|اضيفي?)\s+(?:معلم|معلمة|موظف|موظفة)\s+(.+)$/);
  if (createStaff) {
    const period = /مسائي|مسائية/.test(text) ? "EVENING" : "MORNING";
    const name = cleanValue(createStaff[1]!.replace(/\s+(?:صباحي|صباحية|مسائي|مسائية)\s*$/, ""));
    return { kind: "action", proposal: { kind: "staff_create", name, period } };
  }

  const shift = text.match(/^(?:انشئ|انشئي|عدل|عدلي)\s+مناوبة\s+(?:للمعلم|للمعلمة|للموظف|للموظفة)\s+(.+)\s+(?:بتاريخ|تاريخ)\s+(\d{4}-\d{2}-\d{2})\s+من\s+(\d{2}:\d{2})\s+الي\s+(\d{2}:\d{2})(?:\s+في\s+فصل\s+(.+))?$/);
  if (shift) {
    return { kind: "action", proposal: { kind: "shift_save", staffName: cleanValue(shift[1]!), date: shift[2]!, startTime: shift[3]!, endTime: shift[4]!, ...(shift[5] ? { className: cleanValue(shift[5]) } : {}), updateExisting: /^(?:عدل|عدلي)/.test(text) } };
  }

  const createStaffAccount = text.match(/^(?:انشئ|انشئي)\s+حساب\s+(?:للمعلم|للمعلمة|للموظف|للموظفة)\s+(.+)\s+بالبريد\s+([^\s]+)$/);
  if (createStaffAccount) {
    return { kind: "action", proposal: { kind: "staff_account", action: "create", staffName: cleanValue(createStaffAccount[1]!), email: createStaffAccount[2]! } };
  }
  const staffAccountAction = text.match(/^(?:اعد|اعيدي)\s+ارسال\s+دعوة\s+(?:المعلم|المعلمة|الموظف|الموظفة)\s+(.+)$|^(?:عطل|عطلي|فعل|فعلي)\s+حساب\s+(?:المعلم|المعلمة|الموظف|الموظفة)\s+(.+)$/);
  if (staffAccountAction) {
    const resend = staffAccountAction[1];
    const name = cleanValue(resend ?? staffAccountAction[2]!);
    const action = resend ? "resend" : /^(?:فعل|فعلي)/.test(text) ? "enable" : "disable";
    return { kind: "action", proposal: { kind: "staff_account", action, staffName: name } };
  }

  const renameClass = text.match(/^(?:غير|غيري|عدل|عدلي)\s+اسم\s+فصل\s+(.+)\s+الي\s+(.+)$/);
  if (renameClass) return { kind: "action", proposal: { kind: "class_update", className: cleanValue(renameClass[1]!), newName: cleanValue(renameClass[2]!) } };
  const capacityClass = text.match(/^(?:عدل|عدلي|اجعل|اجعلي)\s+سعة\s+فصل\s+(.+)\s+(?:الي|تساوي)\s+(\d+)$/);
  if (capacityClass) return { kind: "action", proposal: { kind: "class_update", className: cleanValue(capacityClass[1]!), capacity: Number(capacityClass[2]) } };
  const stageClass = text.match(/^(?:غير|غيري|عدل|عدلي)\s+مرحلة\s+فصل\s+(.+)\s+الي\s+(.+)$/);
  if (stageClass) return { kind: "action", proposal: { kind: "class_update", className: cleanValue(stageClass[1]!), stageName: cleanValue(stageClass[2]!) } };
  const archiveClass = text.match(/^(?:ارشف|ارشفي)\s+فصل\s+(.+)$/);
  if (archiveClass) return { kind: "action", proposal: { kind: "class_archive", className: cleanValue(archiveClass[1]!) } };

  const restoreAll = text.match(/^(?:استعد|استعيد|استرجع)\s+(?:كل|جميع)\s+(الاطفال|الطلاب|المعلمين|الموظفين|الفصول)(?:\s+من\s+السلة)?$/);
  if (restoreAll) {
    const recordType = /فصول/.test(restoreAll[1]!) ? "class" : /معلم|موظف/.test(restoreAll[1]!) ? "staff" : "student";
    return { kind: "action", proposal: { kind: "restore_all", recordType } };
  }

  const updateEventName = text.match(/^(?:غير|غيري|عدل|عدلي)\s+اسم\s+(?:الحدث|الموعد)\s+(.+)\s+الي\s+(.+)$/);
  if (updateEventName) return { kind: "action", proposal: { kind: "calendar_update", title: cleanValue(updateEventName[1]!), newTitle: cleanValue(updateEventName[2]!) } };
  const moveEvent = text.match(/^(?:انقل|انقلي|غير|غيري)\s+تاريخ\s+(?:الحدث|الموعد)\s+(.+)\s+الي\s+(\d{4}-\d{2}-\d{2})$/);
  if (moveEvent) return { kind: "action", proposal: { kind: "calendar_update", title: cleanValue(moveEvent[1]!), date: moveEvent[2]! } };
  const targetEvent = text.match(/^(?:اربط|اربطي|خصص|خصصي)\s+(?:الحدث|الموعد)\s+(.+)\s+(?:بفصل|لفصل)\s+(.+)$/);
  if (targetEvent) return { kind: "action", proposal: { kind: "calendar_update", title: cleanValue(targetEvent[1]!), className: cleanValue(targetEvent[2]!) } };
  const targetEventStaff = text.match(/^(?:اربط|اربطي|خصص|خصصي)\s+(?:الحدث|الموعد)\s+(.+)\s+(?:بالمعلم|بالمعلمة|للمعلم|للمعلمة)\s+(.+)$/);
  if (targetEventStaff) return { kind: "action", proposal: { kind: "calendar_update", title: cleanValue(targetEventStaff[1]!), staffName: cleanValue(targetEventStaff[2]!) } };
  const deleteEvent = text.match(/^(?:احذف|احذفي)\s+(?:الحدث|الموعد)\s+(.+)$/);
  if (deleteEvent) return { kind: "action", proposal: { kind: "calendar_delete", title: cleanValue(deleteEvent[1]!) } };
  const createTargetedEvent = text.match(/^(?:انشئ|انشئي|اضف|اضيفي?)\s+(?:حدث|موعد)\s+(.+?)\s+(?:بتاريخ|تاريخ)\s+(\d{4}-\d{2}-\d{2})(?:\s+(لفصل|للمعلم|للمعلمة)\s+(.+))?$/);
  if (createTargetedEvent) return { kind: "action", proposal: { kind: "calendar_create", type: "ANNOUNCEMENT", title: cleanValue(createTargetedEvent[1]!), date: createTargetedEvent[2]!, allDay: true, ...(createTargetedEvent[3] === "لفصل" ? { className: cleanValue(createTargetedEvent[4]!) } : createTargetedEvent[4] ? { staffName: cleanValue(createTargetedEvent[4]) } : {}) } };

  const createUnit = text.match(/^(?:انشئ|انشئي|اضف|اضيفي?)\s+وحد(?:ه|ة)\s+(.+?)(?:\s+من\s+(\d{4}-\d{2}-\d{2})\s+الي\s+(\d{4}-\d{2}-\d{2}))?(?:\s+(?:لفصل|في\s+فصل)\s+(.+))?$/);
  if (createUnit) return { kind: "action", proposal: { kind: "unit_create", name: cleanValue(createUnit[1]!), ...(createUnit[2] ? { startDate: createUnit[2] } : {}), ...(createUnit[3] ? { endDate: createUnit[3] } : {}), ...(createUnit[4] ? { className: cleanValue(createUnit[4]) } : {}) } };
  const createLesson = text.match(/^(?:انشئ|انشئي|اضف|اضيفي?)\s+درس\s+(.+)\s+(?:في\s+وحد(?:ه|ة)|لوحد(?:ه|ة)|للوحد(?:ه|ة))\s+(.+)$/);
  if (createLesson) return { kind: "action", proposal: { kind: "lesson_create", title: cleanValue(createLesson[1]!), unitName: cleanValue(createLesson[2]!) } };
  const createActivity = text.match(/^(?:انشئ|انشئي|اضف|اضيفي?)\s+نشاط\s+(.+)\s+من\s+(\d{4}-\d{2}-\d{2})\s+الي\s+(\d{4}-\d{2}-\d{2})(?:\s+(?:لفصل|في\s+فصل)\s+(.+))?$/);
  if (createActivity) return { kind: "action", proposal: { kind: "activity_create", name: cleanValue(createActivity[1]!), startDate: createActivity[2]!, endDate: createActivity[3]!, ...(createActivity[4] ? { className: cleanValue(createActivity[4]) } : {}) } };
  const sendActivity = text.match(/^(?:ارسل|ارسلي)\s+نشاط\s+(.+?)(?:\s+(?:الي|ل)\s+(اولياء\s+الامور|المعلمين|الجميع))?$/);
  if (sendActivity) {
    const audience = /اولياء/.test(sendActivity[2] ?? "") ? "guardians" : /معلمين/.test(sendActivity[2] ?? "") ? "staff" : "both";
    return { kind: "action", proposal: { kind: "activity_send", activityName: cleanValue(sendActivity[1]!), audience } };
  }
  const deleteUnitFile = text.match(/^(?:احذف|احذفي)\s+ملف\s+(.+)\s+من\s+وحد(?:ه|ة)\s+(.+)$/);
  if (deleteUnitFile) return { kind: "action", proposal: { kind: "unit_file_delete", fileName: cleanValue(deleteUnitFile[1]!), unitName: cleanValue(deleteUnitFile[2]!) } };

  const approveCare = text.match(/^(?:اعتمد|اعتمدي|اقبل|اقبلي)\s+تقرير\s+الرعاي(?:ه|ة)\s+(?:للطفل|للطفلة|للطالب|للطالبة)\s+(.+)$/);
  if (approveCare) return { kind: "action", proposal: { kind: "care_review", action: "approve", studentName: cleanValue(approveCare[1]!) } };
  const returnCare = text.match(/^(?:ارجع|ارجعي|اعد|اعيدي)\s+تقرير\s+الرعاي(?:ه|ة)\s+(?:للطفل|للطفلة|للطالب|للطالبة)\s+(.+)\s+(?:مع\s+ملاحظ(?:ه|ة)|بملاحظ(?:ه|ة))\s+(.+)$/);
  if (returnCare) return { kind: "action", proposal: { kind: "care_review", action: "return", studentName: cleanValue(returnCare[1]!), note: cleanValue(returnCare[2]!) } };
  const editCare = text.match(/^(?:عدل|عدلي)\s+ملاحظ(?:ه|ة)\s+تقرير\s+الرعاي(?:ه|ة)\s+(?:للطفل|للطفلة|للطالب|للطالبة)\s+(.+)\s+الي\s+(.+)$/);
  if (editCare) return { kind: "action", proposal: { kind: "care_edit", studentName: cleanValue(editCare[1]!), note: cleanValue(editCare[2]!) } };
  const deleteCare = text.match(/^(?:احذف|احذفي)\s+تقرير\s+الرعاي(?:ه|ة)\s+(?:للطفل|للطفلة|للطالب|للطالبة)\s+(.+)$/);
  if (deleteCare) return { kind: "action", proposal: { kind: "care_delete", studentName: cleanValue(deleteCare[1]!) } };
  const resubmitCare = text.match(/^(?:اعد|اعيدي)\s+ارسال\s+تقرير\s+الرعاي(?:ه|ة)\s+(?:للطفل|للطفلة|للطالب|للطالبة)\s+(.+)$/);
  if (resubmitCare) return { kind: "action", proposal: { kind: "care_resubmit", studentName: cleanValue(resubmitCare[1]!) } };

  const invoice = text.match(/^(?:انشئ|انشئي|اصدر|اصدري)\s+فاتور(?:ه|ة)\s+(?:للطفل|للطفلة|للطالب|للطالبة|راتب\s+للمعلم|راتب\s+للمعلمة|للمعلم|للمعلمة)\s+(.+)$/);
  if (invoice) return { kind: "action", proposal: { kind: "invoice_create", subject: /راتب|معلم|معلمة/.test(text) ? "staff" : "student", name: cleanValue(invoice[1]!) } };
  const stopExpense = text.match(/^(?:اوقف|اوقفي)\s+(?:تكرار\s+)?(?:المصروف|مصروف)\s+(.+)$/);
  if (stopExpense) return { kind: "action", proposal: { kind: "expense_stop", title: cleanValue(stopExpense[1]!) } };
  const updateExpenseAmount = text.match(/^(?:عدل|عدلي|غير|غيري)\s+مبلغ\s+(?:المصروف|مصروف)\s+(.+)\s+الي\s+(\d+(?:\.\d{1,2})?)$/);
  if (updateExpenseAmount) return { kind: "action", proposal: { kind: "expense_update", title: cleanValue(updateExpenseAmount[1]!), amount: Number(updateExpenseAmount[2]) } };
  const financialReport = text.match(/^(?:انشئ|انشئي|اصدر|اصدري)\s+تقرير\s+مالي\s+(شهري|نصف\s+سنوي|سنوي)\s+(.+)$/);
  if (financialReport) return { kind: "action", proposal: { kind: "financial_report", type: financialReport[1] === "شهري" ? "monthly" : financialReport[1] === "سنوي" ? "annual" : "semi_annual", periodLabel: cleanValue(financialReport[2]!) } };
  const opening = text.match(/^(?:عين|عيني|عدل|عدلي)\s+الرصيد\s+الافتتاحي\s+(?:الي\s+)?(-?\d+(?:\.\d{1,2})?)(?:\s+بتاريخ\s+(\d{4}-\d{2}-\d{2}))?$/);
  if (opening) return { kind: "action", proposal: { kind: "finance_opening", amount: Number(opening[1]), date: opening[2] ?? null } };
  const bulkRenew = text.match(/^(?:جدد|جددي)\s+اشتراكات\s+(?:كل|جميع)\s+الاطفال(?:\s+في\s+فصل\s+(.+))?$/);
  if (bulkRenew) return { kind: "action", proposal: { kind: "bulk_renew", ...(bulkRenew[1] ? { className: cleanValue(bulkRenew[1]) } : {}) } };
  const bulkReminder = text.match(/^(?:ارسل|ارسلي)\s+تذكيرات\s+(دفع|تجديد)\s+(?:لكل|لجميع)\s+الاطفال(?:\s+في\s+فصل\s+(.+))?$/);
  if (bulkReminder) return { kind: "action", proposal: { kind: "bulk_reminder", reminderKind: bulkReminder[1] === "دفع" ? "payment" : "renewal", ...(bulkReminder[2] ? { className: cleanValue(bulkReminder[2]) } : {}) } };

  const enrollmentLink = text.match(/^(?:انشئ|انشئي|ارسل|ارسلي)\s+رابط\s+تسجيل\s+(?:الي|للبريد)\s+([^\s]+)$/);
  if (enrollmentLink) return { kind: "action", proposal: { kind: "enrollment_link", email: enrollmentLink[1]! } };
  const enrollmentReview = text.match(/^(?:اقبل|اقبلي|ارفض|ارفضي)\s+طلب\s+تسجيل\s+(.+?)(?:\s+(?:في|الي)\s+فصل\s+(.+))?$/);
  if (enrollmentReview) return { kind: "action", proposal: { kind: "enrollment_review", action: /ارفض|ارفضي/.test(text) ? "reject" : "approve", studentName: cleanValue(enrollmentReview[1]!), ...(enrollmentReview[2] ? { className: cleanValue(enrollmentReview[2]) } : {}) } };
  const importConfirm = text.match(/^(?:اكد|اكدي)\s+استيراد\s+(?:الجلسه\s+)?([a-zA-Z0-9_-]{8,100})$/);
  if (importConfirm) return { kind: "action", proposal: { kind: "import_confirm", sessionId: importConfirm[1]! } };

  const feeSetting = text.match(/^(?:عين|عيني|عدل|عدلي)\s+(رسوم\s+التاخير|الرسوم\s+اليومي(?:ه|ة)|الرسوم\s+الاسبوعي(?:ه|ة)|الرسوم\s+الشهري(?:ه|ة)|الرسوم\s+السنوي(?:ه|ة))\s+(?:الي\s+)?(\d+(?:\.\d{1,2})?)$/);
  if (feeSetting) {
    const label = feeSetting[1]!.replace(/ة/g, "ه");
    const fields = { "رسوم التاخير": "hourlyLateFee", "الرسوم اليوميه": "dailyStudentFee", "الرسوم الاسبوعيه": "weeklyStudentFee", "الرسوم الشهريه": "monthlyStudentFee", "الرسوم السنويه": "yearlyStudentFee" } as const;
    return { kind: "action", proposal: { kind: "settings_update", field: fields[label as keyof typeof fields], value: Number(feeSetting[2]) } };
  }
  const workTime = text.match(/^(?:عين|عيني|عدل|عدلي)\s+وقت\s+(دخول|خروج)\s+(الاطفال|المعلمين)\s+(الصباحي|المسائي)\s+(?:الي\s+)?(\d{2}:\d{2})$/);
  if (workTime) {
    const actor = workTime[2] === "الاطفال" ? "student" : "teacher";
    const period = workTime[3] === "الصباحي" ? "Morning" : "Evening";
    const action = workTime[1] === "دخول" ? "CheckinTime" : "CheckoutTime";
    return { kind: "action", proposal: { kind: "settings_update", field: `${actor}${period}${action}` as "studentMorningCheckinTime", value: workTime[4]! } };
  }
  const stageCreate = text.match(/^(?:اضف|اضيفي?)\s+مرحل(?:ه|ة)\s+دراسي(?:ه|ة)\s+(.+)$/);
  if (stageCreate) return { kind: "action", proposal: { kind: "stage_manage", action: "create", name: cleanValue(stageCreate[1]!) } };
  const stageRename = text.match(/^(?:غير|غيري|عدل|عدلي)\s+اسم\s+المرحل(?:ه|ة)\s+(.+)\s+الي\s+(.+)$/);
  if (stageRename) return { kind: "action", proposal: { kind: "stage_manage", action: "rename", name: cleanValue(stageRename[1]!), newName: cleanValue(stageRename[2]!) } };
  const stageArchive = text.match(/^(?:ارشف|ارشفي|استعد|استعيد)\s+المرحل(?:ه|ة)\s+(.+)$/);
  if (stageArchive) return { kind: "action", proposal: { kind: "stage_manage", action: /استعد|استعيد/.test(text) ? "restore" : "archive", name: cleanValue(stageArchive[1]!) } };
  const arrival = text.match(/^(?:اضف|اضيفي?|ازل|ازيلي)\s+(.+)\s+(?:الي|من)\s+مستلمي\s+اشعار\s+الوصول$/);
  if (arrival) return { kind: "action", proposal: { kind: "arrival_recipient", action: /^(?:ازل|ازيلي)/.test(text) ? "remove" : "add", accountName: cleanValue(arrival[1]!) } };
  const schoolInfo = text.match(/^(?:عدل|عدلي|غير|غيري)\s+(اسم\s+المنشا(?:ه|ة)|رقم\s+التواصل|رقم\s+الهاتف|عنوان\s+المنشا(?:ه|ة)|السجل\s+التجاري|الرقم\s+الضريبي)\s+الي\s+(.+)$/);
  if (schoolInfo) {
    const label = schoolInfo[1]!;
    const field = label.startsWith("اسم") ? "name" : label === "رقم التواصل" ? "contactNumber" : label === "رقم الهاتف" ? "phoneNumber" : label.startsWith("عنوان") ? "address" : label === "السجل التجاري" ? "commercialRegistration" : "vatNumber";
    return { kind: "action", proposal: { kind: "school_info", field, value: cleanValue(schoolInfo[2]!) } };
  }
  if (/^(?:حدث|حدثي|اعد|اعيدي)\s+حساب\s+مساح(?:ه|ة)\s+التخزين$/.test(text)) return { kind: "action", proposal: { kind: "storage_refresh" } };

  const createStudentInClass = text.match(/^(?:اضف|اضيفي?)\s+(?:طفل|طفلة|طالب|طالبة)\s+(.+)\s+(?:الي|في)\s+فصل\s+(.+)$/);
  if (createStudentInClass) {
    const source = raw.match(/^(?:أضف|اضف|أضيفي?|اضيفي?)\s+(?:طفل|طفلة|طالب|طالبة)\s+(.+)\s+(?:إلى|الى|في)\s+فصل\s+(.+)$/);
    return {
      kind: "action",
      proposal: {
        kind: "student_create",
        name: cleanValue(source?.[1] ?? createStudentInClass[1]!),
        className: cleanValue(source?.[2] ?? createStudentInClass[2]!),
      },
    };
  }
  const createStudent = text.match(/^(?:اضف|اضيفي?)\s+(?:طفل|طفلة|طالب|طالبة)\s+(.+)$/);
  if (createStudent) {
    const source = raw.match(/^(?:أضف|اضف|أضيفي?|اضيفي?)\s+(?:طفل|طفلة|طالب|طالبة)\s+(.+)$/);
    return { kind: "action", proposal: { kind: "student_create", name: cleanValue(source?.[1] ?? createStudent[1]!) } };
  }

  const attendance = text.match(/^(?:سجل|سجلي|تسجيل)\s+(حضور|دخول|خروج|انصراف)\s+(.+)$/);
  if (attendance) {
    const operation = /خروج|انصراف/.test(attendance[1]!) ? "checkout" : "checkin";
    const remainder = raw.match(/^(?:سجل|سجلي|تسجيل)\s+(?:حضور|دخول|خروج|انصراف)\s+(.+)$/)?.[1] ?? attendance[2]!;
    const subject = /^(?:المعلم|المعلمة|الموظف|الموظفة|معلم|معلمة|موظف|موظفة)\b/.test(normalized(remainder))
      ? "staff"
      : "student";
    const name = cleanValue(remainder.replace(/^(?:لل?|ال)?(?:طفل|طفلة|طالب|طالبة|معلم|معلمة|موظف|موظفة)\s+/, ""));
    if (name.length < 2) return actionHelp();
    return { kind: "action", proposal: { kind: "attendance", subject, operation, name } };
  }

  const reminder = text.match(/^(?:ارسل|ارسلي)\s+تذكير(?:\s+دفع)?\s+(.+)$/);
  if (reminder) {
    const remainder = raw.match(/^(?:أرسل|ارسل|أرسلي|ارسلي)\s+تذكير(?:\s+دفع)?\s+(.+)$/)?.[1] ?? reminder[1]!;
    const studentName = cleanValue(remainder.replace(/^(?:لولي\s+أ?مر\s+)?(?:لل?|ال)?(?:طفل|طفلة|طالب|طالبة)?\s*/, ""));
    if (studentName.length < 2) return actionHelp();
    return { kind: "action", proposal: { kind: "payment_reminder", studentName } };
  }

  if (/تقارير?\s+الرعاية/.test(text) && /(?:مباشر|بدون\s+مراجعة|الغاء\s+المراجعة)/.test(text)) {
    return { kind: "action", proposal: { kind: "care_policy", reviewRequired: false } };
  }
  if (/تقارير?\s+الرعاية/.test(text) && /(?:تفعيل|فعل|مراجعة|راجع)/.test(text)) {
    return { kind: "action", proposal: { kind: "care_policy", reviewRequired: true } };
  }

  const restore = text.match(/^(?:استعد|استعيد|استرجع)\s+(طفل|طفلة|طالب|طالبة|معلم|معلمة|موظف|موظفة|فصل)\s+(.+)$/);
  if (restore) {
    const label = restore[1]!;
    const recordType = label === "فصل" ? "class" : /معلم|موظف/.test(label) ? "staff" : "student";
    const name = cleanValue(raw.match(/^(?:استعد|استعيد|استرجع)\s+(?:طفل|طفلة|طالب|طالبة|معلم|معلمة|موظف|موظفة|فصل)\s+(.+)$/)?.[1] ?? restore[2]!);
    if (name.length < 2) return actionHelp();
    return { kind: "action", proposal: { kind: "restore_record", recordType, name } };
  }

  const broadcast = text.match(/^(?:ارسل|ارسلي)\s+اعلان\s+(.+)$/);
  if (broadcast) {
    const source = raw.match(/^(?:أرسل|ارسل|أرسلي|ارسلي)\s+إ?علان\s+(.+)$/)?.[1] ?? broadcast[1]!;
    const separator = source.indexOf(":");
    if (separator < 1) return actionHelp();
    const title = cleanValue(source.slice(0, separator));
    const message = cleanValue(source.slice(separator + 1).replace(/\b\d{4}-\d{2}-\d{2}\b/g, ""));
    const audience = /اولياء|ولي\s+امر/.test(text) && !/معلم|موظف/.test(text)
      ? "guardians"
      : /معلم|موظف/.test(text) && !/اولياء|ولي\s+امر/.test(text)
        ? "staff"
        : "both";
    if (!title || !message) return actionHelp();
    return {
      kind: "action",
      proposal: { kind: "broadcast_create", title, message, date: dateFrom(raw) ?? today, audience },
    };
  }

  const expense = text.match(/^(?:اضف|اضيفي?|سجل|سجلي)\s+مصروف\s+(.+)$/);
  if (expense) {
    const amount = amountFrom(text);
    if (!amount) return actionHelp();
    const remainder = raw.match(/^(?:أضف|اضف|أضيفي?|اضيفي?|سجل|سجلي)\s+مصروف\s+(.+)$/)?.[1] ?? expense[1]!;
    const title = cleanValue(
      remainder
        .replace(/(?:بمبلغ|مبلغ|بقيمة|قيمته|قيمة)\s*\d+(?:\.\d{1,2})?.*$/, "")
    );
    if (!title) return actionHelp();
    const type = /شهري/.test(text) ? "monthly" : "one_time";
    return {
      kind: "action",
      proposal: {
        kind: "expense_create",
        title,
        amount,
        type,
        startDate: dateFrom(raw) ?? today,
      },
    };
  }

  const expenseStatus = text.match(/^(?:حدد|حددي|اعتبر|اجعل)\s+مصروف\s+(.+)\s+(مدفوع|غير\s+مدفوع)$/);
  if (expenseStatus) {
    const dueDate = dateFrom(raw);
    if (!dueDate) return actionHelp();
    const remainder = raw.match(/^(?:حدد|حددي|اعتبر|اجعل)\s+مصروف\s+(.+)\s+(?:مدفوع|غير\s+مدفوع)$/)?.[1] ?? expenseStatus[1]!;
    const title = cleanValue(remainder.replace(/\b\d{4}-\d{2}-\d{2}\b/g, ""));
    return {
      kind: "action",
      proposal: { kind: "expense_status", title, dueDate, status: expenseStatus[2] === "مدفوع" ? "PAID" : "PENDING" },
    };
  }

  const createClass = text.match(/^(?:انشئ|انشئي|اضف|اضيفي?)\s+فصل\s+(.+)$/);
  if (createClass) {
    const period = /مسائي|مسائية/.test(text) ? "EVENING" : "MORNING";
    const remainder = raw.match(/^(?:أنشئ|انشئ|أنشئي|انشئي|أضف|اضف|أضيفي?|اضيفي?)\s+فصل\s+(.+)$/)?.[1] ?? createClass[1]!;
    const name = cleanValue(remainder.replace(/\s+(?:صباحي|صباحية|مسائي|مسائية)\s*$/, ""));
    if (!name) return actionHelp();
    return { kind: "action", proposal: { kind: "class_create", name, period } };
  }

  const calendar = text.match(/^(?:انشئ|انشئي|اضف|اضيفي?)\s+(?:حدث|موعد)\s+(.+)$/);
  if (calendar) {
    const date = dateFrom(raw);
    if (!date) return actionHelp();
    const remainder = raw.match(/^(?:أنشئ|انشئ|أنشئي|انشئي|أضف|اضف|أضيفي?|اضيفي?)\s+(?:حدث|موعد)\s+(.+)$/)?.[1] ?? calendar[1]!;
    const title = cleanValue(remainder.replace(/(?:بتاريخ|تاريخ)\s*\d{4}-\d{2}-\d{2}.*$/, ""));
    if (!title) return actionHelp();
    return { kind: "action", proposal: { kind: "calendar_create", type: "ANNOUNCEMENT", title, date, allDay: true } };
  }

  if (/(?:سجل|ارسل|اضف|اضيف|انشئ|استعد|استعيد|استرجع|حدد|حددي|اعتبر|اجعل)/.test(text)
    && /(?:حضور|خروج|تذكير|مصروف|فصل|حدث|موعد|اعلان|تقارير?\s+الرعاية)/.test(text)) {
    return actionHelp();
  }

  return null;
}
