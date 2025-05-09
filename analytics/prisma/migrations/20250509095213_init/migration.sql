-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "v" INTEGER NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Link" (
    "id" TEXT NOT NULL,
    "short" TEXT NOT NULL,
    "long" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "v" INTEGER NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lookup" (
    "id" SERIAL NOT NULL,
    "linkId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lookup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Link_short_key" ON "Link"("short");

-- CreateIndex
CREATE INDEX "Link_short_userId_idx" ON "Link"("short", "userId");

-- CreateIndex
CREATE INDEX "Link_short_expiresAt_idx" ON "Link"("short", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Link_short_deletedAt_key" ON "Link"("short", "deletedAt");

-- CreateIndex
CREATE INDEX "Lookup_linkId_timestamp_idx" ON "Lookup"("linkId", "timestamp" DESC);

-- AddForeignKey
ALTER TABLE "Link" ADD CONSTRAINT "Link_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lookup" ADD CONSTRAINT "Lookup_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "Link"("id") ON DELETE CASCADE ON UPDATE CASCADE;
