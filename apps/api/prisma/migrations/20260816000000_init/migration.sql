-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'standard',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomLiveState" (
    "roomId" TEXT NOT NULL,
    "state" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoomLiveState_pkey" PRIMARY KEY ("roomId")
);

-- CreateTable
CREATE TABLE "RoomEvent" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "playerId" TEXT,
    "playerKind" TEXT,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoomEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Round" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "landlordId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "abortReason" TEXT,
    "failedPlayerId" TEXT,

    CONSTRAINT "Round_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoundPlayer" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "playerKind" TEXT NOT NULL,
    "seat" INTEGER NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "botProvider" TEXT,
    "botModel" TEXT,

    CONSTRAINT "RoundPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameAction" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "playerId" TEXT,
    "playerKind" TEXT,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameActionMutation" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "mutationId" TEXT NOT NULL,
    "actionFingerprint" TEXT NOT NULL,
    "roomEventIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "actionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "roundId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameActionMutation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomClaim" (
    "roomId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoomClaim_pkey" PRIMARY KEY ("roomId")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Room_code_key" ON "Room"("code");

-- CreateIndex
CREATE INDEX "RoomEvent_roomId_createdAt_idx" ON "RoomEvent"("roomId", "createdAt");

-- CreateIndex
CREATE INDEX "RoomEvent_roomId_seq_idx" ON "RoomEvent"("roomId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "RoomEvent_roomId_seq_key" ON "RoomEvent"("roomId", "seq");

-- CreateIndex
CREATE INDEX "RoundPlayer_botProvider_botModel_idx" ON "RoundPlayer"("botProvider", "botModel");

-- CreateIndex
CREATE UNIQUE INDEX "RoundPlayer_roundId_seat_key" ON "RoundPlayer"("roundId", "seat");

-- CreateIndex
CREATE UNIQUE INDEX "RoundPlayer_roundId_playerId_key" ON "RoundPlayer"("roundId", "playerId");

-- CreateIndex
CREATE INDEX "GameAction_roundId_createdAt_idx" ON "GameAction"("roundId", "createdAt");

-- CreateIndex
CREATE INDEX "GameAction_roundId_seq_idx" ON "GameAction"("roundId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "GameAction_roundId_seq_key" ON "GameAction"("roundId", "seq");

-- CreateIndex
CREATE INDEX "GameActionMutation_roomId_createdAt_idx" ON "GameActionMutation"("roomId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GameActionMutation_roomId_mutationId_key" ON "GameActionMutation"("roomId", "mutationId");

-- CreateIndex
CREATE INDEX "RoomClaim_ownerId_idx" ON "RoomClaim"("ownerId");

-- CreateIndex
CREATE INDEX "RoomClaim_expiresAt_idx" ON "RoomClaim"("expiresAt");

-- AddForeignKey
ALTER TABLE "RoomLiveState" ADD CONSTRAINT "RoomLiveState_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomEvent" ADD CONSTRAINT "RoomEvent_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Round" ADD CONSTRAINT "Round_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoundPlayer" ADD CONSTRAINT "RoundPlayer_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "Round"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameAction" ADD CONSTRAINT "GameAction_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "Round"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameActionMutation" ADD CONSTRAINT "GameActionMutation_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomClaim" ADD CONSTRAINT "RoomClaim_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- 部分唯一索引(Prisma schema 无法表达):同一房间同时只允许一局未结束
CREATE UNIQUE INDEX "Round_roomId_open_round_key" ON "Round"("roomId") WHERE "endedAt" IS NULL;
