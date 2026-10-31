import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { AssistantScreen } from "@/components/assistant/AssistantScreen";

export default async function AssistantPage() {
  const session = await requireSession();
  if (!session.can("settings.ai")) redirect("/dashboard");
  return <AssistantScreen />;
}
