import { prisma } from "@/lib/prisma";
import { requireMobileAuth, mobileAuthResponse } from "@/lib/mobile-guard";
import { z } from "zod";

/**
 * Device registration for push.
 *
 * Called on every app launch, not only the first: provider tokens rotate
 * without warning — a reinstall, a restore from backup, an OS update — and a
 * stale one delivers nothing while looking perfectly healthy in the database.
 */

const schema = z.object({
  token: z.string().min(10).max(500),
  platform: z.enum(["IOS", "ANDROID", "HUAWEI", "WEB"]),
});

export async function POST(request: Request) {
  let context;
  try {
    context = await requireMobileAuth(request);
  } catch (error) {
    const response = mobileAuthResponse(error);
    if (response) return response;
    throw error;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const owner =
    context.claims.kind === "guardian"
      ? { guardianAccountId: context.claims.sub, userId: null }
      : { userId: context.claims.sub, guardianAccountId: null };

  /**
   * Upsert on the token, not on the account.
   *
   * The same handset can pass between people — a nursery tablet, a parent's old
   * phone given to a sibling — and the provider reuses the registration token.
   * Keying on the token means the row is *reassigned* to whoever is signed in
   * now, so notifications follow the account rather than the device's history.
   * Keying on the account would leave the previous owner's row in place, still
   * receiving another family's notifications.
   *
   * `failedAt` is cleared: a token that reappears is alive again, whatever the
   * provider said last time.
   */
  const device = await prisma.deviceToken.upsert({
    where: { token: parsed.data.token },
    create: {
      schoolId: context.schoolId,
      token: parsed.data.token,
      platform: parsed.data.platform,
      ...owner,
    },
    update: {
      schoolId: context.schoolId,
      platform: parsed.data.platform,
      lastSeenAt: new Date(),
      failedAt: null,
      ...owner,
    },
    select: { id: true, platform: true },
  });

  return Response.json(device, { status: 201 });
}

const deleteSchema = z.object({ token: z.string().min(10).max(500) });

/** Sign-out unregisters the device, or the next user of the phone gets the alerts. */
export async function DELETE(request: Request) {
  let context;
  try {
    context = await requireMobileAuth(request);
  } catch (error) {
    const response = mobileAuthResponse(error);
    if (response) return response;
    throw error;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "التوكن مفقود" }, { status: 422 });
  }

  // Scoped to the caller: a token belonging to someone else is not theirs to
  // remove, and silently succeeding would be a way to switch off another
  // family's notifications.
  await prisma.deviceToken.deleteMany({
    where: {
      token: parsed.data.token,
      ...(context.claims.kind === "guardian"
        ? { guardianAccountId: context.claims.sub }
        : { userId: context.claims.sub }),
    },
  });

  return Response.json({ success: true });
}
