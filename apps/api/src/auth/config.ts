import type { TokenConfig } from "@ddz/auth";

export function readTokenConfig(env: NodeJS.ProcessEnv = process.env): TokenConfig {
  const secret = env.JWT_SECRET?.trim();
  if (!secret) {
    throw new Error("JWT_SECRET is required to start the API authentication service.");
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
