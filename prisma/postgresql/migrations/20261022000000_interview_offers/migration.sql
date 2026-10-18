-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "place" TEXT,
ADD COLUMN     "timeZone" TEXT;

-- CreateTable
CREATE TABLE "InterviewOffer" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "times" TEXT NOT NULL,
    "durationMins" INTEGER NOT NULL,
    "timeZone" TEXT NOT NULL,
    "location" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawnAt" TIMESTAMP(3),
    "bookingId" TEXT,

    CONSTRAINT "InterviewOffer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InterviewOffer_bookingId_key" ON "InterviewOffer"("bookingId");

-- CreateIndex
CREATE INDEX "InterviewOffer_candidateId_idx" ON "InterviewOffer"("candidateId");

-- AddForeignKey
ALTER TABLE "InterviewOffer" ADD CONSTRAINT "InterviewOffer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewOffer" ADD CONSTRAINT "InterviewOffer_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewOffer" ADD CONSTRAINT "InterviewOffer_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

