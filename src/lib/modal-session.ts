export type ModalSessionKind = "admin-invoice" | "student-invoice" | "teacher-invoice";

/** A record change must create a fresh form state instead of reusing edited fields. */
export function modalSessionKey(kind: ModalSessionKind, recordId: string): string {
  return `${kind}:${recordId}`;
}
