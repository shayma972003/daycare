"use client";

import { useRef, useState } from "react";
import { useT } from "@/lib/i18n-provider";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/Dialog";

export function RenewalReactivationChoice({ checked, onChange, disabled }: {
  checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean;
}) {
  const t = useT();
  return <label className="flex items-start gap-2 text-sm text-gray-700">
    <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="mt-1" />
    <span>{t("students.renewalReactivateConsent")}</span>
  </label>;
}

/** Mounted per opening: consent cannot leak from the previous student. */
export function RenewalConfirmation({ endDate, startDate, cycle, needsReactivation, pending, error, onConfirm, onClose }: {
  endDate: string; startDate?: string; cycle?: string; needsReactivation: boolean; pending: boolean; error: string | null;
  onConfirm: (reactivate: boolean) => void; onClose: () => void;
}) {
  const t = useT();
  const [reactivate, setReactivate] = useState(false);
  const cancel = useRef<HTMLButtonElement>(null);
  return <Dialog open onOpenChange={(open) => { if (!open && !pending) onClose(); }}>
    <DialogContent dismissBlocked={pending} className="max-w-md space-y-5 p-5 text-start sm:p-6" onOpenAutoFocus={(event) => { event.preventDefault(); cancel.current?.focus(); }}>
      <DialogHeader className="flex-col gap-2">
        <DialogTitle>{t("students.renewSubscription")}</DialogTitle>
        <DialogDescription>{t("students.renewalPeriodHint")}</DialogDescription>
      </DialogHeader>
      <dl className="space-y-3 rounded-xl bg-gray-50 p-4 text-sm">
        {cycle && <div className="flex flex-wrap justify-between gap-2"><dt>{t("students.profile.billingCycle")}</dt><dd>{t(`billingCycle.${cycle}`)}</dd></div>}
        {startDate && <div className="flex flex-wrap justify-between gap-2"><dt>{t("students.renewalStartDate")}</dt><dd dir="ltr">{startDate}</dd></div>}
        <div className="flex flex-wrap justify-between gap-2"><dt>{t("students.subscriptionEndColumn")}</dt><dd dir="ltr">{endDate}</dd></div>
      </dl>
      {needsReactivation && <RenewalReactivationChoice checked={reactivate} onChange={setReactivate} disabled={pending} />}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <DialogFooter className="justify-end pt-4">
        <button ref={cancel} type="button" onClick={onClose} disabled={pending} className="rounded-lg border px-4 py-2">{t("common.cancel")}</button>
        <button type="button" onClick={() => onConfirm(reactivate)} disabled={pending || (needsReactivation && !reactivate)} className="rounded-lg bg-[#4f00c1] px-4 py-2 text-white disabled:opacity-50">
          {pending ? t("common.updating") : t("students.renewSubscription")}
        </button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
