import { verifyAndApplyMoyasarInvoice } from "@/lib/moyasar";
import { z } from "zod";

const invoiceIdSchema = z.string().uuid();

async function invoiceId(request: Request): Promise<string | null> {
  const fromQuery = new URL(request.url).searchParams.get("id");
  if (fromQuery) return fromQuery;
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => null) as { id?: unknown } | null;
    return typeof body?.id === "string" ? body.id : null;
  }
  const form = await request.formData().catch(() => null);
  const value = form?.get("id");
  return typeof value === "string" ? value : null;
}

export async function POST(request: Request) {
  const parsedId = invoiceIdSchema.safeParse(await invoiceId(request));
  if (!parsedId.success) return Response.json({ error: "Invalid invoice id" }, { status: 400 });
  try {
    const result = await verifyAndApplyMoyasarInvoice(parsedId.data);
    return Response.json(result);
  } catch {
    return Response.json({ error: "Payment verification failed" }, { status: 400 });
  }
}
