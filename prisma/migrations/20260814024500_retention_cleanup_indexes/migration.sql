BEGIN;

CREATE INDEX "RefreshToken_revokedAt_expiresAt_idx" ON "RefreshToken"("revokedAt", "expiresAt");
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");
CREATE INDEX "ImportSession_expires_at_idx" ON "ImportSession"("expires_at");

COMMIT;
