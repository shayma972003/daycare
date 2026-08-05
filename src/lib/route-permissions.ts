/**
 * Which permission each tenant API route requires.
 *
 * A table rather than a `withPermission(...)` wrapper on each of the 128 route
 * files. Both are defensible; this one was chosen because the failure mode is
 * better. A per-file wrapper is invisible when it is missing — a new route ships
 * with no check and looks exactly like every other file — whereas an unmatched
 * path here is caught by `DEFAULT_REQUIREMENT` and refused. Enforcement is also
 * in one place, so "what can an accountant reach" is a question with an answer
 * you can read.
 *
 * Enforced in `requireSession()` (src/lib/session.ts), which every tenant route
 * already calls, using the path and method `src/proxy.ts` forwards on request
 * headers.
 *
 * Matching is longest-prefix on the URL path with `[params]` collapsed, so
 * `/api/students/abc123/late-fee` resolves against `/api/students/:id/late-fee`.
 */

import { ALL_PERMISSIONS } from "@/lib/permissions";

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** `null` means "any signed-in member of the school" — no extra permission. */
export type Requirement = string | null;

export interface RouteRule {
  /** Applied to every method not named in `methods`. */
  default?: Requirement;
  methods?: Partial<Record<Method, Requirement>>;
}

/**
 * Routes that manage their own access and must not be gated here.
 *
 * These never reach `requireSession()` — they are the super-admin panel (its own
 * JWT), the sign-in endpoints, the self-service enrolment
 * links a parent opens before any account exists, and the stored-file route
 * (which accepts three different credentials and picks among them itself).
 * Listed for the reader; the matcher in `src/proxy.ts` already skips them.
 */
export const UNGATED_PREFIXES = [
  "/api/auth",
  "/api/admin",
  "/api/mobile",
  "/api/enrollment",
  "/api/files",
];

/**
 * Refused when no rule matches.
 *
 * The wildcard means only a school owner (or a role explicitly granted "*") can
 * reach a route nobody has classified. A new endpoint is therefore usable by its
 * author on day one and invisible to everyone else until it is listed — which is
 * the right way round.
 */
export const DEFAULT_REQUIREMENT: Requirement = ALL_PERMISSIONS;

export const ROUTE_PERMISSIONS: Record<string, RouteRule> = {
  // ── Students ────────────────────────────────────────────────────────────
  "/api/students": {
    methods: { GET: "students.view", POST: "students.manage" },
  },
  "/api/students/bulk": { default: "students.manage" },
  "/api/students/bulk-status": { default: "students.manage" },
  "/api/students/bulk-extend": { default: "students.manage" },
  "/api/students/:id": {
    methods: {
      GET: "students.view",
      PUT: "students.manage",
      DELETE: "students.delete",
    },
  },
  "/api/students/:id/avatar": { default: "students.manage" },
  "/api/students/:id/evaluation": { default: "students.files" },
  // Leaving and returning change the retention clock — an archive action, not an
  // edit. See docs/DATA_LIFECYCLE.md.
  "/api/students/:id/cancel": { default: "students.archive" },
  "/api/students/:id/reactivate": { default: "students.archive" },
  "/api/students/:id/checkin": { default: "attendance.students" },
  "/api/students/:id/checkout": { default: "attendance.students" },
  "/api/students/:id/late-fee": { default: "finance.manage" },
  "/api/students/:id/invoice": { default: "finance.manage" },
  "/api/students/:id/reminder": { default: "finance.manage" },

  // ── Staff ───────────────────────────────────────────────────────────────
  "/api/teachers": {
    methods: { GET: "staff.view", POST: "staff.manage" },
  },
  "/api/teachers/bulk": { default: "staff.manage" },
  "/api/teachers/:id": {
    methods: { GET: "staff.view", PUT: "staff.manage", DELETE: "staff.delete" },
  },
  "/api/teachers/:id/classes": { default: "staff.view" },
  "/api/teachers/:id/cancel": { default: "staff.archive" },
  "/api/teachers/:id/checkin": { default: "attendance.staff" },
  "/api/teachers/:id/checkout": { default: "attendance.staff" },
  // Payroll. Deliberately finance, not staff: an HR account manages people and
  // their attendance; what they are paid is a separate question.
  "/api/teachers/:id/invoice": { default: "finance.manage" },
  "/api/teachers/:id/late-fee": { default: "finance.manage" },
  "/api/teachers/:id/reminder": { default: "finance.manage" },

  // ── Classes ─────────────────────────────────────────────────────────────
  "/api/classes": { methods: { GET: "classes.view", POST: "classes.manage" } },
  "/api/classes/:id": {
    methods: {
      GET: "classes.view",
      PUT: "classes.manage",
      DELETE: "classes.archive",
    },
  },
  "/api/classes/:id/students": { default: "classes.view" },
  "/api/classes/:id/available-students": { default: "classes.assign" },
  "/api/classes/:id/add-students": { default: "classes.assign" },

  // ── Attendance ──────────────────────────────────────────────────────────
  "/api/attendance/page-data": { default: "attendance.students" },
  "/api/attendance/students/checkin": { default: "attendance.students" },
  "/api/attendance/students/checkout": { default: "attendance.students" },
  "/api/attendance/students/today": { default: "attendance.students" },
  "/api/attendance/students/status": { default: "attendance.students" },
  "/api/attendance/week": { default: "attendance.students" },
  "/api/students/:id/schedule": { default: "students.manage" },
  "/api/attendance/teachers/checkin": { default: "attendance.staff" },
  "/api/attendance/teachers/checkout": { default: "attendance.staff" },
  "/api/attendance/teachers/today": { default: "attendance.staff" },
  "/api/attendance/teachers/bulk-action": { default: "attendance.staff" },
  // ── Activities and schedule ─────────────────────────────────────────────
  "/api/activities": {
    methods: { GET: "schedule.view", POST: "schedule.manage" },
  },
  "/api/activities/:id": {
    methods: {
      GET: "schedule.view",
      PUT: "schedule.manage",
      DELETE: "schedule.delete",
    },
  },
  "/api/activities/:id/send": { default: "schedule.manage" },

  // ── Finance ─────────────────────────────────────────────────────────────
  "/api/invoices": { default: "finance.view" },
  "/api/invoices/:id": {
    methods: { GET: "finance.view", DELETE: "finance.manage" },
  },
  "/api/invoices/generate": { default: "finance.manage" },
  "/api/invoices/generate/teacher": { default: "finance.manage" },
  "/api/invoices/prefill/:id": { default: "finance.manage" },
  "/api/invoices/prefill/teacher/:id": { default: "finance.manage" },
  "/api/expenses": { methods: { GET: "finance.view", POST: "finance.manage" } },
  "/api/expenses/:id": {
    methods: { GET: "finance.view", PUT: "finance.manage", DELETE: "finance.manage" },
  },
  "/api/expenses/:id/stop": { default: "finance.manage" },
  "/api/financial-reports": { default: "finance.view" },
  "/api/financial-reports/generate": { default: "finance.manage" },
  "/api/statistics/dashboard": { default: "finance.view" },
  "/api/statistics/export/excel": { default: "finance.view" },

  // ── Calendar and teaching units ─────────────────────────────────────────
  "/api/calendar": {
    methods: { GET: "schedule.view", POST: "schedule.manage" },
  },
  "/api/calendar/:id": {
    methods: { PUT: "schedule.manage", DELETE: "schedule.delete" },
  },
  "/api/units": { methods: { GET: "units.view", POST: "units.manage" } },
  "/api/units/:id": {
    methods: {
      GET: "units.view",
      // Archiving rides on `units.manage` because it is the same PUT; the
      // separate `units.archive` key exists for a future dedicated action.
      PUT: "units.manage",
      DELETE: "units.delete",
    },
  },
  "/api/units/:id/lessons": { default: "units.manage" },
  // Rota — staff scheduling, so it rides with the schedule permissions.
  "/api/shifts": { methods: { GET: "schedule.view", POST: "schedule.manage", DELETE: "schedule.delete" } },
  // Roster counts are read by the dashboard; any signed-in member may see them.
  "/api/statistics/roster": { default: null },

  // Both answer only for the caller and filter their own contents by the
  // permissions that caller holds, so the gate here is "signed in".
  "/api/me": { default: null },
  "/api/dashboard/tasks": { default: null },
  "/api/search": { default: null },
  "/api/storage": { methods: { GET: null, POST: "settings.storage" } },
  "/api/units/:id/files": { default: "units.manage" },
  "/api/units/:id/files/:fileId": { default: "units.manage" },

  // ── Daily care reports ──────────────────────────────────────────────────
  // Filing them is the teacher's core job, so it rides on `attendance.students`
  // — the permission every classroom role already holds — rather than needing a
  // separate box that would have to be ticked for all of them anyway.
  // Deleting is narrower: retracting something a parent has already read.
  "/api/care-reports": {
    methods: { GET: "students.view", POST: "attendance.students" },
  },
  "/api/care-reports/:id": {
    methods: { PUT: "attendance.students", DELETE: "students.manage" },
  },
  // Same permission as filing the report the photo will be attached to. Listed
  // before `:id` would match it — the table is exact-path, but keeping the pair
  // adjacent is what stops one being changed without the other.
  "/api/care-reports/photo": {
    methods: { POST: "attendance.students" },
  },

  // ── Guardians, notifications, import/export ─────────────────────────────
  "/api/guardians/search": { default: "students.guardians" },
  "/api/students/:id/guardians": { default: "students.guardians" },
  // Sending reminders is a finance action, not a messaging one — it chases money
  // and it is what an accountant needs.
  "/api/reminders": { methods: { GET: "finance.view", POST: "finance.manage" } },
  "/api/notifications": { default: null },
  "/api/notifications/alerts": { default: null },
  "/api/notifications/admin-messages": { default: null },
  "/api/notifications/log/:id": { default: "settings.manage" },
  "/api/notifications/log/bulk": { default: "settings.manage" },
  "/api/import/upload": { default: "students.manage" },
  "/api/import/:id": { default: "students.manage" },
  "/api/import/:id/mapping": { default: "students.manage" },
  "/api/import/:id/detect-mapping": { default: "students.manage" },
  "/api/import/:id/validate": { default: "students.manage" },
  "/api/import/:id/confirm": { default: "students.manage" },
  "/api/upload": { default: null },

  // ── Trash ───────────────────────────────────────────────────────────────
  // Restoring is an archive-level action; erasing for good is a delete.
  "/api/trash/students": { default: "students.archive" },
  "/api/trash/teachers": { default: "staff.archive" },
  "/api/trash/classes": { default: "classes.archive" },
  "/api/trash/restore/student/:id": { default: "students.archive" },
  "/api/trash/restore/teacher/:id": { default: "staff.archive" },
  "/api/trash/restore/class/:id": { default: "classes.archive" },
  "/api/trash/restore-all/students": { default: "students.archive" },
  "/api/trash/restore-all/teachers": { default: "staff.archive" },
  "/api/trash/restore-all/classes": { default: "classes.archive" },
  "/api/trash/permanent/student/:id": { default: "students.delete" },
  "/api/trash/permanent/teacher/:id": { default: "staff.delete" },
  "/api/trash/permanent/class/:id": { default: "classes.archive" },

  // ── Settings ────────────────────────────────────────────────────────────
  // GET is open: the dashboard reads fee settings and school hours on almost
  // every screen, and a teacher who cannot read them sees an empty timetable.
  "/api/settings": { methods: { GET: null, PUT: "settings.manage" } },
  /**
   * Academic stages (task 2.44).
   *
   * Readable by anyone signed in — the stage appears in nearly every picker in
   * the product, and a teacher who cannot read the list sees empty dropdowns.
   * Changing the list is a settings decision.
   */
  "/api/academic-stages": { methods: { GET: null, POST: "settings.manage" } },
  "/api/academic-stages/:id": { default: "settings.manage" },
  "/api/settings/logo": { default: "settings.manage" },
  "/api/settings/logs": { default: "settings.manage" },
  "/api/settings/logs/export": { default: "settings.manage" },
  "/api/settings/2fa/activate": { default: "settings.manage" },
  "/api/settings/2fa/deactivate": { default: "settings.manage" },
  "/api/settings/2fa/send-activation-otp": { default: "settings.manage" },
  // Changing your *own* password is not an administrative act.
  "/api/settings/password": { default: null },

  // ── Roles ───────────────────────────────────────────────────────────────
  "/api/roles": { methods: { GET: "staff.view", POST: "staff.manage" } },
  "/api/roles/:id": { default: "staff.manage" },
  "/api/staff-accounts": { methods: { GET: "staff.view", POST: "staff.manage" } },
  "/api/staff-accounts/:id": { default: "staff.manage" },
  "/api/guardian-accounts": {
    methods: { GET: "students.guardians", POST: "students.guardians" },
  },
  "/api/guardian-accounts/:id/invite": { default: "students.guardians" },
};

/**
 * Collapses concrete ids to `:id` so a request path can be looked up.
 *
 * A segment is treated as an id when it looks like one — a cuid/uuid, or any
 * long opaque token. Named segments ("bulk", "generate", "teacher") are short
 * and lower-case, so the heuristic keeps them.
 */
function normalizeSegment(segment: string): string {
  if (/^c[a-z0-9]{20,}$/i.test(segment)) return ":id";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) return ":id";
  if (/^[A-Za-z0-9_-]{16,}$/.test(segment)) return ":id";
  if (/^\d+$/.test(segment)) return ":id";
  return segment;
}

export function normalizePath(pathname: string): string {
  const clean = pathname.split("?")[0].replace(/\/+$/, "") || "/";
  return clean.split("/").map(normalizeSegment).join("/");
}

export function isUngated(pathname: string): boolean {
  return UNGATED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

/**
 * The permission a request needs.
 *
 * Falls back to the longest matching parent so a sub-route added without a rule
 * inherits its parent's requirement rather than dropping to the wildcard — a new
 * `/api/students/:id/notes` should behave like the rest of `/api/students/:id`.
 */
export function requirementFor(pathname: string, method: string): Requirement {
  const normalized = normalizePath(pathname);
  const verb = method.toUpperCase() as Method;

  let candidate: string | null = normalized;
  while (candidate && candidate !== "/api" && candidate.length > 1) {
    const rule = ROUTE_PERMISSIONS[candidate];
    if (rule) {
      if (rule.methods && verb in rule.methods) {
        return rule.methods[verb] as Requirement;
      }
      if (rule.default !== undefined) return rule.default;
    }
    const cut = candidate.lastIndexOf("/");
    candidate = cut > 0 ? candidate.slice(0, cut) : null;
  }

  return DEFAULT_REQUIREMENT;
}
