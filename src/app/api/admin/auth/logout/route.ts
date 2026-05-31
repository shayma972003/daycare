import { ADMIN_COOKIE_NAME } from "@/lib/admin-auth";

export async function POST() {
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": `${ADMIN_COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`,
    },
  });
}
