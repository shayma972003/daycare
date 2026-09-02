import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  transaction: vi.fn(),
  studentFind: vi.fn(),
  settingsFind: vi.fn(),
  studentCreate: vi.fn(),
  studentUpdate: vi.fn(),
  activityCreate: vi.fn(),
  generateCycles: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ requireSession: mocks.session, sessionErrorResponse: () => null }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  student: { findFirst: mocks.studentFind },
  $transaction: mocks.transaction,
} }));
vi.mock("@/lib/payment-cycles", () => ({ generatePaymentCycles: mocks.generateCycles }));
vi.mock("@/lib/tenant-guard", () => ({
  assertClassOwned: (value: string | null | undefined) => Promise.resolve(value ?? null),
  assertGuardianOwned: (value: string | null | undefined) => Promise.resolve(value ?? null),
  crossTenantResponse: () => null,
}));
vi.mock("@/lib/plan-limits", () => ({ assertStudentCapacity: () => Promise.resolve(), planLimitResponse: () => null }));
vi.mock("@/lib/academic-stage", () => ({ resolveStageId: () => Promise.resolve(null), foreignStageResponse: () => null }));
vi.mock("@/lib/pii-crypto", () => ({ protectIdNumber: () => ({ idNumber: null }) }));
vi.mock("@/lib/roster-dto", () => ({
  studentDetailSelect: { id: true, name: true, schoolId: true, billingCycle: true, cycleFee: true, registration_fee: true },
  studentDetailDto: (student: unknown) => student,
  studentListDto: (student: unknown) => student,
}));
vi.mock("@/lib/activity-logger", () => ({
  activityLogData: (input: unknown) => input,
  logAction: vi.fn(),
}));

import { POST as createStudent } from "@/app/api/students/route";
import { PUT as updateStudent } from "@/app/api/students/[id]/route";

const existingStudent = {
  id: "student-1",
  schoolId: "school-1",
  name: "Student",
  guardianId: null,
  deletedAt: null,
  anonymizedAt: null,
  status: "ACTIVE",
  isActive: true,
  leftAt: null,
  billingCycle: "MONTHLY",
  billingIntervalDays: null,
  cycleFee: 250,
  registration_fee: 0,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({
    user: { id: "manager-1", schoolId: "school-1", name: "Manager" },
    can: () => true,
  });
  mocks.settingsFind.mockResolvedValue({ dailyStudentFee: 10, weeklyStudentFee: 70, monthlyStudentFee: 250, yearlyStudentFee: 2500 });
  mocks.studentFind.mockResolvedValue({ ...existingStudent });
  mocks.studentCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...existingStudent, ...data }));
  mocks.studentUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...existingStudent, ...data }));
  mocks.activityCreate.mockResolvedValue({});
  mocks.generateCycles.mockResolvedValue(1);
  const tx = {
    settings: { findUnique: mocks.settingsFind },
    student: { create: mocks.studentCreate, update: mocks.studentUpdate },
    guardian: { create: vi.fn(), update: vi.fn() },
    activityLog: { create: mocks.activityCreate },
  };
  mocks.transaction.mockImplementation((callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
});

describe("student subscription fee snapshots", () => {
  it("derives a new student's weekly fee on the server and ignores a client price", async () => {
    const response = await createStudent(new Request("http://localhost/api/students", {
      method: "POST",
      body: JSON.stringify({ name: "New student", billingCycle: "WEEKLY", cycleFee: 999 }),
    }));
    expect(response.status).toBe(201);
    expect(mocks.studentCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ billingCycle: "WEEKLY", cycleFee: expect.anything() }),
    }));
    const data = mocks.studentCreate.mock.calls[0][0].data;
    expect(String(data.cycleFee)).toBe("70");
    expect(data.registration_fee).toBeUndefined();
  });

  it("blocks creation when the selected fee is not configured", async () => {
    mocks.settingsFind.mockResolvedValue({ dailyStudentFee: 10, weeklyStudentFee: null, monthlyStudentFee: 250, yearlyStudentFee: null });
    const response = await createStudent(new Request("http://localhost/api/students", {
      method: "POST",
      body: JSON.stringify({ name: "New student", billingCycle: "YEARLY" }),
    }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "CYCLE_FEE_REQUIRED" });
    expect(mocks.studentCreate).not.toHaveBeenCalled();
  });

  it("snapshots the current yearly setting when the subscription type changes", async () => {
    const response = await updateStudent(new Request("http://localhost/api/students/student-1", {
      method: "PUT",
      headers: { "X-Time-Zone": "UTC" },
      body: JSON.stringify({ billingCycle: "YEARLY", cycleFee: 1 }),
    }), { params: Promise.resolve({ id: "student-1" }) });
    expect(response.status).toBe(200);
    const update = mocks.studentUpdate.mock.calls[0][0].data;
    expect(update.billingCycle).toBe("YEARLY");
    expect(String(update.cycleFee)).toBe("2500");
    expect(mocks.generateCycles).toHaveBeenCalledOnce();
  });

  it("does not reprice or regenerate the current subscription when the same billing cycle is saved", async () => {
    mocks.settingsFind.mockResolvedValue({ dailyStudentFee: 10, weeklyStudentFee: 70, monthlyStudentFee: 999, yearlyStudentFee: 2500 });
    const response = await updateStudent(new Request("http://localhost/api/students/student-1", {
      method: "PUT",
      headers: { "X-Time-Zone": "UTC" },
      body: JSON.stringify({ billingCycle: "MONTHLY" }),
    }), { params: Promise.resolve({ id: "student-1" }) });

    expect(response.status).toBe(200);
    const update = mocks.studentUpdate.mock.calls[0][0].data;
    expect(update.billingCycle).toBe("MONTHLY");
    expect(update).not.toHaveProperty("cycleFee");
    expect(String(existingStudent.cycleFee)).toBe("250");
    expect(mocks.settingsFind).not.toHaveBeenCalled();
    expect(mocks.generateCycles).not.toHaveBeenCalled();
  });
});
