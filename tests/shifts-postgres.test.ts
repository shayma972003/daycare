import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const schema = process.env.SHIFT_TEST_SCHEMA;
const suite = schema ? describe.sequential : describe.skip;

suite("shift operations on isolated PostgreSQL", () => {
  let prisma: PrismaClient;
  let routes: typeof import("@/app/api/shifts/route");
  const suffix = randomBytes(5).toString("hex");
  const schoolId = `codex_shift_school_${suffix}`;
  const otherSchoolId = `${schoolId}_other`;
  const teacherId = `codex_shift_teacher_${suffix}`;
  const secondTeacherId = `${teacherId}_second`;
  const classId = `codex_shift_class_${suffix}`;

  beforeAll(async () => {
    if (!schema || !/^codex_shifts_[a-z0-9_]+$/.test(schema) || schema === "public") throw new Error("Unsafe SHIFT_TEST_SCHEMA");
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString || !new URL(connectionString).hostname.toLowerCase().includes("neon")) throw new Error("Isolated Neon target required");
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }, { schema }) });
    vi.doMock("@/lib/prisma", () => ({ prisma }));
    vi.doMock("@/lib/session", () => ({
      requireSession: vi.fn(async () => ({ user: { schoolId, name: "Test admin" }, can: (permission: string) => permission === "schedule.manage" || permission === "schedule.view" })),
      sessionErrorResponse: vi.fn(),
    }));
    vi.doMock("@/lib/activity-logger", () => ({ logAction: vi.fn(async () => undefined) }));
    routes = await import("@/app/api/shifts/route");
    await prisma.school.createMany({ data: [{ id: schoolId, name: "Shift test" }, { id: otherSchoolId, name: "Other shift test" }] });
    await prisma.teacher.createMany({ data: [
      { id: teacherId, schoolId, name: "Teacher one" }, { id: secondTeacherId, schoolId, name: "Teacher two" },
      { id: `${teacherId}_other`, schoolId: otherSchoolId, name: "Other tenant teacher" },
    ] });
    await prisma.class.create({ data: { id: classId, schoolId, name: "Room one" } });
  });

  afterAll(async () => {
    vi.doUnmock("@/lib/prisma"); vi.doUnmock("@/lib/session"); vi.doUnmock("@/lib/activity-logger");
    await prisma?.$disconnect();
  });

  const request = (body: object, method = "POST") => new Request("http://localhost/api/shifts", {
    method, headers: { "Content-Type": "application/json", "X-Time-Zone": "UTC" }, body: JSON.stringify(body),
  });

  it("allows split shifts but lets only one concurrent overlap win", async () => {
    const base = { teacherId, classId, date: "2026-08-30", startTime: "07:00", endTime: "10:00", notes: null };
    expect((await routes.POST(request(base))).status).toBe(201);
    expect((await routes.POST(request({ ...base, startTime: "10:00", endTime: "12:00" }))).status).toBe(201);
    const attempts = await Promise.all([
      routes.POST(request({ ...base, startTime: "12:00", endTime: "15:00" })),
      routes.POST(request({ ...base, startTime: "13:00", endTime: "16:00" })),
    ]);
    expect(attempts.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await prisma.shift.count({ where: { teacherId, date: new Date("2026-08-30T00:00:00.000Z") } })).toBe(3);
  }, 30_000);

  it("enforces tenant and eligibility checks and preserves the class snapshot", async () => {
    const crossTenant = await routes.POST(request({ teacherId: `${teacherId}_other`, date: "2026-08-31", startTime: "07:00", endTime: "08:00" }));
    expect(crossTenant.status).toBe(409);
    await prisma.teacher.update({ where: { id: secondTeacherId }, data: { isActive: false } });
    expect((await routes.POST(request({ teacherId: secondTeacherId, date: "2026-08-31", startTime: "07:00", endTime: "08:00" }))).status).toBe(409);
    const shift = await prisma.shift.findFirstOrThrow({ where: { teacherId, classId } });
    await prisma.class.delete({ where: { id: classId } });
    const retained = await prisma.shift.findUniqueOrThrow({ where: { id: shift.id } });
    expect(retained.classId).toBeNull();
    expect(retained.classNameSnapshot).toBe("Room one");
  });
});
