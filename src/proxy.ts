import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

/**
 * Edge gate for the dashboard and the tenant API.
 *
 * Named `proxy` and living in `proxy.ts` because Next 16 deprecated the
 * `middleware` file convention and renamed it. The behaviour is identical; the
 * rename exists because "middleware" was routinely read as Express middleware,
 * which this is not.
 *
 * CLAUDE.md documented `(dashboard)/` as "protected by middleware" and no such
 * file existed. Every dashboard page was served to anyone who typed the
 * URL; the pages only *looked* protected because they fetched data from routes
 * that did check a session, so an unauthenticated visitor got a rendered,
 * empty-looking shell instead of a redirect.
 *
 * What this can and cannot do:
 *
 * - It runs on the edge with no database, so it verifies the JWT signature only.
 *   Whether the user still exists, is still enabled, and still has a live
 *   subscription is checked per request in `src/lib/authz.ts` — a token stays
 *   cryptographically valid long after the account behind it stops being.
 * - It is therefore a *first* gate, never the only one. Route handlers keep
 *   their own `authorize()` call. A matcher is a list that someone
 *   will eventually forget to extend; the handler is where the guarantee lives.
 */

/** Public paths under the matcher that must stay reachable while signed out. */
const PUBLIC_API_PREFIXES = [
  "/api/auth",
  "/api/admin",
  "/api/mobile",
  // The parent portal authenticates with the same bearer token as the app, not
  // with a NextAuth cookie — so the check below would reject every call. Its
  // routes verify the token themselves.
  "/api/portal",
  "/api/attendance/public",
  "/api/enrollment",
  "/api/health",
  // Stored files accept three different credentials — a per-key `?t=` grant, a
  // mobile bearer token, or a dashboard cookie — and decide among them
  // themselves. A cookie-only check here would reject the first two, which are
  // the ones `<img>` tags and the app actually use.
  "/api/files",
];

function isPublicApi(pathname: string): boolean {
  return PUBLIC_API_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isPublicApi(pathname)) return NextResponse.next();

  /**
   * Forwards the path and method to the route handlers.
   *
   * `requireSession()` runs inside the handler, where Next gives it no way to
   * ask which URL is being served. Without these headers the permission table in
   * src/lib/route-permissions.ts could not be consulted from the one place every
   * tenant route already calls, and the check would have to be pasted into 128
   * files instead.
   *
   * Set from the server's own view of the request, never copied from the
   * client — an inbound `x-pathname` is overwritten here, so a caller cannot
   * claim to be visiting a route with a weaker requirement.
   */
  const forwarded = new Headers(request.headers);
  forwarded.set("x-pathname", pathname);
  forwarded.set("x-method", request.method);
  const withContext = { request: { headers: forwarded } };

  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });

  // A signature-valid token that carries no tenant is unusable — and worse than
  // useless downstream, where `where: { schoolId: undefined }` is Prisma's way
  // of spelling "no filter". Rejected here as well as in requireSession().
  const hasTenant = Boolean(token && typeof token.schoolId === "string" && token.schoolId);

  if (hasTenant) return NextResponse.next(withContext);

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Round-trip the destination so signing in lands where the user was going.
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("callbackUrl", `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

/**
 * Deny by default: everything is matched except an explicit list of public
 * paths and static assets.
 *
 * An allow-list of protected prefixes was the obvious shape and the wrong one.
 * Route-group folders like `(dashboard)` do not appear in the URL, so the list
 * has to be maintained by hand, and the failure mode of forgetting an entry is
 * an unprotected page. Inverted, forgetting an entry means a public page asks
 * for a login — visible immediately, and safe.
 *
 * `attendance/public` is excluded deliberately: it is the walk-up kiosk, reached
 * from a printed QR code by someone who has no account and never will.
 */
export const config = {
  matcher: [
    "/((?!api/auth|api/admin|api/mobile|api/portal|api/attendance/public|api/enrollment|attendance/public|admin|portal|login|register|forgot-password|reset-password|enroll|_next/static|_next/image|favicon.ico|fonts|images).*)",
  ],
};
