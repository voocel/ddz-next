import { readRootFile } from "@ddz/env";
import { parseBotProviderRegistry, type BotProviderRegistry } from "@ddz/bot-ai";

/**
 * 取机器人供应商注册表的原始配置字符串。来源优先级:
 *   1) BOT_PROVIDERS        —— 内联 JSON 字符串(部署友好:docker-compose / PaaS / serverless 用 env 注入,免挂卷)
 *   2) BOT_PROVIDERS_FILE / 默认 bot-providers.json —— 仓库根的 JSON 文件(相对仓库根或绝对路径)
 * 两者皆无返回 null,由 parseBotProviderRegistry 用 ANTHROPIC_API_KEY 合成默认 anthropic 兜底。
 * 含密钥,仅服务端持有。
 */
export function readBotProvidersRaw(env: NodeJS.ProcessEnv = process.env): string | null {
  const inline = env.BOT_PROVIDERS?.trim();
  return inline ? inline : readRootFile(env.BOT_PROVIDERS_FILE ?? "bot-providers.json");
}

/** 加载并解析注册表。解析失败(JSON 非法/schema 不符)显式抛错——配置写错应启动即失败。 */
export function loadBotProviderRegistry(env: NodeJS.ProcessEnv = process.env): BotProviderRegistry {
  return parseBotProviderRegistry(readBotProvidersRaw(env), env);
}
