-- The enrolment invite no longer asks for a phone number.
--
-- Delivery is by email. The number was stored and never used: never messaged
-- (there is no SMS channel), never copied onto the guardian record, never
-- prefilled into the form. Its only reader masks the recipient on links issued
-- before delivery moved to email, so existing rows are kept as they are.

ALTER TABLE "EnrollmentToken" ALTER COLUMN "sent_to_phone" DROP NOT NULL;
