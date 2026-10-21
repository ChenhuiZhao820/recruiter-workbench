-- AlterTable
ALTER TABLE "OutreachLog" ADD COLUMN     "channel" TEXT;

-- CreateTable
CREATE TABLE "EmailLookup" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "personId" TEXT,
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reason" TEXT,
    "enrowId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "EmailLookup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailLookup_userId_createdAt_idx" ON "EmailLookup"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "EmailLookup_personId_idx" ON "EmailLookup"("personId");

-- AddForeignKey
ALTER TABLE "EmailLookup" ADD CONSTRAINT "EmailLookup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailLookup" ADD CONSTRAINT "EmailLookup_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

