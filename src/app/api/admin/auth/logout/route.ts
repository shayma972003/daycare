import { buildAdminLogoutCookieHeader } from "@/lib/admin-auth";

export async function POST() {
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Set-Cookie": buildAdminLogoutCookieHeader(),
    },
  });
}
