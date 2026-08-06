import { requireMobileAuth, mobileAuthResponse, guardianChildIds } from "@/lib/mobile-guard";
import { prisma } from "@/lib/prisma";

/**
 * A guardian's invoices, for their children only.
 *
 * Scoped through `guardianChildIds` rather than by `schoolId`: a parent belongs
 * to a nursery but is entitled to one family's records inside it, and filtering
 * by tenant alone would hand them the whole school's billing.
 *
 * `pdfUrl` is deliberately not returned. It holds a base64 data URI of the whole
 * document — hundreds of kilobytes each — which would make a list of a year's
 * invoices a multi-megabyte response on a phone connection. The app lists them
 * and fetches one document only when one is opened.
 */
export async function GET(request: Request) {
  let context;
  try {
    context = await requireMobileAuth(request, { kind: "guardian" });
  } catch (error) {
    const response = mobileAuthResponse(error);
    if (response) return response;
    throw error;
  }

  const allowedIds = await guardianChildIds(context.claims.sub);
  if (allowedIds.length === 0) return Response.json({ invoices: [] });

  const invoices = await prisma.invoice.findMany({
    where: {
      studentId: { in: allowedIds },
      // Belt and braces: the child ids already prove the relationship, but a
      // tenant filter costs nothing and means one bug cannot cross schools.
      schoolId: context.claims.schoolId,
    },
    orderBy: { createdAt: "desc" },
    take: 60,
    select: {
      id: true,
      type: true,
      amount: true,
      vat_amount: true,
      createdAt: true,
      student: { select: { id: true, name: true } },
    },
  });

  return Response.json({
    invoices: invoices.map((invoice) => ({
      id: invoice.id,
      type: invoice.type,
      amount: invoice.amount,
      vatAmount: invoice.vat_amount,
      issuedAt: invoice.createdAt.toISOString(),
      childId: invoice.student?.id ?? null,
      childName: invoice.student?.name ?? null,
    })),
  });
}
