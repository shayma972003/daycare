import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { modalSessionKey } from "@/lib/modal-session";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("invoice modal sessions", () => {
  it("uses a different remount key for two different records", () => {
    expect(modalSessionKey("student-invoice", "student-a")).not.toBe(
      modalSessionKey("student-invoice", "student-b")
    );
    expect(modalSessionKey("teacher-invoice", "teacher-a")).not.toBe(
      modalSessionKey("teacher-invoice", "teacher-b")
    );
  });

  it.each([
    ["src/components/students/InvoiceModal.tsx", "student-invoice"],
    ["src/components/teachers/TeacherInvoiceModal.tsx", "teacher-invoice"],
    ["src/components/admin/AdminInvoiceModal.tsx", "admin-invoice"],
  ])("unmounts while closed and keys the form content in %s", (path, kind) => {
    const component = source(path);
    expect(component).toContain("if (!open) return null");
    expect(component).toContain(`modalSessionKey("${kind}"`);
  });
});
