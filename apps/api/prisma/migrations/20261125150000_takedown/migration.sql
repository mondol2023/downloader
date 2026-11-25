-- CreateEnum
CREATE TYPE "TakedownStatus" AS ENUM ('PENDING', 'ACTIVE', 'REJECTED');

-- CreateTable
CREATE TABLE "Takedown" (
    "id" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "TakedownStatus" NOT NULL DEFAULT 'PENDING',
    "requesterEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,

    CONSTRAINT "Takedown_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Takedown_mediaId_key" ON "Takedown"("mediaId");

-- CreateIndex
CREATE INDEX "Takedown_status_createdAt_idx" ON "Takedown"("status", "createdAt");
