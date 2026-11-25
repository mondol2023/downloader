-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'EDITOR', 'ADMIN');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "role" "Role" NOT NULL DEFAULT 'USER';

-- AlterTable
ALTER TABLE "AuditEvent" ADD COLUMN "actorId" TEXT,
ADD COLUMN "target" TEXT,
ADD COLUMN "before" JSONB,
ADD COLUMN "after" JSONB;

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "AuditEvent_actorId_createdAt_idx" ON "AuditEvent"("actorId", "createdAt");
