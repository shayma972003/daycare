CREATE TYPE "SupportTicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED');
CREATE TYPE "SupportTicketPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

ALTER TYPE "StoredFileOwnerType" ADD VALUE IF NOT EXISTS 'SUPPORT_TICKET';

CREATE TABLE "SupportTicket" (
  "id" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "schoolId" TEXT,
  "requesterUserId" TEXT,
  "createdByAdminId" TEXT NOT NULL,
  "assignedAdminId" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "category" TEXT,
  "status" "SupportTicketStatus" NOT NULL DEFAULT 'OPEN',
  "priority" "SupportTicketPriority" NOT NULL DEFAULT 'NORMAL',
  "firstRespondedAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupportTicketNote" (
  "id" TEXT NOT NULL,
  "ticketId" TEXT NOT NULL,
  "authorAdminId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "isInternal" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportTicketNote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupportTicketAttachment" (
  "id" TEXT NOT NULL,
  "ticketId" TEXT NOT NULL,
  "uploadedByAdminId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "fileUrl" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportTicketAttachment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupportAccessSession" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "ticketId" TEXT,
  "createdByAdminId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "lastViewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportAccessSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SupportTicket_reference_key" ON "SupportTicket"("reference");
CREATE INDEX "SupportTicket_status_priority_createdAt_idx" ON "SupportTicket"("status", "priority", "createdAt");
CREATE INDEX "SupportTicket_schoolId_createdAt_idx" ON "SupportTicket"("schoolId", "createdAt");
CREATE INDEX "SupportTicket_assignedAdminId_status_idx" ON "SupportTicket"("assignedAdminId", "status");
CREATE INDEX "SupportTicketNote_ticketId_createdAt_idx" ON "SupportTicketNote"("ticketId", "createdAt");
CREATE INDEX "SupportTicketAttachment_ticketId_createdAt_idx" ON "SupportTicketAttachment"("ticketId", "createdAt");
CREATE INDEX "SupportAccessSession_createdByAdminId_expiresAt_idx" ON "SupportAccessSession"("createdByAdminId", "expiresAt");
CREATE INDEX "SupportAccessSession_schoolId_createdAt_idx" ON "SupportAccessSession"("schoolId", "createdAt");
CREATE INDEX "SupportAccessSession_ticketId_idx" ON "SupportAccessSession"("ticketId");

ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_requesterUserId_fkey" FOREIGN KEY ("requesterUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "SuperAdmin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_assignedAdminId_fkey" FOREIGN KEY ("assignedAdminId") REFERENCES "SuperAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportTicketNote" ADD CONSTRAINT "SupportTicketNote_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportTicketNote" ADD CONSTRAINT "SupportTicketNote_authorAdminId_fkey" FOREIGN KEY ("authorAdminId") REFERENCES "SuperAdmin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupportTicketAttachment" ADD CONSTRAINT "SupportTicketAttachment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportTicketAttachment" ADD CONSTRAINT "SupportTicketAttachment_uploadedByAdminId_fkey" FOREIGN KEY ("uploadedByAdminId") REFERENCES "SuperAdmin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupportAccessSession" ADD CONSTRAINT "SupportAccessSession_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportAccessSession" ADD CONSTRAINT "SupportAccessSession_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportAccessSession" ADD CONSTRAINT "SupportAccessSession_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "SuperAdmin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
