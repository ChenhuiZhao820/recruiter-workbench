-- Talent database, iteration 1. Additive only: new tables, new nullable or
-- defaulted columns, new indexes. No existing column changes type or meaning.

-- AlterTable
ALTER TABLE "Role" ADD COLUMN     "budgetCurrency" TEXT,
ADD COLUMN     "budgetMax" INTEGER,
ADD COLUMN     "budgetMin" INTEGER;

-- AlterTable
ALTER TABLE "Candidate" ADD COLUMN     "personId" TEXT;

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "bookingDurationMins" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "bookingHorizonDays" INTEGER NOT NULL DEFAULT 14,
ADD COLUMN     "bookingMinNoticeHours" INTEGER NOT NULL DEFAULT 12,
ADD COLUMN     "bookingTimezone" TEXT NOT NULL DEFAULT 'Europe/London',
ADD COLUMN     "bookingWindows" TEXT NOT NULL DEFAULT '[]',
ADD COLUMN     "meetingLink" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "offerPhone" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "privacyContactEmail" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "privacyNotice" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "Person" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "profileUrl" TEXT,
    "memberId" TEXT,
    "headline" TEXT,
    "email" TEXT,
    "emailSource" TEXT,
    "emailConsentAt" TIMESTAMP(3),
    "salaryMin" INTEGER,
    "salaryMax" INTEGER,
    "salaryCurrency" TEXT,
    "salaryNote" TEXT,
    "noticeWeeks" INTEGER,
    "availableFrom" TIMESTAMP(3),
    "location" TEXT,
    "remotePreference" TEXT,
    "rightToWork" TEXT,
    "rightToWorkNote" TEXT,
    "skillsSummary" TEXT,
    "motivation" TEXT,
    "factsConfirmedAt" TIMESTAMP(3),
    "revisitOn" TIMESTAMP(3),
    "revisitNote" TEXT,
    "doNotContact" BOOLEAN NOT NULL DEFAULT false,
    "searchText" TEXT NOT NULL DEFAULT '',
    "lastContactAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Screening" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "transcript" TEXT,
    "transcriptSource" TEXT,
    "transcriptDeleteAfter" TIMESTAMP(3),
    "summaryJson" TEXT,
    "summaryModel" TEXT,
    "generatedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "representConsentAt" TIMESTAMP(3),
    "clientEmailSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Screening_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "mode" TEXT NOT NULL,
    "meetingUrl" TEXT,
    "phone" TEXT,
    "email" TEXT NOT NULL,
    "consentAt" TIMESTAMP(3) NOT NULL,
    "noticeVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'booked',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookedSlot" (
    "userId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "bookingId" TEXT NOT NULL,

    CONSTRAINT "BookedSlot_pkey" PRIMARY KEY ("userId","startsAt")
);

-- CreateTable
CREATE TABLE "CalendarConnection" (
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "tokenCipher" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastErrorAt" TIMESTAMP(3),

    CONSTRAINT "CalendarConnection_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "AiUsage" (
    "userId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "generations" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("userId","month")
);

-- CreateTable
CREATE TABLE "UsageEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" INTEGER,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Suppression" (
    "userId" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Suppression_pkey" PRIMARY KEY ("userId","keyHash")
);

-- CreateIndex
CREATE INDEX "Person_userId_revisitOn_idx" ON "Person"("userId", "revisitOn");

-- CreateIndex
CREATE UNIQUE INDEX "Person_userId_profileUrl_key" ON "Person"("userId", "profileUrl");

-- CreateIndex
CREATE UNIQUE INDEX "Person_userId_memberId_key" ON "Person"("userId", "memberId");

-- CreateIndex
CREATE INDEX "Screening_candidateId_idx" ON "Screening"("candidateId");

-- CreateIndex
CREATE INDEX "Booking_candidateId_idx" ON "Booking"("candidateId");

-- CreateIndex
CREATE INDEX "Booking_userId_startsAt_idx" ON "Booking"("userId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "BookedSlot_bookingId_key" ON "BookedSlot"("bookingId");

-- CreateIndex
CREATE INDEX "UsageEvent_userId_kind_at_idx" ON "UsageEvent"("userId", "kind", "at");

-- CreateIndex
CREATE INDEX "Candidate_personId_idx" ON "Candidate"("personId");

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Screening" ADD CONSTRAINT "Screening_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookedSlot" ADD CONSTRAINT "BookedSlot_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarConnection" ADD CONSTRAINT "CalendarConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Suppression" ADD CONSTRAINT "Suppression_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

