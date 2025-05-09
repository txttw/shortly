-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "scopes" JSONB NOT NULL,
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

-- CreateIndex
CREATE INDEX "User_id_v_idx" ON "User"("id", "v" DESC);

-- CreateIndex
CREATE INDEX "User_id_deletedAt_idx" ON "User"("id", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_deletedAt_key" ON "User"("username", "deletedAt");

-- CreateIndex
CREATE INDEX "UserChangedEvent_sentAt_idx" ON "UserChangedEvent"("sentAt");
