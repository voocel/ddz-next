import { botModelsResponseSchema, type BotModelsResponse } from "@ddz/protocol";

/**
 * 拉取 game-server 下发的可选机器人模型清单(无密钥)。失败/格式不符返回空清单——
 * 「AI 对战」会退化为只用「服务端默认」,不阻塞使用。
 */
export async function fetchBotModels(endpoint: string): Promise<BotModelsResponse> {
  const empty: BotModelsResponse = { default: { provider: "", model: "" }, models: [] };
  try {
    const response = await fetch(`${endpoint.replace(/\/$/, "")}/bot-models`);
    if (!response.ok) {
      return empty;
    }
    const parsed = botModelsResponseSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : empty;
  } catch {
    return empty;
  }
}
