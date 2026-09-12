"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { SchoolSubscriptionAccess } from "@/lib/school-subscription";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { useT } from "@/lib/i18n-provider";

export function SubscriptionAccessBanner({ access }: { access: SchoolSubscriptionAccess }) {
  const t = useT();
  const [popupOpen, setPopupOpen] = useState(false);

  useEffect(() => {
    if (!access.showFirstExpiredDayPopup || !access.renewalDate) return;
    const key = `subscription-expired-popup:${access.renewalDate.slice(0, 10)}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "shown");
    queueMicrotask(() => setPopupOpen(true));
  }, [access.renewalDate, access.showFirstExpiredDayPopup]);

  if (access.mode === "active") return null;
  const locked = access.mode === "locked";
  const message = locked
    ? t("schoolSubscription.lockedMessage")
    : t("schoolSubscription.graceMessage", { days: access.graceDaysRemaining });

  return (
    <>
      <div role="alert" className={locked ? "border-b border-red-200 bg-red-50 px-4 py-3 text-red-900" : "border-b border-amber-200 bg-amber-50 px-4 py-3 text-amber-900"}>
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-3 text-sm">
          <div>
            <strong>{locked ? t("schoolSubscription.lockedTitle") : t("schoolSubscription.graceTitle")}</strong>
            <span className="mx-2">{message}</span>
          </div>
          <Link href="/subscription" className="rounded-xl bg-gray-950 px-4 py-2 font-semibold text-white hover:bg-gray-800">
            {t("schoolSubscription.renewSubscription")}
          </Link>
        </div>
      </div>

      <Dialog open={popupOpen} onOpenChange={setPopupOpen}>
        <DialogContent dir="rtl" className="p-6">
          <DialogHeader>
            <div>
              <DialogTitle>{t("schoolSubscription.expiredPopupTitle")}</DialogTitle>
              <DialogDescription className="mt-2 leading-6">
                {t("schoolSubscription.expiredPopupDescription")}
              </DialogDescription>
            </div>
          </DialogHeader>
          <div className="mt-5 flex justify-end gap-3">
            <button type="button" onClick={() => setPopupOpen(false)} className="rounded-xl border border-gray-200 px-4 py-2 text-sm">{t("schoolSubscription.later")}</button>
            <Link href="/subscription" className="rounded-xl bg-gray-950 px-4 py-2 text-sm font-semibold text-white">{t("schoolSubscription.renewNow")}</Link>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
