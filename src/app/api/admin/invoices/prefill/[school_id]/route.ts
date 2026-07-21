import { verifyAdminSessionFromRequest } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ school_id: string }> }
) {
  const session = await verifyAdminSessionFromRequest(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { school_id } = await params;

  const school = await prisma.school.findUnique({
    where: { id: school_id },
    include: { subscription_plan: true },
  });
  if (!school) return Response.json({ error: "Not found" }, { status: 404 });

  const count = await prisma.adminInvoice.count({ where: { school_id } });
  const invoiceNumber = `SINV-${String(count + 1).padStart(4, "0")}`;

  const planName = school.subscription_plan?.name ?? "";
  const planPrice = school.subscription_plan?.price ?? 0;
  const vat = planPrice * 0.15;

  return Response.json({
    invoiceNumber,
    schoolName: school.name,
    schoolCommercialReg: school.commercialRegistration ?? "",
    schoolVatNumber: school.vatNumber ?? "",
    schoolContact: school.contactNumber ?? "",
    schoolEmail: school.email ?? "",
    schoolAddress: school.address ?? "",
    planName,
    planPrice,
    ourCompanyName: "",
    ourCommercialReg: "",
    ourVatNumber: "",
    ourContactNumber: "",
    ourEmail: "",
    ourAddress: "",
    suggestedLineItem: {
      description: planName ? `اشتراك ${planName}` : "اشتراك المنصة",
      quantity: 1,
      price: planPrice,
      vat,
      total: planPrice + vat,
    },
  });
}
