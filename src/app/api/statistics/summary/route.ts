import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function GET() {
  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;

  const [regFeeResult, paymentStatusGroups] = await Promise.all([
    prisma.student.aggregate({
      where: { schoolId, isActive: true },
      _sum: { registration_fee: true },
    }),
    prisma.student.groupBy({
      by: ["paymentStatus"],
      where: { schoolId },
      _count: { paymentStatus: true },
    }),
  ]);

  const totalRegistrationFees = regFeeResult._sum.registration_fee ?? 0;

  const paymentStatusBreakdown: Record<string, number> = {
    PAID: 0, LATE: 0, CANCELLED: 0, SUSPENDED: 0, "بانتظار الدفع": 0,
  };
  for (const g of paymentStatusGroups) {
    paymentStatusBreakdown[g.paymentStatus] = g._count.paymentStatus;
  }

  return Response.json({ totalRegistrationFees, paymentStatusBreakdown });
}
