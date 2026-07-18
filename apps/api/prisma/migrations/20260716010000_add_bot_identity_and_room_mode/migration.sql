-- Room 玩法模式:'standard' 常规;'arena' 全 AI 对战房(供直播/竞技场列表过滤)
ALTER TABLE "Room" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'standard';

-- LLM bot 的模型身份(真人与规则 bot 为 NULL),排行榜按 (botProvider, botModel) 聚合
ALTER TABLE "RoundPlayer" ADD COLUMN "botProvider" TEXT;
ALTER TABLE "RoundPlayer" ADD COLUMN "botModel" TEXT;

CREATE INDEX "RoundPlayer_botProvider_botModel_idx" ON "RoundPlayer"("botProvider", "botModel");
