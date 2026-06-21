-- Add deterministic per-room/per-round replay ordering.
ALTER TABLE "RoomEvent" ADD COLUMN "seq" INTEGER;
ALTER TABLE "GameAction" ADD COLUMN "seq" INTEGER;

WITH ordered AS (
  SELECT
    "id",
    row_number() OVER (PARTITION BY "roomId" ORDER BY "createdAt" ASC, "id" ASC) AS "seq"
  FROM "RoomEvent"
)
UPDATE "RoomEvent" event
SET "seq" = ordered."seq"
FROM ordered
WHERE event."id" = ordered."id";

WITH ordered AS (
  SELECT
    "id",
    row_number() OVER (PARTITION BY "roundId" ORDER BY "createdAt" ASC, "id" ASC) AS "seq"
  FROM "GameAction"
)
UPDATE "GameAction" action
SET "seq" = ordered."seq"
FROM ordered
WHERE action."id" = ordered."id";

ALTER TABLE "RoomEvent" ALTER COLUMN "seq" SET NOT NULL;
ALTER TABLE "GameAction" ALTER COLUMN "seq" SET NOT NULL;

CREATE UNIQUE INDEX "RoomEvent_roomId_seq_key" ON "RoomEvent"("roomId", "seq");
CREATE INDEX "RoomEvent_roomId_seq_idx" ON "RoomEvent"("roomId", "seq");
CREATE UNIQUE INDEX "GameAction_roundId_seq_key" ON "GameAction"("roundId", "seq");
CREATE INDEX "GameAction_roundId_seq_idx" ON "GameAction"("roundId", "seq");

-- Explicit game-server room lease. One live owner per room, with expiry for crash recovery.
CREATE TABLE "RoomClaim" (
    "roomId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoomClaim_pkey" PRIMARY KEY ("roomId")
);

CREATE INDEX "RoomClaim_ownerId_idx" ON "RoomClaim"("ownerId");
CREATE INDEX "RoomClaim_expiresAt_idx" ON "RoomClaim"("expiresAt");

ALTER TABLE "RoomClaim" ADD CONSTRAINT "RoomClaim_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
