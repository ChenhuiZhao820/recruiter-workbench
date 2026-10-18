-- AlterTable
ALTER TABLE "Role" ADD COLUMN     "clientReviewFirst" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "interviewDurationMins" INTEGER,
ADD COLUMN     "interviewLocation" TEXT,
ADD COLUMN     "interviewTimezone" TEXT,
ADD COLUMN     "interviewWindows" TEXT NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "Candidate" ADD COLUMN     "submittedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'screening';

-- CreateTable
CREATE TABLE "InterviewSlot" (
    "userId" TEXT NOT NULL,
    "clientKey" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "bookingId" TEXT NOT NULL,

    CONSTRAINT "InterviewSlot_pkey" PRIMARY KEY ("userId","clientKey","startsAt")
);

-- CreateTable
CREATE TABLE "Shortlist" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "roleId" TEXT,
    "title" TEXT NOT NULL,
    "client" TEXT,
    "access" TEXT NOT NULL DEFAULT 'link',
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shortlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShortlistItem" (
    "id" TEXT NOT NULL,
    "shortlistId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "candidateId" TEXT,
    "consentAt" TIMESTAMP(3) NOT NULL,
    "pitch" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "decision" TEXT,
    "decisionReason" TEXT,
    "decisionNote" TEXT,
    "decisionAt" TIMESTAMP(3),
    "decisionAccessId" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShortlistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShortlistAccess" (
    "id" TEXT NOT NULL,
    "shortlistId" TEXT NOT NULL,
    "email" TEXT,
    "nonce" TEXT NOT NULL,
    "lastViewedAt" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShortlistAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InterviewSlot_bookingId_key" ON "InterviewSlot"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "Shortlist_roleId_key" ON "Shortlist"("roleId");

-- CreateIndex
CREATE INDEX "Shortlist_userId_kind_idx" ON "Shortlist"("userId", "kind");

-- CreateIndex
CREATE INDEX "ShortlistItem_personId_idx" ON "ShortlistItem"("personId");

-- CreateIndex
CREATE INDEX "ShortlistItem_candidateId_idx" ON "ShortlistItem"("candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "ShortlistItem_shortlistId_personId_key" ON "ShortlistItem"("shortlistId", "personId");

-- CreateIndex
CREATE INDEX "ShortlistAccess_shortlistId_idx" ON "ShortlistAccess"("shortlistId");

-- AddForeignKey
ALTER TABLE "InterviewSlot" ADD CONSTRAINT "InterviewSlot_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shortlist" ADD CONSTRAINT "Shortlist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shortlist" ADD CONSTRAINT "Shortlist_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShortlistItem" ADD CONSTRAINT "ShortlistItem_shortlistId_fkey" FOREIGN KEY ("shortlistId") REFERENCES "Shortlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShortlistItem" ADD CONSTRAINT "ShortlistItem_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShortlistItem" ADD CONSTRAINT "ShortlistItem_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShortlistAccess" ADD CONSTRAINT "ShortlistAccess_shortlistId_fkey" FOREIGN KEY ("shortlistId") REFERENCES "Shortlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

