import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("student lifecycle contracts", () => {
  it("keeps student profile saves partial and tenant-scoped", () => {
    const profile = source("src/app/(dashboard)/students/[id]/page.tsx");
    const updateRoute = source("src/app/api/students/[id]/route.ts");
    expect(profile).toContain("Object.fromEntries(Object.entries(payloadDraft)");
    expect(profile).toContain("initialGuardianId.current");
    expect(updateRoute).toContain("prisma.$transaction(async (tx)");
    expect(updateRoute).toContain("schoolId");
    expect(updateRoute).toContain('"guardianPhone1" in data');
    expect(updateRoute).toContain('"guardianEmail" in data');
    expect(updateRoute).toContain("Guardian belongs to another family");
  });

  it("uses the restricted class-options endpoint for student forms", () => {
    expect(source("src/app/(dashboard)/students/[id]/page.tsx")).toContain("/api/students/class-options");
    expect(source("src/app/(dashboard)/students/new/page.tsx")).toContain("/api/students/class-options");
    expect(source("src/app/api/students/class-options/route.ts")).toContain("deletedAt: null");
  });

  it("exposes a single transactional renewal path", () => {
    const route = source("src/app/api/students/[id]/renew/route.ts");
    const profile = source("src/app/(dashboard)/students/[id]/page.tsx");
    const renewal = source("src/lib/student-renewal.ts");
    expect(route).toContain("renewStudentSubscription");
    expect(source("src/app/api/students/bulk-extend/route.ts")).toContain("renewStudentSubscription");
    expect(renewal).toContain("prisma.$transaction(async (tx)");
    expect(renewal).toContain("generatePaymentCycles(context.id, tx, from)");
    expect(route).toContain("schoolId");
    expect(profile).toContain("/api/students/${id}/renew");
  });

  it("makes expired-subscription alerts shareable and actionable", () => {
    const listApi = source("src/app/api/students/route.ts");
    const page = source("src/app/(dashboard)/students/page.tsx");
    const tasks = source("src/app/api/dashboard/tasks/route.ts");
    expect(listApi).toContain('subscriptionFilterWhere(subscription, today)');
    expect(page).toContain('params.set("subscription", subscriptionFilter!)');
    expect(tasks).toContain('key: "expiredSubscriptions"');
    expect(tasks).toContain("student:");
    expect(tasks).toContain('subscriptionFilterWhere("current", today)');
  });

  it("removes the retired attendance type from student and enrollment forms", () => {
    for (const path of ["src/app/(dashboard)/students/page.tsx", "src/app/(dashboard)/students/[id]/page.tsx", "src/app/(dashboard)/students/new/page.tsx", "src/app/enroll/[token]/page.tsx", "src/lib/form-schemas.ts"]) {
      expect(source(path)).not.toMatch(/attendanceType|attendance_type/);
    }
  });
});
