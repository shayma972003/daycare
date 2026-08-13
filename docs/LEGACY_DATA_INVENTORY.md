# Legacy data inventory

This inventory records removal preconditions; it does not authorize a production backfill or deletion.

| Field | Classification | Required next step |
|---|---|---|
| `User.twoFaPhone` | removable after audit | Confirm zero non-null values; 2FA now uses email. |
| `EnrollmentToken.sent_to_phone` | historical | Retain for old links until token retention removes them naturally. |
| `Class.group`, `Activity.group`, `Student.academicStage` | product decision | Stage/group replacements exist, but compatibility consumers must be inventoried first. |
| `Teacher.qualification1`–`qualification10` | needs backfill | Normalize only after a reviewed qualification model and reversible rehearsal. |
| `NotificationType.WHATSAPP` | historical | Keep enum value so historical delivery records remain truthful. |
| Transitional Student/Teacher PII columns | needs backfill | Remove only after encrypted-column audit reports zero plaintext dependencies. |
| `ImportRow.raw_data`, `ImportRow.mapped_data` | needs backfill/retention | Encrypted payload is canonical; expired sessions are purged, old active rows need audit. |
| `EnrollmentSubmission.id_number` | needs backfill | Remove only after encrypted identity audit reaches zero conflicts. |

The globally unique `User.email` and `GuardianAccount.email/guardianId` remain a separate multi-school membership architecture decision.
