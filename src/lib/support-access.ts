export const SUPPORT_PREVIEW_VIEWS = [
  "overview",
  "attendance",
  "calendar",
  "finance",
  "accounts",
  "settings",
] as const;

export type SupportPreviewView = (typeof SUPPORT_PREVIEW_VIEWS)[number];

export function isSupportPreviewView(value: string | null): value is SupportPreviewView {
  return SUPPORT_PREVIEW_VIEWS.includes(value as SupportPreviewView);
}

export const SUPPORT_TOOL_ACTIONS = ["REFRESH_STORAGE_USAGE"] as const;
export type SupportToolAction = (typeof SUPPORT_TOOL_ACTIONS)[number];

export function isSupportToolAction(value: string): value is SupportToolAction {
  return SUPPORT_TOOL_ACTIONS.includes(value as SupportToolAction);
}

/** Read-only capabilities available while platform support views a tenant. */
export const SUPPORT_VIEW_PERMISSIONS = [
  "auth.portal",
  "staff.view",
  "students.view",
  "classes.view",
  "units.view",
  "schedule.view",
  "attendance.students",
  "attendance.staff",
] as const;
