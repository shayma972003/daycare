"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ForgotPasswordForm, type RecoveryKind } from "@/components/auth/ForgotPasswordForm";

function RoutedForgotPasswordForm() {
  const searchParams = useSearchParams();
  const kind: RecoveryKind = searchParams.get("kind") === "guardian" ? "guardian" : "staff";
  return <ForgotPasswordForm kind={kind} />;
}

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#1a2340]" />}>
      <RoutedForgotPasswordForm />
    </Suspense>
  );
}
