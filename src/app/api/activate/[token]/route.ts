import { findInvite, redeemInvite } from "@/lib/invitations";
import {
  findSchoolAdminInvite,
  redeemSchoolAdminInvite,
} from "@/lib/school-admin-invitations";
import { passwordSchema } from "@/lib/password-policy";
import { rateLimit, clientIp, rateLimitResponse } from "@/lib/rate-limit";
import { z } from "zod";

/**
 * Redeeming an invitation — the one place an account gets its first password.
 *
 * Public by necessity: the whole point is that the person has no way to sign in
 * yet. The token in the path is the credential, which is why it is 24 random
 * bytes rather than a short code, and why it is stored hashed.
 *
 * Serves both kinds of account. A teacher and a parent redeem the same way and
 * see the same page; `findInvite` knows which table the token belongs to.
 */

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const limit = await rateLimit({
    key: `activate-check:${clientIp(request)}`,
    limit: 30,
    windowMs: 15 * 60 * 1000,
  });
  const limitedResponse = rateLimitResponse(limit);
  if (limitedResponse) return limitedResponse;

  const subject =
    (await findSchoolAdminInvite(token)) ?? (await findInvite(token));

  // One answer for missing, expired, revoked and already-used. A caller trying
  // tokens learns nothing about which they hit.
  if (!subject) {
    return Response.json({ error: "الدعوة غير صالحة أو منتهية" }, { status: 404 });
  }

  return Response.json({
    kind: subject.kind,
    name: subject.name,
    email: subject.email,
    schoolName: subject.schoolName,
  });
}

const bodySchema = z.object({ password: passwordSchema });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  /**
   * Rate limited by IP, not by token.
   *
   * A token is unguessable, so there is nothing to brute force here; the limit
   * exists so a single caller cannot use this endpoint to hash passwords at
   * cost 12 in a loop.
   */
  const limit = await rateLimit({
    key: `activate:${clientIp(request)}`,
    limit: 10,
    windowMs: 15 * 60 * 1000,
  });
  const limitedResponse = rateLimitResponse(limit);
  if (limitedResponse) return limitedResponse;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "كلمة المرور غير صالحة" },
      { status: 422 }
    );
  }

  const schoolAdminInvite = await findSchoolAdminInvite(token);
  const subject = schoolAdminInvite
    ? await redeemSchoolAdminInvite(token, parsed.data.password)
    : await redeemInvite(token, parsed.data.password);
  if (!subject) {
    return Response.json({ error: "الدعوة غير صالحة أو منتهية" }, { status: 404 });
  }

  /**
   * No session is issued here.
   *
   * Redeeming proves control of a mailbox, and the next step differs by kind: a
   * parent signs in to the app, a member of staff to the dashboard. Handing back
   * a session would mean picking one and guessing wrong half the time.
   */
  return Response.json({ kind: subject.kind, email: subject.email });
}
