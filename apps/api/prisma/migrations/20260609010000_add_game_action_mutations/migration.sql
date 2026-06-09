-- CreateTable
CREATE TABLE "GameActionMutation" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "mutationId" TEXT NOT NULL,
    "actionFingerprint" TEXT NOT NULL,
    "roomEventIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "actionIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "roundId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameActionMutation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GameActionMutation_roomId_mutationId_key" ON "GameActionMutation"("roomId", "mutationId");

-- CreateIndex
CREATE INDEX "GameActionMutation_roomId_createdAt_idx" ON "GameActionMutation"("roomId", "createdAt");

-- AddForeignKey
ALTER TABLE "GameActionMutation" ADD CONSTRAINT "GameActionMutation_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
