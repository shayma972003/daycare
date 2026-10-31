"use client";

import { Topbar } from "@/components/layout/Topbar";
import { AssistantChat } from "@/components/assistant/AssistantChat";
import { useT } from "@/lib/i18n-provider";

export function AssistantScreen() {
  const t = useT();
  return (
    <>
      <Topbar title={t("assistant.title")} />
      <AssistantChat />
    </>
  );
}
