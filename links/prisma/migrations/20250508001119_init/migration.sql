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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "v" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinkChangedEvent" (
    "id" SERIAL NOT NULL,
    "queue" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "LinkChangedEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "User_id_deletedAt_idx" ON "User"("id", "deletedAt");

-- CreateIndex
CREATE INDEX "Link_userId_createdAt_idx" ON "Link"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Link_id_v_idx" ON "Link"("id", "v" DESC);

-- CreateIndex
CREATE INDEX "Link_id_deletedAt_idx" ON "Link"("id", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Link_short_deletedAt_key" ON "Link"("short", "deletedAt");

-- CreateIndex
CREATE INDEX "LinkChangedEvent_sentAt_idx" ON "LinkChangedEvent"("sentAt");

-- AddForeignKey
ALTER TABLE "Link" ADD CONSTRAINT "Link_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
