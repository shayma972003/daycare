/**
 * The dashboard's navigation, as data.
 *
 * Lives here rather than inside `Sidebar.tsx` because that file is a client
 * module: importing it from a test drags React and the i18n provider in, and the
 * shape of the menu is a fact worth asserting on its own.
 *
 * Grouped, because ten flat entries read as ten unrelated places and made the
 * product feel larger than it is. Two rules decided the grouping:
 *
 * 1. **A group must not straddle a permission boundary.** The obvious tidy-up —
 *    filing الإحصائيات under "Administration" with the staff and settings screens
 *    — puts the accountant's only screen inside a group whose other entries they
 *    cannot open. Finance is therefore its own group. `tests/nav-groups.test.ts`
 *    holds that line.
 * 2. **Daily work stays at the top level.** الأطفال, الفصول and الرعاية are opened
 *    many times a day; burying them one level down to shorten the list would
 *    trade a rare cost for a constant one.
 *
 * `permission: null` means any signed-in member. The permission named here
 * mirrors `route-permissions.ts`; it decides what is *drawn*, and every route
 * still enforces its own requirement server-side.
 */

export interface NavItem {
  href: string;
  key: string;
  permission: string | null;
}

export interface NavGroup {
  /** Groups without a key render flat, with no heading. */
  key?: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { href: "/dashboard", key: "nav.home", permission: null },
      { href: "/students", key: "nav.students", permission: "students.view" },
      { href: "/classes", key: "nav.classes", permission: "classes.view" },
      { href: "/care", key: "nav.care", permission: "students.files" },
      { href: "/attendance", key: "nav.attendance", permission: "attendance.students" },
      /* The calendar sat under a "Learning" heading beside the units page.
         Units are a calendar event type now, so that heading stood over a
         single entry — a label with nothing to distinguish. */
      { href: "/calendar", key: "nav.calendar", permission: "schedule.view" },
    ],
  },
  {
    key: "nav.groupFinance",
    items: [{ href: "/statistics", key: "nav.statistics", permission: "finance.view" }],
  },
  {
    key: "nav.groupAdmin",
    items: [
      { href: "/teachers", key: "nav.teachers", permission: "staff.view" },
      /* The rota lost its own entry: it is opened from the staff list it
         describes (`/teachers?drawer=rota`) and from each teacher's profile. */
      { href: "/settings", key: "nav.settings", permission: "settings.manage" },
    ],
  },
];
