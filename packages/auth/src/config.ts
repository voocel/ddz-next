import type { TokenConfig } from "./token.js";

/**
 * 读取并校验 JWT 令牌配置：api 与 game-server 共用同一实现，
 * 确保两侧对同一 JWT_SECRET 的强度校验一致（≥32 字符），
 * 避免某个服务接受弱密钥导致 token 可被离线爆破伪造。
 */
export function readTokenConfig(env: NodeJS.ProcessEnv = process.env): TokenConfig {
  const secret = env.JWT_SECRET?.trim();
  // 至少 32 字符，避免弱密钥被离线暴力破解后伪造 token
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters to sign and verify access tokens.");
  }

  const ttl = Number(env.ACCESS_TOKEN_TTL_SECONDS ?? 3600);
  if (!Number.isInteger(ttl) || ttl <= 0) {
    throw new Error("ACCESS_TOKEN_TTL_SECONDS must be a positive integer.");
  }

  return {
    secret,
    issuer: env.JWT_ISSUER?.trim() || "ddz-api",
    audience: env.JWT_AUDIENCE?.trim() || "ddz-web",
    accessTokenTtlSeconds: ttl
  };
}
