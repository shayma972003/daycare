"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { SchoolSubscriptionAccess } from "@/lib/school-subscription";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/Dialog";

export function SubscriptionAccessBanner({ access }: { access: SchoolSubscriptionAccess }) {
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
    ? "الاشتراك غير نشط. التصفح متاح للقراءة فقط، وتوقفت جميع الإضافات والتعديلات حتى التجديد."
    : `انتهى الاشتراك، وبقي ${access.graceDaysRemaining} يوم قبل انتقال الحساب إلى وضع القراءة فقط.`;

  return (
    <>
      <div role="alert" className={locked ? "border-b border-red-200 bg-red-50 px-4 py-3 text-red-900" : "border-b border-amber-200 bg-amber-50 px-4 py-3 text-amber-900"}>
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-3 text-sm">
          <div>
            <strong>{locked ? "الحساب للقراءة فقط" : "مهلة تجديد الاشتراك"}</strong>
            <span className="mx-2">{message}</span>
          </div>
          <Link href="/subscription" className="rounded-xl bg-gray-950 px-4 py-2 font-semibold text-white hover:bg-gray-800">
            تجديد الاشتراك
          </Link>
        </div>
      </div>

      <Dialog open={popupOpen} onOpenChange={setPopupOpen}>
        <DialogContent dir="rtl" className="p-6">
          <DialogHeader>
            <div>
              <DialogTitle>انتهى اشتراك الحضانة</DialogTitle>
              <DialogDescription className="mt-2 leading-6">
                بدأت مهلة التجديد لمدة 7 أيام. لن تُحذف أي بيانات، ويمكنك متابعة العمل والتجديد قبل انتقال الحساب إلى وضع القراءة فقط.
              </DialogDescription>
            </div>
          </DialogHeader>
          <div className="mt-5 flex justify-end gap-3">
            <button type="button" onClick={() => setPopupOpen(false)} className="rounded-xl border border-gray-200 px-4 py-2 text-sm">لاحقًا</button>
            <Link href="/subscription" className="rounded-xl bg-gray-950 px-4 py-2 text-sm font-semibold text-white">تجديد الآن</Link>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
