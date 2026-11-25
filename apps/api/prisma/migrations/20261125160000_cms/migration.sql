-- CreateEnum
CREATE TYPE "CmsStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "CmsPage" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "CmsStatus" NOT NULL DEFAULT 'DRAFT',
    "contentJson" JSONB NOT NULL,
    "contentHtml" TEXT NOT NULL,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "ogImageId" TEXT,
    "publishAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CmsPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CmsRevision" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "contentJson" JSONB NOT NULL,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CmsRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CmsBlock" (
    "key" TEXT NOT NULL,
    "contentJson" JSONB NOT NULL,
    "contentHtml" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CmsBlock_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "CmsAsset" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "alt" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CmsAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CmsPage_slug_key" ON "CmsPage"("slug");

-- CreateIndex
CREATE INDEX "CmsPage_status_publishAt_idx" ON "CmsPage"("status", "publishAt");

-- CreateIndex
CREATE UNIQUE INDEX "CmsRevision_pageId_version_key" ON "CmsRevision"("pageId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "CmsAsset_key_key" ON "CmsAsset"("key");

-- AddForeignKey
ALTER TABLE "CmsRevision" ADD CONSTRAINT "CmsRevision_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "CmsPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
