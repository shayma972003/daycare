import { redirect } from "next/navigation";

/** Self-service tenant creation was retired in favour of admin invitations. */
export default function RegisterPage() {
  redirect("/login");
}
