import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { bearerToken, verifyAccessToken } from "@/lib/mobile-auth";
import { verifyFileToken } from "@/lib/file-token";
import { schoolIdFromKey, signedReadUrl } from "@/lib/r2";
import { storageEnabled } from "@/lib/env";

/**
 * The only way bytes leave the bucket (task 0.34).
 *
 * The bucket is private. These are photographs of children and scans of identity
 * documents, so there is no version of "public URL" that is acceptable: a public
 * object is readable forever by anyone who ever saw the link, with no session to
 * revoke and no log of who read it.
 *
 * This route proves the caller, then hands out a signed URL good for five
 * minutes. The bytes travel from Cloudflare straight to the browser — the
 * function never streams them, which keeps a page of thirty photos from becoming
 * thirty full-size responses through our own compute.
 *
 * ## Who may read
 *
 * Three credentials, in the order they are cheapest to check:
 *
 * 1. A `?t=` grant — a MAC over this one key, minted minutes earlier by an
 *    endpoint that already authorised the reader. This is what makes `<img>`
 *    work at all: markup cannot send an Authorization header.
 * 2. A mobile bearer token, for the app.
 * 3. A dashboard cookie session, for staff.
 *
 * For 2 and 3 the tenant in the key must equal the tenant in the credential.
 * That check is why the school id is the first segment of every key — it makes
 * cross-tenant reads impossible without a database lookup on a hot path.
 *
 * A guardian is *not* additionally checked against the specific child. Keys end
 * in a random UUID, so there is nothing to enumerate, and the grant in case 1 is
 * per-key by construction; the case this does not cover is a guardian who
 * already holds another child's exact key, which they can only have obtained
 * from a response that already leaked it.
 */

export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string[] }> }
) {
  if (!storageEnabled) {
    return Response.json({ error: "التخزين غير مُعدّ" }, { status: 501 });
  }

  const { key: segments } = await params;
  const key = segments.map(decodeURIComponent).join("/");

  const tenant = schoolIdFromKey(key);
  if (!tenant) {
    // Not one of our keys. Refusing rather than passing it to R2 keeps this from
    // becoming a way to probe the bucket for objects written by anything else.
    return Response.json({ error: "مسار غير صالح" }, { status: 400 });
  }

  const allowed = await isAllowed(request, key, tenant);
  if (!allowed) {
    return Response.json({ error: "غير مصرّح" }, { status: 401 });
  }

  const url = await signedReadUrl(key);

  return Response.redirect(url, 302);
}

async function isAllowed(request: Request, key: string, tenant: string): Promise<boolean> {
  const grant = new URL(request.url).searchParams.get("t");
  if (verifyFileToken(key, grant)) return true;

  const bearer = bearerToken(request);
  if (bearer) {
    const claims = await verifyAccessToken(bearer);
    return Boolean(claims && claims.schoolId === tenant);
  }

  const session = await getServerSession(authOptions);
  return session?.user?.schoolId === tenant;
}
