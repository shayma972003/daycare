import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { requirementFor } from "@/lib/route-permissions";

vi.mock("@/lib/pii-crypto", () => ({
  revealIdNumber: (row: { idNumber: string | null }) => row.idNumber,
  maskIdNumber: (value: string | null) => (value ? `******${value.slice(-4)}` : null),
}));

import {
  studentDetailDto,
  studentListDto,
  teacherDetailDto,
} from "@/lib/roster-dto";
import { safeErrorDetails } from "@/lib/safe-logger";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const student = {
  id: "student-1",
  name: "Child",
  period: "MORNING",
  paymentStatus: "LATE",
  classId: "class-1",
  class: { id: "class-1", name: "Room" },
  guardianId: "guardian-1",
  guardian: {
    id: "guardian-1",
    name: "Guardian",
    phone1: "0500000000",
    phone2: null,
    email: "guardian@example.test",
    name_2: null,
    phone_3: null,
    phone_4: null,
    email_2: null,
  },
  isActive: true,
  needsClassWarning: false,
  avatarUrl: null,
  idNumber: "1234567890",
  encryptedIdNumber: null,
  healthCondition: "private health note",
  allergies: "private allergy",
  registration_fee: 400,
  paymentMethod: "CASH",
  enrollment_date: null,
  enrollmentEndDate: null,
};

describe("sensitive roster DTOs", () => {
  it("keeps contact and finance out of a general student list", () => {
    const dto = studentListDto(student, { contact: false, financial: false });
    expect(dto.guardian).toBeNull();
    expect(dto).not.toHaveProperty("paymentStatus");
    expect(JSON.stringify(dto)).not.toMatch(/0500000000|guardian@example/);
  });

  it("defaults to a masked identity and omits health and finance", () => {
    const dto = studentDetailDto(student, {
      contact: false,
      health: false,
      financial: false,
      revealIdentity: false,
    }, { registrationFee: 400, registrationFeeIsDefault: false, siblings: [] });
    expect(dto.idNumber).toBeNull();
    expect(dto.maskedIdNumber).toBe("******7890");
    expect(dto).not.toHaveProperty("healthCondition");
    expect(dto).not.toHaveProperty("registration_fee");
  });

  it("reveals each section only when its permission decision allows it", () => {
    const dto = studentDetailDto(student, {
      contact: true,
      health: true,
      financial: true,
      revealIdentity: true,
    }, { registrationFee: 400, registrationFeeIsDefault: false, siblings: [] });
    expect(dto.idNumber).toBe("1234567890");
    expect(dto.healthCondition).toBe("private health note");
    expect(dto.registration_fee).toBe(400);
    expect(dto.guardian).toHaveProperty("email", "guardian@example.test");
  });

  it("keeps teacher contact, payroll and full identity out by default", () => {
    const dto = teacherDetailDto({
      id: "teacher-1",
      name: "Teacher",
      classes: [],
      idNumber: "9876543210",
      encryptedIdNumber: null,
      email: "teacher@example.test",
      phone1: "0500000000",
      monthlySalary: 5000,
    }, { contact: false, financial: false, revealIdentity: false }, 0);
    expect(dto.idNumber).toBeNull();
    expect(dto).not.toHaveProperty("email");
    expect(dto).not.toHaveProperty("monthlySalary");
  });
});

describe("communication log and validation hardening", () => {
  it("requires settings permission for the delivery log", () => {
    expect(requirementFor("/api/notifications", "GET")).toBe("settings.manage");
    const route = source("src/app/api/notifications/route.ts");
    expect(route).toContain("assertCan(session, \"settings.manage\")");
    expect(route).toContain(".max(100)");
    expect(route).toContain("select:");
  });

  it("uses strict Zod bodies and rejects negative fee settings", () => {
    expect(source("src/app/api/activities/[id]/send/route.ts")).toContain(".strict()");
    expect(source("src/app/api/notifications/admin-messages/route.ts")).toContain(".strict()");
    const settings = source("src/app/api/settings/route.ts");
    expect(settings).toMatch(/hourlyLateFee:\s*z\.number\(\)\.min\(0\)/);
    expect(settings).toContain("}).strict()");
  });

  it("never serialises arbitrary error properties", () => {
    const error = Object.assign(new Error("contains PII"), {
      code: "P2002",
      query: { email: "secret@example.test" },
    });
    expect(safeErrorDetails(error)).toEqual({ name: "Error", code: "P2002" });
    const invoiceRoute = source("src/app/api/invoices/generate/route.ts");
    expect(invoiceRoute).not.toContain("Object.getOwnPropertyNames(error");
    expect(invoiceRoute).not.toContain("JSON.stringify(error");
  });
});
