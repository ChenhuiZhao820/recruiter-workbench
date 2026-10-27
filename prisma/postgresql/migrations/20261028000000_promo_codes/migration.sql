-- AlterTable
ALTER TABLE "User" ADD COLUMN     "promoProFrom" TIMESTAMP(3),
ADD COLUMN     "promoProUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PromoRedemption" (
    "id" TEXT NOT NULL,
    "promoId" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromoRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PromoRedemption_promoId_keyHash_key" ON "PromoRedemption"("promoId", "keyHash");

