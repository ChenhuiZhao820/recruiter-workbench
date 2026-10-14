-- CreateTable
CREATE TABLE "PersonNote" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "candidateId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationConnection" (
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "tokenCipher" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastErrorAt" TIMESTAMP(3),

    CONSTRAINT "IntegrationConnection_pkey" PRIMARY KEY ("userId","provider")
);

-- CreateIndex
CREATE INDEX "PersonNote_personId_createdAt_idx" ON "PersonNote"("personId", "createdAt");

-- AddForeignKey
ALTER TABLE "PersonNote" ADD CONSTRAINT "PersonNote_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonNote" ADD CONSTRAINT "PersonNote_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationConnection" ADD CONSTRAINT "IntegrationConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

