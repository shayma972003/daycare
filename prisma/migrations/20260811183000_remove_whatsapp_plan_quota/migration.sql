-- WhatsApp is no longer an operational notification channel, so subscription
-- plans no longer carry a monthly quota for it.
--
-- Historical NotificationLog rows and the NotificationType.WHATSAPP enum value
-- are intentionally preserved; changing either would falsify or destroy the
-- recorded delivery channel.
ALTER TABLE "SubscriptionPlan" DROP COLUMN "max_whatsapp_per_month";
