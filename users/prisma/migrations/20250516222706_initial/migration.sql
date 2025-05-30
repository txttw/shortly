-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "permissions" JSONB NOT NULL,
    "password" TEXT NOT NULL,
    "v" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserChangedEvent" (
    "id" SERIAL NOT NULL,
    "queue" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "UserChangedEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Link" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "v" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Link_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "User_id_v_idx" ON "User"("id", "v" DESC);

-- CreateIndex
CREATE INDEX "User_id_deletedAt_idx" ON "User"("id", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_deletedAt_key" ON "User"("username", "deletedAt");

-- CreateIndex
CREATE INDEX "UserChangedEvent_sentAt_idx" ON "UserChangedEvent"("sentAt");

-- CreateIndex
CREATE INDEX "Link_id_v_idx" ON "Link"("id", "v" DESC);

-- CreateIndex
CREATE INDEX "Link_id_deletedAt_expiresAt_idx" ON "Link"("id", "deletedAt", "expiresAt");

-- AddForeignKey
ALTER TABLE "Link" ADD CONSTRAINT "Link_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
