import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { canDismissDialog, closeDialogOnOpenChange } from "@/components/ui/Dialog";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const migrated = [
  "src/components/activities/ActivityFormModal.tsx",
  "src/components/students/InvoiceModal.tsx",
  "src/components/teachers/TeacherInvoiceModal.tsx",
  "src/components/admin/AdminInvoiceModal.tsx",
  "src/components/classes/ClassDeleteConfirmModal.tsx",
  "src/components/classes/QuickAddClass.tsx",
];

describe("shared Radix dialog primitives", () => {
  const dialog = source("src/components/ui/Dialog.tsx");

  it("connects content, title, and description through one Radix implementation", () => {
    expect(dialog).toContain('from "@radix-ui/react-dialog"');
    expect(dialog).toContain("DialogPrimitive.Portal");
    expect(dialog).toContain("DialogPrimitive.Overlay");
    expect(dialog).toContain("DialogPrimitive.Content");
    expect(dialog).toContain("DialogPrimitive.Title");
    expect(dialog).toContain("DialogPrimitive.Description");
  });

  it("keeps Radix focus trapping and focus restoration enabled", () => {
    expect(dialog).not.toContain("trapFocus={false}");
    expect(dialog).not.toContain("modal={false}");
    expect(dialog).not.toContain("onCloseAutoFocus");
  });

  it("blocks Escape and outside interaction only while dismissal is unsafe", () => {
    expect(dialog).toContain("onEscapeKeyDown");
    expect(dialog).toContain("onPointerDownOutside");
    expect(dialog).toContain("onInteractOutside");
    expect(canDismissDialog(false)).toBe(true);
    expect(canDismissDialog(true)).toBe(false);

    const close = vi.fn();
    closeDialogOnOpenChange(false, true, close);
    closeDialogOnOpenChange(true, false, close);
    expect(close).not.toHaveBeenCalled();
    closeDialogOnOpenChange(false, false, close);
    expect(close).toHaveBeenCalledOnce();
  });

  it("bounds content to the dynamic viewport with internal scrolling", () => {
    expect(dialog).toContain("max-h-[calc(100dvh-1.5rem)]");
    expect(dialog).toContain("overflow-y-auto");
    expect(dialog).toContain("inset-x-3");
  });
});

describe("critical dialog migrations", () => {
  it.each(migrated)("uses the shared title and description in %s", (path) => {
    const component = source(path);
    expect(component).toContain('from "@/components/ui/Dialog"');
    expect(component).toContain("<DialogContent");
    expect(component).toContain("<DialogTitle");
    expect(component).toContain("<DialogDescription");
    expect(component).not.toContain('@radix-ui/react-dialog');
  });

  it.each(migrated)("removes old overlays and fixed direction in %s", (path) => {
    const component = source(path);
    expect(component).not.toMatch(/className="[^"]*fixed inset-0[^"]*bg-black/);
    expect(component).not.toContain('dir="rtl"');
    expect(component).not.toContain("<Drawer");
  });

  it("blocks accidental dismissal during every critical mutation", () => {
    expect(source(migrated[0])).toContain(
      "dismissBlocked = saving || uploadingImage || sending || deleting"
    );
    for (const path of migrated.slice(1, 4)) {
      expect(source(path)).toContain("dismissBlocked = generating");
    }
    expect(source(migrated[4])).toContain("dismissBlocked={deleting}");
    expect(source(migrated[5])).toContain("dismissBlocked={saving}");
  });

  it("does not nest forms", () => {
    const formCounts = migrated.map((path) => [path, source(path).match(/<form\b/g)?.length ?? 0]);
    expect(formCounts).toEqual([
      [migrated[0], 1],
      [migrated[1], 0],
      [migrated[2], 0],
      [migrated[3], 0],
      [migrated[4], 0],
      [migrated[5], 1],
    ]);
  });

  it("focuses the safe cancel action instead of delete when confirmation opens", () => {
    const confirmation = source("src/components/classes/ClassDeleteConfirmModal.tsx");
    expect(confirmation).toContain("onOpenAutoFocus");
    expect(confirmation).toContain("cancelButtonRef.current?.focus()");
    expect(confirmation).toMatch(/onClick=\{onConfirm\}[\s\S]*?type="button"|type="button"[\s\S]*?onClick=\{onConfirm\}/);
  });

  it("keeps invoice forms keyed by record so switching records cannot reuse state", () => {
    expect(source(migrated[1])).toContain('modalSessionKey("student-invoice", studentId)');
    expect(source(migrated[2])).toContain('modalSessionKey("teacher-invoice", teacherId)');
    expect(source(migrated[3])).toContain('modalSessionKey("admin-invoice", schoolId)');
  });
});
