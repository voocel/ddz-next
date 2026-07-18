-- 流局(竞技场 LLM 决策耗尽重试后放弃本局):
-- abortReason 非空即本局未产生结算;failedPlayerId 记技术负归属(排行按模型聚合时关联 RoundPlayer)
ALTER TABLE "Round" ADD COLUMN "abortReason" TEXT;
ALTER TABLE "Round" ADD COLUMN "failedPlayerId" TEXT;
