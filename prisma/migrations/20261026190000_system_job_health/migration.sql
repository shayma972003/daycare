CREATE TYPE "SystemJobRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

CREATE TABLE "SystemJobRun" (
    "id" TEXT NOT NULL,
    "jobKey" TEXT NOT NULL,
    "status" "SystemJobRunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "errorCode" TEXT,

    CONSTRAINT "SystemJobRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SystemJobRun_jobKey_startedAt_idx" ON "SystemJobRun"("jobKey", "startedAt");
CREATE INDEX "SystemJobRun_status_startedAt_idx" ON "SystemJobRun"("status", "startedAt");
