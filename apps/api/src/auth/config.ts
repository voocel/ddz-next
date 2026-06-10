import type { TokenConfig } from "@ddz/auth";

export function readTokenConfig(env: NodeJS.ProcessEnv = process.env): TokenConfig {
  const secret = env.JWT_SECRET?.trim();
  // 至少 32 字符，避免弱密钥被暴力破解
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters to start the API authentication service.");
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
