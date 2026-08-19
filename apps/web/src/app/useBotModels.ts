import { useEffect, useState } from "react";
import type { BotModelOption } from "@ddz/protocol";
import { fetchBotModels } from "../net/botModels";

/** 可选模型清单:启动时从 game-server 的 /bot-models 拉一次(纯展示数据,无密钥);失败静默为空,选人入口据此禁用。 */
export function useBotModels(): readonly BotModelOption[] {
  const [models, setModels] = useState<readonly BotModelOption[]>([]);

  useEffect(() => {
    const endpoint = import.meta.env.VITE_GAME_ENDPOINT ?? "http://localhost:2567";
    let cancelled = false;
    void fetchBotModels(endpoint).then((response) => {
      if (!cancelled) {
        setModels(response.models);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return models;
}
