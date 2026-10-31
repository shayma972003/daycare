export type SchoolAdminInvitationStatus =
  | "active"
  | "pending"
  | "expired"
  | "revoked"
  | "none";

export function schoolAdminInvitationStatus(input: {
  acceptedAt: Date | null;
  passwordSet: boolean;
  invitation?: {
    expiresAt: Date;
    usedAt: Date | null;
    revokedAt: Date | null;
  } | null;
}, now = new Date()): SchoolAdminInvitationStatus {
  if (input.acceptedAt || input.passwordSet) return "active";
  if (!input.invitation || input.invitation.usedAt) return "none";
  if (input.invitation.revokedAt) return "revoked";
  if (input.invitation.expiresAt <= now) return "expired";
  return "pending";
}
