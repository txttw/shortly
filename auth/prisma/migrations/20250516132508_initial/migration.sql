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
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "User_id_v_idx" ON "User"("id", "v" DESC);

-- CreateIndex
CREATE INDEX "User_id_deletedAt_idx" ON "User"("id", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_deletedAt_key" ON "User"("username", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_value_key" ON "ApiKey"("value");

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
