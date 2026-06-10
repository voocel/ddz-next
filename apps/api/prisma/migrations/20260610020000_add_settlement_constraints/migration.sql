-- 数据兼容：同一房间存在多局未结束时，仅保留最近开始的一局，其余补记结束时间
UPDATE "Round" r
SET "endedAt" = now()
WHERE r."endedAt" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "Round" newer
    WHERE newer."roomId" = r."roomId"
      AND newer."endedAt" IS NULL
      AND (newer."startedAt" > r."startedAt"
        OR (newer."startedAt" = r."startedAt" AND newer."id" > r."id"))
  );

-- 数据兼容：同一局对同一用户的重复金币流水仅保留最早一条
DELETE FROM "CoinLedger" cl
WHERE EXISTS (
  SELECT 1
  FROM "CoinLedger" first
  WHERE first."roundId" = cl."roundId"
    AND first."userId" = cl."userId"
    AND (first."createdAt" < cl."createdAt"
      OR (first."createdAt" = cl."createdAt" AND first."id" < cl."id"))
);

-- DropIndex：被下方 (roundId, userId) 唯一索引覆盖
DROP INDEX "CoinLedger_roundId_idx";

-- CreateIndex：同一局对同一用户只允许一条流水
CREATE UNIQUE INDEX "CoinLedger_roundId_userId_key" ON "CoinLedger"("roundId", "userId");

-- CreateIndex：部分唯一索引（Prisma schema 无法表达），保证同一房间同时只有一局未结束
CREATE UNIQUE INDEX "Round_roomId_open_round_key" ON "Round"("roomId") WHERE "endedAt" IS NULL;
